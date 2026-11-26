// Murtali: the 6-7 item Reel, the 9:16 window, the export jobs and the checks before a Skeda handoff. Pure.

import { FW } from '../../strings.js';
import { lutJob } from './lut.js';

export const REEL_MAX = 7;
export const MAX_FPS = 60;

export const duration = (it) => Math.max(0, it.end - it.start);
export const totalDuration = (items) => items.reduce((t, i) => t + duration(i), 0);
/** Items in time order across sources. */
export const inTimeOrder = (items) => [...items].sort((a, b) => a.source - b.source || a.start - b.start);
/** The reel's items, in reel order. */
export const reelItems = (doc) => doc.reel.map((id) => doc.items.find((i) => i.id === id)).filter(Boolean);

/** The `n` kept items with the highest peak, in time order. */
export function bestN(items, n = REEL_MAX) {
  return inTimeOrder(
    items.filter((i) => i.keep !== false).sort((a, b) => (b.peak ?? 0) - (a.peak ?? 0) || a.start - b.start).slice(0, n),
  );
}

/**
 * The 9:16 window of a source frame, in pixels: full height, `x` = its centre (0-1, default 0.5),
 * clamped to the frame. A source that is already 9:16 or narrower is used whole (the renderer pads it).
 * Must match `crop_window()` in sidecar/fireworks_render.py.
 */
export function cropWindow(x, srcW, srcH) {
  if (srcW * 16 <= srcH * 9 * 1.01) return { x: 0, w: srcW, h: srcH };
  let w = Math.floor((srcH * 9) / 16);
  w -= w % 2;
  w = Math.max(2, Math.min(w, srcW));
  const centre = clampNum(x ?? 0.5, 0, 1);
  const left = Math.floor(centre * srcW - w / 2 + 0.5);
  return { x: Math.max(0, Math.min(left, srcW - w)), w, h: srcH };
}
const clampNum = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : 0.5);

/** The centre (0-1) a window dragged to pixel `left` has. */
export const centreOf = (left, w, srcW) => (srcW > 0 ? Math.max(0, Math.min(1, (left + w / 2) / srcW)) : 0.5);

/** Has the user aimed this item's window? */
export const aimed = (it) => it.crop?.x != null;
export const unaimed = (doc) => reelItems(doc).filter((i) => !aimed(i));

/** m:ss (or h:mm:ss) */
export function clock(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (v) => String(v).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

/** The job for the `render_fireworks` command. `project` = { sources: [{ path }], items, reel }. */
export function exportJob(kind, project, { output, size = 'auto', lut = null } = {}) {
  const sources = project.sources;
  const pick = kind === 'reel' ? reelItems(project) : inTimeOrder(project.items.filter((i) => i.keep !== false));
  return {
    kind, output, size, lut: lutJob(lut),
    items: pick.map((i) => ({ path: sources[i.source].path, start: i.start, end: i.end, crop: kind === 'reel' ? (i.crop ?? null) : null })),
  };
}

/** "12-il murtal · 4:31 minn 38:10 · Reel: 7 · 1:12" */
export function summary(project) {
  const kept = project.items.filter((i) => i.keep !== false);
  const total = project.sources.reduce((t, s) => t + (s.duration || 0), 0);
  return FW.summary(kept.length, clock(totalDuration(kept)), clock(total), project.reel.length, clock(totalDuration(reelItems(project))));
}
