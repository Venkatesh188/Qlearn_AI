/**
 * BlockRenderer — renders all lesson block types from the workflow output.
 *
 * Block type coverage:
 *   hook, text, heading, subheading, analogy, callout, code, list,
 *   image, diagram (mermaid), quiz, challenge, meme,
 *   chat, checkpoint, hot_take, plot_twist, tldr, insight, cliffhanger
 *
 * The lesson template (general / meme / story) is passed via context so the same
 * block picks up template styling (e.g. chat = group chat in meme, dialogue in story).
 *
 * Uses new design tokens (primary, accent, surface, border-subtle, etc.)
 * Mermaid: uses the Qlearnai-grade component with validation + sanitization.
 */
import React, { createContext, useContext, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, Target, AlertTriangle, ShieldCheck, Copy, Check, Eye, HelpCircle, MessageSquare, Flame, Zap, ListChecks, NotebookPen } from 'lucide-react';
import { Block } from '../types';
import type { Template } from '../services/api';
import Mermaid from './Mermaid';
import Sketch from './Sketch';
import { Highlighter, codeTheme, normalizeLanguage } from '../utils/codeHighlight';

// ── Text sanitiser ───────────────────────────────────────────────────────────
// Replace em dashes (—) with comma+space or colon depending on context.
// Also collapses double-hyphens (--) the same way.
const cleanText = (s: string): string =>
  s
    .replace(/\s*—\s*/g, ', ')   // " — " or "— " or " —" → ", "
    .replace(/\s*--\s*/g, ', ')  // double-hyphen variants
    .replace(/,\s*,/g, ',');     // guard against double commas

// ── Inline markdown (bold / italic / code) ───────────────────────────────────
// Tokenizes **bold**, *italic*, and `inline code`. No nesting, no escape.
// Single regex with three alternation groups so we don't need a stateful parser.
const INLINE_RE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

const TemplateCtx = createContext<Template>('general');
const useTemplate = () => useContext(TemplateCtx);

/** Meme mode "sticker" card: hard outline + offset shadow. */
const STICKER = 'border-2 border-text-main shadow-[4px_4px_0_0_#2D2A26]';

export const renderInline = (raw: string): React.ReactNode => {
  const text = cleanText(raw);
  if (!INLINE_RE.test(text)) return text;
  INLINE_RE.lastIndex = 0;
  const parts = text.split(INLINE_RE);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold text-text-main">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="px-1.5 py-0.5 mx-0.5 bg-surface-alt border border-border-subtle rounded text-[0.88em] font-mono text-primary">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

// ── Hook / opener ────────────────────────────────────────────────────────────
const HookBlock: React.FC<{ content: string }> = ({ content }) => {
  const t = useTemplate();
  if (t === 'meme') return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className={`my-10 p-6 rounded-2xl bg-[#FFE45C] -rotate-1 ${STICKER}`}>
      <p className="text-2xl md:text-3xl font-display font-black text-text-main leading-tight">{renderInline(content)}</p>
    </motion.div>
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={t === 'story' ? 'my-10' : 'my-10 pl-5 border-l-4 border-primary'}
    >
      <p className={t === 'story'
        ? 'font-serif italic text-2xl text-text-main leading-relaxed first-letter:text-5xl first-letter:font-semibold first-letter:not-italic first-letter:mr-1 first-letter:float-left first-letter:leading-none first-letter:text-primary'
        : 'text-xl md:text-2xl font-display font-semibold text-text-main leading-relaxed italic'}>
        {t === 'story' ? cleanText(content) : `"${cleanText(content)}"`}
      </p>
    </motion.div>
  );
};

// ── Text / prose ─────────────────────────────────────────────────────────────
const TEXT_CLS: Record<Template, string> = {
  general: 'text-base leading-relaxed',
  meme: 'text-lg font-medium leading-relaxed',
  story: 'font-serif text-[1.125rem] leading-[1.85]',
};

const TextBlock: React.FC<{ content: string }> = ({ content }) => {
  const t = useTemplate();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      className="my-5"
    >
      {content.split('\n').filter(Boolean).map((para, i) => (
        <p key={i} className={`${TEXT_CLS[t]} text-text-main ${i > 0 ? 'mt-4' : ''}`}>
          {renderInline(para)}
        </p>
      ))}
    </motion.div>
  );
};

