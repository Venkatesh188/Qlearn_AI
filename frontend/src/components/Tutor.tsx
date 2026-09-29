/**
 * AI tutor drawer (streamed chat + redesign form) and the shared redesign flow.
 * - Tutor: floating "Ask your tutor" button → right drawer (full-screen on mobile), used on the lesson page.
 * - RedesignDrawer: the same redesign form alone (scope = whole course), used on the course overview.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bot, CheckCircle, Loader2, MessageCircle, Send, Trash2, WandSparkles, X } from 'lucide-react';
import { renderInline } from './BlockRenderer';
import {
  HttpError, redesign, tutorChat, watchGeneration, getTutorHistory, saveTutorHistory, TEMPLATE_LABELS,
  type ChatMsg, type Template,
} from '../services/api';

type Scope = 'lesson' | 'course';

// ── Redesign flow (POST /redesign → follow the generation stream) ──────────────
interface RedesignHandlers { onStart?: (lessonIds: string[]) => void; onLessonReady?: (lessonId: string) => void; onDone?: (ok: boolean) => void }
interface RedesignState { busy: boolean; message: string; ready: number; total: number; error: string; done: boolean }
const IDLE: RedesignState = { busy: false, message: '', ready: 0, total: 0, error: '', done: false };

function useRedesign(courseId: string, handlers: RedesignHandlers) {
  const [state, setState] = useState<RedesignState>(IDLE);
  const h = useRef(handlers);
  h.current = handlers;
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const watch = () => {
    stop.current?.();
    stop.current = watchGeneration(courseId, e => {
      switch (e.type) {
        case 'status': setState(s => ({ ...s, message: e.message || s.message })); break;
        case 'poll': setState(s => ({ ...s, message: e.progress_message || s.message })); break;
        case 'lesson_generating': setState(s => ({ ...s, message: `Rewriting lesson ${e.day}: ${e.title}…` })); break;
        case 'lesson_ready':
          setState(s => ({ ...s, ready: e.lessons_ready ?? s.ready + 1, total: e.lessons_total ?? s.total, message: `Lesson ${e.day} rewritten` }));
          if (e.lesson_id) h.current.onLessonReady?.(e.lesson_id);
          break;
        case 'complete':
          setState(s => ({ ...s, busy: false, done: true, message: 'Redesign complete' }));
          h.current.onDone?.(true);
          stop.current?.();
          break;
        case 'error':
          setState(s => ({ ...s, busy: false, error: e.message || 'Redesign failed. Your previous lessons are unchanged.' }));
          h.current.onDone?.(false);
          stop.current?.();
          break;
      }
    });
  };

  const start = async (instruction: string, template: Template | null, lessonId: string | null) => {
    if (state.busy) return;
    setState({ ...IDLE, busy: true, message: 'Starting redesign…' });
    try {
      const r = await redesign(courseId, { instruction: instruction.slice(0, 500), template, lesson_id: lessonId });
      setState(s => ({ ...s, total: r.lesson_ids?.length || 0 }));
      h.current.onStart?.(r.lesson_ids || []);
      watch();
    } catch (err) {
      const msg = err instanceof HttpError && err.status === 409
        ? 'This course is already being generated or redesigned. Try again when it finishes.'
        : err instanceof Error ? err.message : 'Redesign failed';
      setState({ ...IDLE, error: msg });
    }
  };

  /** Re-attach to a redesign that was already running (e.g. after a page reload). */
  const resume = () => { if (!state.busy) { setState({ ...IDLE, busy: true, message: 'Redesign in progress…' }); watch(); } };

  return { state, start, resume };
}

const Progress: React.FC<{ s: RedesignState }> = ({ s }) => {
  if (s.error) return (
    <p role="alert" className="flex items-start gap-2 text-sm text-danger bg-danger-light rounded-xl px-3.5 py-3">
      <AlertCircle size={16} className="flex-shrink-0 mt-0.5" /> {s.error}
    </p>
  );
  if (!s.busy && !s.done) return null;
  return (
    <div role="status" aria-live="polite" className={`rounded-xl px-3.5 py-3 text-sm ${s.done ? 'bg-success-light text-success' : 'bg-primary-light text-primary'}`}>
      <p className="flex items-center gap-2 font-semibold">
        {s.done ? <CheckCircle size={16} /> : <Loader2 size={16} className="animate-spin" />}
        <span className="truncate">{s.message}</span>
      </p>
      {s.busy && s.total > 1 && (
        <div className="mt-2.5 h-1.5 bg-white/70 rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${Math.round((s.ready / s.total) * 100)}%` }} />
        </div>
      )}
    </div>
  );
};

