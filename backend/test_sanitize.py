"""Self-check: python test_sanitize.py"""
import tempfile
import uuid
from pathlib import Path

import app.store as store
from app.generation import _parse_json, _sanitize_blocks, _sanitize_quiz, _sanitize_sketch_spec

# Invalid mermaid → demoted to text; valid diagram kept
blocks = _sanitize_blocks([
    {"type": "diagram", "code": "not mermaid at all"},
    {"type": "diagram", "code": "graph TD\n A-->B"},
    {"type": "callout", "style": "shout", "content": "x"},
])
assert blocks[0]["type"] == "text" and blocks[0]["content"] == "not mermaid at all", blocks
assert blocks[1]["type"] == "diagram"
# Unknown callout style → note; ids assigned
assert blocks[2]["style"] == "note"
assert [b["id"] for b in blocks] == ["b1", "b2", "b3"]

# Quiz with filler option dropped; valid one kept
quiz = _sanitize_quiz([
    {"question": "Q1?", "options": ["Alpha", "Bravo", "Charl", "All of the above"], "correct": 0},
    {"question": "Q2?", "options": ["Alpha", "Bravo", "Charl", "Delta"], "correct": 1, "explanation": "b"},
])
assert len(quiz) == 1 and quiz[0]["question"] == "Q2?", quiz

# JSON parsing tolerates code fences + trailing commas
assert _parse_json('```json\n{"a": [1, 2,],}\n```') == {"a": [1, 2]}

# Store round-trip in a temp dir
with tempfile.TemporaryDirectory() as d:
    store.DATA_DIR = Path(d)
    cid = str(uuid.uuid4())
    store.save({"id": cid, "title": "T", "created_at": store.now(), "lessons": []})
    assert store.load(cid)["title"] == "T"
    assert [c["id"] for c in store.list_all()] == [cid]
    assert store.load("../etc/passwd") is None
    assert store.delete(cid) and store.load(cid) is None

# Sketch (illustrator) specs: good spec kept, dangling refs dropped, broken spec salvaged or dropped
SKETCH = {"title": "Request path",
          "rows": [[{"id": "a", "label": "Client", "color": "green"}, {"id": "b", "label": "API", "color": "url(#x)"}]],
          "edges": [["a", "b"], ["a", "ghost"], ["a", "a"]],
          "notes": [{"on": "b", "text": "Auth happens here"}, {"on": "ghost", "text": "x"}]}
spec = _sanitize_sketch_spec(SKETCH)
assert spec["edges"] == [["a", "b"]] and [n["on"] for n in spec["notes"]] == ["b"], spec
assert "color" not in spec["rows"][0][1]  # unsafe colour dropped, renderer picks a default
for bad in [None, "graph TD", {"rows": []}, {"rows": [[{"id": "a", "label": "A"}]]},
            {"rows": [[{"id": "a", "label": "A"}, {"id": "a", "label": "B"}]]},
            {"rows": [[{"id": f"n{i}", "label": "x"} for i in range(6)]]}]:
    assert _sanitize_sketch_spec(bad) is None, bad
sk = _sanitize_blocks([
    {"type": "sketch", "spec": {"rows": []}, "content": "Three stages."},
    {"type": "sketch", "spec": "graph TD"},
    {"type": "sketch", "spec": SKETCH},
])
assert [b["type"] for b in sk] == ["text", "sketch"], sk

# Templates: meme blocks need an image_prompt; model follows the template
from app.generation import _model_for, _system_lesson, _lesson_prompt
from app.config import TEMPLATE_MODELS, LLM_MODEL
mb = _sanitize_blocks([
    {"type": "meme", "image_prompt": "robot rejects copy-paste", "caption": "Fix it once."},
    {"type": "meme", "caption": "No prompt, keep the joke"},
    {"type": "meme"},
])
assert [b["type"] for b in mb] == ["meme", "callout"], mb
assert _model_for({"template": "meme"}) == TEMPLATE_MODELS["meme"] and _model_for({}) == LLM_MODEL
assert _model_for({"template": "story"}) == TEMPLATE_MODELS["story"] and _model_for({"template": "bogus"}) == LLM_MODEL
from app.config import TUTOR_MODEL
from app.generation import _extra_body
assert _extra_body("openai/gpt-5.4-mini") == {"extra_body": {"reasoning": {"effort": "low"}}}
assert _extra_body("anthropic/claude-haiku-4.5") == {}
assert TEMPLATE_MODELS["meme"] and TEMPLATE_MODELS["story"] and TUTOR_MODEL

