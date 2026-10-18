// Subtitle looks, layered presets and ASS export.
//
// A look is flat settings in four layers:
//   look      — font, colours, outline / glow / box, text case, alignment
//   layout    — position, margins, characters per line, safe areas
//   animation — entry (how a cue appears) + word effect (how the spoken word
//               is shown) + emphasis (how keywords are shown)
// A preset is just a named set of those values, plus `words`: how many words
// per cue it's designed for (the editor offers to re-split to match). The same timing and layout
// math (wordSlots, frameState, layoutFor) drives both the live preview
// (preview.js) and the .ass file libass burns in, so they match.

import { wrapLines } from './model.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const pct = v => Math.round(v * 100);

// ── Fonts ────────────────────────────────────────────────────────────────────
// Bundled fonts live in public/fonts (served to the webview at /fonts/, and
// shipped to the renderer as Resources/fonts). `w` ≈ average character width
// as a fraction of the font size, used to keep lines inside the frame.
// `em` = CSS em per ASS font-size unit: libass sizes a font by its OS/2
// usWinAscent + usWinDescent, so em = unitsPerEm / (winAscent + winDescent)
// (measured against libass renders; see scripts/build-fonts.py).

export const FONTS = [
  // Montserrat only, in four weights (same family, so they mix cleanly).
  { family: 'Montserrat SemiBold', file: 'MontserratSemiBold.ttf', w: 0.62, em: 0.64, bundled: true },
  { family: 'Montserrat Bold', file: 'MontserratBold.ttf', w: 0.63, em: 0.64, bundled: true },
  { family: 'Montserrat ExtraBold', file: 'MontserratExtraBold.ttf', w: 0.64, em: 0.64, bundled: true },
  { family: 'Montserrat Black', file: 'MontserratBlack.ttf', w: 0.65, em: 0.64, bundled: true },
];
const FONT_BY_FAMILY = new Map(FONTS.map(f => [f.family, f]));
export const fontInfo = family => FONT_BY_FAMILY.get(family) || { family, w: 0.6, em: 0.82 };

/** @font-face rules for the bundled fonts (inject once into the page). */
export function fontFaceCss(base = '/fonts/') {
  return FONTS.filter(f => f.bundled)
    .map(f => `@font-face{font-family:'${f.family}';src:url('${base}${f.file}') format('truetype');font-display:block;}`)
    .join('\n');
}

// ── Layers ───────────────────────────────────────────────────────────────────

export const ENTRIES = [
  { id: 'none', name: 'Xejn' },
  { id: 'fade', name: 'Fade' },
  { id: 'slide', name: 'Slide' },
  { id: 'pop', name: 'Pop' },
];
export const WORD_EFFECTS = [
  { id: 'none', name: 'Xejn' },
  { id: 'karaoke', name: 'Karaoke' },
  { id: 'active', name: 'Kelma bil-kulur' },
  { id: 'pill', name: 'Kaxxa wara l-kelma' },
  { id: 'pop', name: 'Pop' },
  { id: 'bounce', name: 'Bounce' },
  { id: 'reveal', name: 'Kelma kelma' },
  { id: 'single', name: 'Kelma waħda kull darba' },
];
export const EMPHASES = [
  { id: 'color', name: 'Kulur' },
  { id: 'scale', name: 'Akbar' },
  { id: 'both', name: 'Kulur u akbar' },
  { id: 'none', name: 'Xejn' },
];
const ids = list => new Set(list.map(x => x.id));
const ENTRY_IDS = ids(ENTRIES);
const WORD_IDS = ids(WORD_EFFECTS);
const EMPHASIS_IDS = ids(EMPHASES);

