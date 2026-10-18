// Subtitle data model for Traskrittura.
//
// Pure functions + a small undoable document. No DOM, no Tauri — unit-tested
// with `node src/subtitles/subtitles.test.mjs`.
//
//   Word = { text, start, end, prob, speaker, kw }
//   Cue  = { id, start, end, speaker, words: Word[], style: presetId | null }
//
// Cue start/end are the on-screen bounds. Word times are the spoken timings
// (from Whisper / MASRI alignment) and drive the word-level animations; they
// are clamped into the cue bounds when rendering.

export const MIN_CUE = 0.1;           // seconds — shortest cue an edit may leave
export const LOW_CONFIDENCE = 0.65;   // matches the editor's red highlighting
export const CPS_MAX = 20;            // characters per second before a cue is "too fast"
export const MIN_READ = 0.7;          // seconds — shorter cues are hard to read
export const MAX_LINES = 2;

import { mergeTokens } from './maltese.js';

let _seq = 0;
export const newId = () => `c${Date.now().toString(36)}${(_seq++).toString(36)}`;

export const clone = v => JSON.parse(JSON.stringify(v));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// ── Building cues ────────────────────────────────────────────────────────────

/** Normalise the sidecar's word list ({word,start,end,probability,speaker}). */
export function wordsFromSidecar(raw = []) {
  const out = [];
  for (const w of raw) {
    const text = String(w.word ?? w.text ?? '').trim();
    if (!text) continue;
    const start = Number(w.start) || 0;
    const end = Math.max(Number(w.end) || start, start);
    out.push({
      text,
      start,
      end,
      prob: typeof w.probability === 'number' ? w.probability : (typeof w.prob === 'number' ? w.prob : 1),
      speaker: w.speaker || 'SPEAKER_00',
      kw: !!w.kw,
    });
  }
  return out;
}

export const cueText = cue => cue.words.map(w => w.text).join(' ');

function makeCue(words, style = null) {
  return {
    id: newId(),
    start: words[0].start,
    end: Math.max(words[words.length - 1].end, words[0].start + MIN_CUE),
    speaker: words[0].speaker,
    words,
    style,
  };
}

/**
 * Group words into cues. A new cue starts when the current one reaches
 * `maxWords`, would exceed `maxChars`, the speaker changes, there's a pause
 * longer than `maxPause`, or the previous word ended a sentence.
 */
export function buildCues(words, { maxWords = 4, maxPause = 0.8, maxChars = 42 } = {}) {
  const cues = [];
  let chunk = [];
  let chars = 0;
  for (const w of words) {
    if (chunk.length) {
      const prev = chunk[chunk.length - 1];
      const sentenceEnd = /[.!?…]["”»)]?$/.test(prev.text) && chunk.length >= 2;
      if (
        chunk.length >= maxWords ||
        chars + 1 + w.text.length > maxChars ||
        w.speaker !== prev.speaker ||
        w.start - prev.end > maxPause ||
        sentenceEnd
      ) {
        cues.push(makeCue(chunk));
        chunk = [];
        chars = 0;
      }
    }
    chars += (chunk.length ? 1 : 0) + w.text.length;
    chunk.push(w);
  }
  if (chunk.length) cues.push(makeCue(chunk));
  return fixOverlaps(cues);
}

/** Make sure no cue overlaps the next one and every cue has a minimum length. */
export function fixOverlaps(cues) {
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const next = cues[i + 1];
    if (next && c.end > next.start) c.end = Math.max(next.start, c.start + MIN_CUE / 2);
    if (c.end - c.start < MIN_CUE / 2) c.end = c.start + MIN_CUE / 2;
  }
  return cues;
}

/** All words in order (deep copies) — used to re-split without losing edits. */
export const flattenWords = cues => clone(cues.flatMap(c => c.words));

