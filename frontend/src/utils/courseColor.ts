import type { CSSProperties } from 'react';

const COLORS: Record<string, string> = {
  'slate-400': '#94a3b8', 'slate-500': '#64748b', 'slate-600': '#475569', 'slate-700': '#334155',
  'gray-400':  '#9ca3af', 'gray-500':  '#6b7280', 'gray-600':  '#4b5563', 'gray-700':  '#374151',
  'zinc-400':  '#a1a1aa', 'zinc-500':  '#71717a',  'zinc-600':  '#52525b',
  'red-400':   '#f87171', 'red-500':   '#ef4444',  'red-600':   '#dc2626',
  'orange-400':'#fb923c', 'orange-500':'#f97316',  'orange-600':'#ea580c',
  'amber-400': '#fbbf24', 'amber-500': '#f59e0b',  'amber-600': '#d97706',
  'yellow-400':'#facc15', 'yellow-500':'#eab308',
  'lime-400':  '#a3e635', 'lime-500':  '#84cc16',  'lime-600':  '#65a30d',
  'green-400': '#4ade80', 'green-500': '#22c55e',  'green-600': '#16a34a',
  'emerald-400':'#34d399','emerald-500':'#10b981', 'emerald-600':'#059669',
  'teal-400':  '#2dd4bf', 'teal-500':  '#14b8a6',  'teal-600':  '#0d9488',
  'cyan-400':  '#22d3ee', 'cyan-500':  '#06b6d4',  'cyan-600':  '#0891b2',
  'sky-400':   '#38bdf8', 'sky-500':   '#0ea5e9',  'sky-600':   '#0284c7',
  'blue-400':  '#60a5fa', 'blue-500':  '#3b82f6',  'blue-600':  '#2563eb',
  'indigo-400':'#818cf8', 'indigo-500':'#6366f1',  'indigo-600':'#4f46e5',
  'violet-400':'#a78bfa', 'violet-500':'#8b5cf6',  'violet-600':'#7c3aed',
  'purple-400':'#c084fc', 'purple-500':'#a855f7',  'purple-600':'#9333ea',
  'fuchsia-400':'#e879f9','fuchsia-500':'#d946ef', 'fuchsia-600':'#c026d3',
  'pink-400':  '#f472b6', 'pink-500':  '#ec4899',  'pink-600':  '#db2777',
  'rose-400':  '#fb7185', 'rose-500':  '#f43f5e',  'rose-600':  '#e11d48',
};

const DEFAULT_FROM = '#6366f1';
const DEFAULT_TO   = '#7c3aed';

export function gradientStyle(gradient?: string | null, direction = '135deg'): CSSProperties {
  if (!gradient) {
    return { background: `linear-gradient(${direction}, ${DEFAULT_FROM}, ${DEFAULT_TO})` };
  }
  const fromMatch = gradient.match(/from-([\w-]+)/);
  const toMatch   = gradient.match(/\bto-([\w-]+)/);
  const from = fromMatch ? (COLORS[fromMatch[1]] ?? DEFAULT_FROM) : DEFAULT_FROM;
  const to   = toMatch   ? (COLORS[toMatch[1]]   ?? DEFAULT_TO)   : DEFAULT_TO;
  return { background: `linear-gradient(${direction}, ${from}, ${to})` };
}

export function accentBarStyle(gradient?: string | null): CSSProperties {
  return gradientStyle(gradient, '90deg');
}
