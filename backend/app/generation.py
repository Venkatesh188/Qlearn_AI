"""
app/generation.py — LLM calls for course generation (OpenAI-compatible endpoint).

Two-phase approach:
  Phase 1: content → course structure (title, days, lesson outlines)
  Phase 2: per-lesson → blocks + flashcards + quiz

Calls are blocking; the pipeline runs them via asyncio.to_thread.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Optional

from openai import OpenAI

from app.config import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, MAX_CONTENT_CHARS, MAX_LESSONS_PER_PATH, LESSON_MAX_TOKENS, TEMPLATE_MODELS, TUTOR_MODEL
from app.extract import ContentResult

logger = logging.getLogger(__name__)


_client: Optional[OpenAI] = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        if not LLM_API_KEY:
            raise RuntimeError("LLM_API_KEY not set")
        _client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)
    return _client


TEMPLATES = ("general", "meme", "story")


def _template(prefs: dict | None) -> str:
    t = (prefs or {}).get("template")
    return t if t in TEMPLATES else "general"


def _model_for(prefs: dict | None) -> str:
    return TEMPLATE_MODELS.get(_template(prefs), LLM_MODEL)


def _extra_body(model: str) -> dict:
    # gpt-5.x are reasoning models: without this, hidden reasoning tokens eat LESSON_MAX_TOKENS.
    return {"extra_body": {"reasoning": {"effort": "low"}}} if model.startswith("openai/") else {}


def _complete(system: str, user: str, max_tokens: int, what: str, model: str = LLM_MODEL) -> str:
    resp = _get_client().chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        **_extra_body(model),
    )
    choice = resp.choices[0]
    if resp.usage:
        logger.info("%s tokens | in=%s out=%s", what, resp.usage.prompt_tokens, resp.usage.completion_tokens)
    # A cutoff is invalid JSON; say so instead of surfacing a confusing parse error.
    if choice.finish_reason == "length":
        raise ValueError(f"{what} hit max_tokens ({max_tokens}) and was cut off. Raise LESSON_MAX_TOKENS.")
    return choice.message.content or ""


# ── Rendering firewall ────────────────────────────────────────────────────
# Runs after the LLM returns JSON, before data is stored.
# Ensures BlockRenderer never receives a block type or field it cannot handle.

_KNOWN_BLOCK_TYPES = {
    "hook", "text", "heading", "subheading", "analogy", "callout",
    "code", "list", "image", "meme", "diagram", "sketch", "quiz", "challenge",
    "flashcard", "reveal", "progress", "next",
    "chat", "checkpoint", "hot_take", "plot_twist", "tldr", "insight", "cliffhanger",
}
_CONTENT_ONLY_TYPES = {"hot_take", "tldr", "insight", "cliffhanger"}
_CHAT_MAX_MESSAGES = 8
_CALLOUT_STYLES = {"exam_tip", "pro_tip", "warning", "note", "info"}
_FLASHCARD_DIFFICULTIES = {"easy", "medium", "hard"}
_MERMAID_PREFIXES = (
    "graph ", "graph\n", "flowchart ", "flowchart\n",
    "sequenceDiagram", "classDiagram", "stateDiagram",
    "erDiagram", "gantt", "pie", "gitGraph", "mindmap", "timeline",
)


# Sketch (hand-drawn diagram) spec limits. These MUST stay in step with
# validateSpec() in frontend/utils/sketchLayout.ts — the renderer applies the same
# caps and drops anything that fails them, so a looser rule here just means a
# silently missing diagram.
_SKETCH_COLORS = {"green", "blue", "violet", "teal", "orange", "red", "pink"}
_SKETCH_MAX_ROWS = 4
_SKETCH_MAX_PER_ROW = 5
_SKETCH_MAX_NODES = 16
_SKETCH_MAX_NOTES = 12
_SKETCH_MAX_EDGES = 24
_SKETCH_LABEL_CHARS = 80
_SKETCH_NOTE_CHARS = 220
_SKETCH_TITLE_CHARS = 90


def _sanitize_sketch_spec(spec: object) -> dict | None:
    """Validate a sketch spec. Returns a normalized dict, or None if unusable.

    Mirrors frontend/utils/sketchLayout.ts:validateSpec — structural problems
    (bad rows, duplicate ids) are fatal; dangling edges and notes are dropped so
    an otherwise-good diagram still renders.
    """
    if not isinstance(spec, dict):
        return None
    rows_raw = spec.get("rows")
    if not isinstance(rows_raw, list) or not 1 <= len(rows_raw) <= _SKETCH_MAX_ROWS:
        return None

    ids: set[str] = set()
    rows: list[list[dict]] = []
    for row in rows_raw:
        if not isinstance(row, list) or not 1 <= len(row) <= _SKETCH_MAX_PER_ROW:
            return None
        clean_row: list[dict] = []
        for node in row:
            if not isinstance(node, dict):
                return None
            nid = str(node.get("id") or "").strip()
            label = str(node.get("label") or "").strip()
            if not nid or not label or nid in ids:
                return None
            ids.add(nid)
            out = {"id": nid, "label": label[:_SKETCH_LABEL_CHARS]}
            color = str(node.get("color") or "").strip()
            if color in _SKETCH_COLORS:
                out["color"] = color
            clean_row.append(out)
        rows.append(clean_row)

    if not 2 <= len(ids) <= _SKETCH_MAX_NODES:
        return None

    edges: list[list[str]] = []
    raw_edges = spec.get("edges")
    if isinstance(raw_edges, list):
        for edge in raw_edges[:_SKETCH_MAX_EDGES]:
            if not isinstance(edge, (list, tuple)) or len(edge) < 2:
                continue
            a, b = str(edge[0] or "").strip(), str(edge[1] or "").strip()
            if a and b and a != b and a in ids and b in ids:
                edges.append([a, b])

    notes: list[dict] = []
    raw_notes = spec.get("notes")
    if isinstance(raw_notes, list):
        for note in raw_notes[:_SKETCH_MAX_NOTES]:
            if not isinstance(note, dict):
                continue
            on = str(note.get("on") or "").strip()
            text = str(note.get("text") or "").strip()
            if not on or not text or on not in ids:
                continue
            entry = {"on": on, "text": text[:_SKETCH_NOTE_CHARS]}
            if note.get("side") in ("above", "below"):
                entry["side"] = note["side"]
            notes.append(entry)

    clean: dict = {"rows": rows, "edges": edges, "notes": notes}
    title = str(spec.get("title") or "").strip()
    if title:
        clean["title"] = title[:_SKETCH_TITLE_CHARS]
    return clean


def _sanitize_blocks(blocks: object) -> list:
    if not isinstance(blocks, list):
        return []
    clean: list[dict] = []
    seen_ids: set[str] = set()

    for block in blocks:
        if not isinstance(block, dict):
            continue
        btype = block.get("type", "")

        # Unknown type — salvage as text if content exists, else drop
        if btype not in _KNOWN_BLOCK_TYPES:
            content = block.get("content") or block.get("text") or ""
            if content:
                block = {"type": "text", "content": str(content)}
            else:
                continue

        btype = block.get("type")

        if btype == "callout":
            if block.get("style") not in _CALLOUT_STYLES:
                block = {**block, "style": "note"}

        elif btype == "code":
            if not block.get("code") and not block.get("content"):
                continue
            if not block.get("language"):
                block = {**block, "language": "text"}

        elif btype == "diagram":
            code = (block.get("code") or block.get("content") or "").strip()
            if not code:
                continue
            # Invalid Mermaid syntax — demote to text rather than crash the renderer
            if not any(code.startswith(p) for p in _MERMAID_PREFIXES):
                block = {"type": "text", "content": code[:300]}
            else:
                block = {**block, "code": code}

        elif btype == "sketch":
            spec = _sanitize_sketch_spec(block.get("spec"))
            if spec is None:
                # Keep the lesson readable: fall back to whatever prose came with it,
                # otherwise drop. Never ship a spec the renderer will refuse.
                # Log it: a dropped sketch is invisible in the UI, and a Visual-style
                # course losing its diagrams here looks identical to the model ignoring
                # the preference. Grep for this before blaming the prompt.
                logger.warning("Discarded invalid sketch spec: %s", json.dumps(block.get("spec"))[:300])
                salvage = str(block.get("content") or block.get("caption") or "").strip()
                if not salvage:
                    continue
                block = {"type": "text", "content": salvage[:300]}
            else:
                block = {**block, "spec": spec}

        elif btype == "challenge":
            if not block.get("question"):
                continue
            diff = block.get("answer_diff")
            valid_diff = (
                isinstance(diff, dict)
                and isinstance(diff.get("before"), str)
                and isinstance(diff.get("after"), str)
                and diff["before"].strip() != diff["after"].strip()
                and (diff["before"].strip() or diff["after"].strip())
            )
            if valid_diff:
                block = {
                    **block,
                    "answer_diff": {
                        "before": diff["before"],
                        "after": diff["after"],
                        "language": str(diff.get("language") or "text"),
                    },
                }
            elif "answer_diff" in block:
                # Drop malformed diff but keep block if prose answer is present
                block = {k: v for k, v in block.items() if k != "answer_diff"}
            if not valid_diff and not (block.get("answer") or "").strip():
                continue

        elif btype == "meme":
            prompt = str(block.get("image_prompt") or "").strip()
            caption = str(block.get("caption") or "").strip()
            if not prompt:
                if not caption:
                    continue
                block = {"type": "callout", "style": "note", "content": caption[:300]}
            else:
                block = {"type": "meme", "image_prompt": prompt[:600], "caption": caption[:200],
                         "alt_text": str(block.get("alt_text") or caption)[:200]}

        elif btype == "chat":
            msgs = block.get("messages")
            msgs = [{"who": str(m.get("who") or "").strip()[:40], "text": str(m.get("text")).strip()[:400]}
                    for m in (msgs if isinstance(msgs, list) else [])
                    if isinstance(m, dict) and str(m.get("text") or "").strip()][:_CHAT_MAX_MESSAGES]
            if not msgs:
                continue
            block = {"id": block.get("id"), "type": "chat", "messages": msgs}

        elif btype == "checkpoint":
            question = str(block.get("question") or "").strip()
            options = block.get("options")
            correct = block.get("correct")
            if (not question or not isinstance(options, list) or not 2 <= len(options) <= 4
                    or not all(isinstance(o, str) and o.strip() for o in options)
                    or isinstance(correct, bool) or not isinstance(correct, int)
                    or not 0 <= correct < len(options)):
                continue
            block = {"id": block.get("id"), "type": "checkpoint", "question": question,
                     "options": [o.strip() for o in options], "correct": correct,
                     "explanation": str(block.get("explanation") or "").strip()}

        elif btype == "plot_twist":
            content = str(block.get("content") or "").strip()
            if not content:
                continue
            block = {"id": block.get("id"), "type": "plot_twist", "content": content,
                     "setup": str(block.get("setup") or "").strip()}

        elif btype in _CONTENT_ONLY_TYPES:
            content = block.get("content")
            if btype == "tldr" and isinstance(content, list):  # models like to send tldr as an array
                content = "\n".join(f"- {str(c).strip().lstrip('- ')}" for c in content if str(c).strip())
            content = str(content or "").strip() if not isinstance(content, (dict, list)) else ""
            if not content:
                continue
            block = {"id": block.get("id"), "type": btype, "content": content}

        elif btype == "image":
            # BlockRenderer returns null when content is missing
            if not block.get("content"):
                continue

        # Ensure unique sequential id — React key stability
        bid = str(block.get("id") or "")
        if not bid or bid in seen_ids:
            bid = f"b{len(clean) + 1}"
        seen_ids.add(bid)
        clean.append({**block, "id": bid})

    return clean


_FLASHCARD_BACK_MAX_CHARS = 200
_FLASHCARD_BACK_MAX_WORDS = 30


def _truncate_flashcard_back(text: str) -> str:
    """Trim to <=2 sentences, capped at _FLASHCARD_BACK_MAX_CHARS / _MAX_WORDS.

    Sentence boundary = period, exclamation, or question mark followed by space or end.
    """
    text = text.strip()
    if len(text) <= _FLASHCARD_BACK_MAX_CHARS and len(text.split()) <= _FLASHCARD_BACK_MAX_WORDS:
        return text
    sentences = re.split(r"(?<=[.!?])\s+", text)
    out = ""
    for i, sent in enumerate(sentences[:2]):
        candidate = (out + (" " if out else "") + sent).strip()
        if len(candidate) > _FLASHCARD_BACK_MAX_CHARS and i > 0:
            break
        out = candidate
    if not out:
        out = text[:_FLASHCARD_BACK_MAX_CHARS].rstrip()
    if len(out) > _FLASHCARD_BACK_MAX_CHARS:
        out = out[:_FLASHCARD_BACK_MAX_CHARS].rstrip().rstrip(",;:") + "…"
    return out


def _sanitize_flashcards(flashcards: object) -> list:
    if not isinstance(flashcards, list):
        return []
    clean = []
    for fc in flashcards:
        if not isinstance(fc, dict):
            continue
        front = (fc.get("front") or "").strip()
        back = (fc.get("back") or "").strip()
        if not front or not back:
            continue
        back = _truncate_flashcard_back(back)
        difficulty = fc.get("difficulty", "medium")
        if difficulty not in _FLASHCARD_DIFFICULTIES:
            difficulty = "medium"
        clean.append({"front": front, "back": back, "difficulty": difficulty})
    return clean


_QUIZ_FILLER_PATTERNS = (
    "all of the above", "none of the above", "all the above", "both a and b",
    "both of the above", "any of the above",
)


def _sanitize_quiz(quiz: object) -> list:
    if not isinstance(quiz, list):
        return []
    clean = []
    for q in quiz:
        if not isinstance(q, dict):
            continue
        question = (q.get("question") or "").strip()
        options = q.get("options")
        correct = q.get("correct")
        if not question:
            continue
        if not isinstance(options, list) or len(options) < 2:
            continue
        if not isinstance(correct, int) or not (0 <= correct < len(options)):
            continue

        opts = [str(o).strip() for o in options]

        # Reject filler distractors ("all of the above", etc.)
        if any(o.lower() in _QUIZ_FILLER_PATTERNS for o in opts):
            continue

        # Reject duplicate or near-duplicate options
        normalized = [re.sub(r"\s+", " ", o.lower()).rstrip(".") for o in opts]
        if len(set(normalized)) != len(normalized):
            continue

        # Reject length-tell: correct option more than 1.6x or less than 0.6x the median other
        if len(opts) >= 3:
            correct_len = max(len(opts[correct]), 1)
            others = [len(o) for i, o in enumerate(opts) if i != correct]
            others.sort()
            median = others[len(others) // 2] or 1
            ratio = correct_len / median
            if ratio > 1.6 or ratio < 0.6:
                continue

        clean.append({
            "question": question,
            "options": opts,
            "correct": correct,
            "explanation": (q.get("explanation") or "").strip(),
        })
    return clean


def _sanitize_lesson_data(data: dict) -> dict:
    return {
        **data,
        "blocks": _sanitize_blocks(data.get("blocks", [])),
        "flashcards": _sanitize_flashcards(data.get("flashcards", [])),
        "quiz": _sanitize_quiz(data.get("quiz", [])),
    }


# ── Prompts ───────────────────────────────────────────────────────────────

_SYSTEM_STRUCTURE = (
    "You are an expert learning content designer who creates engaging, structured micro-courses. "
    "You output ONLY valid JSON. No markdown, no explanation, no code fences. Just the raw JSON object. "
    "Write in plain, direct prose. Do not use em dashes (—) anywhere. Use commas, colons, or short sentences instead. "
    "Titles and taglines are concrete and specific, never hyped. Ban: powerful, robust, seamless, "
    "cutting-edge, game-changing, ultimate, master. 'Redis beyond caching' beats 'Master the power of Redis'."
)

_SYSTEM_LESSON = (
    "You are an expert learning content designer who creates engaging micro-lessons. "
    "You output ONLY valid JSON. No markdown, no explanation, no code fences. Just the raw JSON object. "
    "Write in plain, direct prose. Do not use em dashes (—) anywhere. Use commas, colons, or short sentences instead.\n\n"
    "VOICE — write like a senior practitioner explaining this to a capable colleague, not like a textbook:\n"
    "- Second person. 'You'll usually reach for X', never 'One might consider' or 'Learners will discover'.\n"
    "- Take a position. When there are several options, recommend one and say why. A neutral list of\n"
    "  alternatives is a non-answer. 'Use X unless Y, in which case Z' beats 'there are three approaches'.\n"
    "- Lead with the decision or the problem, not the definition. Definitions come after the reader\n"
    "  knows why they should care.\n"
    "- Say where it breaks. Every concept gets its failure mode, its cost, or when NOT to use it.\n"
    "  Content that only lists strengths reads as marketing and teaches nothing.\n"
    "- Name genuine disagreement instead of flattening it. If practitioners argue about something,\n"
    "  say so and say which side you land on.\n"
    "- Short declarative sentences. Cut hedges: 'it is important to note', 'generally speaking',\n"
    "  'can be considered', 'it should be mentioned'. Delete them and start with the verb.\n"
    "- Concrete over abstract. Real numbers, real command names, real failure messages.\n"
    "- Ban hype adjectives: powerful, robust, seamless, cutting-edge, game-changing, revolutionary.\n\n"
    "Block types available:\n"
    "- hook: Opening statement or thought-provoking question (first block only)\n"
    "- heading: Major section title (2-3 per lesson)\n"
    "- subheading: Sub-section title under a heading\n"
    "- text: Paragraph explanation. 80-200 words. Vary the length; a run of identical-size\n"
    "  paragraphs reads like filler. Explain, do not summarise.\n"
    "- analogy: Real-world comparison to explain an abstract concept\n"
    "- callout: Highlighted insight. Required field: style (exam_tip | pro_tip | warning | note | info)\n"
    "- code: Working code example. Required fields: language (string), code (string with real runnable code)\n"
    "- list: Bullet points. content = newline-separated items starting with -\n"
    "- sketch: Hand-drawn whiteboard diagram with margin annotations. Required field: spec (object)\n"
    "- diagram: Mermaid diagram. Required field: code (must start with: graph, flowchart, sequenceDiagram, "
    "classDiagram, stateDiagram, erDiagram, gantt, pie, or gitGraph)\n"
    "- challenge: Design/architecture question. Required fields: question, answer. Optional: hint\n\n"
    "Choosing the visual type (prefer sketch; reach for diagram only when the shape needs it):\n"
    "- sketch: components and the flow between them. Architectures, pipelines, request paths, layered\n"
    "  systems, before/after comparisons. Its real value is the notes: one short, opinionated annotation\n"
    "  per box telling the learner what actually matters there. Rows are strict left-to-right bands.\n"
    "- diagram: use ONLY when the structure cannot be drawn as left-to-right rows, specifically:\n"
    "  branching or conditional logic, loops and retries, message exchange between actors over time\n"
    "  (sequenceDiagram), state machines, entity relationships, or timelines.\n"
    "- If a flow has no branches and no cycles, it is a sketch, not a diagram.\n"
    "- Never use both block types for the same idea.\n\n"
    "Match the blocks to the DOMAIN, not to a template:\n"
    "- code: only when the learner will actually read or write code, config, or query syntax in\n"
    "  this subject. A course on negotiation, nutrition, art history, or management has ZERO code\n"
    "  blocks. Never use a code block to display a checklist, a template, an email, a recipe, or a\n"
    "  worked calculation: those are list or text blocks.\n"
    "- sketch and diagram: only when the idea has real structure (components and flow, branching,\n"
    "  a sequence between parties, a state machine). Absent a STYLE directive asking for more,\n"
    "  plenty of good lessons have no visual at all.\n"
    "  A diagram that restates a list actively wastes the learner's attention.\n"
    "- Non-technical subjects lean on analogy, worked scenarios, contrasting examples, and lists.\n"
    "  Those carry exactly as much weight as code does in a technical subject. A lesson is not\n"
    "  lower quality for containing no code and no diagram.\n"
    "- Never include a block type just because it exists or because the schema example shows it.\n\n"
    "Structural rules that always apply:\n"
    "- First block must be hook\n"
    "- Last block must be callout\n"
    "- Organize content into 2-3 named sections using heading blocks\n"
    "- Minimum 5 blocks, maximum 18 blocks\n"
    "- Include one visual (sketch or diagram) whenever the lesson explains a multi-step flow, an\n"
    "  architecture, or how three or more components relate. Absent a STYLE directive asking for\n"
    "  more, skip the visual for purely definitional lessons. A visual that restates a list adds nothing.\n"
    "- Block ids must be unique: b1, b2, b3, ..."
)


# ── Learner preference → prompt directives ────────────────────────────────

_LEVEL_DIRECTIVES = {
    "Beginner": (
        "This replaces the 'capable colleague' register in the VOICE section: the reader is new to "
        "this subject, so keep the directness and the opinions but drop the assumed fluency. "
        "Assume no prior knowledge. Define every domain term the first time it appears, including "
        "ones you would normally treat as common vocabulary (idempotent, race condition, "
        "normalization). If a term is not defined in this lesson or listed under ALREADY "
        "INTRODUCED, define it inline before you use it. "
        "Include one analogy per new concept. Avoid jargon. Examples must be concrete. "
        "Assume no tooling knowledge either: if a lesson includes code, say where it goes, how to "
        "run it, and what output to expect. A beginner who cannot run the example learns nothing "
        "from it. The same applies outside code: name the menu, the file, or the button, do not "
        "just say 'configure it'."
    ),
    "Intermediate": (
        "Assume working familiarity with the domain. Skip beginner definitions. "
        "Focus on the why behind each concept and the trade-offs between alternatives."
    ),
    "Advanced": (
        "Assume expert fluency. Skip introductions. Focus on subtleties, edge cases, "
        "non-obvious failure modes, and how concepts compose in production systems."
    ),
}

_DEPTH_DIRECTIVES = {
    # target_days is a guide band, not a quota. The source material decides the real count:
    # see the duration_days rule in _structure_prompt, which allows going under the floor
    # (thin source) and up to the ceiling (genuinely broad source) without padding either way.
    "Quick overview": {
        "course": "Cover only the load-bearing concepts. Omit edge cases and historical context.",
        "coverage": "Cover only what is essential for this concept to make sense. Stop once the core idea is clear.",
        "target_days": (3, 6),
    },
    "Balanced": {
        "course": "Core concepts plus one or two applied examples each. Include common pitfalls.",
        "coverage": "Cover the concept plus its main real-world application and the most common pitfall.",
        "target_days": (5, 10),
    },
    "Deep dive": {
        "course": "Core concepts plus edge cases, composition, and failure modes. Include one lesson on debugging or internals.",
        "coverage": "Cover the concept thoroughly: edge cases, failure modes, and how it composes with related concepts.",
        "target_days": (8, 15),
    },
}

_STYLE_DIRECTIVES = {
    "Examples": "Lead every section with a concrete worked example. State the principle only after the example has made it obvious.",
    "Theory": "State the principle and its precise definition first. Then demonstrate with an example. Include one formal rule per lesson in a callout.",
    "Visual": (
        "Every lesson gets TWO visuals. This is a floor, not a target to weigh against other "
        "considerations: the learner explicitly asked for a visual-heavy course, and a lesson with "
        "one visual has not honoured that. Find the two ideas in the lesson that have real structure "
        "and draw them; a multi-step flow, an architecture, a lifecycle, a comparison of two "
        "approaches, or a relationship between entities all qualify. Use diagram (Mermaid) for "
        "branching, loops, sequences between actors, and state machines; use sketch for everything "
        "else. Annotate every sketch box with a note."
    ),
    "Code-heavy": "Every concept that can be expressed in code must include a runnable code block. Prefer code over prose when both work.",
    "Story-based": "Frame examples around the established story character's ongoing situation. Do not invent a different character.",
}

# Lesson density driven by per-lesson complexity_weight from Phase 1
# Word budgets are derived from _COMPLEXITY_MINUTES at ~200 wpm, reserving roughly
# 40% of the lesson for quiz, flashcards, and the challenge. Without an explicit budget
# the model writes to the block count and produces a lesson that reads in 2 minutes
# while the UI promises 10, which is the single biggest "this feels thin" complaint.
_DENSITY_DIRECTIVES = {
    "light": (
        "LESSON DENSITY: Light\n"
        "  Introductory or definitional concept. Aim for 7-10 blocks and 700-1000 words of prose\n"
        "  total across all text, analogy, callout, and list blocks. No challenge block needed\n"
        "  unless it is core to understanding."
    ),
    "medium": (
        "LESSON DENSITY: Medium\n"
        "  Applied or procedural concept. Include at least one fully worked example and cover the\n"
        "  primary use case. Aim for 10-14 blocks and 1200-1600 words of prose total.\n"
        "  Include one challenge block if the lesson is intermediate or advanced."
    ),
    "heavy": (
        "LESSON DENSITY: Heavy\n"
        "  Complex, compositional, or system-level concept. Use multiple worked examples, address at\n"
        "  least one edge case or pitfall, and include a challenge block.\n"
        "  Aim for 14-18 blocks and 1800-2400 words of prose total."
    ),
}

# Estimated reading/practice minutes per lesson by density
_COMPLEXITY_MINUTES = {"light": 10, "medium": 15, "heavy": 22}

# Density is driven ONLY by Phase 1's per-lesson complexity_weight. Do not make it a
# function of depth as well: shifting every "medium" lesson to "heavy" on Deep dive put
# 15 concurrent 2400-word lessons against max_tokens=16000 and the raise in
# _check_not_truncated, which fails every lesson and errors the whole course.
# Depth belongs in the day-count band and the coverage directive, not the word budget.

# Styles that make a block type mandatory rather than merely available. Without this,
# Phase 1's natural_content_types could omit "sketch" for a code-first topic and Phase 2's
# "never include a block type absent from this list" rule then vetoed the user's Visual
# choice outright — and _blocks_example() stripped the sketch out of the schema too.
_STYLE_REQUIRED_TYPES = {"Visual": ("sketch",), "Code-heavy": ("code",)}


def _required_content_types(natural: list[str] | None, styles: list[str] | None) -> list[str]:
    """natural_content_types, with any style-mandated types forced to the front."""
    types = list(natural or [])
    for style in reversed(list(styles or [])):
        for t in _STYLE_REQUIRED_TYPES.get(style, ()):
            if t not in types:
                types.insert(0, t)
    return types


def _level_block(level: str | None) -> str:
    directive = _LEVEL_DIRECTIVES.get(level or "Intermediate", _LEVEL_DIRECTIVES["Intermediate"])
    return f"LEVEL: {level or 'Intermediate'}\n  {directive}"


def _depth_coverage_block(depth: str | None) -> str:
    directive = _DEPTH_DIRECTIVES.get(depth or "Balanced", _DEPTH_DIRECTIVES["Balanced"])
    return f"DEPTH COVERAGE: {depth or 'Balanced'}\n  {directive['coverage']}"


def _style_block(styles: list[str] | None) -> str:
    if not styles:
        styles = ["Examples", "Visual", "Story-based"]
    rendered = []
    for s in styles:
        d = _STYLE_DIRECTIVES.get(s)
        if d:
            rendered.append(f"  - {s}: {d}")
    if not rendered:
        return ""
    return "STYLE (apply in listed priority order; blend where natural):\n" + "\n".join(rendered)


_STRUCTURE_DIRECTIVES = {
    "meme": (
        "\n\nTEMPLATE: Meme mode. Titles, taglines and lesson titles are playful and internet-flavoured "
        "(a pun or a meme reference is welcome) but still say exactly what is taught."
    ),
    "story": (
        "\n\nTEMPLATE: Story mode. The course is a serialized story: one recurring protagonist "
        "(story_character) lives through the subject, one episode per lesson. Lesson titles read like "
        "episode titles (\"The Night the Cache Lied\"), still hinting at what is taught. Each lesson's "
        "focus names both the concept and what happens to the character in that episode."
    ),
}

_LESSON_JSON_RULES = (
    "You output ONLY valid JSON. No markdown, no explanation, no code fences. Just the raw JSON object. "
    "Do not use em dashes (—) anywhere. Use commas, colons, or short sentences instead.\n\n"
)

_SYSTEM_LESSON_MEME = (
    "You write micro-lessons told entirely in memes, for a learning app. " + _LESSON_JSON_RULES +
    "VOICE: the funniest person on the team explaining it over lunch. Casual, self-aware, internet\n"
    "culture, group-chat energy, relatable pain ('it works on my machine', 'me at 3am'). Every joke\n"
    "carries the point and every statement is 100% accurate: a gag that is technically wrong is a\n"
    "failure. Second person. Short sentences. No textbook voice, no hedging, no hype words.\n\n"
    "The WHOLE lesson is meme-native, not a normal lesson with one meme added. Block types available\n"
    "(use only these):\n"
    "- hook: a meme-able opening line or situation (first block only)\n"
    "- meme: an image meme. Fields: image_prompt, caption, alt_text (see rules)\n"
    "- chat: a group chat where named characters work the idea out. Field: messages, a list of\n"
    "  {who, text}, 2-8 messages. Give the characters short names and distinct personalities\n"
    "  (the confident one who is wrong, the one who actually read the docs).\n"
    "- hot_take: one bold, opinionated line the learner will remember. Field: content\n"
    "- text: short and punchy, at most 80 words. Field: content\n"
    "- plot_twist: a common misconception flipped. Fields: setup (what everyone believes), content\n"
    "  (the reveal: what is actually true and why)\n"
    "- checkpoint: a pop quiz in the middle of the feed. Fields: question, options (2-4 strings),\n"
    "  correct (0-based index), explanation (why, with a joke if it helps)\n"
    "- tldr: newline-separated bullets starting with '- '. Field: content\n"
    "- list: bullet points. content = newline-separated items starting with -\n"
    "- code: only for a technical topic, and tiny (under 10 lines). Fields: language, code\n"
    "- callout: last block, the one line to remember. Fields: style (exam_tip | pro_tip | warning |\n"
    "  note | info), content\n\n"
    "Lesson shape (follow this order, it is the feed):\n"
    "  hook -> meme -> chat -> hot_take -> meme -> text -> plot_twist -> meme (optional) ->\n"
    "  checkpoint -> tldr -> callout\n"
    "Structural rules that always apply:\n"
    "- First block must be hook, last block must be callout\n"
    "- 3-4 meme blocks per lesson, each right after the idea it roasts or celebrates\n"
    "- 9-14 blocks total. Block ids must be unique: b1, b2, b3, ..."
)

_SYSTEM_LESSON_STORY = (
    "You write lessons as episodes of a serialized story, for a learning app. " + _LESSON_JSON_RULES +
    "VOICE: a good novelist who also knows the subject cold. Present tense, close on the protagonist,\n"
    "concrete sensory detail, real stakes. The story is the vehicle, the concept is the cargo: every\n"
    "scene exists to make one idea land, and the concept is always stated plainly and accurately in\n"
    "an insight block, never left for the reader to infer.\n\n"
    "Block types available (use only these):\n"
    "- hook: cold open, mid-action, one or two sentences (first block only)\n"
    "- text: scene prose, 80-200 words, present tense. Field: content\n"
    "- chat: dialogue between characters. Field: messages, a list of {who, text}, 2-8 messages\n"
    "- insight: 'What just happened': the concept behind the scene, explained plainly, 60-150\n"
    "  words. Field: content\n"
    "- checkpoint: 'What should <protagonist> do?' Fields: question, options (2-4 strings), correct\n"
    "  (0-based index), explanation (what happens with each choice and why)\n"
    "- sketch: the whiteboard the characters draw on. Optional. Field: spec (object)\n"
    "- diagram: Mermaid, only for branching, loops, sequences or state machines. Optional. Field:\n"
    "  code (must start with: graph, flowchart, sequenceDiagram, classDiagram, stateDiagram,\n"
    "  erDiagram, gantt, pie, or gitGraph)\n"
    "- code: only if the character would really write it in the scene. Fields: language, code\n"
    "- cliffhanger: one teaser line that pulls into the next episode. Field: content\n"
    "- callout: last block, 'Field notes': the takeaway in one or two sentences. Fields: style\n"
    "  (exam_tip | pro_tip | warning | note | info), content\n\n"
    "Episode shape (follow this order):\n"
    "  hook -> text (the scene) -> chat -> insight -> sketch or diagram (optional, the whiteboard) ->\n"
    "  text (the scene continues, stakes rise) -> checkpoint -> insight -> cliffhanger -> callout\n"
    "Structural rules that always apply:\n"
    "- First block must be hook, last block must be callout (cliffhanger right before it)\n"
    "- No section titles and no bullet-list structure: this reads like a story, not a manual\n"
    "- 9-14 blocks total. Block ids must be unique: b1, b2, b3, ..."
)

_SYSTEM_LESSONS = {"general": _SYSTEM_LESSON, "meme": _SYSTEM_LESSON_MEME, "story": _SYSTEM_LESSON_STORY}
# Styles that ask for block types a template does not have (memes are this template's visuals).
_TEMPLATE_DROPPED_STYLES = {"meme": {"Visual"}}


def _system_lesson(prefs: dict | None) -> str:
    """System prompt for Phase 2, with the learner's level and style appended.

    LEVEL and STYLE belong here, not in the user turn: they contradict the default VOICE
    and visual-frequency rules above them, and a preference buried mid-user-turn loses to
    a system-prompt rule every time. Appended last so they read as the final word.
    DEPTH coverage and DENSITY stay in the user turn — those vary per lesson.
    """
    level = (prefs or {}).get("level")
    template = _template(prefs)
    dropped = _TEMPLATE_DROPPED_STYLES.get(template, set())
    styles = [s for s in (prefs or {}).get("style") or [] if s not in dropped]
    if dropped and not styles:
        styles = ["Examples"]  # _style_block treats [] as "use the defaults", which include Visual
    tail = "\n\n".join(filter(None, [_level_block(level), _style_block(styles)]))
    return (
        f"{_SYSTEM_LESSONS[template]}\n\n"
        "LEARNER SETTINGS — these were chosen by the reader. Where they conflict with a default "
        "above, these win.\n\n"
        f"{tail}"
    )


def _background_block(background: str | None) -> str:
    background = (background or "").strip()[:500]
    if not background:
        return ""
    return (
        f"LEARNER BACKGROUND: {background}\n"
        "  Tailor examples, analogies, and scenarios to this learner's role and background."
    )


def _depth_range(depth: str | None) -> tuple[int, int]:
    entry = _DEPTH_DIRECTIVES.get(depth or "Balanced", _DEPTH_DIRECTIVES["Balanced"])
    return entry["target_days"]


# Below this, the "source" is a topic prompt, not reference material. A typed topic is 1-5
# words; a real document is hundreds. The distinction matters because the old duration rule
# told the model to size the course to the source, which for a 2-word topic meant "go short".
_PROMPT_SOURCE_MAX_WORDS = 150


def _duration_rule(content: ContentResult, min_days: int, max_days: int) -> str:
    """The duration_days rule, which differs for a typed topic vs a real document.

    For a topic the model IS the material, so the depth band is authoritative. For a
    document the source genuinely constrains how much there is to teach.
    """
    simple_floor = max(3, min_days - 4)
    if content.word_count < _PROMPT_SOURCE_MAX_WORDS:
        return (
            f"- duration_days: MUST be between {min_days} and {max_days}. The learner chose this\n"
            f"    depth and the band is what that choice means to them, so meeting it is not optional.\n"
            f"    The text above is a topic prompt, NOT reference material: your own knowledge of the\n"
            f"    subject is the material. 'The source is short' is never a reason for a short course.\n"
            f"    Use the upper half of the band when topic_complexity is complex or vast.\n"
            f"    ONLY exception: when topic_complexity is \"simple\" (one narrow concept, e.g. \"what is\n"
            f"    a variable\"), you may go as low as {simple_floor}.\n"
            f"    Never pad to hit the number. No recap, conclusion, next-steps, or introduction\n"
            f"    lessons, and never split one concept across two lessons. If you need more lessons,\n"
            f"    go deeper into the subject: edge cases, failure modes, real applications, adjacent\n"
            f"    concepts a practitioner needs. Every lesson teaches something no other lesson does."
        )
    return (
        f"- duration_days: {min_days} to {max_days} for the chosen depth. Within that band the source\n"
        f"    decides: upper half when it is broad and substantial, lower half when it is focused.\n"
        f"    Go below {min_days} only when the source genuinely cannot support more.\n"
        f"    Never pad. No recap, conclusion, or next-steps lessons, and never split one concept\n"
        f"    across two lessons. Every lesson teaches something no other lesson does."
    )


def _structure_prompt(content: ContentResult, prefs: dict | None) -> str:
    body = content.body[:MAX_CONTENT_CHARS]
    level = (prefs or {}).get("level")
    depth = (prefs or {}).get("depth")
    styles = list((prefs or {}).get("style") or [])
    min_days, max_days = _depth_range(depth)
    max_days = min(max_days, MAX_LESSONS_PER_PATH)
    min_days = min(min_days, max_days)
    duration_rule = _duration_rule(content, min_days, max_days)
    story_based = "Story-based" in styles or _template(prefs) == "story"

    prefs_section = "\n\n".join(filter(None, [
        _level_block(level),
        _depth_block_course(depth),
        _style_block(styles),
        _background_block((prefs or {}).get("background")),
    ]))

    story_character_field = (
        '"story_character": {"name": "A realistic name", "context": "One sentence: their job or situation that connects to this topic"},'
        if story_based else
        '"story_character": null,'
    )

    story_character_rule = (
        "- story_character: REQUIRED. The protagonist of the whole course: one consistent, realistic character\n"
        "    whose job or situation runs into this subject."
        if _template(prefs) == "story" else
        "- story_character: only fill this when Story-based style is selected. One consistent character for the entire course.\n"
        "    null otherwise."
    )

    return f"""Analyze this content and create a learning course outline.

