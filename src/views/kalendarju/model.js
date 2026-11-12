// The local calendar's pure rules: no Date in the computer's time zone, no storage, no UI.
//
// Times are Malta wall-clock strings, the way people think of them ("the festa starts at
// 19:00"), so a layout never depends on the zone of the computer or on DST:
//   timed event   start/end = 'YYYY-MM-DDTHH:mm'
//   all-day event start/end = 'YYYY-MM-DD', end exclusive (a one-day event ends the next day)
// A server can store the same strings next to tz = 'Europe/Malta'. Scheduled posts keep real
// instants; the screen converts them with malta-time.js before they reach this module.

export const LIMITS = { title: 120, label: 40, location: 120, description: 2000, occurrences: 800 };
export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];

const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) && dateOk(s);
const isWall = (s) => typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(s) && dateOk(s.slice(0, 10)) && +s.slice(11, 13) < 24 && +s.slice(14) < 60;
function dateOk(s) {
  const t = Date.parse(s + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}
const dayNo = (s) => Math.floor(Date.parse(s.slice(0, 10) + 'T00:00:00Z') / DAY_MS);
const fromDayNo = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export const dayOf = (s) => s.slice(0, 10);
export const timeOf = (s) => s.slice(11, 16);
export const minutesOf = (s) => +s.slice(11, 13) * 60 + +s.slice(14, 16);
export const addDays = (s, n) => fromDayNo(dayNo(s) + n) + s.slice(10);
export const daysBetween = (a, b) => dayNo(b) - dayNo(a);
/** 0 = Sunday … 6 = Saturday */
export const weekday = (s) => new Date(dayNo(s) * DAY_MS).getUTCDay();
export const mondayOf = (s) => addDays(dayOf(s), -((weekday(s) + 6) % 7));
export const monthStart = (s) => s.slice(0, 8) + '01';
export const addMonths = (s, n) => {
  const t = +s.slice(0, 4) * 12 + (+s.slice(5, 7) - 1) + n;
  const y = Math.floor(t / 12), m = t % 12;
  return `${y}-${pad(m + 1)}-01`;
};
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/** A wall time moved by whole minutes (can cross midnight). */
export function shiftWall(s, minutes) {
  const t = Date.parse(s + ':00Z') + minutes * 60000;
  return new Date(t).toISOString().slice(0, 16);
}
export const wallOf = (day, minutes) => `${day}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
export const wallMinutesBetween = (a, b) => Math.round((Date.parse(b + ':00Z') - Date.parse(a + ':00Z')) / 60000);

/** The weeks (Monday first) that cover the month containing `day`; each week is 7 date strings. */
export function monthGrid(day) {
  const first = monthStart(day);
  const last = addDays(addMonths(first, 1), -1);
  const weeks = [];
  for (let d = mondayOf(first); d <= last; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return weeks;
}

// ── Validation ───────────────────────────────────────────────────────────────
/** → { event } with only the stored fields, or { error } in Maltese. */
export function cleanEvent(input = {}) {
  const title = String(input.title ?? '').trim();
  if (!title) return { error: 'It-titlu huwa meħtieġ.' };
  if (title.length > LIMITS.title) return { error: `It-titlu twil wisq (massimu ${LIMITS.title}).` };
  const allDay = !!input.allDay;
  const { start, end } = input;
  if (allDay ? !isDate(start) || !isDate(end) : !isWall(start) || !isWall(end)) return { error: 'Agħżel dati u ħinijiet validi.' };
  if (end <= start) return { error: 'It-tmiem irid ikun wara l-bidu.' };
  const label = String(input.label ?? '').trim();
  const location = String(input.location ?? '').trim();
  const description = String(input.description ?? '').trim();
  if (label.length > LIMITS.label) return { error: 'Il-label twila wisq.' };
  if (location.length > LIMITS.location) return { error: 'Il-post twil wisq.' };
  if (description.length > LIMITS.description) return { error: 'In-noti twal wisq.' };
  const repeat = cleanRepeat(input.repeat, start);
  if (repeat === false) return { error: 'Ir-ripetizzjoni mhix valida.' };
  return { event: { title, label, allDay, start, end, location, description, repeat } };
}
function cleanRepeat(r, start) {
  if (!r) return null;
  if (!FREQS.includes(r.freq)) return false;
  const interval = Number.isInteger(+r.interval) ? +r.interval : 1;
  if (interval < 1 || interval > 30) return false;
  const until = r.until ? String(r.until).slice(0, 10) : null;
  if (until && (!isDate(until) || until < dayOf(start))) return false;
  return { freq: r.freq, interval, until };
}

// ── Occurrences ──────────────────────────────────────────────────────────────
/** Day numbers of the days an occurrence touches, as [firstDay, lastDay] inclusive. */
function span(startDay, start, end, allDay) {
  const endDay = allDay ? addDays(end, -1) : dayOf(end) > dayOf(start) && timeOf(end) === '00:00' ? addDays(dayOf(end), -1) : dayOf(end);
  return [startDay, endDay < startDay ? startDay : endDay];
}

function repeatStarts(e, from, to) {
  // Start days (YYYY-MM-DD) of every repetition that could touch [from, to).
  const r = e.repeat, first = dayOf(e.start), out = [];
  if (!r) return [first];
  const lengthDays = daysBetween(first, e.allDay ? e.end : dayOf(e.end));
  const stop = r.until && r.until < to ? addDays(r.until, 1) : to;
  const pushIf = (d) => { if (d < stop && addDays(d, Math.max(lengthDays, 1)) > from && d >= first) out.push(d); };
  if (r.freq === 'daily' || r.freq === 'weekly') {
    const step = r.interval * (r.freq === 'weekly' ? 7 : 1);
    const skip = Math.max(0, Math.floor((daysBetween(first, from) - lengthDays) / step));
    for (let i = skip, d = addDays(first, i * step); d < stop && out.length < LIMITS.occurrences; i++, d = addDays(first, i * step)) pushIf(d);
  } else {
    const dom = +first.slice(8), fm = +first.slice(0, 4) * 12 + (+first.slice(5, 7) - 1);
    const stepM = r.freq === 'yearly' ? 12 * r.interval : r.interval;
    for (let i = 0; out.length < LIMITS.occurrences; i++) {
      const t = fm + i * stepM, y = Math.floor(t / 12), m = (t % 12) + 1;
      const d = `${y}-${pad(m)}-${pad(dom)}`;
      if (d >= stop) break;
      if (dom <= daysInMonth(y, m)) pushIf(d); // a 31st skips the short months, as iCalendar does
    }
  }
  return out;
}

/**
 * Every occurrence of `events` that touches the days [from, to) (date strings), sorted:
 * { event, key, start, end, allDay, first, last } where first/last are the first and last day
 * (inclusive) the occurrence covers. `key` is unique per repetition.
 */
export function occurrences(events, from, to) {
  const out = [];
  for (const e of events) {
    for (const d of repeatStarts(e, from, to)) {
      const shift = daysBetween(dayOf(e.start), d);
      const start = shift ? addDays(e.start, shift) : e.start;
      const end = shift ? addDays(e.end, shift) : e.end;
      const [first, last] = span(d, start, end, e.allDay);
      if (last < from || first >= to) continue;
      out.push({ event: e, key: `${e.id}@${d}`, start, end, allDay: e.allDay, first, last });
    }
  }
  return out.sort((a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : a.start > b.start ? 1 : a.event.title.localeCompare(b.event.title)) : a.allDay ? -1 : 1));
}
export const touches = (o, day) => o.first <= day && day <= o.last;

/**
 * Lay the timed items of one day into columns so overlapping items sit side by side.
 * items: { start, end } wall strings (anything else is carried along).
 * → [{ item, top, height, col, cols }] in minutes from midnight; an item that runs past
 * midnight is clipped to the day; every item is at least 20 minutes tall.
 */
export function layoutDay(items, day) {
  const next = addDays(day, 1);
  const rows = items
    .map((item) => {
      const s = item.start < day + 'T00:00' ? 0 : minutesOf(item.start);
      let e = item.end >= next + 'T00:00' ? 1440 : minutesOf(item.end);
      if (e < s + 20) e = Math.min(1440, s + 20);
      return { item, top: s, end: e };
    })
    .sort((a, b) => a.top - b.top || b.end - a.end);
  const out = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((r) => r.col + 1));
    for (const r of cluster) out.push({ item: r.item, top: r.top, height: r.end - r.top, col: r.col, cols });
    cluster = []; clusterEnd = -1;
  };
  for (const r of rows) {
    if (r.top >= clusterEnd) flush();
    const taken = new Set(cluster.filter((c) => c.end > r.top).map((c) => c.col));
    r.col = 0;
    while (taken.has(r.col)) r.col++;
    cluster.push(r);
    clusterEnd = Math.max(clusterEnd, r.end);
  }
  flush();
  return out;
}

/** An event moved by whole days and minutes (all-day events ignore minutes). */
export function moved(event, dDays, dMinutes = 0) {
  if (event.allDay) return { start: addDays(event.start, dDays), end: addDays(event.end, dDays) };
  const m = dDays * 1440 + dMinutes;
  return { start: shiftWall(event.start, m), end: shiftWall(event.end, m) };
}
/** A timed event with its end moved by `dMinutes` (never shorter than 15 minutes). */
export function resized(event, dMinutes) {
  const end = shiftWall(event.end, dMinutes);
  return { start: event.start, end: wallMinutesBetween(event.start, end) < 15 ? shiftWall(event.start, 15) : end };
}
