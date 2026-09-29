"""Copy local JSON courses (data/courses/*.json) into Supabase. Safe to re-run (upserts).

    venv/bin/python import_json_to_supabase.py

Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env and the 0001_init.sql migration applied.
Local meme images (/api/images/...) are uploaded to Storage and their URLs rewritten.
"""
import re

from app import store
from app.config import IMAGES_DIR
from app.images import save_image

_LOCAL_IMG = re.compile(r"^/api/images/([0-9a-f-]{36})/([^/?]+)\.png")

if not store.USING_SUPABASE:
    raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in .env")

courses = store._json_list_all()
for c in courses:
    for lesson in c.get("lessons", []):
        for b in lesson.get("blocks", []):
            m = _LOCAL_IMG.match(str(b.get("content") or ""))
            if b.get("type") == "meme" and m:
                f = IMAGES_DIR / m[1] / f"{m[2]}.png"
                if f.exists():
                    b["content"] = save_image(m[1], m[2], f.read_bytes())
    store.save(c)
    print(f"  imported {c['id']}  {c.get('title')!r}  ({len(c.get('lessons', []))} lessons)")
print(f"done: {len(courses)} course(s)")
