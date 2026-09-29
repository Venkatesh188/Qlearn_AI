import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Trash2, Zap } from 'lucide-react';
import DynamicIcon from './DynamicIcon';
import { gradientStyle } from '../utils/courseColor';
import { TEMPLATE_LABELS, type CourseSummary } from '../services/api';

const STATUS: Record<string, string> = {
  ready: 'bg-success-light text-success',
  error: 'bg-danger-light text-danger',
};

const CourseCard: React.FC<{ course: CourseSummary; onDelete?: () => void }> = ({ course, onDelete }) => (
  <Link
    to={`/course/${course.id}`}
    className="group bg-surface border border-border-subtle rounded-2xl p-5 flex items-center gap-4 hover:shadow-card hover:-translate-y-0.5 transition-all"
  >
    <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-soft" style={gradientStyle(course.gradient)}>
      <DynamicIcon name={course.icon} size={26} className="text-white" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-display font-bold text-text-main text-sm truncate">{course.title}</h3>
        {course.status !== 'ready' && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${STATUS[course.status] || 'bg-info-light text-info'}`}>
            {course.status !== 'error' && <Zap size={10} />}{course.status}
          </span>
        )}
      </div>
      {course.tagline && <p className="text-xs text-text-muted truncate mb-1.5">{course.tagline}</p>}
      <p className="flex items-center gap-3 text-xs text-text-faint">
        <span className="flex items-center gap-1"><BookOpen size={13} />{course.lesson_count ?? 0} lessons</span>
        {course.template && course.template !== 'general' && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary-light px-2 py-0.5 rounded-full">{TEMPLATE_LABELS[course.template]}</span>
        )}
        {course.difficulty && <span className="capitalize">{course.difficulty}</span>}
        {course.created_at && <span>{new Date(course.created_at).toLocaleDateString()}</span>}
      </p>
    </div>
    {onDelete && (
      <button
        onClick={e => { e.preventDefault(); onDelete(); }}
        title="Delete course"
        aria-label="Delete course"
        className="p-2 rounded-xl text-text-faint hover:text-danger hover:bg-danger-light transition-colors flex-shrink-0"
      >
        <Trash2 size={18} />
      </button>
    )}
  </Link>
);

export default CourseCard;