// ── Headings ────────────────────────────────────────────────────────────────
const HeadingBlock: React.FC<{ content: string }> = ({ content }) => (
  <motion.h2
    initial={{ opacity: 0, x: -16 }}
    whileInView={{ opacity: 1, x: 0 }}
    viewport={{ once: true }}
    className="font-display font-bold text-text-main text-2xl md:text-3xl mt-12 mb-4 leading-tight"
  >
    {cleanText(content)}
  </motion.h2>
);

const SubheadingBlock: React.FC<{ content: string }> = ({ content }) => (
  <motion.h3
    initial={{ opacity: 0, x: -12 }}
    whileInView={{ opacity: 1, x: 0 }}
    viewport={{ once: true }}
    className="font-display font-semibold text-text-main text-xl mt-8 mb-3 leading-snug"
  >
    {cleanText(content)}
  </motion.h3>
);

// ── Analogy ──────────────────────────────────────────────────────────────────
const AnalogyBlock: React.FC<{ content: string }> = ({ content }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.97 }}
    whileInView={{ opacity: 1, scale: 1 }}
    viewport={{ once: true }}
    className="my-8 p-6 bg-warning-light border border-warning/20 rounded-2xl flex gap-4"
  >
    <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center flex-shrink-0 text-warning">
      <Lightbulb size={20} />
    </div>
    <div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-warning block mb-1.5">Analogy</span>
      <p className="text-base text-text-main leading-relaxed">{renderInline(content)}</p>
    </div>
  </motion.div>
);

// ── Callout ──────────────────────────────────────────────────────────────────
const CALLOUT_STYLES: Record<string, { bg: string; border: string; label: string; icon: React.ComponentType<any> }> = {
  exam_tip: { bg: 'bg-info-light',    border: 'border-info/20',    label: 'Exam Tip', icon: Target },
  warning:  { bg: 'bg-danger-light',  border: 'border-danger/20',  label: 'Warning',  icon: AlertTriangle },
  pro_tip:  { bg: 'bg-success-light', border: 'border-success/20', label: 'Pro Tip',  icon: ShieldCheck },
  note:     { bg: 'bg-primary-light', border: 'border-primary/20', label: 'Note',     icon: HelpCircle },
  info:     { bg: 'bg-info-light',    border: 'border-info/20',    label: 'Info',     icon: HelpCircle },
};

const CALLOUT_ICON_COLORS: Record<string, string> = {
  exam_tip: 'text-info',
  warning:  'text-danger',
  pro_tip:  'text-success',
  note:     'text-primary',
  info:     'text-info',
};

const CalloutBlock: React.FC<{ content: string; style?: string }> = ({ content, style }) => {
  const t = useTemplate();
  const s = CALLOUT_STYLES[style || 'note'] || CALLOUT_STYLES.note;
  const label = t === 'story' && (!style || style === 'note') ? 'Field notes' : s.label;
  const iconColor = CALLOUT_ICON_COLORS[style || 'note'] || 'text-primary';
  const Icon = s.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`my-8 p-5 rounded-2xl flex gap-4 ${s.bg} ${t === 'meme' ? STICKER : `border ${s.border}`}`}
    >
      <div className={`flex-shrink-0 mt-0.5 ${iconColor}`}>
        <Icon size={18} />
      </div>
      <div>
        <span className={`text-[10px] font-bold uppercase tracking-widest ${iconColor} block mb-1.5`}>{label}</span>
        <p className="text-sm text-text-main leading-relaxed">{renderInline(content)}</p>
      </div>
    </motion.div>
  );
};

// ── Code block ───────────────────────────────────────────────────────────────
const CodeBlock: React.FC<{ code: string; language?: string }> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const lang = normalizeLanguage(language);
  return (
    <div className="my-8 rounded-2xl overflow-hidden border border-neutral-800 bg-neutral-950 shadow-card">
      <div className="flex items-center justify-between px-5 py-2.5 bg-neutral-900 border-b border-neutral-800">
        <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <Highlighter
          language={lang}
          style={codeTheme}
          customStyle={{
            margin: 0,
            padding: '1.25rem',
            background: 'transparent',
            fontSize: '0.875rem',
            lineHeight: '1.625',
          }}
          codeTagProps={{ style: { fontFamily: 'inherit' } }}
        >
          {code}
        </Highlighter>
      </div>
    </div>
  );
};

// ── List ─────────────────────────────────────────────────────────────────────
const ListBlock: React.FC<{ content: string }> = ({ content }) => {
  const items = content.split('\n').filter(Boolean).map(l => l.replace(/^[-•*\d.]\s*/, ''));
  return (
    <motion.ul
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      className="my-5 space-y-2.5"
    >
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 text-base text-text-main leading-relaxed">
          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
          <span>{renderInline(item)}</span>
        </li>
      ))}
    </motion.ul>
  );
};

