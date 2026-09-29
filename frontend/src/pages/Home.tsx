/**
 * Home — the course builder (adapted from the old CreatePath).
 * Topic / URL / Paste text / PDF → prefs → Build → inline GeneratingView (SSE + polling fallback).
 */
import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkles, AlertCircle, CheckCircle, GraduationCap, Check, RefreshCw, Search, GitBranch,
  PenLine, BookOpen, FileText, Link as LinkIcon, Lightbulb, File, Upload,
  SlidersHorizontal, ChevronUp, ChevronDown, Layers, X, UserRound, Laugh, ScrollText, type LucideIcon,
} from 'lucide-react';
import {
  generate, generatePdf, watchGeneration, listCourses, getProfile, isBannerDismissed, dismissBanner,
  type GenEvent, type CourseSummary, type Template,
} from '../services/api';
import { PrefsPicker, DEFAULT_PREFS } from '../components/Prefs';
import CourseCard from '../components/CourseCard';

type InputMode = 'topic' | 'url' | 'text' | 'pdf';
type GenState = 'idle' | 'generating' | 'ready' | 'error';

const GEN_STEPS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'analyzing',   label: 'Analyzing your content…',      icon: Search },
  { key: 'structuring', label: 'Building course structure…',    icon: GitBranch },
  { key: 'writing',     label: 'Writing lessons…',              icon: PenLine },
  { key: 'enriching',   label: 'Adding quizzes & flashcards…',  icon: BookOpen },
  { key: 'finishing',   label: 'Finalising your course…',       icon: CheckCircle },
];

// Each template maps to its own text model on the backend (TEMPLATE_MODELS); meme adds Nano Banana images.
const TEMPLATES: { id: Template; icon: LucideIcon; label: string; blurb: string }[] = [
  { id: 'general', icon: BookOpen,   label: 'Classic',    blurb: 'Clear lessons, flowcharts, sketches' },
  { id: 'meme',    icon: Laugh,      label: 'Meme mode',  blurb: 'Every lesson told in memes' },
  { id: 'story',   icon: ScrollText, label: 'Story mode', blurb: 'Learn through a story, episode by episode' },
];

const TOPIC_EXAMPLES = ['Machine Learning basics', 'Kubernetes networking', 'How TCP/IP works', 'AWS Lambda', 'System Design'];

const MODE_TABS: { id: InputMode; icon: LucideIcon; label: string }[] = [
  { id: 'topic', icon: Lightbulb, label: 'Topic' },
  { id: 'url',   icon: LinkIcon,  label: 'URL' },
  { id: 'text',  icon: FileText,  label: 'Paste text' },
  { id: 'pdf',   icon: File,      label: 'PDF' },
];

const WHAT_YOU_GET: { icon: LucideIcon; label: string; color: string }[] = [
  { icon: FileText,  label: 'Lessons',    color: 'text-primary' },
  { icon: Layers,    label: 'Flashcards', color: 'text-accent' },
  { icon: BookOpen,  label: 'Quizzes',    color: 'text-success' },
  { icon: GitBranch, label: 'Diagrams',   color: 'text-intermediate-text' },
];