Source title: {content.title}
Source content:
{body}

LEARNER PREFERENCES (shape the course to match):
{prefs_section}

Return JSON with this exact structure:
{{
  "title": "Concise course title (max 6 words)",
  "tagline": "N days. One compelling benefit.",
  "outcome": "By the end, learners will be able to [specific skill]",
  "difficulty": "beginner|intermediate|advanced",
  "tags": ["tag1", "tag2", "tag3"],
  "topic_complexity": "simple|moderate|complex|vast",
  "prerequisites": ["prerequisite 1", "prerequisite 2"],
  "natural_content_types": ["code", "sketch", "analogy"],
  "pedagogy_note": "One or two sentences: how a lesson in THIS subject should actually be built.",
  {story_character_field}
  "duration_days": {min_days},
  "minutes_per_day": 15,
  "icon": "ai",
  "gradient": "from-violet-600 to-indigo-700",
  "accent_color": "#7C3AED",
  "lessons": [
    {{"day": 1, "title": "Lesson Title", "focus": "What this lesson covers in 1-2 sentences", "problem_setup": "", "complexity_weight": "light|medium|heavy"}},
    {{"day": 2, "title": "Lesson Title", "focus": "...", "problem_setup": "One sentence: the specific limitation of Day 1 that this lesson resolves", "complexity_weight": "light|medium|heavy"}},
    {{"day": 3, "title": "Lesson Title", "focus": "...", "problem_setup": "...", "complexity_weight": "light|medium|heavy"}}
  ]
}}

