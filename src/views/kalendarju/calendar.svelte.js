// The calendar's reactive state: the saved events and labels for the active profile, the chosen
// view and day. The rules are in model.js. Everything is kept on this computer (local-store.js).
import { app, ls, toast } from '../../lib/app.svelte.js';
import { maltaWall } from '../../lib/malta-time.js';
import { createCalendarStore } from './local-store.js';
import { addDays, addMonths, mondayOf, monthStart, monthGrid } from './model.js';

export const store = createCalendarStore({ getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) });
export const VIEWS = [['month', 'Xahar'], ['week', 'Ġimgħa'], ['day', 'Jum'], ['list', 'Lista'], ['plan', 'Kampanji']];
const OLD_NAMES = { dayGridMonth: 'month', timeGridWeek: 'week', timeGridDay: 'day', listMonth: 'list' };

export const today = () => maltaWall().slice(0, 10);
const savedView = ls.get('banditur_cal_view', 'month');

export const cal = $state({
  events: [],
  labels: [],
  campaigns: [],
  slots: [], // planned posts
  campaign: ls.get('banditur_cal_campaign', ''), // '' = everything, else only this campaign's things
  view: OLD_NAMES[savedView] || (VIEWS.some(([v]) => v === savedView) ? savedView : 'month'),
  day: today(),
  loadedFor: '', // the profile whose events are in `events`
  error: '',
  focus: '', // an event id to open on its page (from Home or ⌘K)
  focusSlot: '', // a planned post to open in its form (from Home)
});

/** Read the active profile's events, labels, campaigns and planned posts. */
export function load() {
  const profileId = app.profileId;
  const r = store.list(profileId);
  Object.assign(cal, { events: r.events, labels: r.labels, campaigns: r.campaigns, slots: r.slots, loadedFor: profileId, error: '' });
  return Promise.resolve();
}
/** The events of a profile, for screens other than Kalendarju (Home, ⌘K). */
export const eventsFor = (profileId) => store.list(profileId).events;
/** The planned posts of a profile, for Home. */
export const slotsFor = (profileId) => store.list(profileId).slots;

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
  if (view === 'plan') return [mondayOf(monthStart(day)), addDays(mondayOf(monthStart(day)), 7 * 13)];
  return [monthStart(day), addMonths(day, 1)];
}
export function setView(v) {
  cal.view = v;
  ls.set('banditur_cal_view', v);
}
/** Previous / next page of the current view. */
export function step(n) {
  const v = cal.view;
  cal.day = v === 'week' ? addDays(cal.day, 7 * n) : v === 'day' ? addDays(cal.day, n) : addMonths(cal.day, n);
}
/** Show only one campaign's events and planned posts ('' = everything). */
export function setCampaignFilter(id) {
  cal.campaign = id;
  ls.set('banditur_cal_campaign', id);
}
export const campaignOf = (id) => cal.campaigns.find((c) => c.id === id) || null;

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

// ── Campaigns and slots (planned posts) ─────────────────────────────────────
const KINDS = {
  campaign: { create: 'createCampaign', update: 'updateCampaign', remove: 'removeCampaign' },
  slot: { create: 'createSlot', update: 'updateSlot', remove: 'removeSlot' },
};
function createKind(kind, input) {
  const row = store[KINDS[kind].create](app.profileId, { ...input, request_id: crypto.randomUUID() });
  load();
  return row;
}
function updateKind(kind, id, patch) {
  try {
    return store[KINDS[kind].update](id, patch);
  } finally {
    load();
  }
}
function removeKind(kind, id) {
  store[KINDS[kind].remove](id);
  load();
  if (kind === 'campaign' && cal.campaign === id) setCampaignFilter('');
}
export const createCampaign = (input) => createKind('campaign', input);
export const updateCampaign = (id, patch) => updateKind('campaign', id, patch);
export const removeCampaign = (id) => removeKind('campaign', id);
export const createSlot = (input) => createKind('slot', input);
export const updateSlot = (id, patch) => updateKind('slot', id, patch);
export const removeSlot = (id) => removeKind('slot', id);