// ── Generation progress (inline) ────────────────────────────────────────────
const GeneratingView: React.FC<{
  status: GenState; message: string; lessonCount: number; totalLessons: number;
  title: string; error: string; onView: () => void; onRetry: () => void;
}> = ({ status, message, lessonCount, totalLessons, title, error, onView, onRetry }) => {
  // Map the free-text progress message onto a step; lesson events imply "writing".
  const msg = message.toLowerCase();
  let activeStep = GEN_STEPS.findIndex(s => msg.includes(s.key));
  if (activeStep < 0) activeStep = lessonCount > 0 || msg.includes('lesson') ? 2 : 0;

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center py-16 text-center animate-fadeIn">
        <div className="w-16 h-16 rounded-2xl bg-danger-light flex items-center justify-center mb-5">
          <AlertCircle size={32} className="text-danger" />
        </div>
        <h2 className="font-display font-bold text-text-main text-2xl mb-2">Generation failed</h2>
        <p className="text-text-muted text-sm mb-8 max-w-sm">{error || 'Something went wrong. Please try again.'}</p>
        <button onClick={onRetry} className="px-6 py-3 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary-hover transition-colors">
          Try again
        </button>
      </div>
    );
  }

  if (status === 'ready') {
    return (
      <div className="flex flex-col items-center py-16 text-center animate-fadeIn">
        <div className="w-20 h-20 rounded-3xl bg-primary-light flex items-center justify-center mb-6 animate-celebrate">
          <CheckCircle size={40} className="text-primary" />
        </div>
        <h2 className="font-display font-bold text-text-main text-3xl mb-2">Your course is ready!</h2>
        <p className="text-text-muted mb-1">{title}</p>
        {totalLessons > 0 && <p className="text-text-faint text-sm mb-8">{totalLessons} lessons · ready to learn</p>}
        <button
          onClick={onView}
          className="px-8 py-4 rounded-2xl bg-primary text-white font-bold text-base hover:bg-primary-hover transition-colors shadow-card flex items-center gap-2"
        >
          <GraduationCap size={20} />
          Start learning
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-12 animate-fadeIn">
      {title && (
        <div className="text-center mb-10">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-2">Building your course</p>
          <h2 className="font-display font-bold text-text-main text-2xl">{title}</h2>
          {message && <p className="text-sm text-text-muted mt-2">{message}</p>}
        </div>
      )}

      <div className="space-y-3 mb-10">
        {GEN_STEPS.map((step, i) => {
          const isDone = i < activeStep;
          const isActive = i === activeStep;
          const StepIcon = step.icon;
          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                isActive ? 'bg-primary-light border border-primary/20' : isDone ? 'opacity-60' : 'opacity-30'
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                isDone ? 'bg-primary text-white' : isActive ? 'bg-primary/10' : 'bg-surface-alt'
              }`}>
                {isDone ? <Check size={16} />
                  : isActive ? <RefreshCw size={16} className="text-primary animate-spin" />
                  : <StepIcon size={16} className="text-text-faint" />}
              </div>
              <span className={`text-sm font-medium ${isActive ? 'text-primary' : isDone ? 'text-text-muted' : 'text-text-faint'}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {totalLessons > 0 && (
        <div className="bg-surface border border-border-subtle rounded-2xl p-5">
          <div className="flex justify-between text-xs text-text-muted mb-3">
            <span>Lessons generated</span>
            <span className="font-semibold text-text-main">{lessonCount} / {totalLessons}</span>
          </div>
          <div className="h-2 bg-surface-alt rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${Math.round((lessonCount / totalLessons) * 100)}%` }} />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {[...Array(totalLessons)].map((_, i) => (
              <div key={i} className={`w-2.5 h-2.5 rounded-full transition-all ${i < lessonCount ? 'bg-primary' : 'bg-surface-alt'}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main ─────────────────────────────────────────────────────────────────────
const Home: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [profile] = useState(getProfile);

  const [mode, setMode] = useState<InputMode>('topic');
  const [topicInput, setTopicInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [template, setTemplate] = useState<Template>('general');
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState(() => ({
    level: profile?.level || DEFAULT_PREFS.level,
    depth: profile?.depth || DEFAULT_PREFS.depth,
    style: profile?.style?.length ? profile.style : DEFAULT_PREFS.style,
  }));

  const [gen, setGen] = useState<GenState>('idle');
  const [genMessage, setGenMessage] = useState('');
  const [courseId, setCourseId] = useState('');
  const [genTitle, setGenTitle] = useState('');
  const [lessonCount, setLessonCount] = useState(0);
  const [totalLessons, setTotalLessons] = useState(0);
  const [genError, setGenError] = useState('');

  const [showBanner, setShowBanner] = useState(() => !profile && !isBannerDismissed());
  const [recent, setRecent] = useState<CourseSummary[]>([]);

  useEffect(() => { listCourses().then(c => setRecent(c.slice(0, 5))).catch(() => {}); }, []);
  useEffect(() => () => stopRef.current?.(), []);

  const handleEvent = (e: GenEvent) => {
    switch (e.type) {
      case 'status':
        setGenMessage(e.message || '');
        break;
      case 'structure_ready':
        setGenTitle(e.title || '');
        setTotalLessons(e.lessons?.length || e.duration_days || 0);
        setGenMessage(`Course outline ready, ${e.lessons?.length || e.duration_days} lessons`);
        break;
      case 'lesson_generating':
        setGenMessage(`Writing lesson ${e.day}: ${e.title}…`);
        break;
      case 'lesson_ready':
        setLessonCount(e.lessons_ready || 0);
        setTotalLessons(e.lessons_total || 0);
        setGenMessage(`${e.lessons_ready} of ${e.lessons_total} lessons ready`);
        break;
      case 'poll':
        setGenMessage(e.progress_message || '');
        setLessonCount(e.lesson_count || 0);
        if (e.title) setGenTitle(e.title);
        if (e.duration_days > 0) setTotalLessons(e.duration_days);
        break;
      case 'complete':
        if (e.title) setGenTitle(e.title);
        if (e.duration_days) { setTotalLessons(e.duration_days); setLessonCount(e.duration_days); }
        setGen('ready');
        break;
      case 'error':
        setGen('error');
        setGenError(e.message || 'Generation failed');
        break;
    }
  };

  const canGenerate =
    (mode === 'topic' && topicInput.trim().length > 2) ||
    (mode === 'url' && urlInput.trim().length > 5) ||
    (mode === 'text' && textInput.trim().split(/\s+/).filter(Boolean).length >= 20) ||
    (mode === 'pdf' && !!selectedFile);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    const p = { ...prefs, template, ...(profile?.background ? { background: profile.background } : {}) };
    setGen('generating');
    setGenMessage('Analyzing your content…');
    setGenError('');
    setLessonCount(0);
    setTotalLessons(0);
    setGenTitle(mode === 'topic' ? topicInput.trim() : 'Your course');
    try {
      const { course_id } =
        mode === 'pdf' ? await generatePdf(selectedFile!, p)
        : mode === 'url' ? await generate('url', urlInput.trim(), p)
        : mode === 'text' ? await generate('text', textInput.trim(), p)
        : await generate('topic', topicInput.trim(), p);
      setCourseId(course_id);
      stopRef.current?.();
      stopRef.current = watchGeneration(course_id, handleEvent);
    } catch (err) {
      setGen('error');
      setGenError(err instanceof Error ? err.message : 'Generation failed. Please try again.');
    }
  };

  if (gen !== 'idle') {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-4">
        <GeneratingView
          status={gen}
          message={genMessage}
          lessonCount={lessonCount}
          totalLessons={totalLessons}
          title={genTitle}
          error={genError}
          onView={() => navigate(`/course/${courseId}`)}
          onRetry={() => { stopRef.current?.(); setGen('idle'); }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-12 pb-24">
      {showBanner && (
        <div className="mb-8 flex items-center gap-3 bg-primary-light border border-primary/15 text-primary rounded-2xl px-4 py-3 text-sm animate-fadeIn">
          <UserRound size={18} className="flex-shrink-0" />
          <p className="flex-1">
            Tell us about yourself and courses will be tailored to your background.{' '}
            <Link to="/profile" className="font-bold underline underline-offset-2">Set up profile</Link>
          </p>
          <button onClick={() => { dismissBanner(); setShowBanner(false); }} aria-label="Dismiss" className="p-1 rounded-lg hover:bg-primary/10">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="text-center mb-10 animate-fadeIn">
        <div className="inline-flex items-center gap-2 bg-primary-light text-primary px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-6">
          <Sparkles size={14} />
          AI Course Builder
        </div>
        <h1 className="font-display font-black text-text-main text-4xl md:text-5xl leading-tight mb-3">
          What do you want<br />to learn?
        </h1>
        <p className="text-text-muted text-base max-w-md mx-auto">
          Enter a topic, paste a URL, upload a PDF, or drop in text. We'll build a complete course.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 animate-fadeIn" role="radiogroup" aria-label="Course template">
        {TEMPLATES.map(t => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={template === t.id}
            onClick={() => setTemplate(t.id)}
            className={`flex sm:flex-col items-center sm:items-start gap-3 text-left p-4 rounded-2xl border transition-all ${
              template === t.id
                ? 'bg-primary-light border-primary/40 shadow-soft'
                : 'bg-surface border-border-subtle hover:border-primary/30'
            }`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              template === t.id ? 'bg-primary text-white' : 'bg-surface-alt text-text-muted'
            }`}>
              <t.icon size={20} />
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-bold ${template === t.id ? 'text-primary' : 'text-text-main'}`}>{t.label}</p>
              <p className="text-xs text-text-muted">{t.blurb}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 bg-surface-alt rounded-2xl p-1.5 mb-6 animate-fadeIn">
        {MODE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setMode(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all ${
              mode === tab.id ? 'bg-surface text-text-main shadow-soft' : 'text-text-muted hover:text-text-main'
            }`}
          >
            <tab.icon size={16} />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="bg-surface border border-border-subtle rounded-2xl shadow-card overflow-hidden mb-4 animate-fadeIn">
        <div className="p-5">
          {mode === 'topic' && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-text-faint mb-3">Topic or concept</label>
              <input
                type="text"
                value={topicInput}
                onChange={e => setTopicInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                placeholder="e.g. Kubernetes networking, how TCP/IP works, React hooks…"
                className="w-full text-base text-text-main placeholder-text-faint bg-transparent outline-none border-none"
                autoFocus
              />
              <div className="flex flex-wrap gap-2 mt-4">
                {TOPIC_EXAMPLES.map(ex => (
                  <button
                    key={ex}
                    onClick={() => setTopicInput(ex)}
                    className="text-xs text-primary bg-primary-light px-2.5 py-1 rounded-full font-medium hover:bg-primary hover:text-white transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === 'url' && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-text-faint mb-3">Article, documentation, or YouTube URL</label>
              <input
                type="url"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                placeholder="https://…"
                className="w-full text-base text-text-main placeholder-text-faint bg-transparent outline-none"
                autoFocus
              />
            </div>
          )}

          {mode === 'text' && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-text-faint mb-3">Paste any text (min 20 words)</label>
              <textarea
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                placeholder="Paste an article, notes, documentation, transcript, or any text…"
                rows={7}
                className="w-full text-base text-text-main placeholder-text-faint bg-transparent outline-none resize-none leading-relaxed"
                autoFocus
              />
              <p className="text-xs text-text-faint mt-2">{textInput.trim().split(/\s+/).filter(Boolean).length} words</p>
            </div>
          )}

          {mode === 'pdf' && (
            <div>
              <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={e => setSelectedFile(e.target.files?.[0] || null)} />
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                  selectedFile ? 'border-primary bg-primary-light' : 'border-border-subtle hover:border-primary hover:bg-primary-light/50'
                }`}
              >
                {selectedFile ? (
                  <>
                    <FileText size={40} className="text-primary mb-2 mx-auto" />
                    <p className="font-semibold text-text-main">{selectedFile.name}</p>
                    <p className="text-xs text-text-muted mt-1">{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>
                    <button
                      onClick={e => { e.stopPropagation(); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      className="mt-3 text-xs text-danger font-medium"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <Upload size={48} className="text-text-faint mb-3 mx-auto" />
                    <p className="font-semibold text-text-muted">Drop your PDF here</p>
                    <p className="text-xs text-text-faint mt-1">or click to browse · max 20MB</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border-subtle">
          <button
            type="button"
            onClick={() => setPrefsOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium text-text-muted hover:text-text-main hover:bg-surface-alt transition-colors"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal size={18} />
              Preferences
              <span className="text-xs text-text-faint">(optional)</span>
            </span>
            {prefsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {prefsOpen && (
            <div className="px-5 pb-5 animate-fadeIn">
              <PrefsPicker {...prefs} onChange={setPrefs} />
            </div>
          )}
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className="w-full py-4 rounded-2xl bg-primary hover:bg-primary-hover text-white font-bold text-base transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-card flex items-center justify-center gap-2 animate-fadeIn"
      >
        <Sparkles size={20} />
        Build my course
      </button>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8 animate-fadeIn">
        {WHAT_YOU_GET.map(item => (
          <div key={item.label} className="bg-surface border border-border-subtle rounded-2xl p-4 text-center">
            <item.icon size={22} className={`${item.color} mx-auto mb-2`} />
            <p className="text-xs font-semibold text-text-main">{item.label}</p>
          </div>
        ))}
      </div>

      {recent.length > 0 && (
        <section className="mt-14">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-text-main text-lg">Recent courses</h2>
            <Link to="/courses" className="text-sm font-semibold text-primary hover:text-primary-hover">View all</Link>
          </div>
          <div className="grid gap-3">
            {recent.map(c => <CourseCard key={c.id} course={c} />)}
          </div>
        </section>
      )}
    </div>
  );
};

export default Home;
