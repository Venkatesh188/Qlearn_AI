"""app/store.py — course persistence. Callers see one dict per course with a "lessons" list.

Backend is picked at import time:
  - Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set): `courses` and `lessons` tables
    via PostgREST, schema in supabase/migrations/0001_init.sql.
  - Otherwise one JSON file per course at data/courses/{id}.json.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timezone

import httpx

from app.config import DATA_DIR, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

# ponytail: one global lock for all course writes; per-course locks if many courses generate at once.
lock = asyncio.Lock()

_ID_RE = re.compile(r"^[0-9a-f-]{36}$")


def _path(course_id: str):
    if not _ID_RE.match(course_id):  # course_id comes from the URL; keep it off the filesystem path otherwise
        raise KeyError(course_id)
    return DATA_DIR / f"{course_id}.json"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_load(course_id: str) -> dict | None:
    try:
        return json.loads(_path(course_id).read_text())
    except (KeyError, FileNotFoundError):
        return None


def _json_save(course: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = _path(course["id"])
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(course, ensure_ascii=False))
    os.replace(tmp, path)


async def update(course_id: str, fn) -> dict | None:
    """Locked read-modify-write. fn mutates the course dict in place."""
    async with lock:
        course = load(course_id)
        if course is None:  # deleted mid-generation
            return None
        fn(course)
        course["updated_at"] = now()
        save(course)
        return course


def _json_delete(course_id: str) -> bool:
    try:
        _path(course_id).unlink()
        return True
    except (KeyError, FileNotFoundError):
        return False


def _json_list_all() -> list[dict]:
    if not DATA_DIR.exists():
        return []
    out = []
    for p in DATA_DIR.glob("*.json"):
        try:
            out.append(json.loads(p.read_text()))
        except (OSError, json.JSONDecodeError):
            continue
    return sorted(out, key=lambda c: c.get("created_at", ""), reverse=True)


# ── Supabase backend ──────────────────────────────────────────────────────
# Columns that exist in 0001_init.sql. Any other key is kept in the row's `extra`
# jsonb and merged back on load, so a new field never breaks a write.
_COURSE_COLS = {
    "id", "status", "template", "title", "tagline", "outcome", "difficulty", "tags", "duration_days",
    "minutes_per_day", "lesson_count", "icon", "gradient", "accent_color", "source_type", "source_title",
    "source_url", "source_excerpt", "source_body", "topic_complexity", "prerequisites", "prefs", "outlines",
    "natural_content_types", "pedagogy_note", "story_character", "progress_message", "error_message",
    "created_at", "updated_at",
}
_LESSON_COLS = {"id", "course_id", "day_number", "title", "estimated_minutes", "template",
                "blocks", "flashcards", "quiz", "created_at"}

# ponytail: sync HTTP from async routes blocks the event loop ~50-150ms per call. Fine for a
# prototype; switch to httpx.AsyncClient (and async store functions) if concurrent users grow.
_http = httpx.Client(
    base_url=f"{SUPABASE_URL}/rest/v1",
    headers={"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"},
    timeout=20,
) if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY else None


def _to_row(d: dict, cols: set[str]) -> dict:
    row = {k: v for k, v in d.items() if k in cols}
    row["extra"] = {k: v for k, v in d.items() if k not in cols and k != "lessons"}
    return row


def _from_row(row: dict) -> dict:
    extra = row.pop("extra", None) or {}
    return {**extra, **row}


def _check(r: httpx.Response) -> httpx.Response:
    if r.is_error:  # surface PostgREST's message (bad column, constraint) instead of a bare status
        raise RuntimeError(f"Supabase {r.request.method} {r.request.url.path} {r.status_code}: {r.text[:300]}")
    return r


def _sb_load(course_id: str) -> dict | None:
    if not _ID_RE.match(course_id):
        return None
    rows = _check(_http.get("/courses", params={"id": f"eq.{course_id}", "select": "*"})).json()
    if not rows:
        return None
    lessons = _check(_http.get("/lessons", params={"course_id": f"eq.{course_id}", "select": "*",
                                                    "order": "day_number"})).json()
    return {**_from_row(rows[0]), "lessons": [_from_row(l) for l in lessons]}


def _sb_save(course: dict) -> None:
    upsert = {"Prefer": "resolution=merge-duplicates,return=minimal"}
    _check(_http.post("/courses", json=_to_row(course, _COURSE_COLS), headers=upsert))
    # ponytail: re-upserts every lesson on each save (one request, ~10 rows). Fine at course scale;
    # track dirty lessons if lesson payloads get large.
    lessons = [_to_row({**l, "course_id": course["id"]}, _LESSON_COLS) for l in course.get("lessons", [])]
    if lessons:
        _check(_http.post("/lessons", json=lessons, headers=upsert))


def _sb_delete(course_id: str) -> bool:
    if not _ID_RE.match(course_id):
        return False
    r = _check(_http.delete("/courses", params={"id": f"eq.{course_id}"},  # lessons cascade
                            headers={"Prefer": "return=representation"}))
    return bool(r.json())


def _sb_list_all() -> list[dict]:
    # Summaries only: the list endpoint never reads lessons, so skip the heavy lesson rows.
    rows = _check(_http.get("/courses", params={"select": "*", "order": "created_at.desc"})).json()
    return [{**_from_row(r), "lessons": []} for r in rows]


USING_SUPABASE = _http is not None
load, save, delete, list_all = (
    (_sb_load, _sb_save, _sb_delete, _sb_list_all) if USING_SUPABASE
    else (_json_load, _json_save, _json_delete, _json_list_all)
)
