// Calendar event rules shared by the desktop (src/views/kalendarju/) and the server
// (api/events.js), so an event is checked the same way wherever it is saved.
//
// Times are Malta wall-clock strings, stored next to tz = 'Europe/Malta':
//   timed event   start/end = 'YYYY-MM-DDTHH:mm'
//   all-day event start/end = 'YYYY-MM-DD', end exclusive

export const LIMITS = { title: 120, label: 40, location: 120, description: 2000, occurrences: 800 };
export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
export const MAX_EVENTS = 5000;
export const MAX_LABELS = 30;
export const DEFAULT_LABELS = [
  { name: 'Festa', color: '#C2410C', visible: true },
  { name: 'Quddiesa', color: '#0F766E', visible: true },
  { name: 'Prova', color: '#6D28D9', visible: true },
];

function dateOk(s) {
  const t = Date.parse(s + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) && dateOk(s);
const isWall = (s) =>
  typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(s) && dateOk(s.slice(0, 10)) && +s.slice(11, 13) < 24 && +s.slice(14) < 60;

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
  // The poster is a Google Drive file kept by its id and name (Drive keeps the file itself).
  const p = input.poster;
  const poster = p && typeof p.id === 'string' && p.id && p.id.length <= 200 ? { id: p.id, name: String(p.name ?? '').slice(0, 200) } : null;
  return { event: { title, label, allDay, start, end, location, description, repeat, poster } };
}

function cleanRepeat(r, start) {
  if (!r) return null;
  if (!FREQS.includes(r.freq)) return false;
  const interval = Number.isInteger(+r.interval) ? +r.interval : 1;
  if (interval < 1 || interval > 30) return false;
  const until = r.until ? String(r.until).slice(0, 10) : null;
  if (until && (!isDate(until) || until < start.slice(0, 10))) return false;
  return { freq: r.freq, interval, until };
}

/** The label list: names unique ignoring case, colours #rrggbb. → { labels } or { error }. */
export function cleanLabels(labels) {
  if (!Array.isArray(labels) || labels.length > MAX_LABELS) return { error: `Massimu ${MAX_LABELS} labels.` };
  const seen = new Set(), clean = [];
  for (const l of labels) {
    const name = String(l?.name ?? '').trim();
    if (!name || name.length > LIMITS.label) return { error: 'Isem tal-label mhux validu.' };
    if (seen.has(name.toLowerCase())) return { error: `Il-label "${name}" teżisti diġà.` };
    seen.add(name.toLowerCase());
    clean.push({ name, color: /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#3355D1', visible: l.visible !== false });
  }
  return { labels: clean };
}

export const validUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
