"""
app/pipeline.py — Course generation pipeline with real-time SSE updates.

Flow:
  1. Extract content (URL / YouTube / PDF / text / topic)
  2. Phase 1 LLM call: course structure (title, lesson outlines)  → broadcast structure_ready
  3. Phase 2 LLM calls: all lessons in parallel (max 3 at once)
     → each lesson broadcasts lesson_ready as it finishes
  4. Mark course ready → broadcast complete
"""
from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace

from app import store
from app.extract import (
    ContentResult,
    brave_context,
    extract_from_pdf,
    extract_from_text,
    extract_from_url,
    extract_from_youtube,
    is_youtube,
)
from app.config import LESSON_CONCURRENCY, MAX_CONTENT_CHARS, MAX_MEMES_PER_LESSON
from app.generation import generate_course_structure, generate_lesson_content, redesign_request
from app.images import generate_image, save_image
from app.sse import sse

logger = logging.getLogger(__name__)


async def _set(course_id: str, **fields) -> None:
    await store.update(course_id, lambda c: c.update(fields))


async def run_pipeline(
    course_id: str,
    source_type: str,
    raw_input: str,
    pdf_bytes: bytes | None = None,
    prefs: dict | None = None,
) -> None:
    try:
        await _run(course_id, source_type, raw_input, pdf_bytes, prefs)
    except Exception as exc:
        logger.error("Pipeline failed for course %s: %s", course_id, exc)
        try:
            await _set(course_id, status="error", error_message=str(exc)[:500])
            await sse.broadcast(course_id, {"type": "error", "message": str(exc)[:200]})
        except Exception:
            pass
        await sse.close(course_id)


async def _run(course_id, source_type, raw_input, pdf_bytes, prefs) -> None:
    # ── Step 1: Extract content ───────────────────────────────────────────
    await _set(course_id, status="extracting")
    await sse.broadcast(course_id, {"type": "status", "status": "extracting",
                                    "message": "Reading your content…"})

    content: ContentResult = await asyncio.to_thread(_extract, source_type, raw_input, pdf_bytes)
    if content.error:
        raise RuntimeError(f"Content extraction failed: {content.error}")

    # ── Step 2: Course structure (one fast LLM call) ──────────────────────
    await _set(course_id, status="generating", source_url=content.source_url)
    await sse.broadcast(course_id, {"type": "status", "status": "generating",
                                    "message": "Building course structure…"})

    structure = await asyncio.to_thread(generate_course_structure, content, prefs)
    structure.id = course_id

    await _set(
        course_id,
        title=structure.title,
        tagline=structure.tagline,
        outcome=structure.outcome,
        difficulty=structure.difficulty,
        tags=structure.tags,
        duration_days=structure.duration_days,
        minutes_per_day=structure.minutes_per_day,
        icon=structure.icon,
        gradient=structure.gradient,
        accent_color=structure.accent_color,
        source_title=structure.source_title,
        source_excerpt=structure.source_excerpt,
        topic_complexity=structure.topic_complexity,
        prerequisites=structure.prerequisites,
        # Everything a redesign needs to regenerate a lesson later without re-extracting.
        outlines=structure.lesson_outlines,
        natural_content_types=structure.natural_content_types,
        pedagogy_note=structure.pedagogy_note,
        story_character=structure.story_character,
        source_body=(content.body or "")[:MAX_CONTENT_CHARS],
    )
    await sse.broadcast(course_id, {
        "type": "structure_ready",
        "title": structure.title,
        "tagline": structure.tagline,
        "icon": structure.icon,
        "gradient": structure.gradient,
        "difficulty": structure.difficulty,
        "duration_days": structure.duration_days,
        "lessons": [{"day": o.get("day"), "title": o.get("title")} for o in structure.lesson_outlines],
    })

    # ── Step 3: Generate lessons in parallel, broadcast each as it lands ──
    sem = asyncio.Semaphore(LESSON_CONCURRENCY)

    async def _gen_lesson(outline: dict) -> bool:
        day = outline.get("day", 1)
        await sse.broadcast(course_id, {
            "type": "lesson_generating",
            "day": day,
            "title": outline.get("title", f"Lesson {day}"),
        })
        try:
            lesson = await _build_lesson(course_id, structure, outline, content, prefs, sem)

            def _add(c: dict) -> None:
                c["lessons"].append(lesson)
                c["lesson_count"] = len(c["lessons"])

            course = await store.update(course_id, _add)
            if course is None:
                return False
            await sse.broadcast(course_id, {
                "type": "lesson_ready",
                "day": day,
                "lesson_id": lesson["id"],
                "title": lesson["title"],
                "lessons_ready": course["lesson_count"],
                "lessons_total": structure.duration_days,
            })
            logger.info("Course %s — lesson %d/%d ready", course_id, course["lesson_count"], structure.duration_days)
            return True
        except Exception as exc:
            logger.error("Course %s — lesson %d failed: %s", course_id, day, exc)
            return exc

    results = await asyncio.gather(*(_gen_lesson(o) for o in structure.lesson_outlines),
                                   return_exceptions=True)
    if not any(r is True for r in results):
        first_err = next((r for r in results if isinstance(r, Exception)), None)
        raise RuntimeError(f"All lessons failed. First error: {first_err}" if first_err
                           else "All lesson generation attempts failed — no lessons were saved")

    # ── Step 4: Mark ready ───────────────────────────────────────────────
    await _set(course_id, status="ready")
    await sse.broadcast(course_id, {
        "type": "complete",
        "course_id": course_id,
        "title": structure.title,
        "duration_days": structure.duration_days,
    })
    await sse.close(course_id)
    logger.info("Course %s complete (%d lessons)", course_id, structure.duration_days)