# Meme prompt is meme-native: no heading/sketch instructions, has the meme vocabulary
PREFS = {"style": ["Examples", "Visual", "Story-based"]}  # Visual would pull sketches in; meme drops it
meme_prompt = (_system_lesson({**PREFS, "template": "meme"})
               + _lesson_prompt("T", "L", "f", 2, "x", {**PREFS, "template": "meme"}, problem_setup="p",
                                natural_content_types=["sketch", "diagram", "analogy"]))
for banned in ("heading", "sketch", "diagram", "analogy"):
    assert banned not in meme_prompt.lower(), banned
for needed in ('"type": "chat"', '"type": "hot_take"', '"type": "plot_twist"', '"type": "tldr"', '"type": "meme"',
               '"type": "checkpoint"', "flashcards", "quiz"):
    assert needed in meme_prompt, needed
assert "no code blocks" in meme_prompt  # topic has no code in its natural types
general_prompt = _system_lesson({}) + _lesson_prompt("T", "L", "f", 1, "x", {}, natural_content_types=[])
assert '"type": "meme"' not in general_prompt and "heading" in general_prompt and '"type": "chat"' not in general_prompt
story_prompt = _system_lesson({"template": "story"}) + _lesson_prompt("T", "L", "f", 1, "x", {"template": "story"},
                                                                    story_character={"name": "Ana", "context": "c"})
for needed in ('"type": "insight"', '"type": "cliffhanger"', '"type": "chat"', "sketch spec rules", "Name: Ana"):
    assert needed in story_prompt, needed

# Story template forces a story_character (in the prompt, and as a fallback if the model omits it)
from app.extract import ContentResult
import app.generation as gen
C = ContentResult(title="t", body="caching", source_type="topic")
assert '"story_character": null' in gen._structure_prompt(C, {"style": []})
assert '"story_character": {"name"' in gen._structure_prompt(C, {"style": [], "template": "story"})
assert "REQUIRED" in gen._structure_prompt(C, {"template": "story"})
_real_complete = gen._complete
gen._complete = lambda *a, **k: '{"title": "X", "story_character": null, "lessons": [{"day": 1, "title": "A"}]}'
assert gen.generate_course_structure(C, {"template": "story"}).story_character["name"]
assert gen.generate_course_structure(C, {"template": "general"}).story_character is None
gen._complete = _real_complete

# New block types: malformed ones dropped or salvaged
nb = _sanitize_blocks([
    {"type": "chat", "messages": [{"who": "A", "text": "hi"}, {"who": "B", "text": "  "}, "junk"] + [{"who": "C", "text": "x"}] * 10},
    {"type": "chat", "messages": []},
    {"type": "chat", "messages": "nope"},
    {"type": "checkpoint", "question": "Q?", "options": ["a", "b", "c"], "correct": 2, "explanation": "e"},
    {"type": "checkpoint", "question": "Q?", "options": ["a"], "correct": 0},
    {"type": "checkpoint", "question": "Q?", "options": ["a", "b", "c", "d", "e"], "correct": 0},
    {"type": "checkpoint", "question": "Q?", "options": ["a", "b"], "correct": 2},
    {"type": "checkpoint", "question": "Q?", "options": ["a", "b"], "correct": True},
    {"type": "checkpoint", "question": "", "options": ["a", "b"], "correct": 0},
    {"type": "hot_take", "content": "Bold."},
    {"type": "hot_take"},
    {"type": "plot_twist", "setup": "myth", "content": "truth"},
    {"type": "plot_twist", "setup": "myth only"},
    {"type": "tldr", "content": ["one", "- two"]},
    {"type": "tldr", "content": {"x": 1}},
    {"type": "insight", "content": "What just happened"},
    {"type": "cliffhanger", "content": "Next time..."},
    {"type": "cliffhanger", "content": ""},
])
assert [b["type"] for b in nb] == ["chat", "checkpoint", "hot_take", "plot_twist", "tldr", "insight", "cliffhanger"], nb
assert nb[0]["messages"][0] == {"who": "A", "text": "hi"} and len(nb[0]["messages"]) == 8
assert nb[1]["correct"] == 2 and nb[3]["setup"] == "myth" and nb[4]["content"] == "- one\n- two"
assert len({b["id"] for b in nb}) == len(nb)

# Lesson → plain text (tutor context + redesign prompt)
from app.generation import lesson_to_text, redesign_request, tutor_system
L = {"title": "Caching", "blocks": [{"type": "hook", "content": "Why is it slow?"},
                                    {"type": "heading", "content": "The fix"},
                                    {"type": "chat", "messages": [{"who": "Ana", "text": "cache it"}]},
                                    {"type": "checkpoint", "question": "Do what?", "options": ["x", "y"], "correct": 1},
                                    {"type": "meme", "caption": "Cache all the things", "image_prompt": "p"},
                                    {"type": "code", "language": "py", "code": "print(1)"}],
     "quiz": [{"question": "What is a TTL?"}]}
