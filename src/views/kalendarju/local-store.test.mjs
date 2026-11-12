import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCalendarStore, STORAGE_KEY, DEFAULT_LABELS } from './local-store.js';

const mem = (init = {}) => { const m = { ...init }; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, m }; };
const make = (storage = mem()) => { let n = 0; return { storage, store: createCalendarStore(storage, { newId: () => `id${++n}`, now: () => '2026-11-12T10:00:00.000Z' }) }; };
const body = (o = {}) => ({ title: 'Festa', start: '2026-11-12T19:00', end: '2026-11-12T21:00', ...o });
const throws = (fn, status) => assert.throws(fn, (e) => e.status === status);

test('an empty store lists nothing and offers the default labels', () => {
  const { store } = make();
  assert.deepEqual(store.list('p1'), { events: [], labels: DEFAULT_LABELS });
});

test('create stores the cleaned event, per profile', () => {
  const { store } = make();
  const e = store.create('p1', body({ title: ' Festa ', location: ' Rabat ' }));
  assert.equal(e.id, 'id1'); assert.equal(e.title, 'Festa'); assert.equal(e.location, 'Rabat');
  assert.equal(e.revision, 0); assert.equal(e.tz, 'Europe/Malta'); assert.equal(e.profile_id, 'p1');
  assert.equal(store.list('p1').events.length, 1);
  assert.equal(store.list('p2').events.length, 0);
});

test('invalid events are refused with a Maltese message and nothing is saved', () => {
  const { store } = make();
  throws(() => store.create('p1', body({ title: '' })), 400);
  throws(() => store.create('p1', body({ end: '2026-11-12T18:00' })), 400);
  assert.equal(store.list('p1').events.length, 0);
});

test('the same request_id returns the same event', () => {
  const { store } = make();
  const a = store.create('p1', body({ request_id: 'r1' }));
  const b = store.create('p1', body({ request_id: 'r1', title: 'Other' }));
  assert.equal(a.id, b.id);
  assert.equal(store.list('p1').events.length, 1);
});

test('update merges, validates and bumps the revision', () => {
  const { store } = make();
  const a = store.create('p1', body());
  const b = store.update(a.id, { title: 'Quddiesa', revision: 0 });
  assert.equal(b.title, 'Quddiesa'); assert.equal(b.start, a.start); assert.equal(b.revision, 1);
  throws(() => store.update(a.id, { end: '2020-01-01T00:00' }), 400);
  assert.equal(store.get(a.id).revision, 1, 'a refused update changes nothing');
  throws(() => store.update('nope', { title: 'x' }), 404);
});

test('a stale revision gets 409 with the current event', () => {
  const { store } = make();
  const a = store.create('p1', body());
  store.update(a.id, { title: 'B' });
  try { store.update(a.id, { title: 'C', revision: 0 }); assert.fail('should throw'); }
  catch (e) { assert.equal(e.status, 409); assert.equal(e.current.title, 'B'); }
});

test('a move without a revision (drag) always lands', () => {
  const { store } = make();
  const a = store.create('p1', body());
  store.update(a.id, { title: 'B' });
  assert.equal(store.update(a.id, { start: '2026-11-13T19:00', end: '2026-11-13T21:00' }).start, '2026-11-13T19:00');
});

test('remove twice is fine', () => {
  const { store } = make();
  const a = store.create('p1', body());
  assert.deepEqual(store.remove(a.id), { ok: true });
  assert.deepEqual(store.remove(a.id), { ok: true });
  assert.equal(store.list('p1').events.length, 0);
});

test('labels: validated, unique ignoring case; removing one clears it from events', () => {
  const { store } = make();
  const e = store.create('p1', body({ label: 'Festa' }));
  throws(() => store.saveLabels([{ name: 'A', color: '#000000' }, { name: 'a', color: '#000000' }]), 400);
  throws(() => store.saveLabels([{ name: '  ' }]), 400);
  const saved = store.saveLabels([{ name: 'Prova', color: 'oops', visible: false }]);
  assert.deepEqual(saved, [{ name: 'Prova', color: '#3355D1', visible: false }]);
  assert.equal(store.get(e.id).label, '', 'event lost its removed label');
});

test('unreadable storage starts empty and a full disk is reported', () => {
  const { store } = make(mem({ [STORAGE_KEY]: '{oops' }));
  assert.equal(store.list('p1').events.length, 0);
  const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  throws(() => createCalendarStore(full).create('p1', body()), 507);
});
