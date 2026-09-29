/**
 * sketchLayout — hand-drawn ("whiteboard") architecture diagrams from a declarative spec.
 *
 * Specs are AI-generated, so everything here is defensive: validateSpec() rejects
 * anything malformed and buildSketch() returns null rather than throwing. The caller
 * renders nothing when it gets null; the backend has already demoted invalid specs
 * to text blocks, so this is defence in depth.
 *
 * Consumed by:
 *   - src/components/Sketch.tsx (renders the primitives as real SVG elements)
 */
import rough from 'roughjs';

// ── Spec ──────────────────────────────────────────────────────────────────

export interface SketchNodeSpec { id: string; label: string; color?: string }
export interface SketchNoteSpec { on: string; text: string; side?: 'above' | 'below'; maxW?: number }
export interface SketchSpec {
  title?: string;
  rows: SketchNodeSpec[][];
  edges?: [string, string][];
  notes?: SketchNoteSpec[];
  options?: Partial<typeof DEFAULTS>;
}

export const PALETTE: Record<string, string> = {
  green: '#2f9e44', blue: '#1971c2', violet: '#6741d9', teal: '#0c8599',
  orange: '#f08c00', red: '#e03131', pink: '#c2255c', ink: '#1e1e1e',
};
const CYCLE = ['green', 'blue', 'violet', 'teal', 'orange', 'red', 'pink'];

export const DEFAULTS = {
  pad: 70, gapX: 130, gapY: 150, boxMinW: 280, boxPadX: 48, boxPadY: 52,
  nodeFont: 30, noteFont: 28, titleFont: 48, lineH: 1.42,
  noteMaxW: 420, noteGap: 26, arrowRun: 84, laneGap: 22,
  charW: 0.5, // handwriting faces run narrow; 0.5em/char tracks Architects Daughter
};

// Caps keep a hallucinated spec from producing a 40-node canvas nobody can read.
export const LIMITS = { rows: 4, perRow: 5, nodes: 16, notes: 12, edges: 24, label: 80, note: 220, title: 90 };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Strict runtime validation. Returns a normalized spec, or null if unusable. */
export function validateSpec(raw: unknown): SketchSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.rows) || s.rows.length === 0 || s.rows.length > LIMITS.rows) return null;

  const ids = new Set<string>();
  const rows: SketchNodeSpec[][] = [];
  for (const row of s.rows) {
    if (!Array.isArray(row) || row.length === 0 || row.length > LIMITS.perRow) return null;
    const out: SketchNodeSpec[] = [];
    for (const n of row) {
      if (!n || typeof n !== 'object') return null;
      const node = n as Record<string, unknown>;
      const id = str(node.id), label = str(node.label);
      if (!id || !label || ids.has(id)) return null;
      ids.add(id);
      const color = str(node.color);
      out.push({
        id,
        label: label.slice(0, LIMITS.label),
        color: PALETTE[color] ? color : (/^#[0-9a-f]{6}$/i.test(color) ? color : undefined),
      });
    }
    rows.push(out);
  }
  if (ids.size < 2 || ids.size > LIMITS.nodes) return null;

  // Edges/notes referencing unknown nodes are dropped, not fatal — a spec that is
  // otherwise good should still render.
  const edges: [string, string][] = [];
  if (Array.isArray(s.edges)) {
    for (const e of s.edges.slice(0, LIMITS.edges)) {
      if (!Array.isArray(e) || e.length < 2) continue;
      const [a, b] = [str(e[0]), str(e[1])];
      if (a && b && a !== b && ids.has(a) && ids.has(b)) edges.push([a, b]);
    }
  }

  const notes: SketchNoteSpec[] = [];
  if (Array.isArray(s.notes)) {
    for (const n of s.notes.slice(0, LIMITS.notes)) {
      if (!n || typeof n !== 'object') continue;
      const note = n as Record<string, unknown>;
      const on = str(note.on), text = str(note.text);
      if (!on || !text || !ids.has(on)) continue;
      const side = note.side === 'above' || note.side === 'below' ? note.side : undefined;
      notes.push({ on, text: text.slice(0, LIMITS.note), side });
    }
  }

  const title = str(s.title).slice(0, LIMITS.title);
  return { title: title || undefined, rows, edges, notes };
}

// ── Layout ────────────────────────────────────────────────────────────────

interface Box extends SketchNodeSpec { color: string; lines: string[]; x: number; y: number; w: number; h: number }
interface Note extends SketchNoteSpec { host: Box; rowIdx: number; lines: string[]; side: 'above' | 'below';
  x: number; y: number; w: number; h: number; lane: number; laneH: number }

export interface Layout {
  o: typeof DEFAULTS; rows: Box[][]; nodes: Record<string, Box>; notes: Note[];
  edges: { from: Box; to: Box }[]; title?: string; width: number; height: number;
}

const wide = (s: string, fs: number, cw: number) =>
  Math.max(...s.split('\n').map(l => l.length)) * fs * cw;

function wrap(text: string, fs: number, maxW: number, cw: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length * fs * cw > maxW) { out.push(line); line = word; }
      else line = next;
    }
    out.push(line);
  }
  return out.filter(Boolean);
}

