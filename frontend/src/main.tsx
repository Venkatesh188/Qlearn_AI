import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import './index.css';
import Home from './pages/Home';
import Profile from './pages/Profile';
import Courses from './pages/Courses';
import CourseOverview from './pages/CourseOverview';
import Lesson from './pages/Lesson';

const navCls = ({ isActive }: { isActive: boolean }) =>
  `text-sm transition-colors ${isActive ? 'text-primary font-semibold' : 'font-medium text-text-muted hover:text-text-main'}`;

const Navbar: React.FC = () => (
  <header className="sticky top-0 z-50 w-full bg-surface border-b border-border-subtle">
    <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
      <Link to="/" className="flex items-center gap-2 flex-shrink-0">
        <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
          <GraduationCap size={18} className="text-white" />
        </div>
        <span className="font-display font-bold text-xl text-text-main tracking-tight">QlearnAI</span>
      </Link>
      <nav className="flex items-center gap-4 sm:gap-7">
        <NavLink to="/" end className={navCls}>New course</NavLink>
        <NavLink to="/courses" className={navCls}>My courses</NavLink>
        <NavLink to="/profile" className={navCls}>Profile</NavLink>
      </nav>
    </div>
  </header>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/course/:id" element={<CourseOverview />} />
        <Route path="/course/:id/lesson/:lessonId" element={<Lesson />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
