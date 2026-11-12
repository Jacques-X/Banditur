// The Gantt view's maths, kept free of the DOM so it can be tested
// (gantt-model.test.mjs): scales, the visible date range, axis ticks, bar
// geometry and what a drag does to a card's dates. Dates are YYYY-MM-DD
// strings (Malta calendar days), handled as UTC day numbers.
import { MONTHS, MONTHS_SHORT } from '../../lib/format.js';
import { sortedColumns, cardsIn } from './model.js';

/** Zoom levels: pixels per day. */
export const SCALES = {
  week: { id: 'week', name: 'Ġimgħat', px: 30 },
  month: { id: 'month', name: 'Xhur', px: 7 },
  year: { id: 'year', name: 'Sena', px: 3 },
};

const DAY = 86400000;
export const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
export const isoOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (iso, n) => isoOf(dayNum(iso) + n);
const weekday = (n) => (new Date(n * DAY).getUTCDay() + 6) % 7; // Monday = 0

/** The days a card covers: [start, end] (inclusive) or null when it has no dates. */
export function span(task) {
  const s = task.start_date || task.due_date;
  const e = task.due_date || task.start_date;
  return s ? [s, e] : null;
}

/** A card's dated checklist steps (the sub-timeline): [{ id, text, done, start_date, due_date }]. */
export const stepsOf = (task) => (task.checklist || []).filter((x) => span(x));

/**
 * The days shown: around today and every dated card, padded, then aligned to
 * whole weeks (week scale) or months (month/year scale), and at least 8 weeks,
 * ~6 months or a year long — or `fill` days, to fill the screen's width.
 * → { start, days } with start an ISO date.
 */
export function chartRange(tasks, today, scale = 'week', fill = 0) {
  const t = dayNum(today);
  let lo = t - 7, hi = t + 28;
  for (const task of tasks) {
    for (const s of [span(task), ...stepsOf(task).map(span)]) {
      if (!s) continue;
      lo = Math.min(lo, dayNum(s[0]) - 3);
      hi = Math.max(hi, dayNum(s[1]) + 3);
    }
  }
  if (scale !== 'week') {
    const minDays = Math.max(scale === 'year' ? 365 : 180, fill);
    const first = (n) => { const d = new Date(n * DAY); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY; };
    const next = (n) => { const d = new Date(n * DAY); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY; };
    lo = first(lo);
    let end = next(hi);
    while (end - lo < minDays) end = next(end);
    return { start: isoOf(lo), days: end - lo };
  }
  lo -= weekday(lo);
  let end = hi + (7 - weekday(hi));
  const min = Math.max(56, Math.ceil(fill / 7) * 7);
  if (end - lo < min) end = lo + min;
  return { start: isoOf(lo), days: end - lo };
}

/** x (px) of a date's left edge. */
export const xOf = (iso, range, px) => (dayNum(iso) - dayNum(range.start)) * px;

/**
 * Axis marks for a range.
 * months: [{ x, w, label }] — a band per month (cut at the range's edges).
 * lines:  [{ x, label }]    — week starts (week scale, labelled with the day) or month starts.
 * weekends: [{ x, w }]      — Saturdays and Sundays (week scale only).
 */
export function ticks(range, scale, px) {
  const s = dayNum(range.start), e = s + range.days;
  const months = [], lines = [], weekends = [];
  for (let n = s; n < e; ) {
    const d = new Date(n * DAY);
    const nextMonth = Math.min(e, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY);
    const w = (nextMonth - n) * px;
    const name = w >= 110 ? MONTHS[d.getUTCMonth()] : MONTHS_SHORT[d.getUTCMonth()];
    months.push({ x: (n - s) * px, w, label: `${name} ${d.getUTCFullYear()}` });
    n = nextMonth;
  }
  for (let n = s; n < e; n++) {
    const d = new Date(n * DAY);
    if (scale === 'week') {
      if (weekday(n) === 0) lines.push({ x: (n - s) * px, label: String(d.getUTCDate()) });
      if (weekday(n) === 5) weekends.push({ x: (n - s) * px, w: Math.min(2, e - n) * px });
    } else if (d.getUTCDate() === 1) lines.push({ x: (n - s) * px, label: '' });
  }
  return { months, lines, weekends };
}

/** A card's bar: { x, w } in px, or null when it has no dates. */
export function barOf(task, range, px) {
  const s = span(task);
  if (!s) return null;
  return { x: xOf(s[0], range, px), w: (dayNum(s[1]) - dayNum(s[0]) + 1) * px };
}

/** Whole days moved for a pointer delta of dx pixels. */
export const daysFor = (dx, px) => Math.round(dx / px) || 0;

/**
 * The new dates after dragging a bar `delta` days.
 * mode 'move' shifts both ends; 'start' / 'end' resize one end, never past the
 * other (a bar is at least one day). → { start_date, due_date }
 */
export function dragDates(task, mode, delta) {
  const [s, e] = span(task);
  const a = dayNum(s), b = dayNum(e);
  if (mode === 'start') return { start_date: isoOf(Math.min(a + delta, b)), due_date: e };
  if (mode === 'end') return { start_date: s, due_date: isoOf(Math.max(b + delta, a)) };
  return { start_date: isoOf(a + delta), due_date: isoOf(b + delta) };
}

/** Dates for a card without any, placed where the track was clicked: one week from that day. */
export const newSpan = (day) => ({ start_date: day, due_date: addDays(day, 6) });

/** The day under x px. */
export const dayAt = (x, range, px) => isoOf(dayNum(range.start) + Math.floor(x / px));

/**
 * The rows of a board: its columns in order, each with its cards (in board
 * order). → [{ column, tasks }] plus counts of cards with and without dates.
 */
export function ganttRows(columns, tasks) {
  const groups = sortedColumns(columns).map((column) => ({ column, tasks: cardsIn(tasks, column.id) }));
  const all = groups.flatMap((g) => g.tasks);
  const dated = all.filter((t) => span(t)).length;
  return { groups, dated, undated: all.length - dated };
}
