// Murtali: the timeline's maths (pixels, zoom, hit-testing, waveform columns). Pure. Drawing is in Timeline.svelte.
//
//   view = { start: seconds at the left edge, pps: pixels per second }

export const MIN_PPS = 0.05;
export const MAX_PPS = 400;
export const EDGE_PX = 7;
export const SNAP_PX = 8;

export const timeToX = (t, view) => (t - view.start) * view.pps;
export const xToTime = (x, view) => view.start + x / view.pps;

/** A view showing the whole clip. */
export function fitView(duration, width) {
  return { start: 0, pps: clampPps(width / Math.max(duration, 1)) };
}
const clampPps = (p) => Math.max(MIN_PPS, Math.min(MAX_PPS, p));

/** Keep the view inside the clip (it may be zoomed out further than the clip is long: it then starts at 0). */
export function clampView(view, duration, width) {
  const pps = clampPps(view.pps);
  const visible = width / pps;
  const start = visible >= duration ? 0 : Math.max(0, Math.min(duration - visible, view.start));
  return { start, pps };
}

/** Zoom by `factor` around the time under pixel `anchorX`, which stays put. */
export function zoomAt(view, factor, anchorX, duration, width) {
  const t = xToTime(anchorX, view);
  const pps = clampPps(view.pps * factor);
  return clampView({ start: t - anchorX / pps, pps }, duration, width);
}

/** Scroll by pixels. */
export const panBy = (view, dx, duration, width) => clampView({ ...view, start: view.start + dx / view.pps }, duration, width);

/** Scroll just enough to show time `t` (follow the playhead). */
export function reveal(view, t, duration, width, margin = 40) {
  const x = timeToX(t, view);
  if (x >= margin && x <= width - margin) return view;
  return clampView({ ...view, start: t - (width / 2) / view.pps }, duration, width);
}

/**
 * What is under pixel `x`: { id, part: 'start' | 'end' | 'body' } or null. Edges win inside
 * EDGE_PX of an item's edge; when two edges compete the nearer one does.
 */
export function hitTest(items, x, view, edgePx = EDGE_PX) {
  let best = null;
  for (const it of items) {
    const x0 = timeToX(it.start, view), x1 = timeToX(it.end, view);
    const d0 = Math.abs(x - x0), d1 = Math.abs(x - x1);
    const w = x1 - x0;
    const reach = Math.min(edgePx, Math.max(2, w / 3)); // a tiny item still has a body to grab
    if (d0 <= reach && (!best || d0 < best.d)) best = { id: it.id, part: 'start', d: d0 };
    if (d1 <= reach && (!best || d1 < best.d)) best = { id: it.id, part: 'end', d: d1 };
  }
  if (best) return { id: best.id, part: best.part };
  const body = items.find((it) => x > timeToX(it.start, view) && x < timeToX(it.end, view));
  return body ? { id: body.id, part: 'body' } : null;
}

/** Snap `t` to the playhead (and the other given times) when within SNAP_PX. */
export function snap(t, targets, view, snapPx = SNAP_PX) {
  let best = t, d = snapPx / view.pps;
  for (const c of targets) if (c != null && Math.abs(c - t) <= d) { best = c; d = Math.abs(c - t); }
  return best;
}

/** One 0-1 value per pixel column from a series sampled at `rate`/s (max of the samples under the column). */
export function columns(series, rate, view, width, scale = 255) {
  const out = new Array(Math.max(0, Math.floor(width)));
  if (!series?.length) return out.fill(0);
  const perPx = rate / view.pps;
  for (let x = 0; x < out.length; x++) {
    const a = Math.floor((view.start * rate) + x * perPx);
    const b = Math.max(a + 1, Math.floor((view.start * rate) + (x + 1) * perPx));
    let m = 0;
    for (let i = Math.max(0, a); i < Math.min(series.length, b); i++) if (series[i] > m) m = series[i];
    out[x] = Math.min(1, m / scale);
  }
  return out;
}

/** "Ruler" ticks: a step in seconds that keeps labels about 80 px apart, and the tick times in view. */
export function ticks(view, width, minGapPx = 80) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((s) => s * view.pps >= minGapPx) ?? steps[steps.length - 1];
  const out = [];
  for (let t = Math.ceil(view.start / step) * step; timeToX(t, view) <= width; t += step) out.push(t);
  return { step, times: out };
}

/**
 * Shift+← / Shift+→: the firework to jump to from playhead `t`. → the item whose start is the next one after t;
 * ← the start of the item t is in (when more than `grace` s into it), else the previous item's start.
 * Hidden items (keep: false) count too: they are still on the timeline. → the item, or null at either end.
 */
export function jumpTarget(items, t, dir, grace = 0.3) {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  if (dir > 0) return sorted.find((i) => i.start > t + 1e-3) ?? null;
  for (let k = sorted.length - 1; k >= 0; k--) {
    if (sorted[k].start < t - grace) return sorted[k];
  }
  return null;
}
