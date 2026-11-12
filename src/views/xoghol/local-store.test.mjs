import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore, STORAGE_KEY } from './local-store.js';

function setup() {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  let n = 0;
  const store = createLocalStore(storage, { newId: () => `id${++n}` });
  const req = (method, query = {}, body = {}) => store.request({ method, query, body });
  return { data, storage, store, req };
}

test('starts empty; a new board comes with three columns and is saved', async () => {
  const { req, data, storage } = setup();
  assert.deepEqual(await req('GET', { profile_id: 'main' }), { boards: [], columns: [], tasks: [] });
  const b = await req('POST', {}, { type: 'board', profile_id: 'main', title: 'Videos', position: 1024 });
  assert.deepEqual(b.columns.map((c) => c.title), ['Biex isir', 'Għaddej', 'Lest']);
  assert.ok(data.get(STORAGE_KEY).includes('Videos'));
  // A fresh store over the same storage sees it (survives a restart).
  const again = await createLocalStore(storage).request({ method: 'GET', query: { profile_id: 'main' } });
  assert.equal(again.boards.length, 1);
  assert.equal(again.columns.length, 3);
  assert.deepEqual((await req('GET', { profile_id: 'banda' })).boards, []);
});

test('cards: add, tick, move across boards, stale edit refused, delete', async () => {
  const { req } = setup();
  const v = await req('POST', {}, { type: 'board', profile_id: 'main', title: 'Videos', position: 1 });
  const e = await req('POST', {}, { type: 'board', profile_id: 'main', title: 'Elementi', position: 2 });
  const t = await req('POST', {}, { profile_id: 'main', column_id: v.columns[0].id, title: 'Reel', position: 1, checklist: [{ id: 'a', text: 'Filmati' }] });
  assert.equal((await req('PATCH', { id: t.id }, { op: 'check', item_id: 'a', done: true })).checklist[0].done, true);
  const moved = await req('PATCH', { id: t.id }, { column_id: e.columns[1].id, position: 5 });
  assert.equal(moved.column_id, e.columns[1].id);
  await assert.rejects(req('PATCH', { id: t.id }, { revision: 0, title: 'x' }), (err) => err.status === 409);
  await assert.rejects(req('POST', {}, { profile_id: 'main', column_id: v.columns[0].id, title: '  ', position: 1 }), (err) => err.status === 400);
  await req('DELETE', { id: t.id });
  assert.equal((await req('GET', { profile_id: 'main' })).tasks.length, 0);
});

test('columns and boards follow the same rules as the server', async () => {
  const { req } = setup();
  const b = await req('POST', {}, { type: 'board', profile_id: 'main', title: 'Videos', position: 1 });
  await req('POST', {}, { profile_id: 'main', column_id: b.columns[0].id, title: 'Reel', position: 1 });
  await assert.rejects(req('DELETE', { type: 'column', id: b.columns[0].id }), (err) => err.status === 409);
  await req('DELETE', { type: 'column', id: b.columns[1].id });
  await req('DELETE', { type: 'column', id: b.columns[2].id });
  await req('DELETE', { type: 'board', id: b.id });
  assert.deepEqual(await req('GET', { profile_id: 'main' }), { boards: [], columns: [], tasks: [] });
});

test('unreadable saved data starts empty instead of breaking the screen', async () => {
  const { req, data } = setup();
  data.set(STORAGE_KEY, '{not json');
  assert.deepEqual(await req('GET', { profile_id: 'main' }), { boards: [], columns: [], tasks: [] });
});

test('start and due dates must be in order, also when only one changes', async () => {
  const { req } = setup();
  const b = await req('POST', {}, { type: 'board', profile_id: 'main', title: 'Videos', position: 1 });
  await assert.rejects(req('POST', {}, { profile_id: 'main', column_id: b.columns[0].id, title: 'X', position: 1, start_date: '2026-11-10', due_date: '2026-11-05' }), (e) => e.status === 400);
  const t = await req('POST', {}, { profile_id: 'main', column_id: b.columns[0].id, title: 'X', position: 1, start_date: '2026-11-01', due_date: '2026-11-05' });
  await assert.rejects(req('PATCH', { id: t.id }, { start_date: '2026-11-09' }), (e) => /bidu/.test(e.message));
  const moved = await req('PATCH', { id: t.id }, { start_date: '2026-11-08', due_date: '2026-11-12' });
  assert.deepEqual([moved.start_date, moved.due_date], ['2026-11-08', '2026-11-12']);
});