export function layout(spec: SketchSpec): Layout {
  const o = { ...DEFAULTS, ...(spec.options || {}) };
  const nodes: Record<string, Box> = {};
  let ci = 0;

  const rows: Box[][] = spec.rows.map(row => row.map(n => {
    const lines = n.label.split('\n');
    const box: Box = {
      ...n,
      color: PALETTE[n.color || ''] || n.color || PALETTE[CYCLE[ci++ % CYCLE.length]],
      lines, x: 0, y: 0,
      w: Math.max(o.boxMinW, wide(n.label, o.nodeFont, o.charW) + o.boxPadX * 2),
      h: lines.length * o.nodeFont * o.lineH + o.boxPadY * 2,
    };
    nodes[n.id] = box;
    return box;
  }));

  const notes: Note[] = (spec.notes || []).map(n => {
    const host = nodes[n.on];
    const rowIdx = rows.findIndex(r => r.includes(host));
    const lines = wrap(n.text, o.noteFont, n.maxW || o.noteMaxW, o.charW);
    return {
      ...n, host, rowIdx, lines,
      side: n.side || (rowIdx === 0 ? 'above' : 'below'),
      x: 0, y: 0, lane: 0, laneH: 0,
      w: Math.max(...lines.map(l => l.length)) * o.noteFont * o.charW,
      h: lines.length * o.noteFont * o.lineH,
    };
  });

  // x: rows centred against the widest row
  const rowW = rows.map(r => r.reduce((s, b) => s + b.w, 0) + (r.length - 1) * o.gapX);
  const maxRowW = Math.max(...rowW);
  rows.forEach((row, i) => {
    let x = o.pad + (maxRowW - rowW[i]) / 2;
    for (const b of row) { b.x = x; x += b.w + o.gapX; }
  });

  // lane-stack notes so horizontal neighbours never collide
  const bandH: Record<string, number> = {};
  for (const side of ['above', 'below'] as const) {
    rows.forEach((_, r) => {
      const group = notes.filter(n => n.rowIdx === r && n.side === side)
        .sort((a, b) => a.host.x - b.host.x);
      const laneEnd: number[] = [];
      for (const n of group) {
        n.x = n.host.x + n.host.w / 2 - n.w / 2;
        let lane = 0;
        while (laneEnd[lane] !== undefined && n.x < laneEnd[lane] + o.noteGap) lane++;
        n.lane = lane;
        laneEnd[lane] = n.x + n.w;
      }
      const lanes = group.length ? Math.max(...group.map(n => n.lane + 1)) : 0;
      const laneH = group.length ? Math.max(...group.map(n => n.h)) : 0;
      bandH[`${r}:${side}`] = lanes ? lanes * (laneH + o.laneGap) + o.arrowRun : 0;
      group.forEach(n => { n.laneH = laneH; });
    });
  }

  // y: each row reserves room for its own annotation bands
  let y = o.pad + (spec.title ? o.titleFont * 1.6 : 0);
  rows.forEach((row, r) => {
    y += bandH[`${r}:above`];
    const h = Math.max(...row.map(b => b.h));
    for (const b of row) { b.y = y; b.h = h; }
    y += h + bandH[`${r}:below`] + (r < rows.length - 1 ? o.gapY : 0);
  });

  for (const n of notes) {
    const row = rows[n.rowIdx][0];
    n.y = n.side === 'above'
      ? row.y - o.arrowRun - (n.lane + 1) * (n.laneH + o.laneGap) + o.laneGap
      : row.y + row.h + o.arrowRun + n.lane * (n.laneH + o.laneGap);
  }

  // a note wider than its box can hang off the left edge — shift the canvas right
  const all = [...Object.values(nodes), ...notes];
  const minX = Math.min(...all.map(e => e.x));
  if (minX < o.pad) for (const e of all) e.x += o.pad - minX;

  return {
    o, rows, nodes, notes, title: spec.title,
    edges: (spec.edges || []).map(([a, b]) => ({ from: nodes[a], to: nodes[b] })),
    width: Math.max(...all.map(e => e.x + e.w)) + o.pad,
    height: Math.max(...all.map(e => e.y + e.h)) + o.pad,
  };
}

type Pt = [number, number];

/** Edge ports, chosen from relative position: same row = sides, else bottom → top. */
export function ports(a: Box, b: Box): [Pt, Pt] {
  if (Math.abs(a.y - b.y) < 1) {
    return a.x < b.x
      ? [[a.x + a.w, a.y + a.h / 2], [b.x, b.y + b.h / 2]]
      : [[a.x, a.y + a.h / 2], [b.x + b.w, b.y + b.h / 2]];
  }
  const [up, dn] = a.y < b.y ? [a, b] : [b, a];
  const p: [Pt, Pt] = [[up.x + up.w / 2, up.y + up.h], [dn.x + dn.w / 2, dn.y]];
  return a.y < b.y ? p : [p[1], p[0]];
}