Rules:
- The "lessons" array MUST contain exactly duration_days entries, numbered day 1 to
    duration_days with no gaps. The three shown above illustrate the SHAPE of an entry, not
    how many to write. Returning three lessons when duration_days is {min_days} is a failure.
- topic_complexity: assess how broad this subject genuinely is.
    simple   = one clear concept (e.g. "what is a variable").
    moderate = a handful of related concepts (e.g. "REST API design").
    complex  = many interconnected concepts requiring significant time (e.g. "async programming").
    vast     = a domain that normally takes weeks or months (e.g. "data structures", "machine learning").
- prerequisites: list 0-4 things the learner should already know before starting. Be specific.
    Use [] when there are none. Do not list things this course will teach.
- natural_content_types: which block types genuinely benefit this topic most.
    Choose from: code, sketch, diagram, analogy, list, challenge. Order by importance for this topic.
    sketch = hand-drawn architecture/pipeline visual; diagram = Mermaid, only for branching,
    sequences between actors, or state machines.
    Be honest and selective. Only list code if the learner will really read or write code in this
    subject. Only list sketch or diagram if the ideas have structure worth drawing. A course on
    public speaking might be ["analogy", "list", "challenge"] and nothing else, and that is correct.
    Listing a type here makes it appear in the lesson generator, so a wrong entry produces a
    pointless code block or diagram in every lesson.
