import React from 'react';

export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
export const DEPTHS = ['Quick overview', 'Balanced', 'Deep dive'];
export const STYLES = ['Examples', 'Theory', 'Visual', 'Code-heavy', 'Story-based'];
export const DEFAULT_PREFS = { level: 'Intermediate', depth: 'Balanced', style: ['Examples', 'Visual', 'Story-based'] };

export const PrefChip: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
      active
        ? 'bg-primary text-white shadow-soft'
        : 'bg-surface border border-border-subtle text-text-muted hover:border-primary/30 hover:text-primary'
    }`}
  >
    {label}
  </button>
);

const Row: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <p className="text-xs font-bold uppercase tracking-wider text-text-faint mb-2.5">{title}</p>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);

/** Level (single) / Depth (single) / Style (multi) chip rows, shared by Home and Profile. */
export const PrefsPicker: React.FC<{
  level: string; depth: string; style: string[];
  onChange: (p: { level: string; depth: string; style: string[] }) => void;
}> = ({ level, depth, style, onChange }) => (
  <div className="space-y-5">
    <Row title="Level">
      {LEVELS.map(l => <PrefChip key={l} label={l} active={level === l} onClick={() => onChange({ level: l, depth, style })} />)}
    </Row>
    <Row title="Depth">
      {DEPTHS.map(d => <PrefChip key={d} label={d} active={depth === d} onClick={() => onChange({ level, depth: d, style })} />)}
    </Row>
    <Row title="Style">
      {STYLES.map(s => (
        <PrefChip
          key={s}
          label={s}
          active={style.includes(s)}
          onClick={() => onChange({ level, depth, style: style.includes(s) ? style.filter(x => x !== s) : [...style, s] })}
        />
      ))}
    </Row>
  </div>
);
