import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle, ChevronRight, Clock, Play, Sparkles, BookOpen, WandSparkles } from 'lucide-react';
import DynamicIcon from '../components/DynamicIcon';
import { RedesignDrawer } from '../components/Tutor';
import { gradientStyle } from '../utils/courseColor';
import { getCourse, getCompleted, watchGeneration, TEMPLATE_LABELS, type Course } from '../services/api';

const CourseOverview: React.FC = () => {
  const { id = '' } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [outline, setOutline] = useState<{ day: number; title: string }[]>([]);
  const [writingDay, setWritingDay] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [redesignOpen, setRedesignOpen] = useState(false);
  const completed = getCompleted(id);

  useEffect(() => {
    setCourse(null);
    getCourse(id).then(setCourse).catch(e => setError(e.message));
  }, [id]);

  const generating = !!course && course.status !== 'ready' && course.status !== 'error';

  // While generating: follow the stream, refetch the course whenever a lesson lands.
  useEffect(() => {
    if (!generating) return;
    const refresh = () => getCourse(id).then(setCourse).catch(() => {});
    let seen = course?.lessons.length || 0;
    return watchGeneration(id, e => {
      if (e.type === 'structure_ready') {
        setOutline(e.lessons || []);
        setCourse(c => c && { ...c, title: e.title || c.title, tagline: e.tagline ?? c.tagline, icon: e.icon ?? c.icon,
          gradient: e.gradient ?? c.gradient, difficulty: e.difficulty ?? c.difficulty, duration_days: e.duration_days ?? c.duration_days });
      } else if (e.type === 'lesson_generating') setWritingDay(e.day);
      else if (e.type === 'lesson_ready' || e.type === 'complete' || e.type === 'error') refresh();
      else if (e.type === 'poll' && (e.lesson_count || 0) > seen) { seen = e.lesson_count; refresh(); }
    });
  }, [id, generating]);

  if (error) return (
    <div className="flex items-center justify-center py-32 text-center">
      <div>
        <AlertCircle size={48} className="text-danger mb-4 mx-auto" />
        <p className="font-semibold text-text-main mb-4">{error}</p>
        <Link to="/courses" className="px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm">My courses</Link>
      </div>
    </div>
  );

  if (!course) return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-4">
      <div className="h-44 bg-surface-alt rounded-3xl animate-pulse" />
      {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-surface-alt rounded-2xl animate-pulse" />)}
    </main>
  );

  const lessons = [...course.lessons].sort((a, b) => a.day_number - b.day_number);
  const total = outline.length || course.duration_days || lessons.length;
  // One row per planned lesson; landed lessons are links, pending ones are placeholders.
  const rows = Array.from({ length: Math.max(total, lessons.length) }, (_, i) => {
    const day = outline[i]?.day ?? i + 1;
    return { day, title: outline[i]?.title, lesson: lessons.find(l => l.day_number === day) ?? (outline.length ? undefined : lessons[i]) };
  });
  const totalMinutes = lessons.reduce((a, l) => a + (l.estimated_minutes || 15), 0);
  const resume = lessons.find(l => !completed.has(l.id)) || lessons[0];
  const prereqs = Array.isArray(course.prerequisites) ? course.prerequisites : course.prerequisites ? [course.prerequisites] : [];

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 pb-24">
      <Link to="/courses" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors mb-6">
        <ArrowLeft size={18} /> My courses
      </Link>

      {/* Gradient header */}
      <header className="rounded-3xl p-8 text-white shadow-card mb-8" style={gradientStyle(course.gradient)}>
        <div className="flex flex-wrap items-center gap-2 mb-5 text-xs font-bold">
          <span className="inline-flex items-center gap-1 bg-white/20 px-3 py-1 rounded-full"><Sparkles size={12} /> AI Generated</span>
          <span className="bg-white/20 px-3 py-1 rounded-full">{TEMPLATE_LABELS[course.template || 'general'] || 'Classic'}</span>
          {course.difficulty && <span className="bg-white/20 px-3 py-1 rounded-full capitalize">{course.difficulty}</span>}
          {total > 0 && <span className="inline-flex items-center gap-1 bg-white/20 px-3 py-1 rounded-full"><BookOpen size={12} /> {total} lessons</span>}
          {totalMinutes > 0 && <span className="inline-flex items-center gap-1 bg-white/20 px-3 py-1 rounded-full"><Clock size={12} /> {totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m` : `${totalMinutes}m`}</span>}
          {generating && (
            <span className="inline-flex items-center gap-1.5 bg-white/20 px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> {course.status === 'redesigning' ? 'Redesigning…' : 'Generating…'}
            </span>
          )}
        </div>
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <DynamicIcon name={course.icon} size={30} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-black text-3xl md:text-4xl leading-tight tracking-tight">{course.title}</h1>
            {course.tagline && <p className="mt-2 text-white/85 text-lg leading-relaxed">{course.tagline}</p>}
          </div>
        </div>
      </header>

      {course.status === 'error' && (
        <p className="mb-6 flex items-center gap-2 text-sm text-danger bg-danger-light rounded-xl px-4 py-3">
          <AlertCircle size={16} /> {course.error_message || 'Generation failed.'}
        </p>
      )}

      {course.outcome && (
        <div className="mb-4 p-4 bg-primary-light rounded-2xl border border-primary/10">
          <p className="text-sm text-primary font-medium"><span className="font-bold">You'll be able to: </span>{course.outcome}</p>
        </div>
      )}

      {prereqs.length > 0 && (
        <div className="mb-8 p-4 bg-surface border border-border-subtle rounded-2xl">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-faint mb-2">Prerequisites</p>
          <ul className="flex flex-wrap gap-2">
            {prereqs.map(p => <li key={p} className="px-3 py-1 bg-surface-alt text-text-muted text-xs font-semibold rounded-full">{p}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-10">
        {resume && (
          <Link
            to={`/course/${id}/lesson/${resume.id}`}
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-primary hover:bg-primary-hover text-white font-bold text-base transition-colors shadow-card"
          >
            <Play size={20} /> {completed.size > 0 ? 'Continue learning' : 'Start course'}
          </Link>
        )}
        {course.status === 'ready' && lessons.length > 0 && (
          <button onClick={() => setRedesignOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-3.5 rounded-2xl border border-border-subtle bg-surface text-text-muted hover:text-primary hover:border-primary/40 font-bold text-sm transition-colors">
            <WandSparkles size={18} /> Redesign course
          </button>
        )}
      </div>
      <RedesignDrawer courseId={id} open={redesignOpen} onClose={() => setRedesignOpen(false)}
        onLessonReady={() => getCourse(id).then(setCourse).catch(() => {})}
        onDone={() => getCourse(id).then(setCourse).catch(() => {})} />

      <h2 className="font-display font-bold text-text-main text-2xl mb-6">Syllabus</h2>
      <div className="space-y-2.5">
        {rows.length === 0 && generating && [...Array(4)].map((_, i) => (
          <div key={i} className="h-[68px] bg-surface rounded-2xl border border-border-subtle animate-pulse" />
        ))}
        {rows.map(({ day, title, lesson }) => {
          const done = !!lesson && completed.has(lesson.id);
          const body = (
            <>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                done ? 'bg-success-light text-success' : lesson ? 'bg-surface-alt text-text-muted' : 'bg-info-light text-info'
              }`}>
                {done ? <CheckCircle size={16} />
                  : lesson ? <Play size={16} />
                  : <div className={`w-4 h-4 border-2 border-info border-t-transparent rounded-full ${writingDay === day ? 'animate-spin' : 'opacity-40'}`} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate text-text-main">{lesson?.title || title || `Lesson ${day}`}</p>
                <p className="text-[11px] text-text-faint mt-0.5">
                  Lesson {day}
                  {lesson?.estimated_minutes ? ` · ${lesson.estimated_minutes} min` : ''}
                  {!lesson && (writingDay === day ? ' · Writing…' : ' · Queued')}
                </p>
              </div>
              {lesson && <ChevronRight size={18} className="flex-shrink-0 text-text-faint group-hover:text-primary transition-colors" />}
            </>
          );
          return lesson ? (
            <Link key={day} to={`/course/${id}/lesson/${lesson.id}`}
              className="group flex items-center gap-4 p-4 rounded-2xl border border-border-subtle bg-surface hover:shadow-card hover:-translate-y-0.5 transition-all animate-fadeIn">
              {body}
            </Link>
          ) : (
            <div key={day} className="flex items-center gap-4 p-4 rounded-2xl border border-border-subtle bg-surface opacity-70">{body}</div>
          );
        })}
      </div>

      {!!course.tags?.length && (
        <div className="mt-8 flex flex-wrap gap-2">
          {course.tags.map(tag => <span key={tag} className="px-3 py-1 bg-surface-alt text-text-muted text-xs font-semibold rounded-full">{tag}</span>)}
        </div>
      )}
    </main>
  );
};

export default CourseOverview;