async def _build_lesson(course_id, structure, outline, content, prefs, sem,
                        lesson_id: str | None = None, redesign: str | None = None) -> dict:
    """The shared lesson step: one LLM call (under sem) + meme images → a stored lesson dict."""
    async with sem:
        lc = await asyncio.to_thread(generate_lesson_content, structure, outline, content, prefs, redesign)
    lc.id = lesson_id or lc.id
    await _illustrate_memes(course_id, lc.id, lc.blocks)
    return {
        "id": lc.id, "course_id": course_id, "title": lc.title, "day_number": lc.day_number,
        "estimated_minutes": lc.estimated_minutes,
        "blocks": lc.blocks, "flashcards": lc.flashcards, "quiz": lc.quiz,
    }


async def run_redesign(course_id: str, instruction: str, template: str | None, lesson_id: str | None) -> None:
    """Regenerate one lesson (lesson_id) or all of them in place, ids kept. A lesson that fails
    keeps its old content and template. The caller has already set status="redesigning";
    status always returns to "ready". template + whole course = the course's template changes.
    """
    try:
        course = store.load(course_id)
        if course is None:
            return
        await sse.broadcast(course_id, {"type": "status", "status": "redesigning",
                                        "message": "Rewriting your lesson…" if lesson_id
                                        else "Rewriting your course…"})
        outlines = {o.get("day"): o for o in course.get("outlines") or []}
        structure = SimpleNamespace(  # the CourseStructure fields generate_lesson_content reads
            id=course_id, title=course["title"], duration_days=course.get("duration_days") or len(course["lessons"]),
            lesson_outlines=list(outlines.values()) or [
                {"day": l["day_number"], "title": l["title"]} for l in course["lessons"]],
            natural_content_types=course.get("natural_content_types") or [],
            story_character=course.get("story_character"), pedagogy_note=course.get("pedagogy_note") or "",
        )
        content = ContentResult(title=course.get("source_title") or course["title"],
                                body=course.get("source_body") or "", source_type=course.get("source_type") or "text")
        old_template = course.get("template") or "general"
        new_template = template if template and not lesson_id else old_template
        targets = sorted((l for l in course["lessons"] if not lesson_id or l["id"] == lesson_id),
                         key=lambda l: l["day_number"])
        sem = asyncio.Semaphore(LESSON_CONCURRENCY)
        done = 0
        errors: list[Exception] = []
        templates: dict[str, str] = {}  # lesson id → template its current content was written in

        async def _one(old: dict) -> None:
            nonlocal done
            day = old["day_number"]
            effective = template or old.get("template") or old_template
            prefs = {**(course.get("prefs") or {}), "template": effective}
            outline = {**outlines.get(day, {"focus": ""}), "day": day, "title": old["title"]}
            await sse.broadcast(course_id, {"type": "lesson_generating", "day": day, "title": old["title"]})
            try:
                lesson = await _build_lesson(course_id, structure, outline, content, prefs, sem,
                                             lesson_id=old["id"], redesign=redesign_request(instruction, old))
            except Exception as exc:
                logger.error("Course %s — redesign of lesson %d failed: %s", course_id, day, exc)
                errors.append(exc)
                return
            templates[old["id"]] = effective

            def _replace(c: dict) -> None:
                c["lessons"] = [lesson if l["id"] == old["id"] else l for l in c["lessons"]]

            if await store.update(course_id, _replace) is None:
                return
            done += 1
            await sse.broadcast(course_id, {"type": "lesson_ready", "day": day, "lesson_id": old["id"],
                                            "title": lesson["title"], "lessons_ready": done,
                                            "lessons_total": len(targets)})

        await asyncio.gather(*(_one(l) for l in targets))

        def _retemplate(c: dict) -> None:
            # Course template switches only now, so lessons whose rewrite failed keep their own.
            c["template"] = new_template
            c.setdefault("prefs", {})["template"] = new_template
            for l in c["lessons"]:
                eff = templates.get(l["id"]) or l.get("template") or old_template
                if eff == new_template:
                    l.pop("template", None)
                else:
                    l["template"] = eff

        await store.update(course_id, _retemplate)
        if done == 0:
            msg = f"Redesign failed, your lessons are unchanged. {errors[0] if errors else ''}".strip()
            await _set(course_id, status="ready", error_message=msg[:500])
            await sse.broadcast(course_id, {"type": "error", "message": msg[:200]})
        else:
            await _set(course_id, status="ready", error_message=None)
            await sse.broadcast(course_id, {"type": "complete", "course_id": course_id, "title": course["title"],
                                            "duration_days": course.get("duration_days")})
    except Exception as exc:
        logger.error("Redesign failed for course %s: %s", course_id, exc)
        await _set(course_id, status="ready", error_message=str(exc)[:500])
        await sse.broadcast(course_id, {"type": "error", "message": str(exc)[:200]})
    finally:
        await sse.close(course_id)