// ── Redesign form ───────────────────────────────────────────────────────────
const PRESETS: { label: string; instruction: string; template: Template | null }[] = [
  { label: 'Explain it differently', instruction: 'Explain it differently: a new angle, new examples.', template: null },
  { label: 'Make it simpler', instruction: 'Make it simpler: plainer words, shorter sentences, one idea at a time.', template: null },
  { label: 'More visuals', instruction: 'Add more visuals: diagrams, sketches or memes wherever they help.', template: null },
  { label: 'Turn it into memes', instruction: 'Turn it into memes.', template: 'meme' },
  { label: 'Turn it into a story', instruction: 'Turn it into a story.', template: 'story' },
];

const RedesignForm: React.FC<{
  state: RedesignState; lockCourse?: boolean;
  onSubmit: (instruction: string, template: Template | null, scope: Scope) => void;
}> = ({ state, lockCourse, onSubmit }) => {
  const [preset, setPreset] = useState<number | null>(null);
  const [instruction, setInstruction] = useState('');
  const [scope, setScope] = useState<Scope>(lockCourse ? 'course' : 'lesson');
  const template = preset !== null ? PRESETS[preset].template : null;

  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (instruction.trim()) onSubmit(instruction.trim(), template, scope); }}>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-text-faint mb-2">Quick redesigns</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p, i) => (
            <button key={p.label} type="button" aria-pressed={preset === i}
              onClick={() => { const on = preset !== i; setPreset(on ? i : null); setInstruction(on ? p.instruction : ''); }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                preset === i ? 'bg-primary text-white border-primary' : 'bg-surface text-text-muted border-border-subtle hover:border-primary/40 hover:text-primary'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="redesign-instruction" className="text-xs font-bold uppercase tracking-wider text-text-faint mb-2 block">What should change?</label>
        <textarea id="redesign-instruction" value={instruction} maxLength={500} rows={3}
          onChange={e => setInstruction(e.target.value)}
          placeholder="e.g. Use cooking analogies, and go deeper on the tricky part"
          className="w-full text-sm text-text-main placeholder-text-faint bg-surface border border-border-subtle rounded-xl px-3.5 py-3 outline-none focus:border-primary focus:shadow-glow resize-none" />
        {template && <p className="text-xs text-text-muted mt-1.5">Template becomes <span className="font-bold text-primary">{TEMPLATE_LABELS[template]}</span></p>}
      </div>
      {!lockCourse && (
        <div role="radiogroup" aria-label="Redesign scope" className="flex gap-1 bg-surface-alt rounded-xl p-1">
          {(['lesson', 'course'] as Scope[]).map(s => (
            <button key={s} type="button" role="radio" aria-checked={scope === s} onClick={() => setScope(s)}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${scope === s ? 'bg-surface text-text-main shadow-soft' : 'text-text-muted hover:text-text-main'}`}>
              {s === 'lesson' ? 'This lesson' : 'Whole course'}
            </button>
          ))}
        </div>
      )}
      <button type="submit" disabled={!instruction.trim() || state.busy}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white font-bold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        <WandSparkles size={16} /> {scope === 'course' ? 'Redesign the whole course' : 'Redesign this lesson'}
      </button>
      <Progress s={state} />
    </form>
  );
};

// ── Drawer shell (Esc closes, focus moves in on open and back on close) ────────
const Drawer: React.FC<{
  open: boolean; onClose: () => void; label: string; title: React.ReactNode;
  focusRef: React.RefObject<HTMLElement>; children: React.ReactNode; actions?: React.ReactNode;
}> = ({ open, onClose, label, title, focusRef, children, actions }) => {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => focusRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-text-main/30 hidden sm:block animate-fadeIn" onClick={onClose} aria-hidden />
      <section role="dialog" aria-modal="true" aria-label={label}
        className="absolute inset-0 sm:left-auto sm:w-[420px] bg-page-bg sm:border-l border-border-subtle shadow-modal flex flex-col animate-slideUp sm:animate-fadeIn">
        <header className="flex items-center gap-2 px-4 h-14 border-b border-border-subtle bg-surface flex-shrink-0">
          {title}
          <div className="ml-auto flex items-center gap-1">
            {actions}
            <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-text-muted hover:bg-surface-alt hover:text-text-main">
              <X size={18} />
            </button>
          </div>
        </header>
        {children}
      </section>
    </div>
  );
};

// ── Markdown-lite for tutor replies: paragraphs, lists, ``` code, inline marks ──
const renderMd = (text: string): React.ReactNode[] => {
  const out: React.ReactNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i]);
      out.push(<pre key={i} className="my-2 p-3 rounded-lg bg-neutral-900 text-neutral-100 text-xs overflow-x-auto"><code>{code.join('\n')}</code></pre>);
    } else if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*•]|\d+\.)\s+/, ''));
      i--;
      const L = ordered ? 'ol' : 'ul';
      out.push(<L key={i} className={`my-1.5 pl-5 space-y-1 ${ordered ? 'list-decimal' : 'list-disc'}`}>{items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</L>);
    } else if (line.trim()) {
      out.push(<p key={i} className="my-1.5">{renderInline(line)}</p>);
    }
  }
  return out;
};

