/**
 * Lesson reader: sidebar (lessons + localStorage checkmarks) → blocks → flashcards → quiz → prev/next.
 */
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BookOpen, Check, CheckCircle, ChevronLeft, ChevronRight, Clock, GraduationCap, Layers } from 'lucide-react';
import BlockRenderer from '../components/BlockRenderer';
import InteractiveQuiz from '../components/InteractiveQuiz';
import InteractiveFlashcard from '../components/InteractiveFlashcard';
import { Tutor } from '../components/Tutor';
import { getCourse, getLesson, getCompleted, markCompleted, type BackendQuiz, type Course, type Lesson as LessonT, type Template } from '../services/api';
import type { Flashcard, QuizQuestion } from '../types';

/** Backend {question, options: string[], correct: number} → frontend QuizQuestion. */
const toQuizQuestions = (quiz: BackendQuiz[]): QuizQuestion[] =>
  quiz.map((q, i) => ({
    id: i,
    question: q.question,
    options: q.options.map((text, j) => ({ id: String(j), text })),
    correctId: String(q.correct),
    explanation: q.explanation,
  }));

const Sidebar: React.FC<{ course: Course; currentId: string; completed: Set<string> }> = ({ course, currentId, completed }) => (
  <aside className="w-72 border-r border-border-subtle bg-white hidden lg:flex flex-col sticky top-16 self-start h-[calc(100vh-4rem)] flex-shrink-0">
    <div className="p-5 border-b border-border-subtle">
      <Link to={`/course/${course.id}`} className="flex items-center gap-2 text-sm text-text-muted hover:text-primary transition-colors">
        <ArrowLeft size={18} /> Course overview
      </Link>
      <h3 className="mt-3 font-display font-bold text-text-main text-sm leading-snug line-clamp-2">{course.title}</h3>
    </div>
    <div className="flex-1 overflow-y-auto p-3 space-y-1">
      {course.lessons.map(l => {
        const active = l.id === currentId;
        const done = completed.has(l.id);
        return (
          <Link
            key={l.id}
            to={`/course/${course.id}/lesson/${l.id}`}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
              active ? 'bg-primary-light text-primary-dark font-semibold' : 'text-text-muted hover:bg-surface-alt hover:text-text-main'
            }`}
          >
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
              done ? 'bg-success-light text-success' : active ? 'bg-primary text-white' : 'bg-surface-alt text-text-muted'
            }`}>
              {done ? <Check size={14} /> : l.day_number}
            </span>
            <span className="truncate">{l.title}</span>
          </Link>
        );
      })}
    </div>
  </aside>
);

// Reading theme per template: page background, reading measure, title + eyebrow styling.
const THEME: Record<Template, { main: string; measure: string; title: string; eyebrow: string }> = {
  general: { main: 'bg-surface', measure: 'max-w-content', title: 'font-display font-black text-4xl tracking-tight', eyebrow: 'text-primary' },
  meme: {
    main: 'bg-[#FFF8EC]', measure: 'max-w-[600px]',
    title: 'font-display font-black text-4xl md:text-5xl tracking-tight',
    eyebrow: 'text-text-main bg-[#FFE45C] border-2 border-text-main px-2 py-0.5 rounded-full -rotate-2',
  },
  story: { main: 'bg-[#FBF7EF]', measure: 'max-w-[620px]', title: 'font-serif font-semibold text-4xl md:text-[2.75rem]', eyebrow: 'text-accent' },
};

const SectionHeader: React.FC<{ icon: React.ReactNode; tint: string; title: string; sub: string; count: string }> = ({ icon, tint, title, sub, count }) => (
  <div className="flex items-center gap-3 mb-6">
    <div className={`w-10 h-10 rounded-xl ${tint} flex items-center justify-center flex-shrink-0`}>{icon}</div>
    <div>
      <h2 className="font-display font-bold text-text-main text-xl">{title}</h2>
      <p className="text-xs text-text-muted">{sub}</p>
    </div>
    <span className="ml-auto text-xs font-bold text-text-faint bg-surface-alt px-2.5 py-1 rounded-full">{count}</span>
  </div>
);

