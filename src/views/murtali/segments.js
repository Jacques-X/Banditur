// Murtali: from the measured sound curves to "fireworks items". Pure.
//
// The sidecar only measures (rms / transient / low per 0.1 s, 0-255). Everything here decides, so a
// slider or the distance setting re-segments instantly without another analysis.

export const RATE = 10; // curve values per second

/** Seconds of lead-in before the first bang: the sound reaches the camera late (the shell's climb is quiet). */
export const DISTANCE = { qrib: 1.5, medju: 3, bogħod: 4.5 };
export const DEFAULTS = { sensitivity: 0.5, distance: 'medju', mergeGap: 2.5, minLen: 1, postRoll: 1 };

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** The p-quantile (0-1) of an array, by sorting a copy. */
function quantile(values, p) {
  if (!values.length) return 0;
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
}

/**
 * One 0-1 score per curve value. Mostly `transient` (bangs and crackle are impulsive, music, crowd
 * and traffic are loud but not), weighted up by `low` (bursts and launch thumps are bass-heavy,
 * voices are not), minus a baseline: a rolling low percentile of the clip, so a noisy crowd raises
 * the floor rather than the score.
 */
export function activity(curves, { window = 600, step = 10, floorQuantile = 0.2, decay = 0.8 } = {}) {
  const tr = curves?.transient || [];
  const low = curves?.low || [];
  const n = tr.length;
  const raw = new Float64Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = (tr[i] || 0) / 255;
    const l = (low[i] || 0) / 255;
    const v = Math.min(1, t * (0.7 + 0.6 * l));
    // a short tail bridges the gaps inside crackle
    prev = Math.max(v, prev * decay);
    raw[i] = prev;
  }
  return withoutBaseline(raw, { window, step, floorQuantile });
}

/** `raw` (0-1) minus a rolling low percentile of itself (computed every `step` values, interpolated), rescaled to 0-1. */
function withoutBaseline(raw, { window = 600, step = 10, floorQuantile = 0.2 } = {}) {
  const n = raw.length;
  const knots = [];
  for (let i = 0; i < n; i += step) {
    const lo = Math.max(0, i - window), hi = Math.min(n, i + window + 1);
    knots.push(quantile(raw.subarray(lo, hi), floorQuantile));
  }
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = i / step, k0 = Math.floor(k), k1 = Math.min(knots.length - 1, k0 + 1);
    const base = lerp(knots[k0], knots[k1], k - k0);
    out[i] = base >= 0.95 ? 0 : clamp01((raw[i] - base) / (1 - base));
  }
  return out;
}

/** True when the clip has a usable light curve (a video whose picture could be read). */
export const hasLight = (curves) => Array.isArray(curves?.light) && curves.light.length > 0;

/** One 0-1 score per curve value for how much the picture brightened (a burst lights the sky; wind does not). */
export function lightActivity(curves, opts = {}) {
  const raw = Float64Array.from((curves?.light || []).map((v) => clamp01((v || 0) / 255)));
  return withoutBaseline(raw, opts);
}

/** Light needed at a place for the sound there to count: lower with higher sensitivity. */
export const lightThreshold = (sensitivity) => lerp(0.45, 0.12, clamp01(sensitivity));

/**
 * Sound AND light. Wind on the microphone is loud and impulsive but lights nothing; a burst lights the sky
 * and then, a second or three later (the distance), is heard. So a sound value counts in proportion to the
 * brightest light seen in the seconds before it (and a moment after, for a frame or two of slack): the window
 * is as long as the lead-in for the chosen distance, plus a second. Returns `score` unchanged when there is
 * no usable light curve or `useLight` is false (daytime shows, a camera that can't be read).
 */
export function withLight(score, curves, { sensitivity = DEFAULTS.sensitivity, distance = DEFAULTS.distance, useLight = true, rate = RATE } = {}) {
  if (!useLight || !hasLight(curves)) return score;
  const light = lightActivity(curves);
  const n = score.length;
  const back = Math.round(((DISTANCE[distance] ?? DISTANCE.medju) + 1) * rate);
  const fwd = Math.round(0.5 * rate);
  const need = lightThreshold(sensitivity);
  // max of light over [i - back, i + fwd], by a monotonic deque: O(n)
  const out = new Array(n);
  const dq = [];
  let next = 0;
  for (let i = 0; i < n; i++) {
    const hi = Math.min(light.length - 1, i + fwd);
    for (; next <= hi; next++) {
      while (dq.length && light[dq[dq.length - 1]] <= light[next]) dq.pop();
      dq.push(next);
    }
    while (dq.length && dq[0] < i - back) dq.shift();
    const near = dq.length ? light[dq[0]] : 0;
    out[i] = score[i] * clamp01(near / need);
  }
  return out;
}