export const DEFAULT_LOOK = {
  preset: 'deheb',
  // look
  font: 'Montserrat Bold',
  bold: false,             // faux bold on top of the font's own weight
  sizePct: 6,              // % of the video's shorter side
  color: '#FFFFFF',
  accent: '#FFD60A',       // karaoke fill, active word, keywords, pill
  pillText: '#16181D',     // text colour on the pill
  outlineColor: '#000000',
  outlinePct: 8,           // % of font size
  shadow: true,
  glow: false,
  box: false,              // box behind each line instead of an outline
  boxColor: '#000000',
  boxOpacity: 0.65,
  textCase: 'normal',      // normal | upper | lower
  align: 'center',         // center | left
  // layout
  position: 'bottom',      // bottom | lower | middle | top
  marginPct: 8,            // % of video height
  maxChars: 32,            // per line (also capped by what fits the frame)
  maxLines: 2,             // captions are built to fit this many lines (1 or 2)
  safeArea: true,          // keep clear of Instagram/Facebook overlays on reels
  // animation
  entry: 'none',
  word: 'none',
  emphasis: 'color',
  slant: false,            // lean the text (used by the big line)
};

export const DEFAULT_PRESET = 'deheb';
export const PRESETS = [
  {
    // From an example reel: small, clean, one line; white text, the spoken word in warm gold.
    id: 'deheb', words: 3, name: 'Deheb', hint: 'L-istil ewlieni: linja waħda, test abjad, il-kelma mitkellma bid-deheb',
    look: { font: 'Montserrat Bold', sizePct: 5.2, color: '#FFFFFF', accent: '#E2AD72', outlinePct: 0, shadow: true, position: 'bottom', maxChars: 20, maxLines: 1, entry: 'none', word: 'active', emphasis: 'none' },
  },
  {
    id: 'pillola', words: 4, name: 'Pillola', hint: 'Kaxxa bil-kulur li ssegwi kull kelma mitkellma',
    look: { font: 'Montserrat ExtraBold', sizePct: 6.2, outlinePct: 6, shadow: false, position: 'lower', maxChars: 22, entry: 'fade', word: 'pill', emphasis: 'color', accent: '#FFD60A', pillText: '#16181D' },
  },
  {
    id: 'klassiku', words: 6, name: 'Klassiku', hint: 'Sempliċi u ċar, mingħajr animazzjoni',
    look: { font: 'Montserrat Bold', sizePct: 5.6, outlinePct: 8, shadow: true, position: 'bottom', maxChars: 32, entry: 'none', word: 'none', emphasis: 'color' },
  },
];
export const PRESET_BY_ID = new Map(PRESETS.map(p => [p.id, p]));

// Presets from the first version of the editor → the layers they used.
const LEGACY = {
  classic: { entry: 'none', word: 'none' },
  fade: { entry: 'fade', word: 'none' },
  slide: { entry: 'slide', word: 'none' },
  karaoke: { word: 'karaoke' },
  active: { word: 'active' },
  pop: { word: 'pop' },
  reveal: { word: 'reveal' },
  single: { word: 'single' },
  keyword: { word: 'none', emphasis: 'both' },
};

/** A look built from a preset (preset values over the defaults). */
export function lookFromPreset(id, keep = {}) {
  const p = PRESET_BY_ID.get(id) || PRESETS[0];
  return normalizeLook({ ...DEFAULT_LOOK, ...p.look, ...keep, preset: p.id });
}