- pedagogy_note: how a lesson in THIS specific subject should be built, in one or two sentences.
    This is what stops every course coming out with the same shape. Say what the spine of a lesson
    looks like here and what makes an explanation land in this field. Be concrete and specific to
    the subject, never generic advice.
    Examples of the right level of specificity:
      Cooking: "Lead with the sensory cue the cook is watching for, then the technique behind it.
        Every step needs a 'you know it is working when' marker. Ratios beat exact quantities."
      System design: "Open with the constraint that makes the naive design fail, then derive the
        fix. Every component needs its failure mode and its cost."
      History: "Anchor each lesson in one specific person, place, or document, then widen to the
        pattern it illustrates. Name the disagreement between historians where one exists."
      Negotiation: "Open with a short realistic exchange, then dissect what each move was doing.
        Every tactic needs its counter and the situation where it backfires."
{story_character_rule}
{duration_rule}
- difficulty: match the LEVEL directive (Beginner=beginner, Intermediate=intermediate, Advanced=advanced).
- complexity_weight per lesson: rate each lesson independently.
    light  = introductory or definitional (what is X).
    medium = applied or procedural (how to use X, when to use X).
    heavy  = compositional, edge-case, or system-level (when X fails, how X fits into Y).
- Each lesson MUST build on the previous. For every lesson after day 1, problem_setup contains the specific
  gap or failure case of the prior lesson that this lesson resolves. Day 1 problem_setup is "".
