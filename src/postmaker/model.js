// postmaker/model.js — the pure parts of the post maker: the template format,
// photo placement math and fitting a name into its box. No DOM here, so it is
// unit-tested with node (model.test.mjs).

export const FRAME_W = 1080;
export const FRAME_H = 1350;
export const TEMPLATE_VERSION = 1;
export const MAX_ZONES = 2;
export const MAX_ZOOM = 8;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);

// ── Template format ──────────────────────────────────────────────────────────
// {
//   version: 1, id: 'awguri', name: 'Awguri',
//   zones: [{ id, label, x, y, w, h,            // box, in 1080×1350 pixels
//             font, color, align, valign,         // font = a bundled family name
//             case, minSize, maxSize, maxLines, lineHeight,
//             shadow, sample }]
// }

export const ALIGNS  = ['left', 'center', 'right'];
export const VALIGNS = ['top', 'middle', 'bottom'];
export const CASES   = ['none', 'upper', 'lower'];

export function newZone(over = {}) {
  return normalizeZone({
    label: 'Isem', x: 90, y: 1090, w: 900, h: 160,
    font: 'Montserrat ExtraBold', color: '#ffffff', align: 'center', valign: 'middle',
    case: 'upper', minSize: 36, maxSize: 90, maxLines: 2, lineHeight: 1.12,
    shadow: true, sample: 'Maria Grazia Borg',
    ...over,
  }, 0);
}