/** Hysteresis thresholds from the slider: higher sensitivity = lower thresholds. */
export function thresholds(sensitivity) {
  const on = lerp(0.6, 0.1, clamp01(sensitivity));
  return { on, off: on * 0.5 };
}

/**
 * score → [{ start, end, peak, peakAt }] in seconds, sorted, not overlapping.
 * Runs of sound (hysteresis) → gaps shorter than mergeGap joined → runs shorter than minLen dropped
 * → padded (preRoll before, postRoll after) → clamped to the clip → overlapping ones joined.
 */
export function findSegments(score, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rate = o.rate || RATE;
  const preRoll = o.preRoll ?? DISTANCE[o.distance] ?? DISTANCE.medju;
  const duration = o.duration ?? score.length / rate;
  const { on, off } = thresholds(o.sensitivity);

  const runs = [];
  let from = -1;
  for (let i = 0; i < score.length; i++) {
    if (from < 0) { if (score[i] >= on) from = i; }
    else if (score[i] < off) { runs.push([from, i]); from = -1; }
  }
  if (from >= 0) runs.push([from, score.length]);

  const gap = Math.round(o.mergeGap * rate);
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < gap) last[1] = r[1];
    else merged.push([...r]);
  }

  const padded = [];
  for (const [a, b] of merged) {
    if ((b - a) / rate < o.minLen) continue;
    const start = Math.max(0, a / rate - preRoll);
    const end = Math.min(duration, b / rate + o.postRoll);
    if (end <= start) continue;
    const last = padded[padded.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else padded.push({ start, end });
  }
  return padded.map((s) => {
    const i0 = Math.max(0, Math.floor(s.start * rate)), i1 = Math.min(score.length, Math.ceil(s.end * rate));
    let peak = 0, at = i0;
    for (let i = i0; i < i1; i++) if (score[i] > peak) { peak = score[i]; at = i; }
    return { start: round3(s.start), end: round3(s.end), peak: round3(peak), peakAt: round3((at + 0.5) / rate) };
  });
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/** Convenience: curves + settings → segments (sound, and light unless `useLight` is false). */
export function detect(curves, opts = {}) {
  const duration = opts.duration ?? (curves?.transient?.length || 0) / (opts.rate || RATE);
  return findSegments(withLight(activity(curves), curves, opts), { ...opts, duration });
}

let counter = 0;
/** An id not used by `items`. */
export function newId(items) {
  let max = counter;
  for (const it of items) { const m = /^i(\d+)$/.exec(it.id || ''); if (m) max = Math.max(max, +m[1]); }
  counter = max + 1;
  return `i${counter}`;
}

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Re-run detection without losing manual work. Items the user has touched (`auto: false`) stay
 * exactly as they are; the other (automatic) items of this source are replaced by `segs`, minus
 * the time the kept items already cover. A new segment that mostly overlaps an old automatic item
 * takes over its id, crop and keep flag, so a reel selection survives a slider move.
 * Items of other sources are untouched. Returns the new item list, sorted by source then start.
 */
export function redetect(oldItems, segs, source = 0, { minLen = DEFAULTS.minLen } = {}) {
  const others = oldItems.filter((it) => it.source !== source);
  const mine = oldItems.filter((it) => it.source === source);
  const kept = mine.filter((it) => it.auto === false);
  const oldAuto = mine.filter((it) => it.auto !== false);
  const taken = new Set();
  const made = [];
  for (const seg of segs) {
    // cut out the kept items
    let pieces = [[seg.start, seg.end]];
    for (const k of kept) {
      pieces = pieces.flatMap(([a, b]) => {
        if (k.end <= a || k.start >= b) return [[a, b]];
        const out = [];
        if (k.start - a > 0) out.push([a, k.start]);
        if (b - k.end > 0) out.push([k.end, b]);
        return out;
      });
    }
    for (const [a, b] of pieces) {
      if (b - a < minLen) continue;
      const src = oldAuto.filter((o) => !taken.has(o.id)).map((o) => ({ o, ov: overlap(a, b, o.start, o.end) }))
        .filter((x) => x.ov >= 0.5 * (b - a)).sort((x, y) => y.ov - x.ov)[0]?.o;
      if (src) taken.add(src.id);
      made.push({
        id: src ? src.id : newId([...oldItems, ...made]),
        source, start: a, end: b, auto: true,
        keep: src ? src.keep !== false : true,
        crop: src?.crop ?? null,
        label: src?.label ?? '',
        peak: seg.peak, peakAt: seg.peakAt,
      });
    }
  }
  return [...others, ...kept, ...made].sort((x, y) => x.source - y.source || x.start - y.start);
}
