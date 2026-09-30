"""Apply supabase/migrations/*.sql and verify the project is ready for the app.

    venv/bin/python supabase_setup.py           # apply migrations, then verify
    venv/bin/python supabase_setup.py --check   # verify only

Needs SUPABASE_DB_URL (Postgres, for migrations) plus SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
(the keys the app itself uses; verification goes through them so it proves what the app sees).
Dev-only: pip install -r requirements-dev.txt
"""
import os
import sys
from pathlib import Path

import httpx
import psycopg

from app.config import SUPABASE_IMAGE_BUCKET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

DB_URL = os.getenv("SUPABASE_DB_URL", "")
MIGRATIONS = sorted((Path(__file__).parent / "supabase" / "migrations").glob("*.sql"))
TABLES = ("courses", "lessons")


def apply() -> None:
    # ponytail: re-runs every file each time, so migrations must stay idempotent
    # ("if not exists" / "on conflict"). Add a schema_migrations table once one can't be.
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        for f in MIGRATIONS:
            conn.execute(f.read_text())
            print(f"applied  {f.name}")


def verify() -> bool:
    ok = True

    def report(name: str, good: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= good
        print(f"{'ok  ' if good else 'FAIL'}  {name}{'  ' + detail if detail else ''}")

    h = {"apikey": SUPABASE_SERVICE_ROLE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}
    for t in TABLES:
        r = httpx.get(f"{SUPABASE_URL}/rest/v1/{t}?select=id&limit=1", headers={**h, "Prefer": "count=exact"})
        report(f"table {t} (service key)", r.status_code == 200,
               f"rows={r.headers.get('content-range', '?').split('/')[-1]}" if r.status_code == 200 else r.text[:120])
    r = httpx.get(f"{SUPABASE_URL}/storage/v1/bucket/{SUPABASE_IMAGE_BUCKET}", headers=h)
    report(f"bucket {SUPABASE_IMAGE_BUCKET}", r.status_code == 200 and r.json().get("public") is True,
           "" if r.status_code == 200 else r.text[:120])

    if DB_URL:
        with psycopg.connect(DB_URL) as conn:
            for t in TABLES:
                row = conn.execute("select relrowsecurity from pg_class where oid = to_regclass(%s)",
                                   (f"public.{t}",)).fetchone()
                report(f"RLS on {t}", bool(row and row[0]))
    return ok


if __name__ == "__main__":
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in .env")
    if "--check" not in sys.argv:
        if not DB_URL:
            sys.exit("SUPABASE_DB_URL not set in .env (needed to apply migrations)")
        apply()
    sys.exit(0 if verify() else 1)