// ── Image ────────────────────────────────────────────────────────────────────
const ImageBlock: React.FC<{ content?: string; caption?: string; alt_text?: string }> = ({
  content, caption, alt_text,
}) => {
  if (!content) return null;
  return (
    <motion.figure
      initial={{ opacity: 0, scale: 0.98 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      className="my-8 rounded-2xl overflow-hidden border border-border-subtle shadow-soft"
    >
      <img
        src={content}
        alt={alt_text || caption || ''}
        className="w-full h-auto object-cover"
        loading="lazy"
      />
      {caption && (
        <figcaption className="text-xs text-center text-text-faint italic py-3 px-4 bg-surface-alt border-t border-border-subtle">
          {caption}
        </figcaption>
      )}
    </motion.figure>
  );
};

// ── Meme (Tenor GIF) ─────────────────────────────────────────────────────────
const MemeBlock: React.FC<{ src?: string; tenor_gif_id?: string; caption?: string; alt?: string; width?: number }> = ({
  src, tenor_gif_id, caption, alt, width,
}) => {
  // Generated memes arrive as a URL in `content`; old lessons used Tenor GIF ids.
  const url = src || (tenor_gif_id ? `https://media.tenor.com/${tenor_gif_id}/giphy.gif` : '');
  const t = useTemplate();
  if (!url) return null;
  return (
  <motion.div
    initial={{ opacity: 0, scale: 0.96 }}
    whileInView={{ opacity: 1, scale: 1 }}
    viewport={{ once: true }}
    className="my-10 flex flex-col items-center"
  >
    <div className={`rounded-2xl overflow-hidden ${t === 'meme' ? `${STICKER} bg-white` : 'shadow-card border-4 border-surface-alt'}`}>
      <img
        src={url}
        alt={alt || caption || 'meme'}
        style={{ width: width || 480 }}
        className="max-w-full h-auto"
        loading="lazy"
      />
    </div>
    {caption && (
      <p className={`mt-3 text-center max-w-md ${t === 'meme' ? 'text-base font-display font-bold text-text-main' : 'text-sm text-text-muted italic'}`}>{caption}</p>
    )}
  </motion.div>
  );
};

// ── Inline quiz (block-level) ─────────────────────────────────────────────────
const QuizBlock: React.FC<{ block: Block; label?: string }> = ({ block, label = 'Knowledge Check' }) => {
  const t = useTemplate();
  const [selected, setSelected] = useState<number | null>(null);
  const isCorrect = selected === block.correct;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`my-10 p-6 rounded-2xl ${t === 'meme' ? `bg-[#E8F7FF] ${STICKER}` : t === 'story' ? 'bg-[#FFFDF8] border border-[#E6DCC8] shadow-soft' : 'bg-surface border border-border-subtle shadow-soft'}`}
    >
      <div className="flex items-center gap-2 text-primary mb-4">
        <HelpCircle size={18} />
        <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <p className={`text-text-main mb-5 leading-snug ${t === 'story' ? 'font-serif text-lg' : 'font-semibold text-base'}`}>{renderInline(block.question || '')}</p>
      <div className="space-y-2">
        {block.options?.map((opt, idx) => (
          <button
            key={idx}
            onClick={() => selected === null && setSelected(idx)}
            disabled={selected !== null}
            className={`w-full text-left p-3.5 rounded-xl border-2 text-sm font-medium transition-all flex items-center justify-between ${
              selected === null
                ? 'border-border-subtle hover:border-primary/40 hover:bg-primary-light text-text-main'
                : idx === block.correct
                  ? 'border-success bg-success-light text-success'
                  : selected === idx
                    ? 'border-danger bg-danger-light text-danger'
                    : 'border-border-subtle text-text-faint opacity-60'
            }`}
          >
            <span>{renderInline(opt)}</span>
            {selected !== null && idx === block.correct && (
              <Check className="text-success flex-shrink-0" size={16} />
            )}
          </button>
        ))}
      </div>
      <AnimatePresence>
        {selected !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-5 pt-5 border-t border-border-subtle"
          >
            <div className={`p-4 rounded-xl text-sm leading-relaxed ${
              isCorrect ? 'bg-success-light text-success' : 'bg-info-light text-info'
            }`}>
              <span className="font-bold">{isCorrect ? 'Correct! ' : 'Not quite. '}</span>
              {renderInline(block.explanation || '')}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ── Line diff (LCS-based) ────────────────────────────────────────────────────
type DiffLine = { type: 'same' | 'add' | 'remove'; text: string };

const diffLines = (before: string, after: string): DiffLine[] => {
  const a = before.split('\n');
  const b = after.split('\n');
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'remove', text: a[i] }); i++; }
    else { out.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < m) { out.push({ type: 'remove', text: a[i++] }); }
  while (j < n) { out.push({ type: 'add', text: b[j++] }); }
  return out;
};

const DIFF_LINE_STYLES: Record<DiffLine['type'], { bg: string; marker: string; markerColor: string }> = {
  same:   { bg: '',                                                marker: ' ', markerColor: 'text-neutral-500' },
  add:    { bg: 'bg-green-500/15 border-l-2 border-green-500',     marker: '+', markerColor: 'text-green-400' },
  remove: { bg: 'bg-red-500/15 border-l-2 border-red-500',         marker: '−', markerColor: 'text-red-400' },
};

const DiffLineView: React.FC<{ line: DiffLine; language: string }> = ({ line, language }) => {
  const s = DIFF_LINE_STYLES[line.type];
  return (
    <div className={`flex items-start ${s.bg} whitespace-pre`}>
      <span className={`flex-shrink-0 w-6 pl-2 select-none ${s.markerColor}`}>{s.marker}</span>
      <span className="flex-1 pr-4">
        {line.text ? (
          <Highlighter
            language={language}
            style={codeTheme}
            PreTag="span"
            CodeTag="span"
            customStyle={{ background: 'transparent', padding: 0, margin: 0, display: 'inline' }}
            codeTagProps={{ style: { fontFamily: 'inherit', background: 'transparent' } }}
          >
            {line.text}
          </Highlighter>
        ) : ' '}
      </span>
    </div>
  );
};

const DiffBlock: React.FC<{ before: string; after: string; language: string }> = ({ before, after, language }) => {
  const lines = diffLines(before, after);
  const lang = normalizeLanguage(language);
  return (
    <div className="rounded-xl overflow-hidden border border-neutral-700/60 bg-neutral-900">
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-800/70 border-b border-neutral-700/60">
        <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest">{language || 'diff'}</span>
        <span className="text-[10px] font-mono text-neutral-500">updated</span>
      </div>
      <pre className="text-sm font-mono leading-relaxed overflow-x-auto py-2 m-0">
        {lines.map((ln, idx) => (
          <DiffLineView key={idx} line={ln} language={lang} />
        ))}
      </pre>
    </div>
  );
};

// ── Challenge ─────────────────────────────────────────────────────────────────
const ChallengeBlock: React.FC<{ block: Block }> = ({ block }) => {
  const [revealed, setRevealed] = useState(false);
  const diff = block.answer_diff;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="my-10 p-7 bg-neutral-950 text-white rounded-2xl border border-neutral-800 shadow-card overflow-hidden relative"
    >
      <div className="absolute top-0 right-0 p-6 opacity-5">
        <MessageSquare size={120} />
      </div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400 block mb-3">Architecture Challenge</span>
      <p className="font-semibold text-white text-lg mb-6 leading-relaxed max-w-[80%]">{block.question}</p>
      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition"
        >
          <Eye size={16} />
          Reveal answer
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-neutral-800/60 p-5 rounded-xl border border-neutral-700/50 space-y-4"
        >
          {diff && (
            <DiffBlock before={diff.before} after={diff.after} language={diff.language || 'text'} />
          )}
          {block.answer && (
            <p className="text-blue-100 leading-relaxed">{renderInline(block.answer)}</p>
          )}
          {block.hint && (
            <p className="text-sm text-neutral-400 italic">Pro tip: {block.hint}</p>
          )}
        </motion.div>
      )}
    </motion.div>
  );
};