const Lesson: React.FC = () => {
  const { id = '', lessonId = '' } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [lesson, setLesson] = useState<LessonT | null>(null);
  const [completed, setCompleted] = useState(() => getCompleted(id));
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false); // open lesson is being redesigned → dim it

  const reloadCourse = () => getCourse(id).then(setCourse).catch(() => {});
  const reloadLesson = () => getLesson(id, lessonId).then(setLesson).catch(() => {});

  useEffect(() => { getCourse(id).then(setCourse).catch(e => setError(e.message)); setCompleted(getCompleted(id)); }, [id]);
  useEffect(() => {
    setLesson(null);
    setError('');
    window.scrollTo(0, 0);
    getLesson(id, lessonId).then(setLesson).catch(e => setError(e.message));
  }, [id, lessonId]);

  if (error) return (
    <div className="flex items-center justify-center py-32 text-center">
      <div>
        <AlertCircle size={48} className="text-danger mb-4 mx-auto" />
        <p className="font-semibold text-text-main mb-4">{error}</p>
        <Link to={`/course/${id}`} className="px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm">Back to course</Link>
      </div>
    </div>
  );

  const lessons = course?.lessons ?? [];
  const idx = lessons.findIndex(l => l.id === lessonId);
  const prev = idx > 0 ? lessons[idx - 1] : null;
  const next = idx >= 0 && idx < lessons.length - 1 ? lessons[idx + 1] : null;
  const done = completed.has(lessonId);
  const flashcards: Flashcard[] = (lesson?.flashcards ?? []).map((c, i) => ({ ...c, id: c.id ?? i }));
  const quiz = toQuizQuestions(lesson?.quiz ?? []);
  const template: Template = lesson?.template || course?.template || 'general';
  const theme = THEME[template] || THEME.general;

  return (
    <div className="flex">
      {course && <Sidebar course={course} currentId={lessonId} completed={completed} />}

      <main className={`flex-1 min-w-0 min-h-[calc(100vh-4rem)] ${theme.main}`}>
        <div className={`${theme.measure} mx-auto px-5 sm:px-6 py-12 pb-32`}>
          <nav className="flex items-center gap-1.5 text-xs text-text-faint mb-8">
            <Link to={`/course/${id}`} className="hover:text-primary transition-colors font-medium truncate">{course?.title || 'Course'}</Link>
            <ChevronRight size={14} className="flex-shrink-0" />
            <span className="text-text-muted truncate">{lesson?.title || '…'}</span>
          </nav>

          {!lesson ? (
            <div className="space-y-5 animate-pulse">
              <div className="h-3 bg-surface-alt rounded w-28" />
              <div className="h-9 bg-surface-alt rounded-2xl w-3/4" />
              <div className="h-4 bg-surface-alt rounded w-full" />
              <div className="h-4 bg-surface-alt rounded w-5/6" />
              <div className="h-32 bg-surface-alt rounded-2xl mt-6" />
            </div>
          ) : (
            <>
              <header className="mb-10">
                <div className="flex items-center gap-2 mb-3 text-[10px] font-bold uppercase tracking-widest">
                  <span className={theme.eyebrow}>{template === 'story' ? 'Episode' : 'Lesson'} {lesson.day_number || idx + 1}</span>
                  {!!lesson.estimated_minutes && (
                    <span className="text-text-faint flex items-center gap-1">· <Clock size={12} /> {lesson.estimated_minutes} min</span>
                  )}
                  {done && <span className="text-success flex items-center gap-1">· <CheckCircle size={12} /> Complete</span>}
                </div>
                <h1 className={`text-text-main leading-tight ${theme.title}`}>{lesson.title}</h1>
                {template === 'story' && course?.title && <p className="mt-3 font-serif italic text-text-muted">from {course.title}</p>}
              </header>

              {stale && <p role="status" className="sticky top-20 z-10 mx-auto mb-6 w-fit px-4 py-2 rounded-full bg-primary text-white text-xs font-bold shadow-card">Rewriting this lesson…</p>}
              <article aria-busy={stale} className={`transition-opacity ${stale ? 'opacity-40 pointer-events-none' : ''}`}>
                <BlockRenderer blocks={lesson.blocks ?? []} template={template} />
              </article>

              {flashcards.length > 0 && (
                <section className="mt-14 pt-10 border-t border-border-subtle">
                  <SectionHeader icon={<Layers size={20} className="text-accent" />} tint="bg-accent-light" title="Flashcards"
                    sub="Tap to flip · Space / arrow keys work too" count={`${flashcards.length} cards`} />
                  <InteractiveFlashcard cards={flashcards} />
                </section>
              )}

              {quiz.length > 0 && (
                <section className="mt-14 pt-10 border-t border-border-subtle">
                  <SectionHeader icon={<BookOpen size={20} className="text-primary" />} tint="bg-primary-light" title="Knowledge Check"
                    sub="Test what you've learned in this lesson" count={`${quiz.length} questions`} />
                  <InteractiveQuiz questions={quiz} />
                </section>
              )}

              <div className="mt-14 pt-8 border-t border-border-subtle flex items-center justify-between gap-3">
                {prev ? (
                  <Link to={`/course/${id}/lesson/${prev.id}`}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border-subtle text-text-muted hover:text-text-main hover:bg-surface-alt text-sm font-semibold transition-colors">
                    <ChevronLeft size={18} /> Previous
                  </Link>
                ) : <div />}
                <div className="flex items-center gap-3">
                  {!done && (
                    <button onClick={() => setCompleted(markCompleted(id, lessonId))}
                      className="flex items-center gap-2 px-5 py-3 rounded-2xl border border-primary/30 text-primary hover:bg-primary-light font-bold text-sm transition-colors">
                      <Check size={18} /> Mark complete
                    </button>
                  )}
                  {next ? (
                    <Link to={`/course/${id}/lesson/${next.id}`}
                      className="flex items-center gap-2 px-7 py-3 rounded-2xl bg-primary hover:bg-primary-hover text-white font-bold text-sm transition-colors shadow-card">
                      Next lesson <ChevronRight size={18} />
                    </Link>
                  ) : (
                    <Link to={`/course/${id}`}
                      className="flex items-center gap-2 px-7 py-3 rounded-2xl bg-success hover:opacity-90 text-white font-bold text-sm transition shadow-soft">
                      <GraduationCap size={18} /> Back to course
                    </Link>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      <Tutor
        courseId={id} lessonId={lessonId} lessonTitle={lesson?.title} courseStatus={course?.status}
        onStart={ids => { if (!ids.length || ids.includes(lessonId)) setStale(true); }}
        onLessonReady={lid => { if (lid === lessonId) { reloadLesson().then(() => setStale(false)); } reloadCourse(); }}
        onDone={() => { setStale(false); reloadLesson(); reloadCourse(); }}
      />
    </div>
  );
};

export default Lesson;