/** Index of the cue on screen at time t, or -1. Binary search (cues are sorted). */
export function cueIndexAt(cues, t) {
  let lo = 0, hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (t < c.start) hi = mid - 1;
    else if (t >= c.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Index of the word being spoken at t within a cue (last word started), or -1. */
export function wordIndexAt(cue, t) {
  let k = -1;
  for (let i = 0; i < cue.words.length; i++) {
    if (cue.words[i].start <= t) k = i;
    else break;
  }
  return k;
}

// ── Editing operations ───────────────────────────────────────────────────────
// Each takes the cues array (mutated in place) and returns true on success,
// false when the edit isn't possible (nothing is changed in that case).

/** Split cue i at time t: words whose midpoint is at/after t move to a new cue. */
export function splitAt(cues, i, t) {
  const cue = cues[i];
  if (!cue || cue.words.length < 2) return false;
  const k = cue.words.findIndex(w => (w.start + w.end) / 2 >= t);
  if (k <= 0) return false;
  return splitBefore(cues, i, k, t);
}

/** Split cue i so that word k starts the second cue. */
export function splitBefore(cues, i, k, t = null) {
  const cue = cues[i];
  if (!cue || k <= 0 || k >= cue.words.length) return false;
  const a = cue.words.slice(0, k);
  const b = cue.words.slice(k);
  const lo = Math.max(cue.start + MIN_CUE, a[a.length - 1].start + MIN_CUE / 2);
  const hi = Math.min(cue.end - MIN_CUE, Math.max(b[0].end, b[0].start + MIN_CUE / 2));
  if (lo > hi) return false;
  const natural = (a[a.length - 1].end + b[0].start) / 2;
  const boundary = clamp(t ?? natural, lo, hi);
  const second = { id: newId(), start: boundary, end: cue.end, speaker: b[0].speaker, words: b, style: cue.style };
  cue.words = a;
  cue.end = boundary;
  cues.splice(i + 1, 0, second);
  return true;
}

/** Join cue i with cue i+1. */
export function joinNext(cues, i) {
  const a = cues[i];
  const b = cues[i + 1];
  if (!a || !b) return false;
  a.words = a.words.concat(b.words);
  a.end = Math.max(a.end, b.end);
  cues.splice(i + 1, 1);
  return true;
}

/** Move cue i's start to t (can't cross the previous cue or its own end). */
export function trimIn(cues, i, t) {
  const c = cues[i];
  if (!c) return false;
  const lo = i > 0 ? cues[i - 1].end : 0;
  const hi = c.end - MIN_CUE;
  if (hi < lo) return false;
  const v = clamp(t, lo, hi);
  if (v === c.start) return false;
  c.start = v;
  return true;
}

/** Move cue i's end to t (can't cross the next cue or its own start). */
export function trimOut(cues, i, t) {
  const c = cues[i];
  if (!c) return false;
  const lo = c.start + MIN_CUE;
  const hi = i < cues.length - 1 ? cues[i + 1].start : Infinity;
  if (hi < lo) return false;
  const v = clamp(t, lo, hi);
  if (v === c.end) return false;
  c.end = v;
  return true;
}

/** Move the cut between cue i-1 and cue i to t, leaving no gap. */
export function rollIn(cues, i, t) {
  const prev = cues[i - 1];
  const c = cues[i];
  if (!prev || !c) return false;
  const lo = prev.start + MIN_CUE;
  const hi = c.end - MIN_CUE;
  if (lo > hi) return false;
  const v = clamp(t, lo, hi);
  if (v === prev.end && v === c.start) return false;
  prev.end = v;
  c.start = v;
  return true;
}

/** Move the cut between cue i and cue i+1 to t, leaving no gap. */
export function rollOut(cues, i, t) {
  return rollIn(cues, i + 1, t);
}

/** Move cue i's first word to the end of the previous cue (keeps its timing). */
export function moveFirstWordToPrev(cues, i) {
  const prev = cues[i - 1];
  const c = cues[i];
  if (!prev || !c || !c.words.length) return false;
  const w = c.words.shift();
  prev.words.push(w);
  prev.end = Math.max(prev.end, w.end);
  if (!c.words.length) {
    prev.end = Math.max(prev.end, c.end);
    cues.splice(i, 1);
  } else {
    c.start = Math.max(c.start, prev.end);
    if (c.end - c.start < MIN_CUE) c.end = c.start + MIN_CUE;
  }
  fixOverlaps(cues);
  return true;
}

/** Move cue i's last word to the start of the next cue (keeps its timing). */
export function moveLastWordToNext(cues, i) {
  const c = cues[i];
  const next = cues[i + 1];
  if (!c || !next || !c.words.length) return false;
  const w = c.words.pop();
  next.words.unshift(w);
  next.start = Math.min(next.start, w.start);
  if (!c.words.length) {
    next.start = Math.min(next.start, c.start);
    cues.splice(i, 1);
  } else {
    c.end = Math.min(c.end, next.start);
    if (c.end - c.start < MIN_CUE) {
      c.end = c.start + MIN_CUE;
      next.start = Math.max(next.start, c.end);
    }
  }
  return true;
}

export function deleteCue(cues, i) {
  if (!cues[i]) return false;
  cues.splice(i, 1);
  return true;
}

/**
 * Replace a cue's text. Same word count → texts change, timings stay.
 * Different count → the cue's time span is shared out by word length.
 */
export function setCueText(cues, i, text, { keepArticles = true } = {}) {
  const c = cues[i];
  if (!c) return false;
  let tokens = String(text).split(/\s+/).filter(Boolean);
  if (keepArticles) tokens = mergeTokens(tokens).map(g => g.text);
  if (!tokens.length) return deleteCue(cues, i);
  if (tokens.join(' ') === cueText(c)) return false;
  if (tokens.length === c.words.length) {
    tokens.forEach((t, k) => {
      if (c.words[k].text !== t) { c.words[k].text = t; c.words[k].prob = 1; }
    });
    return true;
  }
  const total = tokens.reduce((n, t) => n + t.length, 0);
  const span = c.end - c.start;
  let at = c.start;
  c.words = tokens.map(t => {
    const d = span * (t.length / total);
    const w = { text: t, start: at, end: at + d, prob: 1, speaker: c.speaker, kw: false };
    at += d;
    return w;
  });
  return true;
}

export function toggleKeyword(cues, i, k) {
  const w = cues[i]?.words[k];
  if (!w) return false;
  w.kw = !w.kw;
  return true;
}

export function setCueStyle(cues, i, presetId) {
  const c = cues[i];
  if (!c) return false;
  const v = presetId || null;
  if (c.style === v) return false;
  c.style = v;
  return true;
}

// ── Low-confidence navigation ────────────────────────────────────────────────

/** Next low-confidence word after (cue i, word k), wrapping around. */
export function nextUnsure(cues, i = -1, k = -1) {
  const flat = [];
  cues.forEach((c, ci) => c.words.forEach((w, wi) => { if (w.prob < LOW_CONFIDENCE) flat.push([ci, wi]); }));
  if (!flat.length) return null;
  const after = flat.find(([ci, wi]) => ci > i || (ci === i && wi > k));
  return after || flat[0];
}

// ── Names: find spelling variants and replace them all ───────────────────────

const EDGE_PUNCT = /^[\s"'“”‘’«»(\[{¿¡]+|[\s"'“”‘’«»)\]}.,;:!?…]+$/g;

/** Lowercase, drop diacritics (ħ has no decomposition, so map it by hand). */
export function normKey(s) {
  return String(s)
    .toLowerCase()
    .replace(/ħ/g, 'h')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function core(text) {
  return text.replace(EDGE_PUNCT, '');
}

/** Split a word core into name-able parts: "il-Ġużeppi" → ["il", "Ġużeppi"]. */
function parts(text) {
  return core(text).split(/[-–]/).filter(Boolean);
}

function lev1(a, b) {
  // true when edit distance <= 1
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else { i++; j++; }
  }
  return diff + (la - i) + (lb - j) <= 1;
}

/**
 * Groups of words that look like the same name spelled differently, e.g.
 * "Ġużeppi" / "Guzeppi" / "Guzepi". Only groups where at least one form is
 * capitalised and the forms differ by more than letter case are returned.
 *   → [{ key, total, variants: [{ text, count }] }]
 */
export function findNameVariants(cues) {
  const counts = new Map();   // exact part text → count
  for (const c of cues) for (const w of c.words) for (const p of parts(w.text)) {
    if (p.length < 3) continue;
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  const byKey = new Map();    // normKey → Set(texts)
  for (const text of counts.keys()) {
    const k = normKey(text);
    if (k.length < 3) continue;
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(text);
  }
  const capital = t => /^\p{Lu}/u.test(t);
  const candidateKeys = [...byKey.keys()].filter(k => [...byKey.get(k)].some(capital));

  // union-find over candidate keys: merge keys within edit distance 1 (len ≥ 5)
  const parent = new Map(candidateKeys.map(k => [k, k]));
  const find = k => { while (parent.get(k) !== k) k = parent.get(k); return k; };
  for (let a = 0; a < candidateKeys.length; a++) {
    for (let b = a + 1; b < candidateKeys.length; b++) {
      const ka = candidateKeys[a], kb = candidateKeys[b];
      if (Math.min(ka.length, kb.length) >= 5 && lev1(ka, kb)) parent.set(find(ka), find(kb));
    }
  }
  const groups = new Map();
  for (const k of candidateKeys) {
    const root = find(k);
    if (!groups.has(root)) groups.set(root, new Set());
    for (const t of byKey.get(k)) groups.get(root).add(t);
  }
  const out = [];
  for (const [key, set] of groups) {
    const variants = [...set].map(text => ({ text, count: counts.get(text) }));
    const distinctLower = new Set(variants.map(v => v.text.toLowerCase()));
    if (distinctLower.size < 2) continue;
    // most used first; on a tie prefer the capitalised form, then the one with
    // Maltese letters (ħ ġ ċ ż …), which is more likely the correct spelling
    const marks = t => (t.match(/[^\x00-\x7F]/g) || []).length;
    variants.sort((x, y) => y.count - x.count || (capital(y.text) - capital(x.text)) || marks(y.text) - marks(x.text));
    out.push({ key, total: variants.reduce((n, v) => n + v.count, 0), variants });
  }
  return out.sort((a, b) => b.total - a.total);
}

/** Replace every whole-part occurrence of any `from` spelling with `to`. */
export function replaceVariants(cues, from, to) {
  const set = new Set(from.filter(f => f !== to));
  if (!set.size || !to) return false;
  let changed = false;
  for (const c of cues) for (const w of c.words) {
    const next = w.text.replace(/[^\s\-–"'“”‘’«»()\[\]{}.,;:!?…]+/gu, m => (set.has(m) ? to : m));
    if (next !== w.text) { w.text = next; w.prob = 1; changed = true; }
  }
  return changed;
}

/** Plain find & replace inside word texts. Returns the number of words changed. */
export function replaceText(cues, find, repl, { matchCase = false } = {}) {
  if (!find) return 0;
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc, matchCase ? 'g' : 'gi');
  let n = 0;
  for (const c of cues) for (const w of c.words) {
    const next = w.text.replace(re, repl);
    if (next !== w.text) { w.text = next.trim() || w.text; w.prob = 1; n++; }
  }
  return n;
}

// ── Line wrapping (shared by the preview and the ASS export) ────────────────

/**
 * Break a cue's words into lines of at most `maxChars` characters.
 * Two lines are balanced; returns arrays of word indices.
 */
export function wrapLines(words, maxChars = 32) {
  const lens = words.map(w => w.text.length);
  const total = lens.reduce((n, l) => n + l, 0) + Math.max(0, lens.length - 1);
  if (total <= maxChars || words.length < 2) return [words.map((_, i) => i)];
  // try a balanced two-line split first
  let best = -1, bestScore = Infinity, left = 0;
  for (let k = 1; k < words.length; k++) {
    left += lens[k - 1] + (k > 1 ? 1 : 0);
    const right = total - left - 1;
    const over = Math.max(0, left - maxChars) + Math.max(0, right - maxChars);
    const score = over * 1000 + Math.abs(left - right);
    if (score < bestScore) { bestScore = score; best = k; }
  }
  const idx = words.map((_, i) => i);
  if (bestScore < 1000) return [idx.slice(0, best), idx.slice(best)];
  // greedy fallback for very long cues
  const lines = [];
  let line = [], len = 0;
  for (let i = 0; i < words.length; i++) {
    const add = (line.length ? 1 : 0) + lens[i];
    if (line.length && len + add > maxChars) { lines.push(line); line = []; len = 0; }
    len += (line.length ? 1 : 0) + lens[i];
    line.push(i);
  }
  if (line.length) lines.push(line);
  return lines;
}

// ── SRT ──────────────────────────────────────────────────────────────────────

export function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function buildSrt(cues, { maxChars = 0 } = {}) {
  return cues
    .filter(c => c.words.length)
    .map((c, i) => {
      const text = maxChars
        ? wrapLines(c.words, maxChars).map(l => l.map(k => c.words[k].text).join(' ')).join('\n')
        : cueText(c);
      return `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${text}`;
    })
    .join('\n\n') + '\n';
}

// ── Undoable document ────────────────────────────────────────────────────────

// ── Maltese articles across cues ─────────────────────────────────────────────

/**
 * Merge split articles / short forms ("L" "-festa" → "l-festa") across the
 * whole cue list. A merged word stays in the cue its first piece was in.
 */
export function mergeArticlesInCues(cues) {
  const flat = [];
  cues.forEach((c, ci) => c.words.forEach(w => flat.push([ci, w])));
  const groups = mergeTokens(flat.map(([, w]) => w.text));
  if (groups.length === flat.length) return false;
  const byCue = cues.map(() => []);
  for (const { from, to, text } of groups) {
    const part = flat.slice(from, to + 1).map(([, w]) => w);
    const word = from === to ? part[0] : {
      ...part[0],
      text,
      end: Math.max(...part.map(w => w.end)),
      prob: Math.min(...part.map(w => w.prob ?? 1)),
      kw: part.some(w => w.kw),
    };
    byCue[flat[from][0]].push(word);
  }
  for (let ci = cues.length - 1; ci >= 0; ci--) {
    const c = cues[ci];
    c.words = byCue[ci];
    if (!c.words.length) {
      const prev = cues[ci - 1];
      if (prev) prev.end = Math.max(prev.end, c.end);
      cues.splice(ci, 1);
      continue;
    }
    c.end = Math.max(c.end, c.words[c.words.length - 1].end);
  }
  for (let ci = 1; ci < cues.length; ci++) {
    if (cues[ci].start < cues[ci - 1].end) cues[ci].start = cues[ci - 1].end;
    if (cues[ci].end - cues[ci].start < MIN_CUE) cues[ci].end = cues[ci].start + MIN_CUE;
  }
  return true;
}

/** Replace one word's text (used by the "Artikli" fixes). */
export function setWordText(cues, i, k, text) {
  const w = cues[i]?.words[k];
  if (!w || !text || w.text === text) return false;
  w.text = text;
  w.prob = 1;
  return true;
}

/** Glue word k of cue i to the following word (possibly in the next cue). */
export function joinWordWithNext(cues, i, k) {
  const c = cues[i];
  if (!c?.words[k]) return false;
  let nc = c, nk = k + 1;
  if (nk >= c.words.length) { nc = cues[i + 1]; nk = 0; }
  const next = nc?.words[nk];
  if (!next) return false;
  const w = c.words[k];
  w.text = (w.text + next.text).replace(/[-‐]{2,}/u, '-');
  w.end = Math.max(w.end, next.end);
  w.prob = Math.min(w.prob ?? 1, next.prob ?? 1);
  w.kw = w.kw || next.kw;
  nc.words.splice(nk, 1);
  if (nc !== c) {
    c.end = Math.max(c.end, w.end);
    if (!nc.words.length) cues.splice(i + 1, 1);
    else nc.start = Math.max(nc.start, c.end);
  }
  return true;
}

// ── Readability ──────────────────────────────────────────────────────────────

/** Problems a viewer would notice: 'fast' (too many chars/s), 'short', 'lines' (more than maxLines, normally 2). */
export function cueIssues(cue, { maxChars = 32, maxLines = MAX_LINES } = {}) {
  const out = [];
  const dur = cue.end - cue.start;
  const chars = cueText(cue).length;
  if (dur > 0 && chars / dur > CPS_MAX) out.push('fast');
  if (dur < MIN_READ) out.push('short');
  if (wrapLines(cue.words, maxChars).length > maxLines) out.push('lines');
  return out;
}

/** Next cue (after i, wrapping) with any readability issue, or -1. */
export function nextIssueCue(cues, i, opts) {
  for (let n = 1; n <= cues.length; n++) {
    const j = (i + n + cues.length) % cues.length;
    if (cueIssues(cues[j], opts).length) return j;
  }
  return -1;
}

// ── Suggested keywords ───────────────────────────────────────────────────────

/**
 * At most one suggestion per cue: a number, else a name (capitalised, not at
 * a sentence start), else the longest word of 9+ letters. → [[i, k], ...]
 */
export function suggestKeywords(cues) {
  const out = [];
  const coreOf = t => t.replace(/^[\s"'“”‘’«»(]+|[\s"'“”‘’«»).,;:!?…]+$/gu, '');
  let prevText = null;
  cues.forEach((c, i) => {
    if (c.words.some(w => w.kw)) { prevText = c.words.at(-1)?.text ?? prevText; return; }
    let best = -1, bestScore = 0;
    c.words.forEach((w, k) => {
      const core = coreOf(w.text);
      const before = k ? c.words[k - 1].text : prevText;
      const sentenceStart = before == null || /[.!?…]["”»)]?$/u.test(before);
      const tail = core.split(/[-‐'’]/u).pop() || '';
      let score = 0;
      if (/\d/.test(core)) score = 3;
      else if (!sentenceStart && /^\p{Lu}/u.test(tail) && tail.length >= 3) score = 2;
      else if (tail.length >= 9) score = 1 + tail.length / 100;
      if (score > bestScore) { bestScore = score; best = k; }
    });
    if (best >= 0) out.push([i, best]);
    prevText = c.words.at(-1)?.text ?? prevText;
  });
  return out;
}

export function markKeywords(cues, pairs) {
  let n = 0;
  for (const [i, k] of pairs) {
    const w = cues[i]?.words[k];
    if (w && !w.kw) { w.kw = true; n++; }
  }
  return n > 0;
}

// ── Timeline helpers ─────────────────────────────────────────────────────────

/** Set cue i's bounds, clamped so it never overlaps its neighbours. */
export function setCueTimes(cues, i, start, end) {
  const c = cues[i];
  if (!c) return false;
  const lo = i > 0 ? cues[i - 1].end : 0;
  const hi = i < cues.length - 1 ? cues[i + 1].start : Infinity;
  let s = clamp(start, lo, hi - MIN_CUE);
  let e = clamp(end, s + MIN_CUE, hi);
  if (e - s < MIN_CUE) return false;
  if (s === c.start && e === c.end) return false;
  c.start = s;
  c.end = e;
  return true;
}

/** Move cue i by dt seconds, keeping its length and clamping to neighbours. */
export function moveCue(cues, i, dt, origin = null) {
  const c = cues[i];
  if (!c) return false;
  const o = origin || c;
  const len = o.end - o.start;
  const lo = i > 0 ? cues[i - 1].end : 0;
  const hi = i < cues.length - 1 ? cues[i + 1].start : Infinity;
  const s = clamp(o.start + dt, lo, hi - len);
  if (s < lo) return false;
  c.start = s;
  c.end = s + len;
  return true;
}

const MIN_WORD = 0.03;

/**
 * Retime when word k of cue i is highlighted (its start). The word stays between
 * its neighbours; the word before it ends where this one starts. Word 0 is
 * pinned to the cue start, so k must be ≥ 1.
 */
export function setWordStart(cues, i, k, t) {
  const c = cues[i];
  const w = c?.words[k];
  if (!w || k < 1) return false;
  const prev = c.words[k - 1];
  const next = c.words[k + 1];
  const lo = Math.max(c.start, prev.start) + MIN_WORD;
  const hi = (next ? next.start : c.end) - MIN_WORD;
  if (hi < lo) return false;
  const s = clamp(t, lo, hi);
  if (s === w.start) return false;
  const old = w.start;
  w.start = s;
  if (w.end < s + MIN_WORD) w.end = Math.min(s + MIN_WORD, c.end);
  if (prev.end > s || prev.end >= old - 0.06) prev.end = s;   // keep touching words touching
  return true;
}

/** Word start/end times of cues i-1..i+1, for snapping. */
export function snapTimes(cues, i) {
  const out = [];
  for (let j = Math.max(0, i - 1); j <= Math.min(cues.length - 1, i + 1); j++) {
    for (const w of cues[j].words) out.push(w.start, w.end);
  }
  return out.sort((a, b) => a - b);
}

// ── Undoable document ────────────────────────────────────────────────────────

export class SubtitleDoc {
  constructor(cues = [], { limit = 200 } = {}) {
    this.cues = cues;
    this.limit = limit;
    this.undoStack = [];   // [{ cues, label }]
    this.redoStack = [];
    this.listeners = new Set();
    this._live = null;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(kind, label) { for (const fn of this.listeners) fn(kind, label); }

  _push(before, label) {
    this.undoStack.push({ cues: before, label });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Run fn(cues); if it returns true the previous state goes on the undo stack. */
  apply(fn, label = '') {
    const before = clone(this.cues);
    const ok = fn(this.cues);
    if (!ok) { this.cues = before; return false; }
    this._push(before, label);
    this._emit('edit', label);
    return true;
  }

  replace(cues, label = '') {
    return this.apply(c => { c.splice(0, c.length, ...cues); return true; }, label);
  }

  // Live edits (timeline drags): many small changes, one undo step.
  beginLive() { this._live = clone(this.cues); }
  live(fn) { if (this._live && fn(this.cues) !== false) this._emit('live'); }
  commitLive(label = '') {
    const before = this._live;
    this._live = null;
    if (!before || JSON.stringify(before) === JSON.stringify(this.cues)) { this._emit('live'); return false; }
    this._push(before, label);
    this._emit('edit', label);
    return true;
  }
  cancelLive() {
    if (!this._live) return;
    this.cues = this._live;
    this._live = null;
    this._emit('undo');
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Returns the undone step's label ('' if none), or null if nothing to undo. */
  undo() {
    if (!this.undoStack.length) return null;
    const step = this.undoStack.pop();
    this.redoStack.push({ cues: clone(this.cues), label: step.label });
    this.cues = step.cues;
    this._emit('undo', step.label);
    return step.label;
  }

  redo() {
    if (!this.redoStack.length) return null;
    const step = this.redoStack.pop();
    this.undoStack.push({ cues: clone(this.cues), label: step.label });
    this.cues = step.cues;
    this._emit('redo', step.label);
    return step.label;
  }
}