txt = lesson_to_text(L)
for needed in ("# Caching", "Why is it slow?", "## The fix", "Ana: cache it", "Answer: y", "Cache all the things",
               "print(1)", "What is a TTL?"):
    assert needed in txt, needed
assert len(lesson_to_text({"title": "x", "blocks": [{"type": "text", "content": "w" * 9000}]})) == 8000
assert redesign_request("more memes", L).startswith("REDESIGN REQUEST from the learner: more memes.") and "Ana: cache it" in redesign_request("x", L)
ts = tutor_system({"title": "Course T", "template": "meme", "prefs": {"level": "Beginner", "background": "nurse"}}, L)
for needed in ("Course T", "Caching", "Ana: cache it", "Beginner", "nurse", '[[redesign scope="lesson" template=""]]', "meme"):
    assert needed in ts, needed

# Meme illustration: success gets a URL, failure falls back to a callout, extras over the cap are dropped
import asyncio
import app.pipeline as pipeline
calls = []
def fake_image(prompt):
    calls.append(prompt)
    if "boom" in prompt:
        raise RuntimeError("no image")
    return b"PNG"
pipeline.generate_image = fake_image
pipeline.save_image = lambda cid, name, data: f"/api/images/{cid}/{name}.png"
pipeline.MAX_MEMES_PER_LESSON = 2
blocks = [{"id": "b1", "type": "text", "content": "t"},
          {"id": "b2", "type": "meme", "image_prompt": "ok", "caption": "c2"},
          {"id": "b3", "type": "meme", "image_prompt": "boom", "caption": "c3"},
          {"id": "b4", "type": "meme", "image_prompt": "over cap", "caption": "c4"}]
asyncio.run(pipeline._illustrate_memes("cid", "lid", blocks))
assert [b["type"] for b in blocks] == ["text", "meme", "callout"], blocks
assert blocks[1]["content"] == "/api/images/cid/lid-b2.png" and blocks[2]["content"] == "c3"
assert len(calls) == 2  # cap of 2 respected

# Template precedence for lesson responses: lesson.template > course.template > "general"
import main
lc = {"template": "meme", "lessons": [{"id": "a"}, {"id": "b", "template": "story"}]}
assert main._lesson(lc, "a")["template"] == "meme" and main._lesson(lc, "b")["template"] == "story"
assert main._lesson({"lessons": [{"id": "a"}]}, "a")["template"] == "general"

# Redesign: ids preserved, success replaces in place, LLM failure keeps old content, SSE events emitted
from app.sse import sse
events = []
_real_broadcast = sse.broadcast
async def fake_broadcast(cid, data):
    events.append(data)
sse.broadcast = fake_broadcast
with tempfile.TemporaryDirectory() as d:
    store.DATA_DIR = Path(d)
    cid = str(uuid.uuid4())
    old = lambda i, day: {"id": i, "course_id": cid, "title": f"Day {day}", "day_number": day, "estimated_minutes": 10,
                          "blocks": [{"id": "b1", "type": "text", "content": f"old {day}"}], "flashcards": [], "quiz": []}
    store.save({"id": cid, "title": "C", "status": "redesigning", "template": "general", "duration_days": 2,
                "prefs": {"template": "general"}, "created_at": store.now(),
                "outlines": [{"day": 1, "title": "Day 1", "focus": "f1"}, {"day": 2, "title": "Day 2", "focus": "f2"}],
                "source_body": "src " * 100, "lessons": [old("L1", 1), old("L2", 2)]})
    prompts = []
    def fake_llm(system, user, max_tokens, what, model):
        prompts.append((system, user, model))
        if "Lesson 2" in what:
            raise RuntimeError("no credit")
        return ('{"quiz": [], "flashcards": [], "blocks": [{"type": "hook", "content": "new"}, '
                '{"type": "meme", "image_prompt": "m", "caption": "c"}, {"type": "callout", "content": "end"}]}')
    gen._complete = fake_llm
    calls.clear()
    asyncio.run(pipeline.run_redesign(cid, "turn it into memes", "meme", None))
    c = store.load(cid)
    assert [l["id"] for l in c["lessons"]] == ["L1", "L2"], c["lessons"]
    assert c["lessons"][0]["blocks"][0]["content"] == "new" and c["lessons"][0]["blocks"][1]["type"] == "meme"
    assert c["lessons"][1]["blocks"][0]["content"] == "old 2"  # failed lesson untouched
    assert c["status"] == "ready" and c["template"] == "meme" and c["prefs"]["template"] == "meme"
    assert "template" not in c["lessons"][0] and c["lessons"][1]["template"] == "general"  # old content keeps its template
    assert len(calls) == 1  # meme image generated for the redesigned meme lesson
    assert all(m == TEMPLATE_MODELS["meme"] for _, _, m in prompts)
    assert "REDESIGN REQUEST from the learner: turn it into memes." in prompts[0][1] and "old 1" in prompts[0][1]
    assert "src src" in prompts[0][1]  # source_body used as source content
    assert [e["type"] for e in events] == ["status", "lesson_generating", "lesson_generating", "lesson_ready", "complete"], events
    assert events[3]["lesson_id"] == "L1" and events[3]["lessons_total"] == 2
    # All fail → error event, status back to ready, old lessons intact, error_message set
    events.clear()
    gen._complete = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down"))
    asyncio.run(pipeline.run_redesign(cid, "simpler", None, "L2"))
    c = store.load(cid)
    assert c["status"] == "ready" and c["error_message"] and c["lessons"][1]["blocks"][0]["content"] == "old 2"
    assert [e["type"] for e in events] == ["status", "lesson_generating", "error"], events
