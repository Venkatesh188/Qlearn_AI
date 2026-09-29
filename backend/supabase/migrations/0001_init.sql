-- Qlearn prototype schema. Mirrors the course/lesson dicts in app/store.py.
-- Apply once: Supabase dashboard → SQL Editor → paste → Run (safe to re-run).
--
-- Access model: the FastAPI backend is the only client and uses the service-role key,
-- which bypasses RLS. RLS is enabled with NO policies, so the anon/public key can read
-- or write nothing. Add policies here only when the browser talks to Supabase directly.

create table if not exists public.courses (
  id                    uuid primary key,
  status                text not null default 'queued'
                          check (status in ('queued', 'extracting', 'generating', 'redesigning', 'ready', 'error')),
  template              text not null default 'general' check (template in ('general', 'meme', 'story')),
  title                 text not null default '',
  tagline               text not null default '',
  outcome               text not null default '',
  difficulty            text not null default 'intermediate',
  tags                  text[] not null default '{}',
  duration_days         integer not null default 0,
  minutes_per_day       integer not null default 15,
  lesson_count          integer not null default 0,
  icon                  text not null default 'general',
  gradient              text not null default 'from-violet-600 to-indigo-700',
  accent_color          text not null default '#7C3AED',
  source_type           text not null default 'topic',
  source_title          text,
  source_url            text,
  source_excerpt        text,
  source_body           text,
  topic_complexity      text,
  prerequisites         jsonb not null default '[]',
  prefs                 jsonb not null default '{}',
  outlines              jsonb not null default '[]',
  natural_content_types jsonb not null default '[]',
  pedagogy_note         text,
  story_character       jsonb,
  progress_message      text,
  error_message         text,
  -- Any course field the code adds later that has no column yet lands here (see app/store.py).
  extra                 jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists courses_created_at_idx on public.courses (created_at desc);

create table if not exists public.lessons (
  id                uuid primary key,
  course_id         uuid not null references public.courses (id) on delete cascade,
  day_number        integer not null,
  title             text not null default '',
  estimated_minutes integer not null default 15,
  -- Set only when a redesign gave this lesson a different template than its course.
  template          text check (template in ('general', 'meme', 'story')),
  blocks            jsonb not null default '[]',
  flashcards        jsonb not null default '[]',
  quiz              jsonb not null default '[]',
  extra             jsonb not null default '{}',
  created_at        timestamptz not null default now()
);

create index if not exists lessons_course_day_idx on public.lessons (course_id, day_number);

alter table public.courses enable row level security;
alter table public.lessons enable row level security;

-- Meme images (Nano Banana). Public read so <img src> works without signed URLs;
-- only the service role can upload.
insert into storage.buckets (id, name, public)
values ('course-images', 'course-images', true)
on conflict (id) do nothing;