export function normalizeLook(look = {}) {
  let l = { ...DEFAULT_LOOK, ...look };
  if (LEGACY[l.preset]) { l = { ...l, ...LEGACY[l.preset], preset: 'custom' }; }
  if (look.uppercase === true && !look.textCase) l.textCase = 'upper';
  delete l.uppercase;
  if (!FONT_BY_FAMILY.has(l.font)) l.font = DEFAULT_LOOK.font;
  l.sizePct = clamp(Number(l.sizePct) || DEFAULT_LOOK.sizePct, 2, 20);
  l.outlinePct = clamp(Number(l.outlinePct) || 0, 0, 25);
  l.marginPct = clamp(Number(l.marginPct) || 0, 0, 40);
  l.maxChars = clamp(Math.round(Number(l.maxChars) || DEFAULT_LOOK.maxChars), 8, 80);
  l.maxLines = Number(l.maxLines) === 1 ? 1 : 2;
  l.boxOpacity = clamp(Number(l.boxOpacity), 0, 1);
  if (!['bottom', 'lower', 'middle', 'top'].includes(l.position)) l.position = 'bottom';
  if (!['center', 'left'].includes(l.align)) l.align = 'center';
  if (!['normal', 'upper', 'lower'].includes(l.textCase)) l.textCase = 'normal';
  if (!ENTRY_IDS.has(l.entry)) l.entry = 'none';
  if (!WORD_IDS.has(l.word)) l.word = 'none';
  if (!EMPHASIS_IDS.has(l.emphasis)) l.emphasis = 'color';
  for (const k of ['color', 'accent', 'pillText', 'outlineColor', 'boxColor']) {
    if (!/^#[0-9a-f]{6}$/i.test(l[k])) l[k] = DEFAULT_LOOK[k];
  }
  for (const k of ['bold', 'shadow', 'glow', 'box', 'safeArea', 'slant']) l[k] = !!l[k];
  if (!l.preset || (l.preset !== 'custom' && !String(l.preset).startsWith('saved:') && !PRESET_BY_ID.has(l.preset))) l.preset = 'custom';
  return l;
}

/**
 * A stored look (last used, or saved with a session). Looks made from a preset
 * that no longer exists start again from the default preset.
 */
export function restoreLook(raw) {
  const id = raw?.preset;
  const known = id === 'custom' || String(id || '').startsWith('saved:') || PRESET_BY_ID.has(id);
  return raw && known ? normalizeLook(raw) : lookFromPreset(DEFAULT_PRESET);
}

/** Per-cue style id for the "big line": a short punchy phrase, large and slanted mid-frame. */
export const PUNCH = 'punch';
const punchLook = look => ({
  ...look,
  textCase: 'upper', position: 'middle', align: 'center',
  sizePct: Math.min(20, look.sizePct * 1.9), maxChars: 14, maxLines: 2,
  slant: true, entry: 'pop', word: 'none', emphasis: 'none',
  color: '#FFFFFF', outlinePct: Math.max(look.outlinePct, 4), shadow: true,
});

/**
 * The look used for one cue: a per-cue preset overrides only the animation layers;
 * the big line (PUNCH) also changes size, position and case.
 */
export function effectiveLook(cue, look) {
  const id = cue?.style;
  if (!id) return look;
  if (id === PUNCH) return normalizeLook(punchLook(look));
  if (PRESET_BY_ID.has(id)) {
    const p = PRESET_BY_ID.get(id).look;
    return { ...look, entry: p.entry ?? look.entry, word: p.word ?? look.word, emphasis: p.emphasis ?? look.emphasis };
  }
  if (LEGACY[id]) return { ...look, ...LEGACY[id] };
  return look;
}

// ── Format, safe areas and layout ───────────────────────────────────────────

/** 'reel' (9:16-ish), 'square' or 'wide' from the video size. */
export function formatOf(width, height) {
  const r = width / Math.max(1, height);
  return r < 0.9 ? 'reel' : r < 1.2 ? 'square' : 'wide';
}

// Fractions of the frame to keep clear (Instagram/Facebook draw buttons and the
// caption over roughly the bottom fifth and the right edge of a reel).
const SAFE = {
  reel: { top: 0.12, bottom: 0.2, side: 0.08, lower: 0.3 },
  square: { top: 0.06, bottom: 0.1, side: 0.06, lower: 0.22 },
  wide: { top: 0.05, bottom: 0.06, side: 0.05, lower: 0.16 },
};
export const safeArea = (width, height) => SAFE[formatOf(width, height)];

// Text is sized from the frame's shorter side. A reel is watched full-screen on
// a phone, so the same sizePct would read small there: scale it up per format.
export const FORMAT_SCALE = { reel: 1.3, square: 1.1, wide: 1 };

/**
 * Pixel layout for a frame of width × height. Shared by preview and export.
 *   fontSize, outline, shadow, blur, pillPad, marginV, marginH, maxChars, anchor {x, y}, an
 */
export function layoutFor(look, width, height) {
  const ref = Math.min(width, height);
  const fontSize = Math.max(8, Math.round((ref * look.sizePct * FORMAT_SCALE[formatOf(width, height)]) / 100));
  const outline = look.box ? Math.round(fontSize * 0.22) : Math.round((fontSize * look.outlinePct) / 100);
  const shadow = look.shadow && !look.box ? Math.max(1, Math.round(fontSize * 0.05)) : 0;
  const blur = look.glow ? Math.max(1, Math.round(outline * 0.8 + fontSize * 0.04)) : 0;
  const pillPad = Math.max(2, Math.round(fontSize * 0.16));
  const fmt = safeArea(width, height);
  const safe = look.safeArea ? fmt : { top: 0, bottom: 0, side: 0.03, lower: fmt.lower };
  const marginH = Math.round(width * Math.max(0.04, safe.side));
  let marginV = Math.round((height * look.marginPct) / 100);
  if (look.position === 'bottom') marginV = Math.max(marginV, Math.round(height * safe.bottom));
  if (look.position === 'top') marginV = Math.max(marginV, Math.round(height * safe.top));
  if (look.position === 'lower') marginV = Math.max(Math.round(height * safe.lower), Math.round(height * safe.bottom));
  // Characters that fit across the frame at this size (uppercase is wider).
  const charW = fontSize * fontInfo(look.font).w * (look.textCase === 'upper' ? 1.12 : 1);
  const fit = Math.max(6, Math.floor((width - 2 * marginH) / charW));
  const maxChars = Math.min(look.maxChars, fit);
  const left = look.align === 'left';
  const y = look.position === 'top' ? marginV : look.position === 'middle' ? Math.round(height / 2) : height - marginV;
  const an = (left ? 1 : 2) + (look.position === 'top' ? 6 : look.position === 'middle' ? 3 : 0);
  const x = left ? marginH : Math.round(width / 2);
  return { fontSize, outline, shadow, blur, pillPad, marginV, marginH, maxChars, anchor: { x, y }, an };
}

/**
 * How many characters a cue may hold so it still fits on two lines at this
 * size (a little under 2 × line length, since words don't split evenly).
 */
export function cueCharBudget(look, width, height) {
  const lines = look.maxLines === 1 ? 1 : 1.8;
  return Math.max(8, Math.floor(layoutFor(look, width, height).maxChars * lines));
}

export function displayText(text, look) {
  if (look.textCase === 'upper') return text.toLocaleUpperCase('mt');
  if (look.textCase === 'lower') return text.toLocaleLowerCase('mt');
  return text;
}

// ── Shared timing math ───────────────────────────────────────────────────────

export const FADE_MS = 150;
export const SLIDE_MS = 220;
export const SLIDE_FADE_IN_MS = 180;
export const SLIDE_FADE_OUT_MS = 120;
export const POP_ENTRY_FADE_MS = 80;
export const KEYWORD_SCALE = 1.25;
export const SINGLE_SIZE = 1.5;

// [ms, scale] keyframes, linear between them (like ASS \t)
export const POP_KEYS = [[0, 0.4], [90, 1.12], [170, 1]];
export const BOUNCE_KEYS = [[0, 1], [80, 1.18], [180, 1]];
export const SINGLE_KEYS = [[0, 0.7], [100, 1.05], [160, 1]];
export const ENTRY_POP_KEYS = [[0, 0.85], [100, 1.03], [160, 1]];

export function keyScale(keys, ms) {
  if (ms <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (ms <= t1) return v0 + (v1 - v0) * ((ms - t0) / (t1 - t0));
  }
  return keys[keys.length - 1][1];
}

/**
 * Word timing inside a cue, clamped to the cue and made monotonic.
 *   b[i]    — when word i becomes "current" (b[0] = cue start)
 *   fill[i] — [start, end] of word i's karaoke fill
 * Rounded to centiseconds, exactly as written to ASS.
 */
export function wordSlots(cue) {
  const cs = s => Math.round(s * 100) / 100;
  const start = cs(cue.start);
  const end = Math.max(cs(cue.end), start + 0.01);
  const b = [];
  const fill = [];
  let prevB = start;
  let prevFillEnd = start;
  cue.words.forEach((w, i) => {
    const ws = clamp(cs(w.start), start, end);
    const we = clamp(cs(w.end), ws, end);
    const bi = i === 0 ? start : Math.max(prevB, ws);
    b.push(bi);
    prevB = bi;
    const fs = Math.max(ws, prevFillEnd);
    const fe = Math.max(fs + 0.01, we);
    fill.push([fs, Math.min(fe, end)]);
    prevFillEnd = Math.min(fe, end);
  });
  return { start, end, b, fill };
}

const kwScale = (look, w) => (w.kw && (look.emphasis === 'scale' || look.emphasis === 'both') ? KEYWORD_SCALE : 1);
const kwColor = (look, w) => w.kw && (look.emphasis === 'color' || look.emphasis === 'both');

/**
 * Everything the preview needs to draw a cue at time t.
 *   { opacity, dy (× font size), lineScale, single: index|null, cur,
 *     words: [{ visible, color: 'base'|'accent'|'pillText', pill, scale, fill }] }
 */
export function frameState(cue, lookIn, t) {
  const look = effectiveLook(cue, lookIn);
  const { start, end, b, fill } = wordSlots(cue);
  const ms = (t - start) * 1000;
  const toEnd = (end - t) * 1000;
  const dur = (end - start) * 1000;
  let cur = 0;
  for (let i = 0; i < b.length; i++) if (b[i] <= t) cur = i;

  let opacity = 1;
  let dy = 0;
  let lineScale = 1;
  if (look.entry === 'fade') {
    const f = Math.min(FADE_MS, dur / 3);
    opacity = Math.min(1, ms / f, toEnd / f);
  } else if (look.entry === 'slide') {
    opacity = Math.min(1, ms / Math.min(SLIDE_FADE_IN_MS, dur / 3), toEnd / Math.min(SLIDE_FADE_OUT_MS, dur / 3));
    dy = 0.6 * (1 - Math.min(1, ms / Math.min(SLIDE_MS, dur)));
  } else if (look.entry === 'pop') {
    const f = Math.min(POP_ENTRY_FADE_MS, dur / 3);
    opacity = Math.min(1, ms / f, toEnd / f);
    lineScale = keyScale(ENTRY_POP_KEYS, ms);
  }
  opacity = clamp(opacity, 0, 1);

  const words = cue.words.map((w, i) => {
    const s = { visible: true, color: kwColor(look, w) ? 'accent' : 'base', pill: false, scale: kwScale(look, w), fill: null };
    switch (look.word) {
      case 'karaoke': {
        const [fs, fe] = fill[i];
        s.fill = clamp((t - fs) / (fe - fs), 0, 1);
        s.color = 'base';
        break;
      }
      case 'active':
        if (i === cur) s.color = 'accent';
        break;
      case 'pill':
        if (i === cur) { s.pill = true; s.color = 'pillText'; }
        break;
      case 'reveal':
        s.visible = i <= cur;
        break;
      case 'pop':
        s.visible = i <= cur;
        if (i === cur) s.scale *= keyScale(POP_KEYS, (t - b[i]) * 1000);
        break;
      case 'bounce':
        if (i === cur) s.scale *= keyScale(BOUNCE_KEYS, (t - b[i]) * 1000);
        break;
      case 'single':
        s.visible = i === cur;
        if (i === cur) s.scale = keyScale(SINGLE_KEYS, (t - b[i]) * 1000);
        break;
      default:
        break;
    }
    return s;
  });
  return { opacity, dy, lineScale, cur, single: look.word === 'single' ? cur : null, words, look };
}

// ── ASS export ───────────────────────────────────────────────────────────────

/** "#RRGGBB" + alpha (0 = opaque, 255 = clear) → ASS "&HAABBGGRR" */
export function assColor(hex, alpha = 0) {
  const h = hex.replace('#', '');
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  const a = Math.round(clamp(alpha, 0, 255)).toString(16).padStart(2, '0');
  return `&H${a}${b}${g}${r}`.toUpperCase();
}
/** Inline colour override value (no alpha): "&HBBGGRR&" */
const inlineColor = hex => `${assColor(hex).slice(0, 2)}${assColor(hex).slice(4)}&`;

export function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Text is placed inside an ASS event: braces start override blocks, so swap them. */
export function assEscape(text) {
  return String(text).replace(/\\/g, '/').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, ' ');
}