gen._complete = _real_complete
sse.broadcast = _real_broadcast

# Supabase store backend against a fake PostgREST (no network)
import json as _json
import httpx
import app.store as store
tables = {"courses": {}, "lessons": {}}
COLS = {"courses": store._COURSE_COLS | {"extra"}, "lessons": store._LESSON_COLS | {"extra"}}
def fake(request: httpx.Request) -> httpx.Response:
    table = request.url.path.rsplit("/", 1)[-1]
    q = dict(request.url.params)
    def match(r):
        return all(str(r.get(k)) == v[3:] for k, v in q.items() if v.startswith("eq."))
    if request.method == "POST":
        body = _json.loads(request.content)
        for r in body if isinstance(body, list) else [body]:
            bad = set(r) - COLS[table]
            if bad:  # what real PostgREST does for an unknown column
                return httpx.Response(400, json={"message": f"column {bad} does not exist"})
            tables[table][r["id"]] = {**tables[table].get(r["id"], {}), **r}
        return httpx.Response(201)
    if request.method == "GET":
        rows = [dict(r) for r in tables[table].values() if match(r)]
        order = q.get("order", "")
        if order:
            rows.sort(key=lambda r: r.get(order.split(".")[0]) or "", reverse=order.endswith(".desc"))
        return httpx.Response(200, json=rows)
    if request.method == "DELETE":
        gone = [r for r in tables[table].values() if match(r)]
        for r in gone:
            del tables[table][r["id"]]
            if table == "courses":  # on delete cascade
                tables["lessons"] = {k: l for k, l in tables["lessons"].items() if l["course_id"] != r["id"]}
        return httpx.Response(200, json=gone)
    return httpx.Response(405)
store._http = httpx.Client(base_url="https://x.supabase.co/rest/v1", transport=httpx.MockTransport(fake))
cid, lid = str(uuid.uuid4()), str(uuid.uuid4())
course = {"id": cid, "title": "T", "status": "ready", "template": "story", "created_at": "2026-01-02",
          "brand_new_field": {"x": 1},  # no column → must round-trip through `extra`
          "lessons": [{"id": lid, "day_number": 1, "title": "L", "blocks": [{"type": "hook"}],
                       "flashcards": [], "quiz": [], "template": "meme"}]}
store._sb_save(course)
got = store._sb_load(cid)
assert got["brand_new_field"] == {"x": 1} and got["template"] == "story", got
assert got["lessons"][0]["course_id"] == cid and got["lessons"][0]["template"] == "meme"
got["lessons"][0]["title"] = "L2"; store._sb_save(got)          # upsert, not duplicate
assert len(tables["lessons"]) == 1 and store._sb_load(cid)["lessons"][0]["title"] == "L2"
assert [c["id"] for c in store._sb_list_all()] == [cid] and store._sb_list_all()[0]["lessons"] == []
assert store._sb_load("../etc/passwd") is None and store._sb_delete("not-a-uuid") is False
assert store._sb_delete(cid) and store._sb_load(cid) is None and not tables["lessons"]
try:
    store._check(httpx.Response(400, text="boom", request=httpx.Request("POST", "https://x/rest/v1/courses")))
    raise AssertionError("expected error")
except RuntimeError as e:
    assert "400" in str(e) and "boom" in str(e)

print("ok")
