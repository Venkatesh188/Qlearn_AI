# QlearnAI

**Learn anything useful in a day, not in a semester.**

QlearnAI is an AI learning companion. It takes a person from "I don't know this" to "I can use this" in hours instead of months. You tell it what you need to learn and why. It builds a short, focused path, teaches it interactively, checks your understanding as you go, and gets you to hands-on practice quickly.

---

## The problem

### Skills now expire faster than traditional education can deliver them

The usual way to learn is built around long cycles: a four-year degree, a semester-long course, a certification that takes months. That worked when knowledge stayed stable for a decade or more. It doesn't anymore.

- **39% of workers' core skills are expected to change by 2030.** This comes from the World Economic Forum's *Future of Jobs Report 2025*, which surveyed more than 1,000 employers representing over 14 million workers. ([WEF][wef-skills])
- **170 million new jobs will be created and 92 million displaced by 2030.** That is 22% of today's jobs disrupted in five years. ([WEF][wef-press])
- **63% of employers already say the skills gap is the biggest barrier** to transforming their business. ([WEF][wef-skills])
- **A skill's "half-life" is about 5 years, and for technical skills it is about 2.5 years.** Half of what you learn loses its value in that time. ([IBM][ibm])

Put these numbers next to a four-year degree and the mismatch is obvious. By graduation, part of the material covered in year one is already out of date. In AI-heavy fields, the tools, frameworks and best practices can turn over several times before a single course is refreshed.

### The bottleneck has moved from access to speed

Information is no longer scarce. Tutorials, docs, videos, papers and LLMs are everywhere. The hard part is turning that flood into working knowledge **quickly**:

1. **Where do I start?** Beginners can't tell the essential 20% from the other 80%.
2. **Passive content feels like progress, but it isn't.** Watching ten hours of video doesn't mean you can do anything.
3. **Nobody checks if you actually understood.** Gaps go unnoticed until they cause a problem at work.
4. **Generic courses don't know your goal.** A PM who needs to understand vector databases for a meeting tomorrow needs something different from an engineer who has to build one.

As a result, people either take far too long to learn something new or never start.

---

## Why it matters

### Learning speed is now the skill that matters most

Kunal Shah, founder of CRED, often says the rate at which you learn beats what you already know:

> "Never underestimate someone with a fast learning loop." ([source][ks-loop])

> "Earning grows with skills. Skills grow with uncomfortable learning & experiences. Anyone's earning is directly correlated to how often they update their brain like an app and not resist it." ([source][ks-app])

He also describes learning as something that **compounds**. Skills built early feed every year that follows, so someone who learns faster early on pulls ahead over time. ([Best in Class podcast][ks-podcast])

The same idea shows up across the WEF data. **Curiosity and lifelong learning** are among the fastest-growing skills employers want, alongside AI and big data. ([WEF][wef-skills]) The ability to learn fast is now a core professional skill in its own right.

### What changes if learning takes a day instead of months

- **Individuals** can move into new roles, tools and domains without leaving work for years of study.
- **Teams** can adopt new technology when it's useful, not months later after everyone has been trained.
- **Students** can add what's current to what they study in class and graduate less out of date.
- **Anyone** can follow a curiosity the moment it appears, while it still feels urgent.

When learning something new costs a day instead of a semester, people stop avoiding it. They pick up new skills more often, try things they would have skipped, and keep up with how fast the field is moving.

---

## How QlearnAI approaches it

| Traditional learning | QlearnAI |
|---|---|
| Fixed curriculum, same for everyone | Path built from *your* goal and current level |
| Months or years | Hours to a day for a working understanding |
| Passive (lectures, videos) | Active (questions, explanations, practice) |
| Assessed at the end | Understanding checked continuously; gaps fixed right away |
| Content goes stale between revisions | Generated on demand, so it stays current |

The core loop:

1. **Goal:** "I need to understand X well enough to do Y."
2. **Map:** QlearnAI identifies the minimum set of concepts you need and the order to learn them in.
3. **Learn:** short, interactive explanations adapted to what you already know.
4. **Check:** quick questions and exercises that show gaps early.
5. **Apply:** a small real task that proves you can use it.

---

## Status

Early stage. This README defines the problem and direction. Implementation details will be added as the project takes shape.

---

## Sources

- World Economic Forum, *Future of Jobs Report 2025*, Skills outlook: <https://www.weforum.org/publications/the-future-of-jobs-report-2025/in-full/3-skills-outlook/>
- World Economic Forum, press release (Jan 2025): <https://www.weforum.org/press/2025/01/future-of-jobs-report-2025-78-million-new-job-opportunities-by-2030-but-urgent-upskilling-needed-to-prepare-workforces/>
- IBM, *Skills Transformation for the 2021 Workplace*: <https://www.ibm.com/new/training/skills-transformation-2021-workplace>
- Kunal Shah on X, "fast learning loop": <https://x.com/kunalb11/status/1592164756789792769>
- Kunal Shah on X, "update their brain like an app": <https://x.com/kunalb11/status/1825144374944059532>
- Kunal Shah on *Best in Class* with Harish Narayanan (compounding learning, learning as a skill): <https://harish.blog/podcast/kunalshah/>

[wef-skills]: https://www.weforum.org/publications/the-future-of-jobs-report-2025/in-full/3-skills-outlook/
[wef-press]: https://www.weforum.org/press/2025/01/future-of-jobs-report-2025-78-million-new-job-opportunities-by-2030-but-urgent-upskilling-needed-to-prepare-workforces/
[ibm]: https://www.ibm.com/new/training/skills-transformation-2021-workplace
[ks-loop]: https://x.com/kunalb11/status/1592164756789792769
[ks-app]: https://x.com/kunalb11/status/1825144374944059532
[ks-podcast]: https://harish.blog/podcast/kunalshah/

---

## Run it locally

```bash
# backend (FastAPI, :8000)
cd backend && python3 -m venv venv && venv/bin/pip install -r requirements.txt
cp .env.example .env            # add LLM_API_KEY (OpenRouter); Supabase keys optional
venv/bin/uvicorn main:app --reload --port 8000

# frontend (Vite, :5173, proxies /api → :8000)
cd frontend && npm install && npm run dev
```

Without Supabase keys, courses are saved as JSON files in `backend/data/`.

## Deploy (Vercel)

One Vercel project, two services (`vercel.json`): the Vite frontend serves `/`, FastAPI serves `/api/*`.

1. Apply `backend/supabase/migrations/0001_init.sql` in the Supabase SQL Editor (Supabase is required on Vercel).
2. Import the repo in Vercel (root directory = repo root) and add environment variables:
   `LLM_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `BRAVE_API_KEY`,
   `MEME_TEXT_MODEL`, `STORY_TEXT_MODEL`, `TUTOR_MODEL`, `IMAGE_MODEL`, `LESSON_CONCURRENCY`.
3. Deploy. Course generation runs inside the progress stream request, so it is bounded by the
   function duration: 300 s on Hobby, 800 s on Pro (set in `vercel.json`).