- gradient: Tailwind gradient classes (from-[color]-500 to-[color]-700).
- accent_color: hex color matching the gradient.
- icon: choose the SINGLE best-fitting category slug from this exact list:
    programming, web, ai, data, cloud, security, database, devops, networking,
    mobile, hardware, design, business, finance, marketing, math, science,
    health, language, humanities, productivity, gaming, music, writing, general.
    Output only the slug (e.g. "science"). Use "general" if none clearly fit."""


def _depth_block_course(depth: str | None) -> str:
    directive = _DEPTH_DIRECTIVES.get(depth or "Balanced", _DEPTH_DIRECTIVES["Balanced"])
    return f"DEPTH: {depth or 'Balanced'}\n  {directive['course']}"


# Schema examples per block type. Models mimic the example far more strongly than they follow
# prose rules, so a fixed example containing python and Mermaid pushed code and diagrams into
# cooking and history courses. Only the types that suit this topic are shown; the full field
# reference for every type still lives in _SYSTEM_LESSON.
_BLOCK_EXAMPLES_CORE = [
    '{"id": "b1", "type": "hook", "content": "Thought-provoking opening..."}',
    '{"id": "b2", "type": "heading", "content": "Section Title"}',
    '{"id": "b3", "type": "text", "content": "Explanation paragraph..."}',
    '{"id": "b4", "type": "subheading", "content": "Sub-topic title"}',
    '{"id": "b5", "type": "analogy", "content": "Think of it like..."}',
    '{"id": "b6", "type": "list", "content": "- Point one\\n- Point two\\n- Point three"}',
]

_BLOCK_EXAMPLES_OPTIONAL = {
    "code": '{"id": "b7", "type": "code", "language": "python", "code": "# Working example\\nprint(\'hello\')"}',
    "sketch": '{"id": "b8", "type": "sketch", "spec": {"title": "Request path", "rows": [[{"id": "cli", "label": "Client", "color": "green"}, {"id": "api", "label": "API\\nGateway", "color": "blue"}, {"id": "db", "label": "Database", "color": "violet"}]], "edges": [["cli", "api"], ["api", "db"]], "notes": [{"on": "api", "text": "Auth happens here, before any query is built"}, {"on": "db", "text": "One round trip per request, or the cache is doing nothing"}]}}',
    "diagram": '{"id": "b8b", "type": "diagram", "code": "graph TD\\n  A[Start] --> B{Valid?}\\n  B -->|yes| C[Process]\\n  B -->|no| D[Reject]"}',
    "challenge": '{"id": "b9", "type": "challenge", "question": "Design question here?", "answer_diff": {"language": "yaml", "before": "on:\\n  push:\\n    branches: [main]", "after": "on:\\n  push:\\n    branches: [main]\\n  pull_request:\\n    branches: [main]"}, "answer": "One sentence explaining why this change satisfies the requirement.", "hint": "Think about..."}',
}

_MEME_EXAMPLE = '{"id": "b8c", "type": "meme", "image_prompt": "Two-panel cartoon: a tired robot waving away a pile of copy-pasted code with the text \\"Copy-paste the fix everywhere\\", then smiling at one tidy function with the text \\"Fix it once in the shared helper\\"", "caption": "One fix in the shared function beats ten patches in the callers.", "alt_text": "Robot rejects copy-pasted code and approves a single shared function"}'

# Meme and story lessons have a fixed shape, so their example IS the shape (in order).
_TEMPLATE_BLOCK_EXAMPLES = {
    "meme": [
        '{"id": "b1", "type": "hook", "content": "POV: you fixed the bug in one place and it is still broken in four others."}',
        _MEME_EXAMPLE.replace('"b8c"', '"b2"'),
        '{"id": "b3", "type": "chat", "messages": [{"who": "Dev", "text": "why is prod still broken, I fixed it"}, {"who": "Senior", "text": "you fixed ONE caller. there are five"}, {"who": "Dev", "text": "so I patch all five?"}, {"who": "Senior", "text": "no. fix the shared function once and every caller gets it"}]}',
        '{"id": "b4", "type": "hot_take", "content": "If your fix lives in the caller, it is not a fix, it is a sticker."}',
        '{"id": "b5", "type": "meme", "image_prompt": "...", "caption": "...", "alt_text": "..."}',
        '{"id": "b6", "type": "text", "content": "Short, punchy explanation of the mechanism, 80 words max..."}',
        '{"id": "b7", "type": "plot_twist", "setup": "What everyone believes...", "content": "What is actually true, and why..."}',
        '{"id": "b8", "type": "checkpoint", "question": "Pop quiz: ...?", "options": ["...", "...", "..."], "correct": 1, "explanation": "Why, in one or two lines..."}',
        '{"id": "b9", "type": "tldr", "content": "- Point one\\n- Point two\\n- Point three"}',
    ],
    "story": [
        '{"id": "b1", "type": "hook", "content": "Cold open, mid-action: the moment it goes wrong..."}',
        '{"id": "b2", "type": "text", "content": "The scene, present tense, what the protagonist sees and wants..."}',
        '{"id": "b3", "type": "chat", "messages": [{"who": "Protagonist", "text": "..."}, {"who": "Colleague", "text": "..."}]}',
        '{"id": "b4", "type": "insight", "content": "What just happened: the concept, stated plainly..."}',
        _BLOCK_EXAMPLES_OPTIONAL["sketch"].replace('"b8"', '"b5"'),
        '{"id": "b6", "type": "text", "content": "The scene continues, the stakes rise..."}',
        '{"id": "b7", "type": "checkpoint", "question": "What should the protagonist do?", "options": ["...", "...", "..."], "correct": 0, "explanation": "What each choice leads to, and why..."}',
        '{"id": "b8", "type": "insight", "content": "The second idea, stated plainly..."}',
        '{"id": "b9", "type": "cliffhanger", "content": "Teaser line into the next episode..."}',
    ],
}

_TEMPLATE_RULES = {
    "meme": """- Follow the lesson shape from the system prompt, in order. Always start with hook, always end
  with callout.
