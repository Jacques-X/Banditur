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
  { id: 'rise', name: "Jitla'" },
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
  preset: 'dinamiku',
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
  position: 'bottom',      // bottom | lower | lowmid | middle | top (lowmid: 64 % of the height, under the face on a reel)
  marginPct: 8,            // % of video height
  maxChars: 32,            // per line (also capped by what fits the frame)
  maxLines: 2,             // captions are built to fit this many lines (1 or 2)
  safeArea: true,          // keep clear of Instagram/Facebook overlays on reels
  // animation
  entry: 'none',
  word: 'none',
  emphasis: 'color',
  slant: false,            // lean the text (used by the big line)
  // big keyword (Dinamiku): the caption's keyword is large and in the accent colour, the other words small
  // and light, stacked above / below it
  tier: false,
  helperFont: 'Montserrat SemiBold',
  // placement: rotate = each caption takes the next of a few slots; posX / posY = an exact place for one caption
  // (fractions of the frame, the middle of the caption); null = by `position`
  rotate: false,
  posX: null,
  posY: null,
  // behind the speaker: the caption is drawn under a cut-out of the person (sidecar/matte.py)
  behind: false,
};

export const DEFAULT_PRESET = 'dinamiku';
const LOWMID = 0.36;               // position 'lowmid': the caption's middle sits at 64 % of the height
const POS_MIN = 0.05;
const POS_MAX = 0.95;
export const PRESETS = [
  {
    // From an example reel: a big keyword in the accent colour with small light words around it. Calm: up to 5 words,
    // one place, every word rises into place (word effect 'rise').
    id: 'dinamiku', words: 5, name: 'Dinamiku', hint: "Kelma kbira bil-kulur bi kliem żgħir fuqha u taħtha (sa 5 kelmiet); kull kelma titla' bil-mod u l-kaxxa tibqa' f'post wieħed",
    look: { font: 'Montserrat Black', helperFont: 'Montserrat SemiBold', sizePct: 11.5, color: '#FFFFFF', accent: '#E2AD72', outlinePct: 0, shadow: true, position: 'lowmid', maxChars: 10, maxLines: 2, entry: 'none', word: 'rise', emphasis: 'none', tier: true, rotate: false },
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

// Presets that no longer exist but whose values must live on: a stored look keeps every value and becomes 'custom';
// a caption's own preset id turns into the animation layers it used (see migrateCueStyles).
export const REMOVED_PRESETS = { deheb: { entry: 'none', word: 'active', emphasis: 'none' } };
const isRemoved = id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(REMOVED_PRESETS, id);

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
  const p = PRESET_BY_ID.get(id) || PRESET_BY_ID.get(DEFAULT_PRESET);
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
  if (!['bottom', 'lower', 'lowmid', 'middle', 'top'].includes(l.position)) l.position = 'bottom';
  if (!['center', 'left'].includes(l.align)) l.align = 'center';
  if (!['normal', 'upper', 'lower'].includes(l.textCase)) l.textCase = 'normal';
  if (!ENTRY_IDS.has(l.entry)) l.entry = 'none';
  if (!WORD_IDS.has(l.word)) l.word = 'none';
  if (!EMPHASIS_IDS.has(l.emphasis)) l.emphasis = 'color';
  for (const k of ['color', 'accent', 'pillText', 'outlineColor', 'boxColor']) {
    if (!/^#[0-9a-f]{6}$/i.test(l[k])) l[k] = DEFAULT_LOOK[k];
  }
  for (const k of ['bold', 'shadow', 'glow', 'box', 'safeArea', 'slant', 'tier', 'rotate', 'behind']) l[k] = !!l[k];
  if (!FONT_BY_FAMILY.has(l.helperFont)) l.helperFont = DEFAULT_LOOK.helperFont;
  const px = l.posX == null || l.posX === '' ? NaN : Number(l.posX);
  const py = l.posY == null || l.posY === '' ? NaN : Number(l.posY);
  if (Number.isFinite(px) && Number.isFinite(py)) { l.posX = clamp(px, POS_MIN, POS_MAX); l.posY = clamp(py, POS_MIN, POS_MAX); }
  else { l.posX = null; l.posY = null; }
  if (!l.preset || (l.preset !== 'custom' && !String(l.preset).startsWith('saved:') && !PRESET_BY_ID.has(l.preset))) l.preset = 'custom';
  return l;
}

/**
 * A stored look (last used, or saved with a session). Looks made from a preset
 * that no longer exists start again from the default preset; a removed one (REMOVED_PRESETS) keeps its values as 'custom'.
 */
export function restoreLook(raw) {
  const id = raw?.preset;
  const known = id === 'custom' || String(id || '').startsWith('saved:') || PRESET_BY_ID.has(id) || isRemoved(id);
  return raw && known ? normalizeLook(raw) : lookFromPreset(DEFAULT_PRESET);
}

/** Per-cue style id for the "big line": a short punchy phrase, large and slanted mid-frame. */
export const PUNCH = 'punch';
const punchLook = look => ({
  ...look,
  textCase: 'upper', position: 'middle', align: 'center',
  sizePct: Math.min(20, look.sizePct * 1.9), maxChars: 14, maxLines: 2,
  slant: true, entry: 'pop', word: 'none', emphasis: 'none', tier: false, posX: null, posY: null,
  color: '#FFFFFF', outlinePct: Math.max(look.outlinePct, 4), shadow: true,
});

/**
 * The look used for one cue: a per-cue preset overrides only the animation layers;
 * the big line (PUNCH) also changes size, position and case.
 */
export function effectiveLook(cue, look) {
  let l = styledLook(cue, look);
  const own = cue?.look;
  if (own && Object.keys(own).length) {
    const patch = {};
    for (const k of CUE_LOOK_KEYS) if (k in own) patch[k] = own[k];
    l = normalizeLook({ ...l, ...patch });
  }
  // rotation: a caption without a place of its own takes the slot `withRotation()` gave it
  if (l.rotate && cue?.autoPos && l.posX == null && cue.style !== PUNCH) l = { ...l, posX: cue.autoPos[0], posY: cue.autoPos[1] };
  return l;
}

/**
 * Look settings one caption can change for itself ("Subtitle magħżul"), stored
 * as `cue.look`. Box, lines and safe area stay video-wide (libass draws the box
 * from the shared style; lines decide how captions are cut).
 */
export const CUE_LOOK_KEYS = ['entry', 'word', 'emphasis', 'font', 'bold', 'sizePct', 'textCase', 'color', 'accent', 'pillText',
  'outlineColor', 'outlinePct', 'shadow', 'glow', 'position', 'align', 'marginPct', 'maxChars', 'tier', 'posX', 'posY', 'behind'];

function styledLook(cue, look) {
  const id = cue?.style;
  if (!id) return look;
  if (id === PUNCH) return normalizeLook(punchLook(look));
  if (PRESET_BY_ID.has(id)) {
    const p = PRESET_BY_ID.get(id).look;
    return { ...look, entry: p.entry ?? look.entry, word: p.word ?? look.word, emphasis: p.emphasis ?? look.emphasis };
  }
  if (LEGACY[id]) return { ...look, ...LEGACY[id] };
  if (isRemoved(id)) return { ...look, ...REMOVED_PRESETS[id] };
  return look;
}

/**
 * Captions whose own preset was removed (Deheb) get the animation it gave as their own look instead, so they
 * look exactly as before. Returns the same array when nothing needs changing.
 */
export function migrateCueStyles(cues) {
  if (!Array.isArray(cues) || !cues.some(c => c && isRemoved(c.style))) return cues;
  return cues.map(c => (c && isRemoved(c.style)
    ? { ...c, style: null, look: { ...REMOVED_PRESETS[c.style], ...(c.look || {}) } }
    : c));
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
 *   fontSize, outline, shadow, blur, pillPad, marginV, marginH, maxChars, anchor {x, y} (middle of the caption), an
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
  // The margin reaches the caption's middle line, so with the safe area on keep
  // a fixed extra strip (not tied to the text size, so the caption still doesn't
  // move when it's enlarged) for the half of the caption beyond that line.
  const pad = look.safeArea ? 0.04 : 0;
  if (look.position === 'bottom') marginV = Math.max(marginV, Math.round(height * (safe.bottom + pad)));
  if (look.position === 'top') marginV = Math.max(marginV, Math.round(height * (safe.top + pad)));
  if (look.position === 'lower') marginV = Math.max(Math.round(height * safe.lower), Math.round(height * (safe.bottom + pad)));
  if (look.position === 'lowmid') marginV = Math.max(Math.round(height * LOWMID), Math.round(height * (safe.bottom + pad)));
  // Characters that fit across the frame at this size (uppercase is wider).
  const charW = fontSize * fontInfo(look.font).w * (look.textCase === 'upper' ? 1.12 : 1);
  const fit = Math.max(6, Math.floor((width - 2 * marginH) / charW));
  const maxChars = Math.min(look.maxChars, fit);
  const left = look.align === 'left';
  // The anchor is the vertical middle of the caption (\an4 / \an5), so a bigger
  // size or a second line grows evenly up and down instead of pushing the text
  // up from the bottom: the caption stays at the same height on screen. The
  // margin is measured from the frame edge to that middle line.
  const y = look.position === 'top' ? marginV : look.position === 'middle' ? Math.round(height / 2) : height - marginV;
  const an = left ? 4 : 5;
  const x = left ? marginH : Math.round(width / 2);
  // an exact place (dragged, or a rotation slot): the middle of the caption, kept inside the safe area
  if (look.posX != null && look.posY != null) {
    const py = look.safeArea ? clamp(look.posY, safe.top + 0.08, 1 - safe.bottom - 0.08) : look.posY;
    return { fontSize, outline, shadow, blur, pillPad, marginV, marginH, maxChars, anchor: { x: Math.round(look.posX * width), y: Math.round(py * height) }, an: 5 };
  }
  return { fontSize, outline, shadow, blur, pillPad, marginV, marginH, maxChars, anchor: { x, y }, an };
}

/** The cues whose own look puts them behind the speaker. */
export function behindCues(cues, look) {
  const l = normalizeLook(look);
  return cues.filter(c => c.words?.length && effectiveLook(c, l).behind);
}

/** Stretches [start, end] (seconds, with a little slack) that need the speaker cut out. */
export function behindRanges(cues, look, slack = 0.15) {
  return behindCues(cues, look).map(c => [Math.max(0, c.start - slack), c.end + slack]);
}

// ── Big keyword layout and rotating places ──────────────────────────────────

export const TIER_HELPER = 0.5;     // helper words are this fraction of the keyword's size

/** Slots a rotating caption takes in turn: [x, y] as fractions of the frame (the caption's middle). */
export const ROTATION = [[0.5, 0.6], [0.42, 0.44], [0.58, 0.54], [0.5, 0.36], [0.44, 0.66], [0.56, 0.48]];

/** `cues` with each one's rotation slot in `autoPos` (the same array when rotation is off). */
export function withRotation(cues, look) {
  if (!look?.rotate) return cues;
  return cues.map((c, i) => ({ ...c, autoPos: ROTATION[i % ROTATION.length] }));
}

/** Where cue `i`'s middle is, as fractions of a width × height frame (rotation and its own place included). */
export function cueAnchor(cues, i, look, width, height) {
  const l = normalizeLook(look);
  const view = withRotation(cues, l)[i];
  const a = layoutFor(effectiveLook(view, l), width, height).anchor;
  return { x: a.x / width, y: a.y / height };
}

const stripPunct = t => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** [first, last] word index of a cue's keyword: its first run of marked words, else its longest word. */
export function tierKeyword(cue) {
  const w = cue.words;
  const first = w.findIndex(x => x.kw);
  if (first >= 0) { let last = first; while (w[last + 1]?.kw) last++; return [first, last]; }
  let best = 0;
  let len = -1;
  w.forEach((x, i) => { const n = stripPunct(x.text).length; if (n >= len) { len = n; best = i; } });
  return [best, best];
}

// `maxChars` (from layoutFor) is a cautious count: it assumes a wide average letter (FONTS[].w of the font size).
// Montserrat's real letters are about a third narrower, so the keyword line holds KEY_FIT times as many.
export const KEY_FIT = 1.5;
/** Characters the small words may have per line (they are half the size, and in a narrower weight). */
export const tierHelperChars = maxChars => Math.max(8, Math.floor((maxChars / TIER_HELPER) * 1.4));

export const TIER_MIN = 0.6;        // the keyword line never shrinks below this fraction of the size

/**
 * Lines of a cue as word indices, the size of each line relative to the font size (null = all 1) and which lines
 * hold the keyword (`keyLine`). With the big-keyword layout: the words before the keyword, the keyword (1–2 words
 * on one line), the words after it. A keyword wider than `maxChars` shrinks (down to TIER_MIN) so it stays inside
 * the frame; only if it still does not fit does it wrap onto more lines.
 */
export function cueLines(cue, look, maxChars) {
  const words = cue.words;
  if (!look.tier || !words.length) return { lines: wrapLines(words, maxChars), size: null, key: null, keyLine: null };
  const [a, b] = tierKeyword(cue);
  const lines = [];
  const size = [];
  const keyLine = [];
  const part = (from, to, rel, chars, isKey) => {
    const idx = [];
    for (let k = from; k < to; k++) idx.push(k);
    if (!idx.length) return;
    for (const l of wrapLines(idx.map(k => words[k]), chars)) { lines.push(l.map(j => idx[j])); size.push(rel); keyLine.push(isKey); }
  };
  const keyChars = words.slice(a, b + 1).reduce((n, w) => n + w.text.length, 0) + (b - a);
  const rel = clamp((maxChars * KEY_FIT) / Math.max(1, keyChars), TIER_MIN, 1);
  const helper = rel === 1 ? TIER_HELPER : Math.min(TIER_HELPER, rel * 0.6);
  const helperChars = tierHelperChars(maxChars);
  part(0, a, helper, helperChars, false);
  part(a, b + 1, rel, Math.max(1, Math.round((maxChars * KEY_FIT) / rel)), true);
  part(b + 1, words.length, helper, helperChars, false);
  return { lines, size, key: [a, b], keyLine };
}

/**
 * Line length and line count a caption must fit when the video is cut into captions and checked
 * (what `buildCues` and `cueIssues` take). The big-keyword layout allows 3 lines of the small words' length.
 */
export function fitLimits(look, width, height) {
  const L = layoutFor(look, width, height);
  if (look.tier) return { lineChars: tierHelperChars(L.maxChars), maxLines: 3 };
  return { lineChars: L.maxChars, maxLines: look.maxLines === 1 ? 1 : 2 };
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

// ── The 'rise' word effect (Jitla') ──────────────────────────────────────────
// Calm motion, no overshoot: a word is invisible until spoken, then fades in while rising `RISE_DY` em into
// place (ease-out cubic, RISE_MS). The keyword line grows from RISE_SCALE_FROM to 1 (ease-out, RISE_SCALE_MS),
// and at the cue's end everything fades out together (RISE_FADE_OUT_MS). frameState() (preview) and buildAss()
// (export) both read these functions.

export const RISE_MS = 220;
export const RISE_DY = 0.5;            // × the word's em (the glyphs' own size)
export const RISE_SCALE_MS = 250;
export const RISE_SCALE_FROM = 0.9;
export const RISE_FADE_OUT_MS = 180;
// libass cannot ease a move: the export cuts the motion into linear pieces at these times (ms from the start)
export const RISE_EDGES = [0, 20, 40, 70, 110, 160, 220];
export const RISE_SCALE_EDGES = [0, 30, 60, 100, 150, 200, 250];

export const easeOutCubic = x => { const u = 1 - clamp(x, 0, 1); return 1 - u * u * u; };

/** A word `ms` after it was spoken: opacity 0→1 and the offset (em, downwards) 0.5→0. */
export function riseWord(ms) {
  const e = easeOutCubic(ms / RISE_MS);
  return { opacity: e, dy: RISE_DY * (1 - e) };
}
/** The keyword line's scale `ms` after its first word was spoken. */
export const riseKeyScale = ms => RISE_SCALE_FROM + (1 - RISE_SCALE_FROM) * easeOutCubic(ms / RISE_SCALE_MS);
/** The block's fade at the cue's end: 1 → 0 over the last RISE_FADE_OUT_MS. */
export const riseFadeOut = (t, end) => clamp(((end - t) * 1000) / RISE_FADE_OUT_MS, 0, 1);

/**
 * Word i of a cue at time t (`slots` from wordSlots, `key` = [first, last] keyword or null):
 * { opacity (fade-out included), dy (em), keyScale }.
 */
export function riseAt(slots, i, t, key = null) {
  const w = riseWord((t - slots.b[i]) * 1000);
  return { opacity: w.opacity * riseFadeOut(t, slots.end), dy: w.dy, keyScale: key ? riseKeyScale((t - slots.b[key[0]]) * 1000) : 1 };
}

/** Times (seconds, centisecond grid) between which word i's motion is cut into linear pieces, from its start to the cue's end. */
export function riseEdges(slots, i, key = null) {
  const cs = x => Math.round(x * 100) / 100;
  const from = slots.b[i];
  const set = new Set([cs(from), cs(slots.end), cs(slots.end - RISE_FADE_OUT_MS / 1000)]);
  for (const e of RISE_EDGES) set.add(cs(from + e / 1000));
  if (key) for (const e of RISE_SCALE_EDGES) set.add(cs(slots.b[key[0]] + e / 1000));
  return [...set].filter(x => x >= cs(from) && x <= cs(slots.end)).sort((a, b) => a - b);
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
 *   { opacity, dy (× font size), lineScale, keyScale (the keyword line, 'rise'), single: index|null, cur,
 *     words: [{ visible, color: 'base'|'accent'|'pillText', pill, scale, fill, opacity, dy (em, 'rise') }] }
 */
export function frameState(cue, lookIn, t) {
  const look = effectiveLook(cue, lookIn);
  const slots = wordSlots(cue);
  const { start, end, b, fill } = slots;
  const ms = (t - start) * 1000;
  const toEnd = (end - t) * 1000;
  const dur = (end - start) * 1000;
  let cur = 0;
  for (let i = 0; i < b.length; i++) if (b[i] <= t) cur = i;

  let opacity = 1;
  let dy = 0;
  let lineScale = 1;
  const entry = look.word === 'rise' ? 'none' : look.entry;   // Jitla' brings its own entry and exit
  if (entry === 'fade') {
    const f = Math.min(FADE_MS, dur / 3);
    opacity = Math.min(1, ms / f, toEnd / f);
  } else if (entry === 'slide') {
    opacity = Math.min(1, ms / Math.min(SLIDE_FADE_IN_MS, dur / 3), toEnd / Math.min(SLIDE_FADE_OUT_MS, dur / 3));
    dy = 0.6 * (1 - Math.min(1, ms / Math.min(SLIDE_MS, dur)));
  } else if (entry === 'pop') {
    const f = Math.min(POP_ENTRY_FADE_MS, dur / 3);
    opacity = Math.min(1, ms / f, toEnd / f);
    lineScale = keyScale(ENTRY_POP_KEYS, ms);
  }
  opacity = clamp(opacity, 0, 1);

  const key = look.tier && cue.words.length ? tierKeyword(cue) : null;
  const words = cue.words.map((w, i) => {
    const isKey = key ? i >= key[0] && i <= key[1] : false;
    const s = key
      ? { visible: true, color: isKey ? 'accent' : 'base', pill: false, scale: 1, fill: null, opacity: 1, dy: 0 }
      : { visible: true, color: kwColor(look, w) ? 'accent' : 'base', pill: false, scale: kwScale(look, w), fill: null, opacity: 1, dy: 0 };
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
      case 'rise': {
        s.visible = i <= cur;
        const r = riseAt(slots, i, t, key);
        s.opacity = s.visible ? r.opacity : 0;
        s.dy = r.dy;
        break;
      }
      case 'single':
        s.visible = i === cur;
        if (i === cur) s.scale = keyScale(SINGLE_KEYS, (t - b[i]) * 1000);
        break;
      default:
        break;
    }
    return s;
  });
  const keyScaleNow = look.word === 'rise' && key ? riseKeyScale((t - b[key[0]]) * 1000) : 1;
  return { opacity, dy, lineScale, cur, single: look.word === 'single' ? cur : null, words, look, keyScale: keyScaleNow };
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
export function buildAss(cues, lookIn, { width = 1920, height = 1080, title = 'Banditur', endCard = null, layer = 'all' } = {}) {
  const globalLook = normalizeLook(lookIn);
  const L = layoutFor(globalLook, width, height);
  const LG = L;
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

  for (const cue of withRotation(cues, globalLook)) {
    if (!cue.words.length) continue;
    const look = effectiveLook(cue, globalLook);
    // layers for the export with the speaker in between: 'behind' = only the captions behind the speaker,
    // 'front' = all the others (and the end card); 'all' = everything in one file
    if (layer === 'behind' ? !look.behind : layer === 'front' && look.behind) continue;
    const L = layoutFor(look, width, height);   // per cue: the big line has its own size and position
    const base = inlineColor(look.color);
    const accent = inlineColor(look.accent);
    const pillText = inlineColor(look.pillText);
    const wordText = w => assEscape(displayText(w.text, look));
    const { start, end, b, fill } = wordSlots(cue);
    const durMs = (end - start) * 1000;
    const { lines, size: lineSize, key: tierKey, keyLine } = cueLines(cue, look, L.maxChars);
    let lineExtra = null;   // 'rise': extra tags at the start of a tier line (the keyword line's scale)
    const lineOf = new Map();
    lines.forEach((l, li) => l.forEach(k => lineOf.set(k, li)));
    // big-keyword layout: each line states its own size and weight
    const lineTags = li => {
      if (!lineSize) return '';
      const fn = (keyLine[li] ? look.font : look.helperFont).replace(/[,{}\\]/g, ' ');
      return `{\\fs${Math.max(6, Math.round(L.fontSize * lineSize[li]))}\\fn${fn}${lineExtra ? lineExtra(li) : ''}}`;
    };

    // parts[k] belongs to word k; null parts are left out entirely.
    const join = parts => {
      let s = '';
      let prev = -1;
      parts.forEach((p, k) => {
        if (p == null) return;
        const newLine = prev < 0 || lineOf.get(k) !== lineOf.get(prev);
        if (prev >= 0) s += newLine ? '\\N' : ' ';
        if (newLine) s += lineTags(lineOf.get(k));
        s += p;
        prev = k;
      });
      return s;
    };

    // Segments: one event per "current word" when the word effect needs it.
    const perWord = ['active', 'pill', 'pop', 'bounce', 'reveal', 'single'].includes(look.word);   // 'rise' has its own events (below)
    const segs = perWord
      ? cue.words.map((_, i) => [b[i], i + 1 < b.length ? b[i + 1] : end, i])
      : [[start, end, -1]];

    segs.forEach(([s, e, cur], si) => {
      const first = si === 0;
      const last = si === segs.length - 1;
      // ── line-level tags (entry / exit, position, glow) ──
      const entry = look.word === 'rise' ? 'none' : look.entry;   // Jitla' brings its own entry and exit
      let head = `\\an${L.an}\\pos(${L.anchor.x},${L.anchor.y})`;
      if (entry === 'fade') {
        const f = Math.round(Math.min(FADE_MS, durMs / 3));
        if (first || last) head += `\\fad(${first ? f : 0},${last ? f : 0})`;
      } else if (entry === 'slide') {
        const fi = Math.round(Math.min(SLIDE_FADE_IN_MS, durMs / 3));
        const fo = Math.round(Math.min(SLIDE_FADE_OUT_MS, durMs / 3));
        if (first) {
          const mv = Math.round(Math.min(SLIDE_MS, durMs));
          const dyPx = Math.round(L.fontSize * 0.6);
          head = `\\an${L.an}\\move(${L.anchor.x},${L.anchor.y + dyPx},${L.anchor.x},${L.anchor.y},0,${mv})`;
        }
        if (first || last) head += `\\fad(${first ? fi : 0},${last ? fo : 0})`;
      } else if (entry === 'pop') {
        const f = Math.round(Math.min(POP_ENTRY_FADE_MS, durMs / 3));
        if (first || last) head += `\\fad(${first ? f : 0},${last ? f : 0})`;
      }
      if (L.blur) head += `\\blur${L.blur}`;
      // a caption with its own look: everything the shared style sets is restated inline
      if (look.font !== globalLook.font) head += `\\fn${look.font.replace(/[,{}\\]/g, ' ')}`;
      if (look.bold !== globalLook.bold) head += `\\b${look.bold ? 1 : 0}`;
      if (cue.style === PUNCH || L.fontSize !== LG.fontSize || L.outline !== LG.outline || L.shadow !== LG.shadow) {
        head += `\\fs${L.fontSize}\\bord${L.outline}\\shad${L.shadow}`;
      }
      if (look.color !== globalLook.color) head += `\\1c${base}`;
      if (look.outlineColor !== globalLook.outlineColor && !look.box) head += `\\3c${inlineColor(look.outlineColor)}`;
      if (look.slant) head += '\\fax-0.2';
      const entryPop = entry === 'pop' && first;

      // ── per-word text ──
      const wordTags = (w, k) => {
        let tags = '';
        let after = '';
        const isKey = tierKey ? k >= tierKey[0] && k <= tierKey[1] : false;
        let scaleK = tierKey ? 1 : kwScale(look, w);
        const colored = tierKey ? isKey : kwColor(look, w);
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

      if (look.word === 'rise') {
        // One event per word, from the moment it is spoken to the cue's end. Each event holds the whole caption (so
        // libass lays it out exactly as it will stand) with every other word fully transparent; only this word is
        // drawn, and the event moves up and fades in, in short linear pieces (libass cannot ease), then rests.
        const posTag = `\\an${L.an}\\pos(${L.anchor.x},${L.anchor.y})`;
        const rest = head.startsWith(posTag) ? head.slice(posTag.length) : head;
        const slots = { b, end };
        const boxA = Math.round((1 - globalLook.boxOpacity) * 255);
        const a4 = (op, baseA) => Math.round(255 - (255 - baseA) * op).toString(16).toUpperCase().padStart(2, '0');
        const alphas = op => `\\1a&H${a4(op, 0)}&\\3a&H${a4(op, look.box ? boxA : 0)}&\\4a&H${a4(op, look.box ? boxA : 110)}&`;
        const num = v => String(Math.round(v * 10) / 10);
        const noColor = t => t.replace(/\\1c&H[0-9A-F]+&/g, '');
        cue.words.forEach((_, k) => {
          const li = lineOf.get(k);
          const lineRel = lineSize ? lineSize[li] : 1;
          const lineFont = lineSize && !keyLine[li] ? look.helperFont : look.font;
          const emPx = L.fontSize * lineRel * fontInfo(lineFont).em;   // the word's own em in video pixels
          const edges = riseEdges(slots, k, tierKey);
          const pieces = [];
          for (let n = 0; n + 1 < edges.length; n++) {
            const v0 = riseAt(slots, k, edges[n], tierKey);
            const v1 = riseAt(slots, k, edges[n + 1], tierKey);
            const flat = Math.abs(v0.opacity - v1.opacity) + Math.abs(v0.dy - v1.dy) + Math.abs(v0.keyScale - v1.keyScale) < 1e-9;
            const prev = pieces[pieces.length - 1];
            if (flat && prev?.flat && Math.abs(prev.v1.opacity - v0.opacity) + Math.abs(prev.v1.dy - v0.dy) + Math.abs(prev.v1.keyScale - v0.keyScale) < 1e-9) prev.e = edges[n + 1];
            else pieces.push({ s: edges[n], e: edges[n + 1], v0, v1, flat });
          }
          for (const pc of pieces) {
            const ms = Math.round((pc.e - pc.s) * 1000);
            const moving = pc.v0.dy !== pc.v1.dy;
            const y0 = L.anchor.y + pc.v0.dy * emPx;
            const y1 = L.anchor.y + pc.v1.dy * emPx;
            const where = moving
              ? `\\an${L.an}\\move(${L.anchor.x},${num(y0)},${L.anchor.x},${num(y1)},0,${ms})`
              : `\\an${L.an}\\pos(${L.anchor.x},${num(y0)})`;
            const fading = pc.v0.opacity !== pc.v1.opacity;
            const fade = fading ? `${alphas(pc.v0.opacity)}\\t(0,${ms},${alphas(pc.v1.opacity)})` : alphas(pc.v0.opacity);
            // the keyword line's scale (it is the same for every word of that line, so every event agrees)
            lineExtra = tierKey
              ? li2 => {
                if (!keyLine[li2]) return '\\fscx100\\fscy100';
                const s0 = pct(pc.v0.keyScale);
                const s1 = pct(pc.v1.keyScale);
                return `\\fscx${s0}\\fscy${s0}${s0 !== s1 ? `\\t(0,${ms},\\fscx${s1}\\fscy${s1})` : ''}`;
              }
              : null;
            const parts = cue.words.map((w, j) => {
              const [tags, after] = wordTags(w, j);
              // a zero-width, invisible run at full size ends the keyword line: while that line is scaled, the line
              // keeps its full height, so the lines around it (and the words already shown) do not move
              const keep = tierKey && j === tierKey[1] ? '{\\alpha&HFF&\\fscx100\\fscy100}\u200B' : '';
              if (j !== k) return `{\\alpha&HFF&${noColor(tags)}}${wordText(w)}${noColor(after) ? `{${noColor(after)}}` : ''}${keep}`;
              return `{${fade}${tags}}${wordText(w)}${after ? `{${after}}` : ''}${keep}`;
            });
            dialogue(1, 'Default', pc.s, pc.e, `{${where}${rest}}` + join(parts));
          }
        });
        lineExtra = null;
        return;
      }

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
        const pillHead = head.replace(/\\blur\d+/, '').replace(/\\3c&H[0-9A-F]+&/, '')
          + (look.accent !== globalLook.accent ? `\\3c${accent}\\4c${accent}` : '');
        dialogue(0, 'Pill', s, e, `{${pillHead}\\alpha&HFF&}` + join(pillParts));
      }
    });
  }
  // End card: big accent-coloured text on a plain frame after the video (the video itself is extended by the exporter).
  if (layer !== 'behind' && endCard?.text && endCard.end > endCard.start) {
    const words = String(endCard.text).trim().split(/\s+/).map(text => ({ text }));
    const Le = layoutFor({ ...globalLook, sizePct: Math.min(20, globalLook.sizePct * 1.6), textCase: 'upper', maxChars: 16, position: 'middle' }, width, height);
    const body = wrapLines(words, Le.maxChars).map(l => l.map(k => assEscape(displayText(words[k].text, { textCase: 'upper' }))).join(' ')).join('\\N');
    const d = Math.round(Math.min(400, (endCard.end - endCard.start) * 300));
    out.push(`Dialogue: 3,${assTime(endCard.start)},${assTime(endCard.end)},Default,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${Math.round(height / 2)})\\fs${Le.fontSize}\\bord0\\shad0\\1c${inlineColor(globalLook.accent)}\\fad(${d},0)}${body}`);
  }
  return out.join('\n') + '\n';
}
