import type { SketchSpec } from './utils/sketchLayout';

export interface Flashcard {
  id: string | number;
  front: string;
  back: string;
  category?: string;
  detail?: string;
  image?: string;
  source_citations?: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
  ease_factor?: number;
  interval_days?: number;
  next_review_date?: string;
  repetitions?: number;
}

export interface QuizOption {
  id: string;
  text: string;
}

export interface QuizQuestion {
  id: string | number;
  question: string;
  options: QuizOption[];
  correctId: string;
  explanation: string;
  source_citations?: string[];
  subtopic?: string;
  difficulty?: string;
}

export interface Block {
  id: string;
  type: 'hook' | 'text' | 'heading' | 'subheading' | 'analogy' | 'callout' | 'code' | 'list' | 'meme' | 'diagram' | 'sketch' | 'image' | 'quiz' | 'challenge' | 'flashcard' | 'reveal' | 'progress' | 'next'
    | 'chat' | 'checkpoint' | 'hot_take' | 'plot_twist' | 'tldr' | 'insight' | 'cliffhanger';
  content?: string;
  style?: string; // e.g., 'exam_tip', 'warning', 'pro_tip' for callouts
  icon?: string;
  language?: string; // for code blocks
  code?: string; // for code or diagram blocks
  spec?: SketchSpec; // for sketch blocks — hand-drawn diagram, see utils/sketchLayout
  tenor_gif_id?: string;
  image_prompt?: string; // meme blocks — rendered to an image by the backend
  alt_text?: string;
  caption?: string;
  width?: number;
  options?: string[]; // for quiz
  correct?: number; // for quiz
  explanation?: string; // for quiz
  question?: string; // for challenge/quiz
  answer?: string; // for challenge
  answer_diff?: { before: string; after: string; language: string }; // for challenge — code/config change
  hint?: string; // for challenge
  xp_earned?: number;
  message?: string;
  streak_message?: string;
  next_lesson_id?: string;
  next_lesson_title?: string;
  source_citations?: string[];
  messages?: { who: string; text: string }[]; // chat
  setup?: string; // plot_twist — the misconception
}
