"""
app/extract.py — Extract clean text from URLs, PDFs, YouTube, and raw text.
Returns a ContentResult with title, body, and metadata.
"""
import ipaddress
import re
import socket
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx

from app.config import BRAVE_API_KEY, MAX_CONTENT_CHARS

# ── SSRF / fetch safety limits ────────────────────────────────────────────────
# The URL passed to extract_from_url() is fully attacker-controlled (public
# "generate from URL" endpoint). Without these guards the server would happily
# fetch cloud-metadata (169.254.169.254), localhost, and private-network hosts,
# and hand the response back to the caller — a classic SSRF exfiltration path.
_FETCH_MAX_BYTES = 8 * 1024 * 1024      # hard cap on response body (memory DoS)
_FETCH_MAX_REDIRECTS = 5                # bounded redirect chain
_FETCH_TIMEOUT = 20.0                   # per-operation timeout (seconds)


class UnsafeURLError(Exception):
    """Raised when a URL points at a disallowed scheme or a private/internal IP."""


def _assert_url_is_public(url: str) -> None:
    """
    Reject non-http(s) schemes and any host that resolves to a
    loopback/private/link-local/reserved/multicast address.

    Re-run this for every redirect hop — a public host can 302 to
    169.254.169.254, and DNS can point a public name at a private IP.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeURLError(f"Unsupported URL scheme: {parsed.scheme or '(none)'}")

    host = parsed.hostname
    if not host:
        raise UnsafeURLError("URL has no host")

    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise UnsafeURLError(f"Could not resolve host: {host}") from exc

    for info in infos:
        ip_str = info[4][0]
        ip = ipaddress.ip_address(ip_str)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise UnsafeURLError(f"URL resolves to a non-public address ({ip_str})")


def _safe_fetch(url: str, headers: dict) -> httpx.Response:
    """
    Fetch a URL with SSRF protection: validate the resolved IP before every hop,
    follow redirects manually (so each hop is re-validated), and cap the body
    size to avoid memory-exhaustion DoS.
    """
    current = url
    with httpx.Client(follow_redirects=False, timeout=_FETCH_TIMEOUT) as client:
        for _ in range(_FETCH_MAX_REDIRECTS + 1):
            _assert_url_is_public(current)
            with client.stream("GET", current, headers=headers) as resp:
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        resp.raise_for_status()
                        raise UnsafeURLError("Redirect with no Location header")
                    current = urljoin(current, location)
                    continue

                resp.raise_for_status()
                chunks: list[bytes] = []
                total = 0
                for chunk in resp.iter_bytes():
                    total += len(chunk)
                    if total > _FETCH_MAX_BYTES:
                        raise UnsafeURLError(
                            f"Response exceeds {_FETCH_MAX_BYTES} byte limit"
                        )
                    chunks.append(chunk)
                resp._content = b"".join(chunks)
                return resp

    raise UnsafeURLError(f"Too many redirects (>{_FETCH_MAX_REDIRECTS})")


@dataclass
class ContentResult:
    title: str
    body: str
    source_type: str
    source_url: Optional[str] = None
    word_count: int = 0
    error: Optional[str] = None

    def truncated_body(self, max_chars: int = MAX_CONTENT_CHARS) -> str:
        return self.body[:max_chars]


def extract_from_url(url: str) -> ContentResult:
    try:
        from bs4 import BeautifulSoup

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        resp = _safe_fetch(url, headers)

        soup = BeautifulSoup(resp.text, "lxml")
        for tag in soup(["script", "style", "nav", "footer", "header",
                          "aside", "form", "noscript", "iframe", "svg"]):
            tag.decompose()

        title = ""
        if soup.title and soup.title.string:
            title = soup.title.string.strip()
        elif soup.find("h1"):
            title = soup.find("h1").get_text(strip=True)

        main = (
            soup.find("main")
            or soup.find("article")
            or soup.find(id=re.compile(r"content|main|article", re.I))
            or soup.find(class_=re.compile(r"content|main|article|post", re.I))
            or soup.body
        )
        body = main.get_text(separator="\n", strip=True) if main else ""
        body = re.sub(r"\n{3,}", "\n\n", body)

        return ContentResult(title=title, body=body, source_type="url",
                             source_url=url, word_count=len(body.split()))
    except Exception as e:
        return ContentResult(title="", body="", source_type="url", source_url=url,
                             error=f"Failed to extract URL content: {e}")


def extract_from_pdf(pdf_bytes: bytes, filename: str = "document.pdf") -> ContentResult:
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages_text = [page.get_text("text") for page in doc]
        doc.close()

        body = "\n\n".join(pages_text)
        body = re.sub(r"\n{3,}", "\n\n", body)
        first_lines = [l.strip() for l in body.split("\n") if l.strip()]
        title = first_lines[0][:120] if first_lines else filename.replace(".pdf", "")

        return ContentResult(title=title, body=body, source_type="pdf",
                             word_count=len(body.split()))
    except Exception as e:
        return ContentResult(title=filename, body="", source_type="pdf",
                             error=f"Failed to extract PDF content: {e}")


def extract_from_youtube(url: str) -> ContentResult:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        video_id_match = re.search(
            r"(?:v=|youtu\.be/|embed/)([a-zA-Z0-9_-]{11})", url
        )
        if not video_id_match:
            raise ValueError("Could not extract YouTube video ID from URL")

        video_id = video_id_match.group(1)
        api = YouTubeTranscriptApi()
        try:
            transcript = api.fetch(video_id)
        except Exception:
            # Fallback: try any available language
            transcript = api.fetch(video_id, languages=["en", "en-US", "en-GB", "a.en"])
        body = " ".join(entry.text for entry in transcript)
        body = re.sub(r"\s{2,}", " ", body)

        return ContentResult(title=f"YouTube Video ({video_id})", body=body,
                             source_type="youtube", source_url=url, word_count=len(body.split()))
    except Exception as e:
        return ContentResult(title="", body="", source_type="youtube", source_url=url,
                             error=f"Failed to extract YouTube transcript: {e}")


def extract_from_text(text: str, title_hint: str = "") -> ContentResult:
    body = text.strip()
    title = title_hint.strip() or "Pasted Content"
    return ContentResult(title=title, body=body, source_type="text", word_count=len(body.split()))


def brave_context(topic: str) -> str:
    """Optional Brave web search to ground "topic" courses. Returns "" if unset or on any failure."""
    if not BRAVE_API_KEY:
        return ""
    try:
        resp = httpx.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": topic[:400], "count": 5},
            headers={"X-Subscription-Token": BRAVE_API_KEY, "Accept": "application/json"},
            timeout=10.0,
        )
        resp.raise_for_status()
        results = resp.json().get("web", {}).get("results", [])[:5]
    except Exception:
        return ""
    lines = [
        f"- {r.get('title', '')}: {re.sub(r'<[^>]+>', '', r.get('description', ''))} ({r.get('url', '')})"
        for r in results
    ]
    return "\n\nWeb search context:\n" + "\n".join(lines) if lines else ""


def is_youtube(url: str) -> bool:
    return bool(re.match(r"https?://(?:www\.|m\.)?(?:youtube\.com|youtu\.be)/", url.strip()))