- The hook MUST riff on the NARRATIVE SETUP when one is provided.
- Do not re-define anything listed under ALREADY INTRODUCED.
- Funny AND correct: every meme, chat line and hot take teaches one real point from this lesson.
  The chat carries most of the explanation, so it must get the mechanism right, not just vibe.
- meme blocks: 3-4 per lesson. Fields: image_prompt, caption, alt_text.
    - image_prompt: describe an ORIGINAL meme image for an image model: the layout (two-panel
      reject/approve, four-panel expanding brain, cartoon dog calmly sipping coffee in a burning room,
      'me vs. me at 3am' split, etc.), the cartoon characters, and the exact overlay text in quotes.
      Overlay text: at most two lines, max 8 words each. No real people, celebrities, brands or logos.
    - caption: one line under the image explaining the joke in terms of the concept.
    - alt_text: what the image shows, for screen readers.
- chat: 3-8 messages, named characters, lowercase group-chat style is fine.
- text: at most 80 words each. plot_twist: setup is the misconception, content is the reveal.
- checkpoint: 2-4 options, correct is a 0-based index, the wrong options are plausible mistakes.
- tldr: 3-5 bullets, each line starts with "- ".
- Inline formatting in text, chat, callout, tldr and list content: **bold** the first mention of
  2-4 key terms per lesson, `backticks` for literal tokens. No markdown in hook, meme or code.
- callout style must be one of: exam_tip | pro_tip | warning | note | info.
""",
    "story": """- Follow the episode shape from the system prompt, in order. Always start with hook, always end
  with callout, with the cliffhanger right before it (skip the cliffhanger only on the final lesson).
- The hook MUST dramatize the NARRATIVE SETUP when one is provided: it is the problem this episode opens on.
- Do not re-define anything listed under ALREADY INTRODUCED; the character already knows it too.
- Keep the STORY CHARACTER consistent with earlier episodes: same name, same job, same world.
- insight blocks carry the teaching. After reading only the insights, a learner must be able to
  answer the quiz. Never leave the concept implied by the story.
- chat: 2-8 lines of dialogue that sound like real people, not a lecture split into quotes.
- checkpoint: "What should <name> do?" with 2-4 options, correct is a 0-based index; the
  explanation says what each choice would have led to.
- Text blocks: 80-200 words, present tense. Aim for 900-1500 words of prose in total.
- Inline formatting in text, insight, chat and callout content: **bold** the first mention of
  2-5 key terms, `backticks` for literal tokens. No markdown in hook, cliffhanger, code or sketch.
- callout style must be one of: exam_tip | pro_tip | warning | note | info.
- Visuals: at most one sketch or diagram, drawn as the characters' whiteboard, only when the idea
  has real structure.
""",
}


def _template_code_rule(natural_content_types: list[str]) -> str:
    if "code" in natural_content_types:
        return "- code: only where the learner really reads or writes code here. Keep it short and runnable.\n"
    return "- This subject has no code: no code blocks.\n"


_BLOCK_EXAMPLE_CLOSER = '{"id": "b10", "type": "callout", "style": "pro_tip", "content": "Key takeaway..."}'


def _blocks_example(natural_content_types: list[str] | None) -> str:
    """Build the blocks schema example, showing only types that fit this topic."""
    wanted = {t.strip().lower() for t in (natural_content_types or [])}
    lines = list(_BLOCK_EXAMPLES_CORE)
    for key, example in _BLOCK_EXAMPLES_OPTIONAL.items():
        # Empty list = Phase 1 gave us nothing, so fall back to showing everything
        # rather than silently stripping capability from the model.
        if not wanted or key in wanted:
            lines.append(example)
    lines.append(_BLOCK_EXAMPLE_CLOSER)
    return ",\n    ".join(lines)


# Lesson rules, split so every template shares the assessment rules (quiz + flashcards) while
# the general template's text stays exactly as it was.
_RULE_ASSESSMENT_FIRST = """- ASSESSMENT FIRST. Write the quiz and flashcards before you write a single block. They are the
  evidence that the learner has actually understood this lesson. Only then write the blocks, and
  write only the blocks needed to make that evidence reachable. Before emitting any block, ask:
  does this help the learner answer a quiz item or land a flashcard? If not, cut it. A lesson
  that explains more than it tests is padded, and padding is the failure mode here.
"""
_RULES_GENERAL = """- Block count AND total word count are set by LESSON DENSITY above. Hit the word budget: a lesson
  that lands well under it is thin, and the learner is being promised more minutes than you wrote.
  Reach the budget by explaining more deeply, not by adding more blocks that say less. Always start
  with hook, always end with callout.
- Depth beats breadth. Prefer explaining WHY something works, what happens when it fails, and what
  a real situation looks like, over listing more named concepts. If you find yourself writing a
  definition and moving on, you owe the reader the mechanism behind it.
- The hook MUST open with the NARRATIVE SETUP when one is provided.
- Do not re-define anything listed under ALREADY INTRODUCED.
- Organize into 2-3 named sections using heading blocks.
- Inline formatting in text, analogy, callout, and list block content:
    - Wrap the FIRST occurrence of each key technical term in **double asterisks** (markdown bold).
      Target 2-5 bolded terms per block. Subsequent mentions of the same term stay plain.
      Bold real domain nouns (e.g. **Triggers**, **Jobs**, **Steps**, **Secrets**), not adjectives.
    - Use `backticks` for short literal tokens: function names, flags, file paths, config keys.
    - Use *single asterisks* sparingly for emphasis only when no bold or code fits.
    - Do not use markdown inside hook, heading, subheading, code, diagram, sketch spec text,
      or challenge.question.
- callout style must be one of: exam_tip | pro_tip | warning | note | info.
- Visuals: at most two per lesson, and only where they carry weight — unless a STYLE directive sets
  a floor, in which case meet the floor. Prefer sketch; use diagram only for branching, loops,
  actor sequences, state machines, entity relationships, or timelines.