// ── Chat (group chat in meme, dialogue in story) ──────────────────────────────
const SPEAKER_COLORS = ['text-primary', 'text-accent', 'text-success', 'text-warning', 'text-info'];

const ChatBlock: React.FC<{ messages: { who: string; text: string }[] }> = ({ messages }) => {
  const t = useTemplate();
  const speakers = [...new Set(messages.map(m => m.who))];
  // First speaker sits on the right ("you" side), everyone else on the left.
  const bubbles = messages.map((m, i) => {
    const si = speakers.indexOf(m.who);
    const mine = si === 0 && speakers.length > 1;
    const prevSame = i > 0 && messages[i - 1].who === m.who;
    return (
      <div key={i} className={`flex flex-col ${mine ? 'items-end' : 'items-start'} ${prevSame ? 'mt-1' : 'mt-3 first:mt-0'}`}>
        {!prevSame && (
          <span className={`text-[11px] font-bold mb-1 px-1 ${t === 'story' ? 'font-serif italic font-semibold text-text-muted' : SPEAKER_COLORS[si % SPEAKER_COLORS.length]}`}>{m.who}</span>
        )}
        <div className={`max-w-[85%] px-4 py-2.5 leading-relaxed ${
          t === 'story'
            ? `font-serif text-[1.05rem] rounded-2xl ${mine ? 'bg-primary-light rounded-tr-sm' : 'bg-[#F3ECDD] rounded-tl-sm'}`
            : t === 'meme'
              ? `text-[15px] font-medium rounded-3xl ${mine ? 'bg-primary text-white rounded-br-md' : 'bg-white border border-border-subtle rounded-bl-md'}`
              : `text-sm rounded-2xl ${mine ? 'bg-primary-light' : 'bg-surface-alt'}`
        }`}>
          {mine && t === 'meme' ? cleanText(m.text) : renderInline(m.text)}
        </div>
      </div>
    );
  });
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className={t === 'meme' ? `my-10 rounded-2xl bg-[#F1F0FF] overflow-hidden ${STICKER}` : 'my-8'}>
      {t === 'meme' && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b-2 border-text-main">
          <MessageSquare size={16} className="text-primary" />
          <span className="text-sm font-display font-bold text-text-main truncate">group chat</span>
          <span className="ml-auto text-[11px] text-text-faint">{speakers.length} members</span>
        </div>
      )}
      <div className={t === 'meme' ? 'p-4' : ''}>{bubbles}</div>
    </motion.div>
  );
};

