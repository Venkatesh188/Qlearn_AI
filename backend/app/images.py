"""app/images.py — meme images via Nano Banana (Gemini image model) on OpenRouter."""
from __future__ import annotations

import base64
import logging
import time

import httpx

from app.config import (IMAGE_MODEL, IMAGES_DIR, SUPABASE_IMAGE_BUCKET, SUPABASE_SERVICE_ROLE_KEY,
                        SUPABASE_URL)
from app.generation import _get_client

logger = logging.getLogger(__name__)

_MEME_STYLE = (
    "Create a funny, original internet-meme style image for a learning app. "
    "Bold white Impact-style caption text with a black outline, spelled exactly as given. "
    "Cartoon or illustrated characters only: no real people, no celebrities, no logos, no watermarks. "
    "Square 1:1 composition, clean and readable at small size.\n\nMeme: "
)


def generate_image(prompt: str) -> bytes:
    """Blocking call — returns PNG/JPEG bytes. Raises if the model returned no image."""
    resp = _get_client().chat.completions.create(
        model=IMAGE_MODEL,
        messages=[{"role": "user", "content": _MEME_STYLE + prompt}],
        extra_body={"modalities": ["image", "text"]},
    )
    msg = resp.choices[0].message
    # OpenRouter returns images as data URLs on a non-standard `images` field.
    images = getattr(msg, "images", None) or (msg.model_extra or {}).get("images") or []
    for img in images:
        url = (img.get("image_url") or {}).get("url", "") if isinstance(img, dict) else ""
        if url.startswith("data:") and "," in url:
            return base64.b64decode(url.split(",", 1)[1])
    raise RuntimeError(f"{IMAGE_MODEL} returned no image")


def save_image(course_id: str, name: str, data: bytes) -> str:
    """Store the image and return the URL the frontend loads it from.

    Supabase configured → public Storage bucket; otherwise data/images/<course_id>/ served by FastAPI.
    """
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        path = f"{course_id}/{name}.png"
        r = httpx.post(
            f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_IMAGE_BUCKET}/{path}",
            content=data,
            headers={"Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}", "apikey": SUPABASE_SERVICE_ROLE_KEY,
                     "Content-Type": "image/png", "x-upsert": "true"},  # upsert: redesigns reuse names
            timeout=30,
        )
        if r.is_error:
            raise RuntimeError(f"Supabase Storage upload {r.status_code}: {r.text[:200]}")
        return f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_IMAGE_BUCKET}/{path}?v={int(time.time())}"
    folder = IMAGES_DIR / course_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.png").write_bytes(data)
    # ?v= so a redesign that rewrites the same file name is not served from the browser cache.
    return f"/api/images/{course_id}/{name}.png?v={int(time.time())}"
