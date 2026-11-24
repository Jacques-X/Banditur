// The calendar's reactive state: the saved events and labels for the active profile, the chosen
// view and day. The rules are in model.js. Events are kept on this computer (local-store.js)
// unless sharing is on (Settings → Sharing): then they come from the backend's /api/events and
// changes show at once and are saved in the background (a failed save reloads the list).
import { app, ls, toast } from '../../lib/app.svelte.js';
import { api } from '../../lib/api.js';
import { sharing } from '../../lib/sharing.svelte.js';
import { cleanEvent, cleanLabels } from '../../../backend/api/_lib/event-rules.js';
import { maltaWall } from '../../lib/malta-time.js';
import { createCalendarStore } from './local-store.js';
import { addDays, addMonths, mondayOf, monthStart, monthGrid } from './model.js';

export const store = createCalendarStore({ getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) });
export const VIEWS = [['month', 'Xahar'], ['week', 'Ġimgħa'], ['day', 'Jum'], ['list', 'Lista']];
const OLD_NAMES = { dayGridMonth: 'month', timeGridWeek: 'week', timeGridDay: 'day', listMonth: 'list' };

export const today = () => maltaWall().slice(0, 10);
const savedView = ls.get('banditur_cal_view', 'month');

export const cal = $state({
  events: [],
  labels: [],
  view: OLD_NAMES[savedView] || (VIEWS.some(([v]) => v === savedView) ? savedView : 'month'),
  day: today(),
  showPosts: ls.get('banditur_cal_posts', '1') === '1',
  loadedFor: '', // the profile whose events are in `events`
  error: '',
  focus: '', // an event id to open on its page (from Home or ⌘K)
});

let loadSeq = 0;
/** Read the active profile's events (from the server when shared; async then). */
export function load() {
  const profileId = app.profileId;
  if (!sharing.calendar) {
    const r = store.list(profileId);
    Object.assign(cal, { events: r.events, labels: r.labels, loadedFor: profileId, error: '' });
    return Promise.resolve();
  }
  const my = ++loadSeq;
  return api('/api/events', { query: { profile_id: profileId } })
    .then((r) => {
      if (my !== loadSeq || profileId !== app.profileId) return;
      Object.assign(cal, { events: r.events || [], labels: r.labels || [], loadedFor: profileId, error: '' });
    })
    .catch((e) => { if (my === loadSeq) cal.error = e.message; });
}
/** The events of a profile, for screens other than Kalendarju (Home, ⌘K, Rapporti). */
export function eventsFor(profileId) {
  if (!sharing.calendar) return store.list(profileId).events;
  if (cal.loadedFor !== profileId) { if (profileId === app.profileId) load(); return []; }
  return cal.events;
}
/** A change saved on the server in the background; on failure say why and show the server's list again. */
function saved(promise, apply) {
  promise.then((row) => apply?.(row)).catch((e) => {
    toast(e.status === 409 ? 'Xi ħadd ieħor biddel dan l-avveniment: qed nuri l-aħħar verżjoni.' : e.message, 'error');
    load();
  });
}
const putRow = (row) => { cal.events = cal.events.map((x) => (x.id === row.id ? row : x)); };
export const labelOf = (name) => cal.labels.find((l) => l.name === name);
export const colorOf = (name) => labelOf(name)?.color || '#7B808A';
export const isVisible = (name) => !name || labelOf(name)?.visible !== false;

/** [from, to) days the view needs (month view includes the grey days around the month). */
export function rangeFor(view, day) {
  if (view === 'month') {
    const w = monthGrid(day);
    return [w[0][0], addDays(w.at(-1)[6], 1)];
  }
  if (view === 'week') return [mondayOf(day), addDays(mondayOf(day), 7)];
  if (view === 'day') return [day, addDays(day, 1)];
  return [monthStart(day), addMonths(day, 1)];
}
export function setView(v) {
  cal.view = v;
  ls.set('banditur_cal_view', v);
}
export function setShowPosts(on) {
  cal.showPosts = on;
  ls.set('banditur_cal_posts', on ? '1' : '0');
}
/** Previous / next page of the current view. */
export function step(n) {
  const v = cal.view;
  cal.day = v === 'week' ? addDays(cal.day, 7 * n) : v === 'day' ? addDays(cal.day, n) : addMonths(cal.day, n);
}

export function createEvent(input) {
  if (sharing.calendar) {
    const { event, error } = cleanEvent(input);
    if (error) throw new Error(error);
    const id = crypto.randomUUID();
    const row = { ...event, id, profile_id: app.profileId, revision: 0, tz: 'Europe/Malta' };
    cal.events = [...cal.events, row];
    saved(api('/api/events', { method: 'POST', body: { ...input, id, request_id: crypto.randomUUID(), profile_id: app.profileId } }), putRow);
    return row;
  }
  const e = store.create(app.profileId, { ...input, request_id: crypto.randomUUID() });
  load();
  return e;
}
export function updateEvent(id, patch) {
  if (sharing.calendar) {
    const cur = cal.events.find((x) => x.id === id);
    if (!cur) throw new Error('L-avveniment tneħħa.');
    const { event, error } = cleanEvent({ ...cur, ...patch });
    if (error) throw new Error(error);
    const { revision, ...fields } = patch;
    putRow({ ...cur, ...event });
    saved(api('/api/events', { method: 'PATCH', query: { id }, body: { ...fields, ...(revision !== undefined ? { revision } : {}) } }), putRow);
    return { ...cur, ...event };
  }
  try {
    return store.update(id, patch);
  } finally {
    load(); // on a 409 the list shows the newer version
  }
}
export function removeEvent(id) {
  if (sharing.calendar) {
    cal.events = cal.events.filter((x) => x.id !== id);
    saved(api('/api/events', { method: 'DELETE', query: { id } }));
    return;
  }
  store.remove(id);
  load();
}
export function setLabels(list) {
  if (sharing.calendar) {
    const { labels, error } = cleanLabels(list);
    if (error) throw new Error(error);
    const names = new Set(labels.map((l) => l.name));
    cal.labels = labels;
    cal.events = cal.events.map((e) => (e.label && !names.has(e.label) ? { ...e, label: '' } : e));
    saved(api('/api/events', { method: 'PUT', query: { type: 'labels' }, body: { labels } }), (l) => { cal.labels = l; });
    return;
  }
  cal.labels = store.saveLabels(list);
  load();
}