// ── Hot take ────────────────────────────────────────────────────────────────
const HotTakeBlock: React.FC<{ content: string }> = ({ content }) => {
  const t = useTemplate();
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
      className={`my-10 p-6 rounded-2xl ${t === 'meme' ? `bg-[#FF8A65] rotate-1 ${STICKER}` : 'bg-accent-light border border-accent/20'}`}>
      <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest mb-2 ${t === 'meme' ? 'text-text-main' : 'text-accent'}`}>
        <Flame size={14} /> Hot take
      </span>
      <p className="font-display font-black text-xl md:text-2xl text-text-main leading-snug">{renderInline(content)}</p>
    </motion.div>
  );
};

// ── Plot twist (click to reveal) ──────────────────────────────────────────────
const PlotTwistBlock: React.FC<{ content: string; setup?: string }> = ({ content, setup }) => {
  const t = useTemplate();
  const [open, setOpen] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className={`my-10 p-6 rounded-2xl bg-text-main text-white ${t === 'meme' ? STICKER : 'shadow-card'}`}>
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#FFE45C] mb-3">
        <Zap size={14} /> Plot twist
      </span>
      {setup && <p className={`text-white/85 leading-relaxed mb-4 ${t === 'story' ? 'font-serif text-lg' : ''}`}>{cleanText(setup)}</p>}
      {!open ? (
        <button onClick={() => setOpen(true)} aria-expanded={false}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-text-main font-bold text-sm hover:bg-[#FFE45C] transition-colors">
          <Eye size={16} /> Reveal the twist
        </button>
      ) : (
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} aria-live="polite"
          className={`text-lg leading-relaxed text-white ${t === 'story' ? 'font-serif' : 'font-semibold'} [&_strong]:text-[#FFE45C] [&_code]:text-text-main`}>
          {renderInline(content)}
        </motion.p>
      )}
    </motion.div>
  );
};

