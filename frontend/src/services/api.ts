import type { Block, Flashcard } from '../types';

// ── Types (backend contract) ────────────────────────────────────────────────
export type Template = 'general' | 'meme' | 'story';
export const TEMPLATE_LABELS: Record<Template, string> = { general: 'Classic', meme: 'Meme mode', story: 'Story mode' };
export interface Prefs { level: string; depth: string; style: string[]; background?: string; template?: Template }

export interface CourseSummary {
  id: string; title: string; tagline?: string; difficulty?: string; tags?: string[];
  duration_days?: number; minutes_per_day?: number; status: string; lesson_count?: number;
  icon?: string; gradient?: string; accent_color?: string; source_type?: string; created_at?: string;
  template?: Template;
}
export interface LessonMeta { id: string; title: string; day_number: number; estimated_minutes?: number }
export interface Course extends CourseSummary {
  outcome?: string; prerequisites?: string[] | string; topic_complexity?: string;
  source_title?: string; source_url?: string; error_message?: string; lessons: LessonMeta[];
}
export interface BackendQuiz { question: string; options: string[]; correct: number; explanation: string }
export interface Lesson extends LessonMeta {
  course_id: string; blocks: Block[]; flashcards: Flashcard[]; quiz: BackendQuiz[]; template?: Template;
}
export interface GenStatus {
  course_id: string; status: string; progress_message?: string; lesson_count?: number;
  duration_days?: number; title?: string; error_message?: string;
}
// SSE events are {type, ...fields}; polling fallback emits {type:'poll', ...GenStatus}.
export type GenEvent = { type: string; [k: string]: any };

// ── HTTP ────────────────────────────────────────────────────────────────────
export class HttpError extends Error { constructor(msg: string, public status: number) { super(msg); } }

async function httpError(res: Response): Promise<HttpError> {
  let msg = `${res.status} ${res.statusText}`;
  try { const j = await res.json(); msg = j.detail || j.message || msg; } catch { /* non-JSON */ }
  return new HttpError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status);
}

// Empty locally (Vite proxies /api). Set VITE_API_URL when the backend is a separate deployment.
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, init);
  if (!res.ok) throw await httpError(res);
  return res.status === 204 ? (undefined as T) : res.json();
}

const json = (body: unknown): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export const generate = (source_type: 'topic' | 'url' | 'text', input: string, prefs: Prefs) =>
  req<{ course_id: string }>('/api/generate', json({ source_type, input, prefs }));

export const generatePdf = (file: File, prefs: Prefs) => {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('prefs', JSON.stringify(prefs));
  return req<{ course_id: string }>('/api/generate/pdf', { method: 'POST', body: fd });
};

export const getStatus = (id: string) => req<GenStatus>(`/api/generate/${id}/status`);
export const listCourses = () => req<CourseSummary[]>('/api/courses');
export const getCourse = (id: string) => req<Course>(`/api/courses/${id}`);
export const getLesson = (id: string, lessonId: string) => req<Lesson>(`/api/courses/${id}/lessons/${lessonId}`);
export const deleteCourse = (id: string) => req<void>(`/api/courses/${id}`, { method: 'DELETE' });

export const redesign = (id: string, body: { instruction: string; template?: Template | null; lesson_id?: string | null }) =>
  req<{ course_id: string; lesson_ids: string[] }>(`/api/courses/${id}/redesign`, json(body));

export interface ChatMsg { role: 'user' | 'assistant'; content: string }

/** Stream the tutor's reply (text/plain) chunk by chunk; resolves when the stream ends. */
export async function tutorChat(id: string, lessonId: string, messages: ChatMsg[], onChunk: (t: string) => void, signal?: AbortSignal) {
  const res = await fetch(`${API}/api/courses/${id}/lessons/${lessonId}/tutor`, { ...json({ messages: messages.slice(-20) }), signal });
  if (!res.ok) throw await httpError(res);
  if (!res.body) return onChunk(await res.text());
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

/**
 * Follow a generation: SSE stream (fetch + ReadableStream, same as the old
 * CreatePath.startSSE), falling back to polling /status if the stream fails or
 * closes before a terminal event. Returns a stop function.
 */
export function watchGeneration(id: string, onEvent: (e: GenEvent) => void): () => void {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const emit = (e: GenEvent) => {
    if (e.type === 'complete' || e.type === 'error') finished = true;
    onEvent(e);
  };

  const poll = async () => {
    if (ctrl.signal.aborted) return;
    try {
      const s = await getStatus(id);
      if (ctrl.signal.aborted) return;
      if (s.status === 'ready') return emit({ type: 'complete', course_id: id, title: s.title, duration_days: s.duration_days });
      if (s.status === 'error') return emit({ type: 'error', message: s.error_message || 'Generation failed' });
      emit({ type: 'poll', ...s });
    } catch { /* retry */ }
    timer = setTimeout(poll, 2500);
  };

  (async () => {
    try {
      const res = await fetch(`${API}/api/generate/${id}/stream`, { signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error('no stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue; // skips blanks and ':' keep-alives
          try { emit(JSON.parse(line.slice(6))); } catch { /* bad frame */ }
        }
      }
    } catch { /* fall through to polling */ }
    if (!finished && !ctrl.signal.aborted) poll();
  })();

  return () => { ctrl.abort(); clearTimeout(timer); };
}

// ── Local storage (profile + progress) ──────────────────────────────────────
export interface Profile { name: string; background: string; level: string; depth: string; style: string[] }

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export const getProfile = () => load<Profile | null>('qlearn.profile', null);
export const saveProfile = (p: Profile) => save('qlearn.profile', p);
export const isBannerDismissed = () => load('qlearn.profileBannerDismissed', false);
export const dismissBanner = () => save('qlearn.profileBannerDismissed', true);
export const getCompleted = (courseId: string) => new Set(load<string[]>(`qlearn.done.${courseId}`, []));
export const markCompleted = (courseId: string, lessonId: string) => {
  const s = getCompleted(courseId);
  s.add(lessonId);
  save(`qlearn.done.${courseId}`, [...s]);
  return s;
};
export const getTutorHistory = (courseId: string, lessonId: string) => load<ChatMsg[]>(`qlearn.tutor.${courseId}.${lessonId}`, []);
export const saveTutorHistory = (courseId: string, lessonId: string, msgs: ChatMsg[]) => save(`qlearn.tutor.${courseId}.${lessonId}`, msgs.slice(-40));
