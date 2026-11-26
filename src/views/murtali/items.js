// Murtali: edits of the item list. Pure: every function takes a document and returns a new one
// (or the same object when nothing changed).
//
//   doc = { items: [{ id, source, start, end, auto, keep, crop: { x } | null, label, peak, peakAt }],
//           reel: [item id, ...] }          the reel's order
//
// Moving an edge, splitting, joining or adding sets `auto: false`: detection never overwrites
// those (segments.redetect). Items never overlap inside one source.

import { newId } from './segments.js';

export const MIN_ITEM = 0.5; // seconds
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round3 = (v) => Math.round(v * 1000) / 1000;

export const emptyDoc = () => ({ items: [], reel: [] });
export const sortItems = (items) => [...items].sort((a, b) => a.source - b.source || a.start - b.start);
/** A document with these items (sorted); reel entries whose item is gone are dropped. */
export const setItems = (doc, items) => withItems(doc, items);
export const find = (doc, id) => doc.items.find((i) => i.id === id);
function withItems(doc, items) {
  return { ...doc, items: sortItems(items), reel: doc.reel.filter((id) => items.some((i) => i.id === id)) };
}
const patch = (doc, id, p) => ({ ...doc, items: doc.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });

/** The free neighbours of an item: the end of the previous one and the start of the next one in its source. */
function room(doc, item, duration) {
  const same = doc.items.filter((i) => i.source === item.source && i.id !== item.id);
  const before = same.filter((i) => i.end <= item.start + 1e-9).reduce((m, i) => Math.max(m, i.end), 0);
  const after = same.filter((i) => i.start >= item.end - 1e-9).reduce((m, i) => Math.min(m, i.start), duration ?? Infinity);
  return [before, Math.min(after, duration ?? Infinity)];
}

/** Move an item's start and/or end. Clamped to the clip, the neighbours and MIN_ITEM. */
export function trim(doc, id, { start, end }, { duration } = {}) {
  const it = find(doc, id);
  if (!it) return doc;
  const [lo, hi] = room(doc, it, duration);
  let s = start ?? it.start, e = end ?? it.end;
  if (start !== undefined) s = clamp(s, lo, it.end - MIN_ITEM);
  if (end !== undefined) e = clamp(e, s + MIN_ITEM, hi);
  s = round3(s); e = round3(e);
  if (s === it.start && e === it.end) return doc;
  return patch(doc, id, { start: s, end: e, auto: false });
}

/** Cut the item under `at` in two (each at least MIN_ITEM long). The new second half is not in the reel. */
export function split(doc, at, source = null) {
  const it = doc.items.find((i) => (source === null || i.source === source) && at > i.start + MIN_ITEM && at < i.end - MIN_ITEM);
  if (!it) return doc;
  const second = { ...it, id: newId(doc.items), start: round3(at), auto: false, keep: it.keep };
  const first = { ...it, end: round3(at), auto: false };
  return withItems(doc, [...doc.items.filter((i) => i.id !== it.id), first, second]);
}

/** Join an item with the next one of the same source. */
export function join(doc, id) {
  const it = find(doc, id);
  if (!it) return doc;
  const next = sortItems(doc.items.filter((i) => i.source === it.source && i.start >= it.end - 1e-9))[0];
  if (!next) return doc;
  const joined = { ...it, end: next.end, auto: false, peak: Math.max(it.peak ?? 0, next.peak ?? 0), peakAt: (it.peak ?? 0) >= (next.peak ?? 0) ? it.peakAt : next.peakAt };
  return withItems(doc, [...doc.items.filter((i) => i.id !== it.id && i.id !== next.id), joined]);
}

export function remove(doc, id) {
  if (!find(doc, id)) return doc;
  return withItems(doc, doc.items.filter((i) => i.id !== id));
}

/** A new item by hand (I/O keys). Fitted into the free space around it; unchanged when there is none. */
export function add(doc, source, start, end, { duration } = {}) {
  let a = clamp(Math.min(start, end), 0, duration ?? Infinity), b = clamp(Math.max(start, end), 0, duration ?? Infinity);
  // the largest free piece of [a, b]
  let pieces = [[a, b]];
  for (const i of doc.items.filter((x) => x.source === source)) {
    pieces = pieces.flatMap(([p, q]) => {
      if (i.end <= p || i.start >= q) return [[p, q]];
      const out = [];
      if (i.start - p > 0) out.push([p, i.start]);
      if (q - i.end > 0) out.push([i.end, q]);
      return out;
    });
  }
  const best = pieces.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0];
  if (!best || best[1] - best[0] < MIN_ITEM) return doc;
  const item = { id: newId(doc.items), source, start: round3(best[0]), end: round3(best[1]), auto: false, keep: true, crop: null, label: '', peak: 0, peakAt: round3((best[0] + best[1]) / 2) };
  return withItems(doc, [...doc.items, item]);
}

export const toggleKeep = (doc, id) => { const it = find(doc, id); return it ? patch(doc, id, { keep: it.keep === false }) : doc; };

export function toggleReel(doc, id) {
  if (!find(doc, id)) return doc;
  return { ...doc, reel: doc.reel.includes(id) ? doc.reel.filter((x) => x !== id) : [...doc.reel, id] };
}

/** Set the reel to exactly these ids (e.g. "Agħżel l-aqwa 7"), in the order given. */
export function setReel(doc, ids) {
  return { ...doc, reel: ids.filter((id, k) => find(doc, id) && ids.indexOf(id) === k) };
}

/** Move the reel entry at index `from` to index `to`. */
export function reorderReel(doc, from, to) {
  const n = doc.reel.length;
  if (from === to || from < 0 || from >= n || to < 0 || to >= n) return doc;
  const reel = [...doc.reel];
  const [x] = reel.splice(from, 1);
  reel.splice(to, 0, x);
  return { ...doc, reel };
}

/** Aim an item's 9:16 window: x = the window's centre across the frame, 0-1. */
export function setCrop(doc, id, x) {
  if (!find(doc, id)) return doc;
  return patch(doc, id, { crop: { x: round3(clamp(x, 0, 1)) } });
}

/** The same window position for every reel item. */
export function copyCropToAll(doc, id) {
  const x = find(doc, id)?.crop?.x;
  if (x === undefined) return doc;
  return { ...doc, items: doc.items.map((i) => (doc.reel.includes(i.id) ? { ...i, crop: { x } } : i)) };
}
