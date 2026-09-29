import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

# Any OpenAI-compatible endpoint works: OpenRouter (default), or Crusoe / Nebius / Vultr
# inference — just change LLM_BASE_URL (and LLM_MODEL to a model that provider serves).
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://openrouter.ai/api/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY") or os.getenv("OPENROUTER_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "anthropic/claude-haiku-4.5")
BRAVE_API_KEY = os.getenv("BRAVE_API_KEY", "")

MAX_CONTENT_CHARS = int(os.getenv("MAX_CONTENT_CHARS", "60000"))
MAX_LESSONS_PER_PATH = int(os.getenv("MAX_LESSONS_PER_PATH", "10"))
DATA_DIR = BACKEND_DIR / "data" / "courses"
# Heavy lessons target ~2400 words of prose plus quiz, flashcards and sketch specs (~6-9k tokens).
# Providers pre-check credit against this cap, so lower it if your balance is tight.
LESSON_MAX_TOKENS = int(os.getenv("LESSON_MAX_TOKENS", "12000"))

# ── Templates ─────────────────────────────────────────────────────────────
# Each template picks its own text model. "meme" also generates images with Nano Banana
# (Google's Gemini image model), served through OpenRouter's image-output modality.
TEMPLATE_MODELS = {
    "general": LLM_MODEL,
    "meme": os.getenv("MEME_TEXT_MODEL", "openai/gpt-5.4-mini"),
    "story": os.getenv("STORY_TEXT_MODEL", "anthropic/claude-haiku-4.5"),
}
TUTOR_MODEL = os.getenv("TUTOR_MODEL", "anthropic/claude-haiku-4.5")
IMAGE_MODEL = os.getenv("IMAGE_MODEL", "google/gemini-2.5-flash-image")
MAX_MEMES_PER_LESSON = int(os.getenv("MAX_MEMES_PER_LESSON", "4"))
IMAGES_DIR = BACKEND_DIR / "data" / "images"

# ── Supabase (optional) ───────────────────────────────────────────────────
# Both set → courses/lessons live in Postgres and meme images in Storage (schema:
# supabase/migrations/0001_init.sql). Either unset → local JSON files under data/.
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_IMAGE_BUCKET = os.getenv("SUPABASE_IMAGE_BUCKET", "course-images")

# ── Hosting ───────────────────────────────────────────────────────────────
# Vercel sets VERCEL=1. Serverless instances are per-request and may freeze after the response,
# so jobs can't run as fire-and-forget tasks: the /stream request claims and runs them instead
# (see main.py). The local filesystem is read-only there, so Supabase is required.
SERVERLESS = bool(os.getenv("VERCEL"))
# Lessons generated at once. Higher finishes sooner (matters under Vercel's duration cap).
LESSON_CONCURRENCY = int(os.getenv("LESSON_CONCURRENCY", "3"))