const scaleChain = (keys, k = 1) => {
  const [[, s0], ...rest] = keys;
  let prev = keys[0][0];
  let out = `\\fscx${pct(s0 * k)}\\fscy${pct(s0 * k)}`;
  for (const [t, s] of rest) {
    out += `\\t(${prev},${t},\\fscx${pct(s * k)}\\fscy${pct(s * k)})`;
    prev = t;
  }
  return out;
};
const staticScale = k => `\\fscx${pct(k)}\\fscy${pct(k)}`;

/**
 * Build a complete .ass subtitle file.
 * @param cues  Cue[] from model.js
 * @param look  look settings (normalised here)
 * @param size  { width, height } of the target video (PlayRes)
 */
export function buildAss(cues, lookIn, { width = 1920, height = 1080, title = 'Banditur', endCard = null } = {}) {
  const globalLook = normalizeLook(lookIn);
  const L = layoutFor(globalLook, width, height);
  const bold = globalLook.bold ? -1 : 0;
  const font = globalLook.font.replace(/,/g, ' ');
  const style = (name, primary, outlineCol, backCol, borderStyle, outline, shadow) =>
    `Style: ${name},${font},${L.fontSize},${primary},${primary},${outlineCol},${backCol},${bold},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${L.an},${L.marginH},${L.marginH},${L.marginV},1`;
  const boxCol = assColor(globalLook.boxColor, (1 - globalLook.boxOpacity) * 255);

  const out = [
    '[Script Info]',
    `Title: ${assEscape(title)}`,
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    globalLook.box
      ? style('Default', assColor(globalLook.color), boxCol, boxCol, 3, L.outline, 0)
      : style('Default', assColor(globalLook.color), assColor(globalLook.outlineColor), assColor('#000000', 110), 1, L.outline, L.shadow),
    // The pill is drawn on a layer underneath: same text, only the current
    // word's box visible (libass gives each differently-styled run its own box).
    style('Pill', assColor('#FFFFFF', 255), assColor(globalLook.accent), assColor(globalLook.accent), 3, L.pillPad, 0),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const dialogue = (layer, styleName, s, e, text) => {
    if (e - s < 0.01) return;
    out.push(`Dialogue: ${layer},${assTime(s)},${assTime(e)},${styleName},,0,0,0,,${text}`);
  };

  for (const cue of cues) {
    if (!cue.words.length) continue;
    const look = effectiveLook(cue, globalLook);
    const L = layoutFor(look, width, height);   // per cue: the big line has its own size and position
    const base = inlineColor(look.color);
    const accent = inlineColor(look.accent);
    const pillText = inlineColor(look.pillText);
    const wordText = w => assEscape(displayText(w.text, look));
    const { start, end, b, fill } = wordSlots(cue);
    const durMs = (end - start) * 1000;
    const lines = wrapLines(cue.words, L.maxChars);
    const lineOf = new Map();
    lines.forEach((l, li) => l.forEach(k => lineOf.set(k, li)));

    // parts[k] belongs to word k; null parts are left out entirely.
    const join = parts => {
      let s = '';
      let prev = -1;
      parts.forEach((p, k) => {
        if (p == null) return;
        if (prev >= 0) s += lineOf.get(k) !== lineOf.get(prev) ? '\\N' : ' ';
        s += p;
        prev = k;
      });
      return s;
    };

    // Segments: one event per "current word" when the word effect needs it.
    const perWord = ['active', 'pill', 'pop', 'bounce', 'reveal', 'single'].includes(look.word);
    const segs = perWord
      ? cue.words.map((_, i) => [b[i], i + 1 < b.length ? b[i + 1] : end, i])
      : [[start, end, -1]];

    segs.forEach(([s, e, cur], si) => {
      const first = si === 0;
      const last = si === segs.length - 1;
      // ── line-level tags (entry / exit, position, glow) ──
      let head = `\\an${L.an}\\pos(${L.anchor.x},${L.anchor.y})`;
      if (look.entry === 'fade') {
        const f = Math.round(Math.min(FADE_MS, durMs / 3));
        if (first || last) head += `\\fad(${first ? f : 0},${last ? f : 0})`;
      } else if (look.entry === 'slide') {
        const fi = Math.round(Math.min(SLIDE_FADE_IN_MS, durMs / 3));
        const fo = Math.round(Math.min(SLIDE_FADE_OUT_MS, durMs / 3));
        if (first) {
          const mv = Math.round(Math.min(SLIDE_MS, durMs));
          const dyPx = Math.round(L.fontSize * 0.6);
          head = `\\an${L.an}\\move(${L.anchor.x},${L.anchor.y + dyPx},${L.anchor.x},${L.anchor.y},0,${mv})`;
        }
        if (first || last) head += `\\fad(${first ? fi : 0},${last ? fo : 0})`;
      } else if (look.entry === 'pop') {
        const f = Math.round(Math.min(POP_ENTRY_FADE_MS, durMs / 3));
        if (first || last) head += `\\fad(${first ? f : 0},${last ? f : 0})`;
      }
      if (L.blur) head += `\\blur${L.blur}`;
      if (cue.style === PUNCH) head += `\\fs${L.fontSize}\\bord${L.outline}\\shad${L.shadow}`;
      if (look.slant) head += '\\fax-0.2';
      const entryPop = look.entry === 'pop' && first;

      // ── per-word text ──
      const wordTags = (w, k) => {
        let tags = '';
        let after = '';
        let scaleK = kwScale(look, w);
        const colored = kwColor(look, w);
        let color = colored ? accent : null;
        if (look.word === 'active' && k === cur) color = accent;
        if (look.word === 'pill' && k === cur) {
          color = pillText;
          // text sits on the box: no outline/shadow (doesn't change the layout)
          if (!look.box) { tags += '\\bord0\\shad0'; after += `\\bord${L.outline}\\shad${L.shadow}`; }
        }
        // scale: word effect > entry pop > keyword scale
        if ((look.word === 'pop' || look.word === 'bounce') && k === cur) {
          tags += scaleChain(look.word === 'pop' ? POP_KEYS : BOUNCE_KEYS, scaleK);
          after += staticScale(1);
        } else if (entryPop) {
          tags += scaleChain(ENTRY_POP_KEYS, scaleK);
          after += staticScale(1);
        } else if (scaleK !== 1) {
          tags += staticScale(scaleK);
          after += staticScale(1);
        }
        if (color) { tags += `\\1c${color}`; after += `\\1c${base}`; }
        return [tags, after];
      };

      if (look.word === 'karaoke') {
        let mark = start;
        const parts = cue.words.map((w, i) => {
          const [fs, fe] = fill[i];
          let k = '';
          const gap = Math.round((fs - mark) * 100);
          if (gap > 0) k += `{\\k${gap}}`;
          const d = Math.max(1, Math.round((fe - fs) * 100));
          mark = fs + d / 100;
          const [tags, after] = wordTags(w, i);
          // karaoke colours come from \1c/\2c, so drop keyword colour tags
          const t2 = tags.replace(/\\1c&H[0-9A-F]+&/g, '');
          const a2 = after.replace(/\\1c&H[0-9A-F]+&/g, '');
          return `${k}{\\kf${d}${t2}}${wordText(w)}${a2 ? `{${a2}}` : ''}`;
        });
        dialogue(1, 'Default', s, e, `{${head}\\1c${accent}\\2c${base}}` + join(parts));
        return;
      }

      if (look.word === 'single') {
        const w = cue.words[cur];
        const big = Math.round(L.fontSize * SINGLE_SIZE);
        const color = kwColor(look, w) ? `\\1c${accent}` : '';
        dialogue(1, 'Default', s, e, `{${head}\\fs${big}${scaleChain(SINGLE_KEYS)}${color}}${wordText(w)}`);
        return;
      }

      const parts = cue.words.map((w, k) => {
        const txt = wordText(w);
        if ((look.word === 'reveal' || look.word === 'pop') && k > cur) {
          // Hidden words keep their space so the line doesn't shift. With a
          // background box, lines that haven't started are left out (libass
          // would still draw an empty box for them).
          if (look.box && lineOf.get(k) > lineOf.get(cur)) return null;
          return `{\\alpha&HFF&}${txt}{\\alpha&H00&}`;
        }
        const [tags, after] = wordTags(w, k);
        return `${tags ? `{${tags}}` : ''}${txt}${after ? `{${after}}` : ''}`;
      });
      dialogue(1, 'Default', s, e, `{${head}}` + join(parts));

      if (look.word === 'pill') {
        // Layer 0: identical text, everything transparent except the current
        // word's box. Scale tags are mirrored so the layout matches exactly.
        const pillParts = cue.words.map((w, k) => {
          const [tags] = wordTags(w, k);
          const scale = (tags.match(/\\fsc[xy]\d+|\\t\([^)]*\)/g) || []).join('');
          const vis = k === cur ? '\\1a&HFF&\\3a&H00&\\4a&HFF&' : '\\alpha&HFF&';
          return `{${scale}${vis}}${wordText(w)}{\\alpha&HFF&${scale ? staticScale(1) : ''}}`;
        });
        dialogue(0, 'Pill', s, e, `{${head.replace(/\\blur\d+/, '')}\\alpha&HFF&}` + join(pillParts));
      }
    });
  }
  // End card: big accent-coloured text on a plain frame after the video (the video itself is extended by the exporter).
  if (endCard?.text && endCard.end > endCard.start) {
    const words = String(endCard.text).trim().split(/\s+/).map(text => ({ text }));
    const Le = layoutFor({ ...globalLook, sizePct: Math.min(20, globalLook.sizePct * 1.6), textCase: 'upper', maxChars: 16, position: 'middle' }, width, height);
    const body = wrapLines(words, Le.maxChars).map(l => l.map(k => assEscape(displayText(words[k].text, { textCase: 'upper' }))).join(' ')).join('\\N');
    const d = Math.round(Math.min(400, (endCard.end - endCard.start) * 300));
    out.push(`Dialogue: 3,${assTime(endCard.start)},${assTime(endCard.end)},Default,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${Math.round(height / 2)})\\fs${Le.fontSize}\\bord0\\shad0\\1c${inlineColor(globalLook.accent)}\\fad(${d},0)}${body}`);
  }
  return out.join('\n') + '\n';
}