// ── TL;DR ────────────────────────────────────────────────────────────────────
const TldrBlock: React.FC<{ content: string }> = ({ content }) => {
  const t = useTemplate();
  const items = content.split('\n').map(l => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className={`my-10 p-6 rounded-2xl ${t === 'meme' ? `bg-[#C8F7D4] ${STICKER}` : 'bg-success-light border border-success/20'}`}>
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-success mb-3">
        <ListChecks size={14} /> TL;DR
      </span>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-3 text-base text-text-main leading-relaxed font-medium">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
            <span>{renderInline(it)}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
};

// ── Insight ("What just happened") ─────────────────────────────────────────────
const InsightBlock: React.FC<{ content: string }> = ({ content }) => {
  const t = useTemplate();
  return (
    <motion.aside initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
      className={`my-10 p-6 rounded-2xl bg-primary-light font-sans ${t === 'meme' ? STICKER : 'border-l-4 border-primary'}`}>
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-primary mb-2">
        <NotebookPen size={14} /> What just happened
      </span>
      {content.split('\n').filter(Boolean).map((para, i) => (
        <p key={i} className={`text-base text-text-main leading-relaxed ${i > 0 ? 'mt-3' : ''}`}>{renderInline(para)}</p>
      ))}
    </motion.aside>
  );
};

// ── Cliffhanger ───────────────────────────────────────────────────────────────
const CliffhangerBlock: React.FC<{ content: string }> = ({ content }) => (
  <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.8 }}
    className="my-14 text-center">
    <div className="flex items-center justify-center gap-3 text-text-faint mb-4" aria-hidden>
      <span className="h-px w-12 bg-border-subtle" /> <span className="tracking-[0.5em]">···</span> <span className="h-px w-12 bg-border-subtle" />
    </div>
    <span className="text-[10px] font-bold uppercase tracking-widest text-accent block mb-2">Next time</span>
    <p className="font-serif italic text-xl md:text-2xl text-text-main leading-relaxed max-w-md mx-auto">{renderInline(content)}</p>
  </motion.div>
);

const CHECKPOINT_LABEL: Record<Template, string> = { general: 'Quick check', meme: 'Pop quiz', story: 'What would you do?' };

// ── Main renderer ─────────────────────────────────────────────────────────────
const BlockRenderer: React.FC<{ blocks: Block[]; template?: Template }> = ({ blocks, template = 'general' }) => {
  const renderBlock = (block: Block) => {
    switch (block.type) {
      case 'hook':
        return <HookBlock key={block.id} content={block.content || ''} />;
      case 'text':
        return <TextBlock key={block.id} content={block.content || ''} />;
      case 'heading':
        return <HeadingBlock key={block.id} content={block.content || ''} />;
      case 'subheading':
        return <SubheadingBlock key={block.id} content={block.content || ''} />;
      case 'analogy':
        return <AnalogyBlock key={block.id} content={block.content || ''} />;
      case 'callout':
        return <CalloutBlock key={block.id} content={block.content || ''} style={block.style} />;
      case 'code':
        return <CodeBlock key={block.id} code={block.code || block.content || ''} language={block.language} />;
      case 'list':
        return <ListBlock key={block.id} content={block.content || ''} />;
      case 'image':
        return <ImageBlock key={block.id} content={block.content} caption={block.caption} alt_text={block.alt_text} />;
      case 'meme':
        return <MemeBlock key={block.id} src={block.content} tenor_gif_id={block.tenor_gif_id} caption={block.caption} alt={block.alt_text} width={block.width} />;
      case 'diagram':
        return (
          <div key={block.id} className="my-8">
            <Mermaid chart={block.code || block.content || ''} />
          </div>
        );
      case 'sketch':
        return <Sketch key={block.id} spec={block.spec} caption={block.caption} altText={block.alt_text} />;
      case 'quiz':
        return <QuizBlock key={block.id} block={block} />;
      case 'challenge':
        return <ChallengeBlock key={block.id} block={block} />;
      case 'chat':
        return block.messages?.length ? <ChatBlock key={block.id} messages={block.messages} /> : null;
      case 'checkpoint':
        return <QuizBlock key={block.id} block={block} label={CHECKPOINT_LABEL[template]} />;
      case 'hot_take':
        return <HotTakeBlock key={block.id} content={block.content || ''} />;
      case 'plot_twist':
        return <PlotTwistBlock key={block.id} content={block.content || ''} setup={block.setup} />;
      case 'tldr':
        return <TldrBlock key={block.id} content={block.content || ''} />;
      case 'insight':
        return <InsightBlock key={block.id} content={block.content || ''} />;
      case 'cliffhanger':
        return <CliffhangerBlock key={block.id} content={block.content || ''} />;
      // Structural/meta blocks — rendered separately in LessonPage
      case 'flashcard':
      case 'reveal':
      case 'progress':
      case 'next':
        return null;
      default:
        return null;
    }
  };

  return (
    <TemplateCtx.Provider value={template}>
      <div className="w-full">
        {blocks.map((b, i) => renderBlock(b.id ? b : { ...b, id: String(i) }))}
      </div>
    </TemplateCtx.Provider>
  );
};

export default BlockRenderer;