async def _illustrate_memes(course_id: str, lesson_id: str, blocks: list[dict]) -> None:
    """Render each meme block's image_prompt with Nano Banana, in place.

    A failed image must not cost the lesson: the block becomes a callout carrying its caption.
    """
    memes = [b for b in blocks if b.get("type") == "meme"]
    for extra in memes[MAX_MEMES_PER_LESSON:]:
        extra.clear()  # over the cap: dropped below
    memes = memes[:MAX_MEMES_PER_LESSON]

    async def _one(block: dict) -> None:
        try:
            data = await asyncio.to_thread(generate_image, block["image_prompt"])
            block["content"] = save_image(course_id, f"{lesson_id}-{block['id']}", data)
        except Exception as exc:
            logger.warning("Meme image failed (%s), falling back to callout: %s", block.get("id"), exc)
            caption = block.get("caption") or block.get("alt_text") or ""
            bid = block.get("id")
            block.clear()
            if caption:
                block.update({"id": bid, "type": "callout", "style": "note", "content": caption})

    await asyncio.gather(*(_one(b) for b in memes))
    blocks[:] = [b for b in blocks if b]


def _extract(source_type: str, raw_input: str, pdf_bytes: bytes | None) -> ContentResult:
    if source_type == "url":
        return extract_from_youtube(raw_input) if is_youtube(raw_input) else extract_from_url(raw_input)
    if source_type == "pdf":
        return extract_from_pdf(pdf_bytes or b"", raw_input)
    if source_type == "topic":
        result = extract_from_text(raw_input + brave_context(raw_input), raw_input[:120])
        # Search snippets are context, not a source document: keep the topic sized as a prompt
        # so the depth band (not the snippet length) decides how many lessons it gets.
        result.word_count = len(raw_input.split())
        return result
    return extract_from_text(raw_input, "")
