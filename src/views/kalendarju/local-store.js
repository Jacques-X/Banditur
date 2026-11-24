// The calendar, stored on this computer: one JSON document in the app's local storage.
// Method names and fields follow what a server endpoint would take (list / create / update
// with a revision / remove), so moving the calendar to your own server means swapping this
// module for api('/api/events', …) and nothing else. Same idea as xoghol/local-store.js.
// Events are per profile; labels are shared. Tested in local-store.test.mjs.
import { cleanEvent, cleanLabels, MAX_EVENTS, MAX_LABELS, DEFAULT_LABELS } from '../../../backend/api/_lib/event-rules.js';

export { MAX_EVENTS, MAX_LABELS, DEFAULT_LABELS };
export const STORAGE_KEY = 'banditur_calendar';

const fail = (status, message) => Object.assign(new Error(message), { status });
const clone = (x) => JSON.parse(JSON.stringify(x));

export function createCalendarStore(storage, { newId = () => crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
  function read() {
    try {
      const d = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
      if (d && Array.isArray(d.events)) return { version: 1, events: d.events, labels: Array.isArray(d.labels) ? d.labels : clone(DEFAULT_LABELS) };
    } catch { /* unreadable: start empty rather than crash */ }
    return { version: 1, events: [], labels: clone(DEFAULT_LABELS) };
  }
  function write(db) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      throw fail(507, 'Ma stajtx nissejvja l-kalendarju fuq dan il-kompjuter (spazju jew permess).');
    }
  }

  return {
    list(profileId) {
      const db = read();
      return { events: clone(db.events.filter((e) => e.profile_id === profileId)), labels: clone(db.labels) };
    },
    get(id) {
      const e = read().events.find((x) => x.id === id);
      return e ? clone(e) : null;
    },
    /** body: the event fields (title, start, end, allDay, label, location, description, repeat) + optional request_id */
    create(profileId, body) {
      const db = read();
      if (body.request_id) {
        const same = db.events.find((e) => e.request_id === body.request_id && e.profile_id === profileId);
        if (same) return clone(same);
      }
      const { event, error } = cleanEvent(body);
      if (error) throw fail(400, error);
      if (db.events.length >= MAX_EVENTS) throw fail(400, `Massimu ${MAX_EVENTS} avvenimenti.`);
      const row = { id: newId(), profile_id: profileId, request_id: body.request_id || null, tz: 'Europe/Malta', revision: 0, created_at: now(), updated_at: now(), ...event };
      db.events.push(row);
      write(db);
      return clone(row);
    },
    /** patch: any event fields; `revision`, when given, must match (else 409 with `current`). */
    update(id, patch) {
      const db = read();
      const i = db.events.findIndex((e) => e.id === id);
      if (i < 0) throw fail(404, 'L-avveniment tneħħa.');
      const cur = db.events[i];
      if (patch.revision !== undefined && patch.revision !== cur.revision) throw Object.assign(fail(409, 'L-avveniment inbidel x’imkien ieħor.'), { current: clone(cur) });
      const { event, error } = cleanEvent({ ...cur, ...patch });
      if (error) throw fail(400, error);
      const row = { ...cur, ...event, revision: cur.revision + 1, updated_at: now() };
      db.events[i] = row;
      write(db);
      return clone(row);
    },
    /** Deleting twice is fine. */
    remove(id) {
      const db = read();
      const left = db.events.filter((e) => e.id !== id);
      if (left.length !== db.events.length) write({ ...db, events: left });
      return { ok: true };
    },
    labels() {
      return clone(read().labels);
    },
    /** Replace the label list (names unique ignoring case, colours #rrggbb). Events whose label vanished lose it. */
    saveLabels(labels) {
      const { labels: clean, error } = cleanLabels(labels);
      if (error) throw fail(400, error);
      const db = read();
      const names = new Set(clean.map((l) => l.name));
      db.events = db.events.map((e) => (e.label && !names.has(e.label) ? { ...e, label: '' } : e));
      db.labels = clean;
      write(db);
      return clone(clean);
    },
  };
}
