/**
 * Sketch — renders a hand-drawn ("whiteboard") diagram block.
 *
 * The layout engine returns drawing primitives and React renders real <path>/<text>
 * elements. No raw HTML/SVG string is ever injected, so AI-authored label text cannot
 * introduce markup — text goes through React's normal escaping.
 *
 * An unusable spec renders nothing. The backend sanitizer demotes invalid sketch
 * blocks to text before they reach the client, so a null here means the block was
 * already salvaged upstream — the lesson still reads correctly.
 */
import React, { useMemo } from 'react';
import { buildSketch, SKETCH_FONT } from '../utils/sketchLayout';

interface SketchProps {
  spec: unknown;
  caption?: string;
  altText?: string;
}

const Sketch: React.FC<SketchProps> = ({ spec, caption, altText }) => {
  const drawing = useMemo(() => buildSketch(spec), [spec]);

  if (!drawing) {
    if (import.meta.env.DEV) console.warn('[Sketch] unusable diagram spec, block skipped:', spec);
    return null;
  }

  return (
    <figure className="my-8 w-full min-w-0 max-w-full">
      <div className="bg-surface border border-border-subtle rounded-2xl p-4 sm:p-6 max-w-full overflow-x-auto shadow-soft">
        <svg
          viewBox={`0 0 ${drawing.width} ${drawing.height}`}
          width="100%"
          role="img"
          aria-label={altText || caption || 'Hand-drawn architecture diagram'}
          style={{ maxWidth: drawing.width, height: 'auto', display: 'block', margin: '0 auto', fontFamily: SKETCH_FONT }}
        >
          {drawing.paths.map((p, i) => (
            <path
              key={`p${i}`}
              d={p.d}
              stroke={p.stroke}
              strokeWidth={p.width}
              strokeDasharray={p.dash}
              strokeLinecap="round"
              fill="none"
            />
          ))}
          {drawing.texts.map((t, i) => (
            <text key={`t${i}`} x={t.x} y={t.y} fill={t.fill} fontSize={t.size} textAnchor={t.anchor}>
              {t.text}
            </text>
          ))}
        </svg>
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-sm text-text-muted">{caption}</figcaption>
      )}
    </figure>
  );
};

export default Sketch;
