"""main.py — FastAPI app. Run: uvicorn main:app --reload --port 8000"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import uuid
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from app import store
from app.config import IMAGES_DIR, SERVERLESS
from app.generation import tutor_stream, tutor_system
from app.pipeline import run_pipeline, run_redesign
from app.sse import sse

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Qlearn prototype")
# Browsers send the origin without a trailing slash, so normalize what's configured.
_CORS = os.getenv("CORS_ORIGINS", "https://frontend-green-two-23.vercel.app")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", *(o.strip().rstrip("/") for o in _CORS.split(",") if o.strip())],
                   allow_methods=["*"], allow_headers=["*"])


class GenerationPrefs(BaseModel):
    level: Literal["Beginner", "Intermediate", "Advanced"] = "Intermediate"
    depth: Literal["Quick overview", "Balanced", "Deep dive"] = "Balanced"
    # Valid values: Examples | Theory | Visual | Code-heavy | Story-based. Unknown values are ignored.
    style: list[str] = Field(default_factory=lambda: ["Examples", "Visual", "Story-based"])
    background: str | None = Field(default=None, max_length=500)
    # Picks the text model (and, for "meme", Nano Banana images). See TEMPLATE_MODELS in app/config.py.
    template: Literal["general", "meme", "story"] = "general"


class GenerateRequest(BaseModel):
    source_type: Literal["topic", "url", "text"]
    input: str
    prefs: GenerationPrefs = Field(default_factory=GenerationPrefs)


class TutorMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class TutorRequest(BaseModel):
    messages: list[TutorMessage] = Field(min_length=1)


class RedesignRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=500)
    template: Literal["general", "meme", "story"] | None = None
    lesson_id: str | None = None


_tasks: set[asyncio.Task] = set()  # strong refs so running pipelines aren't GC'd


def _spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


def _job_coro(course_id: str, job: dict):
    if job["kind"] == "redesign":
        return run_redesign(course_id, job["instruction"], job.get("template"), job.get("lesson_id"))
    pdf = base64.b64decode(job["pdf_b64"]) if job.get("pdf_b64") else None
    return run_pipeline(course_id, job["source_type"], job["raw_input"], pdf, job["prefs"])


def _dispatch(course: dict, job: dict) -> None:
    """Start a job. Caller saves `course` afterwards.

    Local: run it now as a background task. Serverless: park it on the course; the first
    /stream request claims and runs it inside its own (long-lived, streaming) invocation,
    because a fire-and-forget task can be frozen as soon as this response is sent.
    """
    if SERVERLESS:
        course["job"] = job
    else:
        _spawn(_job_coro(course["id"], job))

_SUMMARY_FIELDS = ("id", "title", "tagline", "difficulty", "tags", "duration_days", "minutes_per_day",
                   "status", "lesson_count", "icon", "gradient", "accent_color", "source_type", "created_at", "template")
_DETAIL_FIELDS = _SUMMARY_FIELDS + ("outcome", "prerequisites", "topic_complexity", "source_title",
                                    "source_url", "error_message")


def _start(source_type: str, raw_input: str, prefs: GenerationPrefs, pdf_bytes: bytes | None = None) -> dict:
    course_id = str(uuid.uuid4())
    course = {
        "id": course_id, "status": "queued", "title": "Preparing your course...", "tagline": "",
        "outcome": "", "difficulty": prefs.level.lower(), "tags": [], "duration_days": 0,
        "minutes_per_day": 15, "lesson_count": 0, "icon": "general",
        "gradient": "from-violet-600 to-indigo-700", "accent_color": "#7C3AED",
        "source_type": source_type, "source_title": None, "source_url": None, "source_excerpt": None,
        "topic_complexity": None, "prerequisites": [], "error_message": None,
        "prefs": prefs.model_dump(), "template": prefs.template, "created_at": store.now(), "updated_at": store.now(), "lessons": [],
    }
    job = {"kind": "generate", "source_type": source_type, "raw_input": raw_input, "prefs": prefs.model_dump()}
    if pdf_bytes:
        job["pdf_b64"] = base64.b64encode(pdf_bytes).decode()
    _dispatch(course, job)
    store.save(course)
    return {"course_id": course_id}


def _get(course_id: str) -> dict:
    course = store.load(course_id)
    if course is None:
        raise HTTPException(404, "Course not found")
    return course


@app.post("/api/generate")
async def generate(req: GenerateRequest):
    text = req.input.strip()
    if not text:
        raise HTTPException(422, "Input must not be empty.")
    if req.source_type == "text" and len(text.split()) < 20:
        raise HTTPException(422, "Pasted text must be at least 20 words.")
    if req.source_type == "url" and not text.startswith(("http://", "https://")):
        raise HTTPException(422, "URL must start with http:// or https://")
    return _start(req.source_type, text, req.prefs)


@app.post("/api/generate/pdf")
async def generate_pdf(file: UploadFile = File(...), prefs: str | None = Form(None)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(422, "File must be a PDF.")
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(422, "PDF is empty.")
    if len(pdf_bytes) > 20 * 1024 * 1024:
        raise HTTPException(422, "PDF too large (max 20 MB).")
    try:
        parsed = GenerationPrefs(**json.loads(prefs)) if prefs else GenerationPrefs()
    except (json.JSONDecodeError, TypeError, ValidationError) as exc:
        raise HTTPException(422, f"Invalid prefs: {exc}")
    return _start("pdf", file.filename, parsed, pdf_bytes)


@app.get("/api/generate/{course_id}/stream")
async def stream(course_id: str):
    course = _get(course_id)

    async def events():
        if SERVERLESS:
            job = await _claim(course_id)
            if job:  # this invocation runs the job; events come from it in-process
                _spawn(_job_coro(course_id, job))
                async for event in sse.subscribe(course_id):
                    yield event
                return
            if course["status"] not in ("ready", "error"):
                # Running on another instance: in-process events never reach us, follow the store.
                async for event in _follow_store(course_id):
                    yield event
                return
        # Pipeline already finished (history is dropped on close) — emit the terminal event and stop.
        if course["status"] == "ready":
            yield f"data: {json.dumps({'type': 'complete', 'course_id': course_id, 'title': course['title'], 'duration_days': course['duration_days']})}\n\n"
            return
        if course["status"] == "error":
            yield f"data: {json.dumps({'type': 'error', 'message': (course['error_message'] or '')[:200]})}\n\n"
            return
        async for event in sse.subscribe(course_id):
            yield event

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                                      "Connection": "keep-alive"})


async def _claim(course_id: str) -> dict | None:
    """Atomically take the parked job so only one stream runs it."""
    async with store.lock:
        course = store.load(course_id)
        job = (course or {}).pop("job", None)
        if job:
            store.save(course)
        return job


# ponytail: store.lock is per-process, so two instances could both claim the same job in the
# same instant (double generation). Needs a conditional UPDATE ... WHERE job IS NOT NULL in
# Supabase if that ever shows up; the frontend opens one stream per course, so it's rare.
async def _follow_store(course_id: str, interval: float = 2.0):
    """SSE derived from polling the store, for a viewer on a different instance than the job."""
    seen: dict[str, str] = {}
    first = True
    while True:
        course = store.load(course_id)
        if course is None:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Course was deleted.'})}\n\n"
            return
        for l in sorted(course["lessons"], key=lambda l: l["day_number"]):
            digest = hashlib.md5(json.dumps(l, sort_keys=True).encode()).hexdigest()
            if seen.get(l["id"]) != digest:
                if not first:  # lessons that already existed on connect are not news
                    yield "data: " + json.dumps({
                        "type": "lesson_ready", "day": l["day_number"], "lesson_id": l["id"], "title": l["title"],
                        "lessons_ready": len(course["lessons"]),
                        "lessons_total": course.get("duration_days") or len(course["lessons"])}) + "\n\n"
                seen[l["id"]] = digest
        first = False
        if course["status"] == "ready":
            yield "data: " + json.dumps({"type": "complete", "course_id": course_id, "title": course["title"],
                                         "duration_days": course["duration_days"]}) + "\n\n"
            return
        if course["status"] == "error":
            yield f"data: {json.dumps({'type': 'error', 'message': (course.get('error_message') or '')[:200]})}\n\n"
            return
        yield ": keepalive\n\n"
        await asyncio.sleep(interval)


@app.get("/api/generate/{course_id}/status")
async def status(course_id: str):
    c = _get(course_id)
    messages = {
        "queued": "Queued — starting soon…",
        "extracting": "Reading your source…",
        "generating": f"Generating lessons ({c['lesson_count']} of {c['duration_days'] or '?'})…",
        "redesigning": "Rewriting your lessons…",
        "ready": "Your course is ready!",
        "error": f"Generation failed: {c['error_message'] or 'Unknown error'}",
    }
    return {"course_id": course_id, "status": c["status"],
            "progress_message": messages.get(c["status"], "Processing…"),
            "lesson_count": c["lesson_count"], "duration_days": c["duration_days"],
            "title": c["title"], "error_message": c["error_message"]}


@app.get("/api/courses")
async def list_courses():
    return [{k: c.get(k) for k in _SUMMARY_FIELDS} | {"template": c.get("template") or "general"}
            for c in store.list_all()]


@app.get("/api/courses/{course_id}")
async def get_course(course_id: str):
    c = _get(course_id)
    out = {k: c.get(k) for k in _DETAIL_FIELDS}
    out["template"] = c.get("template") or "general"
    out["lessons"] = sorted(
        ({k: l[k] for k in ("id", "title", "day_number", "estimated_minutes")} for l in c["lessons"]),
        key=lambda l: l["day_number"],
    )
    return out


def _lesson(course: dict, lesson_id: str) -> dict:
    for lesson in course["lessons"]:
        if lesson["id"] == lesson_id:
            return {**lesson, "template": lesson.get("template") or course.get("template") or "general"}
    raise HTTPException(404, "Lesson not found")


@app.get("/api/courses/{course_id}/lessons/{lesson_id}")
async def get_lesson(course_id: str, lesson_id: str):
    return _lesson(_get(course_id), lesson_id)


@app.post("/api/courses/{course_id}/lessons/{lesson_id}/tutor")
async def tutor(course_id: str, lesson_id: str, req: TutorRequest):
    course = _get(course_id)
    lesson = _lesson(course, lesson_id)
    messages = [m.model_dump() for m in req.messages[-20:]]
    if messages[-1]["role"] != "user":
        raise HTTPException(422, "The last message must be the learner's.")
    try:
        chunks = await asyncio.to_thread(tutor_stream, tutor_system(course, lesson), messages)
    except Exception as exc:
        logging.error("Tutor failed for course %s: %s", course_id, exc)
        raise HTTPException(502, f"Tutor unavailable: {str(exc)[:200]}")
    # A sync iterator: Starlette pulls it in a threadpool, so the blocking stream never stalls the loop.
    return StreamingResponse(chunks, media_type="text/plain; charset=utf-8",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/courses/{course_id}/redesign", status_code=202)
async def redesign(course_id: str, req: RedesignRequest):
    # ponytail: status lives only in the JSON, so a server restart mid-redesign leaves it "redesigning"
    # (409 forever), same as a mid-generation restart today. Reset stale statuses on startup if that bites.
    async with store.lock:  # check-and-set, so two clicks can't start two redesigns
        course = _get(course_id)
        if course["status"] not in ("ready", "error"):
            raise HTTPException(409, f"Course is {course['status']}, try again when it is done.")
        if not course["lessons"]:
            raise HTTPException(409, "This course has no lessons to redesign.")
        if req.lesson_id:
            _lesson(course, req.lesson_id)
        course["status"] = "redesigning"
        course["updated_at"] = store.now()
        _dispatch(course, {"kind": "redesign", "instruction": req.instruction, "template": req.template,
                           "lesson_id": req.lesson_id})
        store.save(course)
    lesson_ids = [req.lesson_id] if req.lesson_id else [
        l["id"] for l in sorted(course["lessons"], key=lambda l: l["day_number"])]
    return {"course_id": course_id, "lesson_ids": lesson_ids}


@app.delete("/api/courses/{course_id}")
async def delete_course(course_id: str):
    async with store.lock:
        if not store.delete(course_id):
            raise HTTPException(404, "Course not found")
    return {"ok": True}


if SERVERLESS and not store.USING_SUPABASE:
    # Read-only, per-request filesystem: JSON files would vanish or fail. Fail loudly at boot.
    raise RuntimeError("Running on Vercel requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")

# Local meme images (with Supabase they live in Storage). Mounted last so it never shadows an /api route.
if not store.USING_SUPABASE:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/api/images", StaticFiles(directory=IMAGES_DIR), name="images")
