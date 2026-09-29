import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Sparkles } from 'lucide-react';
import { listCourses, deleteCourse, type CourseSummary } from '../services/api';
import CourseCard from '../components/CourseCard';

const Courses: React.FC = () => {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listCourses().then(setCourses).catch(e => { setError(e.message); setCourses([]); });
  }, []);

  const onDelete = async (id: string) => {
    if (!confirm('Delete this course? This cannot be undone.')) return;
    try {
      await deleteCourse(id);
      setCourses(prev => prev?.filter(c => c.id !== id) ?? null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete course.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 pt-10 pb-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display font-bold text-text-main text-2xl">My courses</h1>
          <p className="text-text-muted text-sm mt-1">Your AI-generated courses</p>
        </div>
        <Link to="/" className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl font-semibold text-sm transition shadow-soft">
          <Plus size={18} />
          New course
        </Link>
      </div>

      {error && <p className="mb-6 text-sm text-danger bg-danger-light rounded-xl px-4 py-3">{error}</p>}

      {courses === null ? (
        <div className="grid md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-28 bg-surface rounded-2xl border border-border-subtle animate-pulse" />)}
        </div>
      ) : courses.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-20 h-20 rounded-full bg-primary-light flex items-center justify-center mx-auto mb-4">
            <Sparkles size={40} className="text-primary" />
          </div>
          <h3 className="font-display text-lg font-bold text-text-main mb-2">No courses yet</h3>
          <p className="text-text-muted mb-6">Enter a topic, URL, PDF, or text to generate your first course.</p>
          <Link to="/" className="px-6 py-3 bg-primary text-white rounded-xl font-semibold">Create your first course</Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {courses.map(c => <CourseCard key={c.id} course={c} onDelete={() => onDelete(c.id)} />)}
        </div>
      )}
    </div>
  );
};

export default Courses;