"""
_RULES_SKETCH = """- sketch spec rules (a spec breaking any of these is discarded and the diagram will not appear):
    - rows: 1-3 bands (hard max 4), each 1-5 nodes, read strictly left to right. 2-16 nodes total.
      Row 1 is usually the main flow; row 2 is a second stage or the runtime path.
    - node id: short and unique across the whole spec (e.g. "api", "db"). label: max 60 chars,
      use \\n for a second line. color: green, blue, violet, teal, orange, red, or pink.
      Colour by role, so components in the same layer share a colour.
    - edges: [fromId, toId] pairs, both ids must exist. Same-row edges draw straight across;
      cross-row edges curve. No self-edges.
    - notes: the point of the block. One per node at most, on the nodes that carry the lesson's
      insight, not on every node. Max 140 chars, a full sentence, opinionated and specific
      ("Auth happens here, before any query is built"), never a restatement of the label
      ("This is the API gateway"). 2-4 notes is the sweet spot.
    - title: optional, max 60 chars.
    - No markdown, no backticks, and no em dashes inside labels, notes, or title.
- diagram code MUST start with a valid Mermaid keyword: graph, flowchart, sequenceDiagram, classDiagram,
  stateDiagram, erDiagram, gantt, pie, or gitGraph.
"""
_RULES_CHALLENGE = """- challenge: requires question, plus either answer_diff or answer. Only one challenge per lesson,
  only in medium or heavy density.
    - When the answer is a concrete code/config change, ALWAYS use answer_diff with before and after
      strings (use \\n for newlines). before and after must differ. Set language to the code's language
      (e.g. yaml, python, json, hcl). Keep answer to 1-2 sentences of reasoning.
    - When the answer is purely conceptual (no code edit), use answer alone.
"""
_RULES_QUIZ_FLASHCARDS = """- flashcards: 4-6 cards. back MUST be 1-2 sentences, at most 25 words. Lead with the answer itself.
  Do not start with phrases like "The answer is" or "This is".
- quiz: 3 questions. Exactly 4 options each. correct is 0-based index. Test understanding, not recall.
  Distractors must be challenging: pick from (a) a common misconception, (b) a true statement that does
  not answer this specific question, (c) a near-miss differing by one critical word or clause, or
  (d) the right idea applied to a related-but-wrong concept. Never use "all of the above",
  tautologies, or obviously unrelated filler. All four options must be similar length (within 30 percent
  of each other); length must not signal which option is correct.
"""
_RULE_CODE = """- code blocks must have both language and code fields."""
_GENERAL_RULES = (_RULE_ASSESSMENT_FIRST + _RULES_GENERAL + _RULES_SKETCH + _RULES_CHALLENGE
                  + _RULES_QUIZ_FLASHCARDS + _RULE_CODE)


def _lesson_prompt(
    path_title: str,
    lesson_title: str,
    lesson_focus: str,
    day: int,
    content_chunk: str,
    prefs: dict | None,
    problem_setup: str | None = None,
    prior_concepts: list[str] | None = None,
    complexity_weight: str = "medium",
    natural_content_types: list[str] | None = None,
    story_character: dict | None = None,
    pedagogy_note: str | None = None,
) -> str:
    depth = (prefs or {}).get("depth")
    styles = list((prefs or {}).get("style") or [])

    template = _template(prefs)

    # A style can make a block type mandatory even when Phase 1 did not list it.
    natural_content_types = _required_content_types(natural_content_types, styles)
    if template == "general":
        blocks_example = _blocks_example(natural_content_types)
        density = _DENSITY_DIRECTIVES.get(complexity_weight, _DENSITY_DIRECTIVES["medium"])
        rules = _GENERAL_RULES
    else:
        # Fixed shape per template: the example is the shape, and the topic's natural types only
        # decide whether code is allowed (the general-vocabulary list would contradict the shape).
        blocks_example = ",\n    ".join(_TEMPLATE_BLOCK_EXAMPLES[template] + [_BLOCK_EXAMPLE_CLOSER])
        density = ""
        rules = (_RULE_ASSESSMENT_FIRST + _TEMPLATE_RULES[template] + _template_code_rule(natural_content_types)
                 + (_RULES_SKETCH if template == "story" else "") + _RULES_QUIZ_FLASHCARDS + _RULE_CODE)
        natural_content_types = []

    # LEVEL and STYLE live in the system prompt (see _system_lesson) — repeating them
    # here would just dilute them.
    prefs_section = "\n\n".join(filter(None, [
        _depth_coverage_block(depth),
        density,
        _background_block((prefs or {}).get("background")),
    ]))

    # Natural content types tell Claude what this topic actually benefits from
    content_type_section = ""
    if natural_content_types:
        content_type_section = (
            "\nBLOCK TYPES THAT SUIT THIS TOPIC (in order of usefulness):\n"
            "  " + ", ".join(natural_content_types) + "\n"
            "  These are the types to reach for, NOT a checklist. Use one only where it genuinely\n"
            "  carries the idea better than prose would. Skipping one entirely is a valid choice.\n"
            "  Never include a block type that is absent from this list.\n"
        )

    # Phase 1 decides how this specific subject should be taught. Without it every
    # course, technical or not, converges on the same hook/heading/text/visual shape.
    pedagogy_section = ""
    if pedagogy_note:
        pedagogy_section = (
            "\nHOW THIS SUBJECT SHOULD BE TAUGHT (decided for this course, follow it):\n"
            f"  {pedagogy_note}\n"
        )

    # Narrative chain
    narrative_section = ""
    if problem_setup:
        narrative_section = (
            f"\nNARRATIVE SETUP (hook block MUST open with this problem, do not invent a new opening):\n"
            f"  {problem_setup}\n"
        )

    prior_section = ""
    if prior_concepts:
        prior_section = (
            "\nALREADY INTRODUCED (do not re-define these; reference them as known and build on them):\n  - "
            + "\n  - ".join(prior_concepts[:10])
            + "\n"
        )

    # Story character consistency — if Phase 1 established one, pass it through
    character_section = ""
    if story_character and isinstance(story_character, dict):
        name = story_character.get("name", "")
        context = story_character.get("context", "")
        if name:
            character_section = (
                f"\nSTORY CHARACTER (use consistently throughout; do not invent a different character):\n"
                f"  Name: {name}\n"
                f"  Context: {context}\n"
                f"  Frame the hook and examples around this character's ongoing situation.\n"
            )

    variety_rule = (
        "\nVARIETY: Use diverse, realistic names and professional contexts in examples. "
        "Do not repeat the same person name or company name more than once within this lesson.\n"
    ) if not story_character else ""

    return f"""Create a micro-lesson for day {day} of "{path_title}".

Lesson title: {lesson_title}
Lesson focus: {lesson_focus}
{narrative_section}{prior_section}{character_section}{variety_rule}{pedagogy_section}{content_type_section}
LEARNER PREFERENCES:
{prefs_section}

Source content:
{content_chunk[:8000]}

Return JSON with this exact shape, generating the keys IN THIS ORDER: quiz first, blocks last.
The order is deliberate: the quiz and flashcards define what the learner must be able to do, and
the blocks exist only to make those answerable.
{{
  "quiz": [
    {{
      "question": "Precise question testing real understanding?",
      "options": ["Correct answer", "Common misconception that sounds right", "Near-miss off by one critical word", "Right idea applied to a related-but-wrong concept"],
      "correct": 0,
      "explanation": "Option A is correct because... The others are wrong because..."
    }}
  ],
  "flashcards": [
    {{"front": "What is X?", "back": "Short definition in one sentence.", "difficulty": "medium"}},
    {{"front": "How does Y work?", "back": "Lead with the mechanism, one clause of why.", "difficulty": "easy"}},
    {{"front": "When would you use Z?", "back": "Use Z when [specific condition].", "difficulty": "hard"}}
  ],
  "blocks": [
    {blocks_example}
  ]
}}

