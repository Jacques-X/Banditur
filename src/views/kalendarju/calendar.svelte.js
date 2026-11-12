// The calendar's reactive state: the saved events and labels for the active profile, the chosen
// view and day. The rules are in model.js, the storage in local-store.js (swap that module to
// move the calendar to a server).
import { app, ls } from '../../lib/app.svelte.js';
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
});

export function load() {
  const r = store.list(app.profileId);
  cal.events = r.events;
  cal.labels = r.labels;
}
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
  const e = store.create(app.profileId, { ...input, request_id: crypto.randomUUID() });
  load();
  return e;
}
export function updateEvent(id, patch) {
  try {
    return store.update(id, patch);
  } finally {
    load(); // on a 409 the list shows the newer version
  }
}
export function removeEvent(id) {
  store.remove(id);
  load();
}
export function setLabels(list) {
  cal.labels = store.saveLabels(list);
  load();
}