/** `[[redesign scope="…" template="…"]]instruction` → hidden from the text, surfaced as a button. */
interface Directive { scope: Scope; template: Template | null; instruction: string }
const DIRECTIVE_RE = /\[\[redesign([^\]]*)\]\]([^\n]*)/;
export function parseReply(raw: string): { text: string; directive: Directive | null } {
  const m = raw.match(DIRECTIVE_RE);
  // Also hide a directive that is still streaming in (a trailing line starting with "[[").
  const text = raw.replace(DIRECTIVE_RE, '').replace(/(^|\n)[ \t]*\[\[[^\n\]]*\]?$/, '').trimEnd();
  if (!m) return { text, directive: null };
  const attr = (k: string) => m[1].match(new RegExp(`${k}\\s*=\\s*"([^"]*)"`))?.[1] || '';
  const tpl = attr('template');
  return {
    text,
    directive: {
      scope: attr('scope') === 'course' ? 'course' : 'lesson',
      template: tpl === 'general' || tpl === 'meme' || tpl === 'story' ? tpl : null,
      instruction: m[2].trim() || 'Redesign it as discussed.',
    },
  };
}

const QUICK_PROMPTS = ['Explain it simpler', 'Give me a real-world example', 'Quiz me on this'];

// ── Tutor (lesson page) ─────────────────────────────────────────────────────
export const Tutor: React.FC<{
  courseId: string; lessonId: string; lessonTitle?: string; courseStatus?: string;
} & RedesignHandlers> = ({ courseId, lessonId, lessonTitle, courseStatus, ...handlers }) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'chat' | 'redesign'>('chat');
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => getTutorHistory(courseId, lessonId));
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { state, start, resume } = useRedesign(courseId, handlers);

  useEffect(() => { if (courseStatus === 'redesigning') resume(); }, [courseStatus]);
  useEffect(() => {
    abortRef.current?.abort();
    setMsgs(getTutorHistory(courseId, lessonId));
    setChatError('');
    setStreaming(false);
  }, [courseId, lessonId]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { if (!streaming) saveTutorHistory(courseId, lessonId, msgs); }, [msgs, streaming]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [msgs, open, tab]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || streaming) return;
    const history: ChatMsg[] = [...msgs, { role: 'user', content }];
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setChatError('');
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await tutorChat(courseId, lessonId, history, chunk =>
        setMsgs(m => [...m.slice(0, -1), { role: 'assistant', content: m[m.length - 1].content + chunk }]), ctrl.signal);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setChatError(err instanceof Error ? err.message : 'The tutor is unavailable right now.');
    } finally {
      if (!ctrl.signal.aborted) {
        setMsgs(m => (m[m.length - 1]?.role === 'assistant' && !m[m.length - 1].content ? m.slice(0, -1) : m));
        setStreaming(false);
      }
    }
  };

  const runRedesign = (instruction: string, template: Template | null, scope: Scope) =>
    start(instruction, template, scope === 'lesson' ? lessonId : null);

  const tabs = (
    <div role="tablist" aria-label="Tutor sections" className="flex gap-1 bg-surface-alt rounded-xl p-1 mx-4 mt-3 flex-shrink-0">
      {([['chat', 'Ask'], ['redesign', 'Redesign']] as const).map(([k, label]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${tab === k ? 'bg-surface text-text-main shadow-soft' : 'text-text-muted hover:text-text-main'}`}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Ask your tutor"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 pl-4 pr-5 py-3 rounded-full bg-primary hover:bg-primary-hover text-white font-bold text-sm shadow-modal transition-colors">
          {state.busy ? <Loader2 size={18} className="animate-spin" /> : <MessageCircle size={18} />}
          {state.busy ? 'Redesigning…' : 'Ask your tutor'}
        </button>
      )}
      <Drawer open={open} onClose={() => setOpen(false)} label="AI tutor" focusRef={(tab === 'chat' ? inputRef : formRef) as React.RefObject<HTMLElement>}
        title={
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center flex-shrink-0"><Bot size={16} className="text-white" /></div>
            <div className="min-w-0">
              <p className="font-display font-bold text-sm text-text-main leading-tight">Your tutor</p>
              {lessonTitle && <p className="text-[11px] text-text-faint truncate">{lessonTitle}</p>}
            </div>
          </div>
        }
        actions={tab === 'chat' && msgs.length > 0 && !streaming && (
          <button onClick={() => setMsgs([])} aria-label="Clear chat" title="Clear chat" className="p-2 rounded-lg text-text-faint hover:bg-surface-alt hover:text-danger">
            <Trash2 size={16} />
          </button>
        )}>
        {tabs}
        {tab === 'chat' && (state.busy || state.error || state.done) && <div className="px-4 pt-3 flex-shrink-0"><Progress s={state} /></div>}
        {tab === 'chat' ? (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" aria-live="polite">
              {msgs.length === 0 && (
                <div className="text-center py-8 px-4">
                  <p className="font-display font-bold text-text-main mb-1">Stuck on something?</p>
                  <p className="text-sm text-text-muted">Ask about this lesson, or ask me to rewrite it a different way.</p>
                </div>
              )}
              {msgs.map((m, i) => {
                if (m.role === 'user') return (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-br-md bg-primary text-white text-sm whitespace-pre-wrap">{m.content}</p>
                  </div>
                );
                const { text, directive } = parseReply(m.content);
                const live = streaming && i === msgs.length - 1;
                return (
                  <div key={i} className="flex flex-col items-start gap-2">
                    <div className="max-w-[92%] px-3.5 py-2 rounded-2xl rounded-bl-md bg-surface border border-border-subtle text-sm text-text-main leading-relaxed">
                      {text ? renderMd(text) : <Loader2 size={16} className="animate-spin text-text-faint my-1" aria-label="Tutor is typing" />}
                    </div>
                    {directive && !live && (
                      <div className="max-w-[92%] w-full p-3 rounded-2xl bg-primary-light border border-primary/20">
                        <p className="text-xs text-primary-dark mb-2">
                          {directive.instruction}
                          <span className="block mt-1 font-semibold">
                            {directive.scope === 'course' ? 'Whole course' : 'This lesson'}
                            {directive.template && ` · ${TEMPLATE_LABELS[directive.template]}`}
                          </span>
                        </p>
                        <button onClick={() => runRedesign(directive.instruction, directive.template, directive.scope)} disabled={state.busy}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold disabled:opacity-40">
                          <WandSparkles size={14} /> Rewrite it this way
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {chatError && <p role="alert" className="flex items-start gap-2 text-sm text-danger bg-danger-light rounded-xl px-3.5 py-3"><AlertCircle size={16} className="flex-shrink-0 mt-0.5" /> {chatError}</p>}
            </div>
            <div className="border-t border-border-subtle bg-surface px-3 pt-2.5 pb-3 flex-shrink-0">
              <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
                {QUICK_PROMPTS.map(q => (
                  <button key={q} onClick={() => send(q)} disabled={streaming}
                    className="flex-shrink-0 text-xs font-medium text-primary bg-primary-light px-2.5 py-1.5 rounded-full hover:bg-primary hover:text-white transition-colors disabled:opacity-40">
                    {q}
                  </button>
                ))}
              </div>
              <form onSubmit={e => { e.preventDefault(); send(input); }} className="flex items-end gap-2">
                <label htmlFor="tutor-input" className="sr-only">Message your tutor</label>
                <textarea id="tutor-input" ref={inputRef} value={input} rows={1} maxLength={2000}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                  placeholder="Ask anything about this lesson…"
                  className="flex-1 max-h-32 text-sm text-text-main placeholder-text-faint bg-page-bg border border-border-subtle rounded-xl px-3.5 py-2.5 outline-none focus:border-primary focus:shadow-glow resize-none" />
                <button type="submit" disabled={!input.trim() || streaming} aria-label="Send"
                  className="p-3 rounded-xl bg-primary hover:bg-primary-hover text-white disabled:opacity-40 transition-colors">
                  {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div ref={formRef} tabIndex={-1} className="flex-1 overflow-y-auto p-4 outline-none">
            <p className="text-sm text-text-muted mb-4">Not clicking? Have the lesson rewritten your way. Lesson links keep working.</p>
            <RedesignForm state={state} onSubmit={runRedesign} />
          </div>
        )}
      </Drawer>
    </>
  );
};

// ── Redesign drawer alone (course overview, scope = whole course) ─────────────
export const RedesignDrawer: React.FC<{ courseId: string; open: boolean; onClose: () => void } & RedesignHandlers> = ({ courseId, open, onClose, ...handlers }) => {
  const { state, start } = useRedesign(courseId, handlers);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Drawer open={open} onClose={onClose} label="Redesign course" focusRef={ref as React.RefObject<HTMLElement>}
      title={<p className="font-display font-bold text-sm text-text-main flex items-center gap-2"><WandSparkles size={16} className="text-primary" /> Redesign course</p>}>
      <div ref={ref} tabIndex={-1} className="flex-1 overflow-y-auto p-4 outline-none">
        <p className="text-sm text-text-muted mb-4">Every lesson is rewritten with your instruction. The structure and lesson links stay the same.</p>
        <RedesignForm state={state} lockCourse onSubmit={(ins, tpl) => start(ins, tpl, null)} />
      </div>
    </Drawer>
  );
};