Rules:
{rules}"""


# ── JSON parsing ──────────────────────────────────────────────────────────

def _parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fixed = re.sub(r",\s*([}\]])", r"\1", text)
    try:
        return json.loads(fixed)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"Could not parse LLM response as JSON: {e}\n\n"
            f"Raw (first 300 chars): {text[:300]}"
        )


# ── Data classes returned to callers ──────────────────────────────────────

# Canonical course-icon categories. The model picks ONE of these slugs; the
# frontend (DynamicIcon) maps each slug to a curated Lucide line-icon. Keeping a
# fixed vocabulary (instead of free-form emoji) guarantees every course gets a
# deliberate, on-brand icon and removes the old "unknown emoji → generic book"
# fallback lottery. Keep this list in sync with CATEGORY_ICONS in
# frontend/components/icons/DynamicIcon.tsx.
COURSE_ICON_CATEGORIES = {
    "programming", "web", "ai", "data", "cloud", "security", "database",
    "devops", "networking", "mobile", "hardware", "design", "business",
    "finance", "marketing", "math", "science", "health", "language",
    "humanities", "productivity", "gaming", "music", "writing", "general",
}


def normalize_course_icon(value: str | None) -> str:
    """Coerce the model's icon output to a known category slug.

    Falls back to "general" for anything unrecognized (including legacy emoji
    values), so the frontend always resolves to a real icon.
    """
    if not value:
        return "general"
    slug = value.strip().lower()
    return slug if slug in COURSE_ICON_CATEGORIES else "general"


class CourseStructure:
    """Result of Phase 1 — course metadata + lesson outlines (no lesson content yet)."""
    def __init__(self, data: dict, content: ContentResult):
        self.id = str(uuid.uuid4())
        self.title = data.get("title", content.title or "Untitled Course")
        self.tagline = data.get("tagline", "Learn at your own pace.")
        self.outcome = data.get("outcome", "Master the key concepts")
        self.difficulty = data.get("difficulty", "intermediate")
        self.tags = data.get("tags", [])
        self.icon = normalize_course_icon(data.get("icon"))
        self.gradient = data.get("gradient", "from-violet-600 to-indigo-700")
        self.accent_color = data.get("accent_color", "#7C3AED")
        self.minutes_per_day = int(data.get("minutes_per_day", 15))
        self.source_type = content.source_type
        self.source_url = content.source_url
        self.source_title = content.title
        self.source_excerpt = content.body[:400] if content.body else None

        # Topic intelligence — new fields from Phase 1
        self.topic_complexity: str = data.get("topic_complexity") or "moderate"
        self.prerequisites: list[str] = data.get("prerequisites") or []
        self.natural_content_types: list[str] = data.get("natural_content_types") or []
        # How lessons in this subject should be shaped — passed into every Phase 2 call
        # so a cooking course does not come out shaped like a systems course.
        self.pedagogy_note: str = (data.get("pedagogy_note") or "").strip()
        # story_character is None unless Story-based style was selected
        raw_char = data.get("story_character")
        self.story_character: dict | None = raw_char if isinstance(raw_char, dict) else None

        raw_lessons = data.get("lessons", [])[:MAX_LESSONS_PER_PATH]
        self.duration_days = len(raw_lessons)
        self.lesson_outlines: list[dict] = raw_lessons


class LessonContent:
    """Result of Phase 2 — full lesson content ready to write to DB."""
    def __init__(self, course_id: str, day: int, outline: dict, data: dict, minutes: int):
        self.id = str(uuid.uuid4())
        self.course_id = course_id
        self.title = outline.get("title", f"Day {day}")
        self.day_number = day
        self.estimated_minutes = minutes
        self.blocks = data.get("blocks", [])
        self.flashcards = data.get("flashcards", [])
        self.quiz = data.get("quiz", [])


# ── Phase 1 ───────────────────────────────────────────────────────────────

def generate_course_structure(
    content: ContentResult,
    prefs: dict | None = None,
) -> CourseStructure:
    """Blocking LLM call — run via asyncio.to_thread."""
    # up to MAX_LESSONS_PER_PATH outlines + pedagogy_note
    system = _SYSTEM_STRUCTURE + _STRUCTURE_DIRECTIVES.get(_template(prefs), "")
    data = _parse_json(_complete(system, _structure_prompt(content, prefs), 4096, "Course structure",
                                 _model_for(prefs)))
    structure = CourseStructure(data, content)
    if _template(prefs) == "story" and not (structure.story_character or {}).get("name"):
        # Story mode has no spine without a protagonist; never leave it to the model's mood.
        structure.story_character = {"name": "Sam", "context": "Sam has just been handed this problem at work and has a week to get it right."}
    structure.prefs = prefs or {}
    return structure


# ── Phase 2 ───────────────────────────────────────────────────────────────

def generate_lesson_content(
    course: CourseStructure,
    outline: dict,
    content: ContentResult,
    prefs: dict | None = None,
    redesign: str | None = None,
) -> LessonContent:
    """Blocking LLM call — run via asyncio.to_thread. redesign = redesign_request(...) text, appended last."""
    day = outline.get("day", 1)
    total = max(course.duration_days, 1)
    body = content.body or ""
    chars_per_lesson = min(len(body) // total + 1, 4000) if body else 0
    start = (day - 1) * chars_per_lesson
    chunk = body[start: start + chars_per_lesson]

    problem_setup = outline.get("problem_setup") or ""
    prior_concepts = [
        o.get("title", "") for o in course.lesson_outlines
        if o.get("day", 0) < day and o.get("title")
    ]

    complexity_weight = outline.get("complexity_weight") or "medium"
    minutes = _COMPLEXITY_MINUTES.get(complexity_weight, 15)
    effective_prefs = prefs if prefs is not None else getattr(course, "prefs", {}) or {}

    user_prompt = _lesson_prompt(
            course.title,
            outline.get("title", f"Lesson {day}"),
            outline.get("focus", ""),
            day,
            chunk,
            effective_prefs,
            problem_setup=problem_setup,
            prior_concepts=prior_concepts,
            complexity_weight=complexity_weight,
            natural_content_types=course.natural_content_types or [],
            story_character=course.story_character,
            pedagogy_note=getattr(course, "pedagogy_note", "") or None,
    )
    if redesign:
        user_prompt += "\n\n" + redesign
    raw_data = _parse_json(_complete(_system_lesson(effective_prefs), user_prompt, LESSON_MAX_TOKENS, f"Lesson {day}",
                                     _model_for(effective_prefs)))
    data = _sanitize_lesson_data(raw_data)
    return LessonContent(course.id, day, outline, data, minutes)


# ── Redesign + tutor ──────────────────────────────────────────────────────

def lesson_to_text(lesson: dict, max_chars: int = 8000) -> str:
    """A lesson as plain text: tutor context and the 'previous version' in a redesign prompt."""
    out = [f"# {lesson.get('title', '')}"]
    for b in lesson.get("blocks") or []:
        t = b.get("type")
        if t == "chat":
            out.append("\n".join(f"{m.get('who') or '?'}: {m.get('text', '')}" for m in b.get("messages") or []))
        elif t == "checkpoint":
            opts = b.get("options") or []
            answer = opts[b["correct"]] if isinstance(b.get("correct"), int) and 0 <= b["correct"] < len(opts) else ""
            out.append(f"[{t}] {b.get('question', '')} Options: {' | '.join(opts)}. Answer: {answer}. {b.get('explanation', '')}")
        elif t == "plot_twist":
            out.append(f"[plot twist] {b.get('setup', '')} -> {b.get('content', '')}")
        elif t == "meme":
            out.append(f"[meme] {b.get('caption', '')}")
        elif t == "sketch":
            spec = b.get("spec") or {}
            labels = [n.get("label", "") for row in spec.get("rows", []) for n in row]
            notes = [n.get("text", "") for n in spec.get("notes", [])]
            out.append(f"[sketch] {spec.get('title', '')}: {' -> '.join(labels)}. {' '.join(notes)}")
        elif t == "challenge":
            out.append(f"[challenge] {b.get('question', '')} Answer: {b.get('answer', '')}")
        elif t in ("code", "diagram"):
            out.append(f"[{t}]\n{b.get('code') or b.get('content') or ''}")
        elif b.get("content"):
            prefix = "## " if t == "heading" else "### " if t == "subheading" else "" if t in ("text", "hook") else f"[{t}] "
            out.append(prefix + str(b["content"]))
    for q in lesson.get("quiz") or []:
        out.append(f"[quiz] {q.get('question', '')}")
    return "\n\n".join(out)[:max_chars]


def redesign_request(instruction: str, previous: dict) -> str:
    return (f"REDESIGN REQUEST from the learner: {instruction.strip()}. Previous version of this lesson "
            f"(keep what worked, change what they asked):\n{lesson_to_text(previous, 6000)}")


_TUTOR_SYSTEM = """You are the learner's personal tutor inside a learning app, sitting next to one lesson.

COURSE: {course_title}
LESSON: {lesson_title}
LEARNER: level {level}; preferred style {style}; background: {background}
CURRENT TEMPLATE: {template}

THE LESSON THEY ARE READING:
<<<
{lesson_text}
>>>

How you help:
- Explain, re-explain it a different way when something did not land, give concrete examples,
  and quiz them when they ask (one question at a time, wait for their answer, then give feedback).
- Stay grounded in this lesson and course. Correct misconceptions plainly.
- Short and friendly: usually under 150 words. Markdown is fine: **bold**, `code`, short lists.
  No headings, no em dashes.

Changing the lesson itself:
If the learner asks to change, rewrite, redo or redesign this lesson or the whole course in a
different way or format (simpler, more examples, more visuals, as memes, as a story, ...), reply
in one or two sentences, then end your reply with exactly one line of this form and nothing after it:
[[redesign scope="lesson" template=""]]One sentence telling the lesson writer what to change.
- scope is "lesson" for this lesson only, "course" for every lesson in the course.
- template is "general" (classic lessons with diagrams), "meme" (told in memes), "story"
  (an episodic story), or "" to keep the current template.
- Only add this line when they asked for a change to the lesson or course, never otherwise."""


def tutor_system(course: dict, lesson: dict) -> str:
    prefs = course.get("prefs") or {}
    return _TUTOR_SYSTEM.format(
        course_title=course.get("title", ""), lesson_title=lesson.get("title", ""),
        level=prefs.get("level") or "Intermediate", style=", ".join(prefs.get("style") or []) or "none",
        background=(prefs.get("background") or "not given").strip()[:500],
        template=lesson.get("template") or course.get("template") or "general",
        lesson_text=lesson_to_text(lesson),
    )


def tutor_stream(system: str, messages: list[dict]):
    """Blocking: opens the stream now (so auth/credit errors raise here), returns a text-chunk iterator."""
    stream = _get_client().chat.completions.create(
        model=TUTOR_MODEL, max_tokens=1200, stream=True,
        messages=[{"role": "system", "content": system}, *messages], **_extra_body(TUTOR_MODEL),
    )

    def chunks():
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    return chunks()
