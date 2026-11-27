// Calendar event rules shared by the desktop (src/views/kalendarju/) and the server
// (api/events.js), so an event is checked the same way wherever it is saved.
//
// Times are Malta wall-clock strings, stored next to tz = 'Europe/Malta':
//   timed event   start/end = 'YYYY-MM-DDTHH:mm'
//   all-day event start/end = 'YYYY-MM-DD', end exclusive

export const LIMITS = { title: 120, label: 40, location: 120, description: 2000, occurrences: 800, name: 80, goal: 300, owner: 60, category: 80 };
export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
export const MAX_EVENTS = 5000;
export const MAX_LABELS = 30;
export const MAX_CAMPAIGNS = 200;
export const MAX_SLOTS = 5000;
/** A planned post's progress; 'done' means a real post was scheduled from it. */
export const SLOT_STATUSES = ['idea', 'draft', 'ready', 'done'];
/** Platforms a slot may name (src/platforms.js holds the full list; this is the server's copy). */
export const SLOT_PLATFORMS = ['fb', 'ig', 'tt', 'web'];
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
  const campaign = linkOf(input.campaign);
  if (campaign === false) return { error: 'Il-kampanja mhix valida.' };
  const repeat = cleanRepeat(input.repeat, start);
  if (repeat === false) return { error: 'Ir-ripetizzjoni mhix valida.' };
  // The poster is a Google Drive file kept by its id and name (Drive keeps the file itself).
  const p = input.poster;
  const poster = p && typeof p.id === 'string' && p.id && p.id.length <= 200 ? { id: p.id, name: String(p.name ?? '').slice(0, 200) } : null;
  return { event: { title, label, allDay, start, end, location, description, repeat, poster, campaign } };
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

/** '' (no link) or a uuid; false when it is neither. */
function linkOf(v) {
  const s = String(v ?? '').trim();
  return !s ? '' : validUuid(s) ? s : false;
}

// ── Campaigns ────────────────────────────────────────────────────────────────
// A campaign is a named run of days (from/to inclusive, 'YYYY-MM-DD') with a colour, a goal
// and an optional target of posts per week. Events and slots point at it by id; posts belong
// to it by date (a post has no campaign field).
/** → { campaign } with only the stored fields, or { error } in Maltese. */
export function cleanCampaign(input = {}) {
  const name = String(input.name ?? '').trim();
  if (!name) return { error: 'L-isem tal-kampanja huwa meħtieġ.' };
  if (name.length > LIMITS.name) return { error: `L-isem twil wisq (massimu ${LIMITS.name}).` };
  const { from, to } = input;
  if (!isDate(from) || !isDate(to)) return { error: 'Agħżel dati validi.' };
  if (to < from) return { error: 'L-aħħar jum irid ikun wara l-ewwel.' };
  const goal = String(input.goal ?? '').trim();
  const notes = String(input.notes ?? '').trim();
  if (goal.length > LIMITS.goal) return { error: 'L-għan twil wisq.' };
  if (notes.length > LIMITS.description) return { error: 'In-noti twal wisq.' };
  const t = input.target === '' || input.target == null ? 0 : Number(input.target);
  if (!Number.isInteger(t) || t < 0 || t > 50) return { error: 'Il-mira trid tkun bejn 0 u 50 post fil-ġimgħa.' };
  const color = /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#3355D1';
  return { campaign: { name, color, from, to, goal, target: t, notes } };
}

// ── Slots (planned posts) ────────────────────────────────────────────────────
// A post that is planned but not made yet: a day, an optional time, the platforms, a status,
// and links to a campaign and an event. Scheduling a post from it sets status 'done' + post_id.
// `owner` is who prepares it (a name), `due` the day it must be ready by ('' = its own day),
// `category` its type (Poster, Reel…; the same free text as a post's Kategorija).
/** → { slot } with only the stored fields, or { error } in Maltese. */
export function cleanSlot(input = {}) {
  const title = String(input.title ?? '').trim();
  if (!title) return { error: 'It-titlu huwa meħtieġ.' };
  if (title.length > LIMITS.title) return { error: `It-titlu twil wisq (massimu ${LIMITS.title}).` };
  if (!isDate(input.day)) return { error: 'Agħżel jum validu.' };
  const time = String(input.time ?? '');
  if (time && !(/^\d\d:\d\d$/.test(time) && +time.slice(0, 2) < 24 && +time.slice(3) < 60)) return { error: 'Il-ħin mhux validu.' };
  const raw = Array.isArray(input.platforms) ? input.platforms : [];
  if (raw.some((p) => !SLOT_PLATFORMS.includes(p))) return { error: 'Pjattaforma mhix magħrufa.' };
  const platforms = SLOT_PLATFORMS.filter((p) => raw.includes(p));
  const status = input.status ?? 'idea';
  if (!SLOT_STATUSES.includes(status)) return { error: 'L-istat mhux validu.' };
  const campaign = linkOf(input.campaign), event = linkOf(input.event);
  if (campaign === false) return { error: 'Il-kampanja mhix valida.' };
  if (event === false) return { error: 'L-avveniment mhux validu.' };
  const notes = String(input.notes ?? '').trim();
  if (notes.length > LIMITS.description) return { error: 'In-noti twal wisq.' };
  const postId = String(input.post_id ?? '').slice(0, 100);
  const owner = String(input.owner ?? '').trim();
  const category = String(input.category ?? '').trim();
  if (owner.length > LIMITS.owner) return { error: 'L-isem twil wisq.' };
  if (category.length > LIMITS.category) return { error: 'It-tip twil wisq.' };
  const due = String(input.due ?? '');
  if (due && !isDate(due)) return { error: 'Id-data “lest sa” mhix valida.' };
  return { slot: { title, day: input.day, time, platforms, status, campaign, event, notes, post_id: postId, owner, due, category } };
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