export function normalizeZone(z = {}, index = 0) {
  const w = clamp(Math.round(num(z.w, 900)), 40, FRAME_W);
  const h = clamp(Math.round(num(z.h, 160)), 40, FRAME_H);
  const minSize = clamp(Math.round(num(z.minSize, 36)), 8, 400);
  const maxSize = clamp(Math.round(num(z.maxSize, 90)), minSize, 400);
  return {
    id: String(z.id || `z${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || `z${index + 1}`,
    label: String(z.label ?? 'Isem').slice(0, 40),
    x: clamp(Math.round(num(z.x, 90)), 0, FRAME_W - w),
    y: clamp(Math.round(num(z.y, 1090)), 0, FRAME_H - h),
    w, h,
    font: String(z.font || 'Montserrat ExtraBold'),
    color: /^#[0-9a-fA-F]{6}$/.test(z.color || '') ? z.color.toLowerCase() : '#ffffff',
    align: ALIGNS.includes(z.align) ? z.align : 'center',
    valign: VALIGNS.includes(z.valign) ? z.valign : 'middle',
    case: CASES.includes(z.case) ? z.case : 'none',
    minSize, maxSize,
    maxLines: clamp(Math.round(num(z.maxLines, 2)), 1, 4),
    lineHeight: clamp(num(z.lineHeight, 1.12), 0.8, 2),
    shadow: z.shadow !== false,
    sample: String(z.sample ?? '').slice(0, 80),
  };
}

/** Clean a template read from disk or built in the editor. Returns null if unusable. */
export function normalizeTemplate(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const rawZones = Array.isArray(raw.zones) ? raw.zones : [];
  const zones = rawZones.slice(0, MAX_ZONES).map(normalizeZone);
  // Keep ids unique inside one template.
  const seen = new Set();
  zones.forEach((z, i) => { while (seen.has(z.id)) z.id = `z${i + 1}_${seen.size}`; seen.add(z.id); });
  if (!zones.length) return null;
  return {
    version: TEMPLATE_VERSION,
    id: String(raw.id),
    name: String(raw.name || raw.id).trim().slice(0, 60),
    zones,
  };
}

const MT_FOLD = { 'ħ': 'h', 'ġ': 'g', 'ċ': 'c', 'ż': 'z', 'Ħ': 'h', 'Ġ': 'g', 'Ċ': 'c', 'Ż': 'z' };

/** "Kondoljanzi ġdid" → "kondoljanzi-gdid"; unique among `taken`. */
export function makeId(name, taken = []) {
  const base = String(name || '')
    .replace(/[ħġċżĦĠĊŻ]/g, ch => MT_FOLD[ch])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'template';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

// ── Text ─────────────────────────────────────────────────────────────────────

/** Trim, collapse spaces and apply the zone's letter case (ħ→Ħ, ġ→Ġ… work natively). */
export function applyCase(text, mode) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (mode === 'upper') return t.toUpperCase();
  if (mode === 'lower') return t.toLowerCase();
  return t;
}

/** A safe file-name piece from a typed name: "Ġużeppi Borg" → "Guzeppi-Borg". */
export function fileSlug(text) {
  return String(text || '')
    .replace(/[ħġċżĦĠĊŻ]/g, ch => { const f = MT_FOLD[ch]; return ch === ch.toUpperCase() ? f.toUpperCase() : f; })
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function wrapGreedy(words, maxW, measure, size) {
  const lines = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (!cur || measure(trial, size) <= maxW) cur = trial;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** For exactly two lines, split where the longer line is shortest (looks centred). */
function balanceTwo(words, measure, size) {
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const widest = Math.max(measure(a, size), measure(b, size));
    if (!best || widest < best.widest) best = { widest, lines: [a, b] };
  }
  return best ? best.lines : [words.join(' ')];
}

/**
 * Pick the biggest font size (maxSize → minSize) at which the text fits the
 * zone in at most `maxLines` lines. `measure(text, sizePx)` returns the width in
 * px. If nothing fits, returns the smallest size with `fits: false`.
 */
export function fitText(text, zone, measure) {
  const shown = applyCase(text, zone.case);
  if (!shown) return { text: '', lines: [], size: zone.maxSize, fits: true };
  const words = shown.split(' ');
  let last = null;
  for (let size = zone.maxSize; size >= zone.minSize; size--) {
    let lines = wrapGreedy(words, zone.w, measure, size);
    if (lines.length === 2) lines = balanceTwo(words, measure, size);
    const widest = Math.max(...lines.map(l => measure(l, size)));
    const height = lines.length * size * zone.lineHeight;
    last = { text: shown, lines, size };
    if (lines.length <= zone.maxLines && widest <= zone.w && height <= zone.h) return { ...last, fits: true };
  }
  return { ...last, fits: false };
}

// ── Photo placement ──────────────────────────────────────────────────────────
// The photo state is { zoom, cx, cy }: zoom 1 = just covers the frame, and
// (cx, cy) is where the photo's centre sits in frame pixels.

export function coverScale(imgW, imgH) {
  return Math.max(FRAME_W / imgW, FRAME_H / imgH);
}

export function initialPhoto() {
  return { zoom: 1, cx: FRAME_W / 2, cy: FRAME_H / 2 };
}

export function photoRect(imgW, imgH, st) {
  const scale = coverScale(imgW, imgH) * st.zoom;
  const w = imgW * scale, h = imgH * scale;
  return { scale, w, h, left: st.cx - w / 2, top: st.cy - h / 2 };
}

/** Keep the photo covering the whole frame (no empty strips) and zoom in range. */
export function clampPhoto(imgW, imgH, st) {
  const zoom = clamp(st.zoom, 1, MAX_ZOOM);
  const scale = coverScale(imgW, imgH) * zoom;
  const w = imgW * scale, h = imgH * scale;
  const cx = clamp(st.cx, FRAME_W - w / 2, w / 2);
  const cy = clamp(st.cy, FRAME_H - h / 2, h / 2);
  return { zoom, cx, cy };
}

export function panPhoto(imgW, imgH, st, dx, dy) {
  return clampPhoto(imgW, imgH, { ...st, cx: st.cx + dx, cy: st.cy + dy });
}

/** Change zoom while the point under (fx, fy) — in frame pixels — stays put. */
export function zoomPhotoAt(imgW, imgH, st, newZoom, fx = FRAME_W / 2, fy = FRAME_H / 2) {
  const z = clamp(newZoom, 1, MAX_ZOOM);
  const before = photoRect(imgW, imgH, st);
  const ix = (fx - before.left) / before.scale, iy = (fy - before.top) / before.scale;
  const scale = coverScale(imgW, imgH) * z;
  const left = fx - ix * scale, top = fy - iy * scale;
  return clampPhoto(imgW, imgH, { zoom: z, cx: left + (imgW * scale) / 2, cy: top + (imgH * scale) / 2 });
}

/**
 * How badly the photo is stretched: 'ok' when every frame pixel has a real photo
 * pixel behind it, 'soft' when it is enlarged up to 1.5×, 'bad' beyond that.
 */
export function resolutionLevel(imgW, imgH, st) {
  const scale = photoRect(imgW, imgH, st).scale;
  if (scale <= 1) return 'ok';
  return scale <= 1.5 ? 'soft' : 'bad';
}