/** Note arrow: leaves the note edge nearest its box, lands square on the box. */
export function notePort(n: Note): [Pt, Pt] {
  const b = n.host;
  const ax = Math.max(n.x + 40, Math.min(n.x + n.w - 40, b.x + b.w / 2));
  const ay = n.side === 'above' ? n.y + n.h + 10 : n.y - 10;
  const tx = Math.max(b.x + 30, Math.min(b.x + b.w - 30, ax));
  const ty = n.side === 'above' ? b.y : b.y + b.h;
  return [[ax, ay], [tx, ty]];
}

// ── Drawing primitives (renderer-agnostic) ────────────────────────────────

export interface DrawPath { d: string; stroke: string; width: number; dash?: string }
export interface DrawText { x: number; y: number; text: string; fill: string; size: number; anchor: 'start' | 'middle' }
export interface Drawing { width: number; height: number; paths: DrawPath[]; texts: DrawText[] }

export function draw(L: Layout): Drawing {
  const o = L.o, gen = rough.generator(), paths: DrawPath[] = [], texts: DrawText[] = [];
  const emit = (drawable: ReturnType<typeof gen.rectangle>, stroke: string, width: number, dash?: string) =>
    gen.toPaths(drawable).forEach(p => paths.push({ d: p.d, stroke, width, dash }));

  for (const b of Object.values(L.nodes))
    emit(gen.rectangle(b.x, b.y, b.w, b.h,
      { roughness: 2.1, bowing: 1.6, stroke: b.color, seed: b.x + b.y }), b.color, 2.6);

  // bendF 0 keeps a run dead straight; same-row connectors want that
  const arrow = ([x1, y1]: Pt, [x2, y2]: Pt, sw: number, dash?: string, bendF = 0.22) => {
    // single-stroke: Rough's default double-stroke muddies thin/dashed runs
    const one = { disableMultiStroke: true, stroke: PALETTE.ink };
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(30, len * bendF) * (x2 < x1 ? -1 : 1);
    const cx = (x1 + x2) / 2 - dy / len * bend, cy = (y1 + y2) / 2 + dx / len * bend;
    emit(gen.curve([[x1, y1], [cx, cy], [x2, y2]], { ...one, roughness: 1.4, bowing: 1.4, seed: x1 + y2 }),
      PALETTE.ink, sw, dash);
    const a = Math.atan2(y2 - cy, x2 - cx), hl = 22, sp = 0.42;
    emit(gen.linearPath([
      [x2 - hl * Math.cos(a - sp), y2 - hl * Math.sin(a - sp)], [x2, y2],
      [x2 - hl * Math.cos(a + sp), y2 - hl * Math.sin(a + sp)],
    ], { ...one, roughness: 1.1, seed: x2 + y2 }), PALETTE.ink, sw);
  };

  for (const e of L.edges) arrow(...ports(e.from, e.to), 2.2, undefined, Math.abs(e.from.y - e.to.y) < 1 ? 0 : 0.22);
  for (const n of L.notes) arrow(...notePort(n), 1.8, '10 12');

  if (L.title) texts.push({ x: o.pad, y: o.pad + o.titleFont * 0.7, text: L.title, fill: PALETTE.ink, size: o.titleFont, anchor: 'start' });
  for (const b of Object.values(L.nodes))
    b.lines.forEach((l, i) => texts.push({
      x: b.x + b.w / 2,
      y: b.y + b.h / 2 + (i - (b.lines.length - 1) / 2) * o.nodeFont * o.lineH + o.nodeFont * 0.35,
      text: l, fill: b.color, size: o.nodeFont, anchor: 'middle',
    }));
  for (const n of L.notes)
    n.lines.forEach((l, i) => texts.push({
      x: n.x + n.w / 2, y: n.y + (i + 0.8) * o.noteFont * o.lineH,
      text: l, fill: PALETTE.ink, size: o.noteFont, anchor: 'middle',
    }));

  return { width: L.width, height: L.height, paths, texts };
}

/** Validate → layout → draw. Null when the spec is unusable; never throws. */
export function buildSketch(raw: unknown, options?: Partial<typeof DEFAULTS>): Drawing | null {
  try {
    const spec = validateSpec(raw);
    if (!spec) return null;
    return draw(layout({ ...spec, options: { ...(spec.options || {}), ...(options || {}) } }));
  } catch {
    return null;
  }
}

export const SKETCH_FONT = `'Architects Daughter','Bradley Hand','Comic Sans MS',cursive`;

/** Standalone SVG string — used by the CLI tool, not by the React renderer. */
export function toSVGString(d: Drawing, opts: { background?: string; fontFamily?: string } = {}): string {
  const font = opts.fontFamily || SKETCH_FONT;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paths = d.paths.map(p =>
    `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.width}" fill="none" stroke-linecap="round"${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}/>`).join('');
  const texts = d.texts.map(t =>
    `<text x="${t.x}" y="${t.y}" fill="${t.fill}" font-family="${font}" font-size="${t.size}" text-anchor="${t.anchor}">${esc(t.text)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${d.height}" viewBox="0 0 ${d.width} ${d.height}">`
    + `<rect width="${d.width}" height="${d.height}" fill="${opts.background || '#ffffff'}"/>${paths}${texts}</svg>`;
}
