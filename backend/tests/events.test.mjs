import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://unit.supabase.co';
process.env.SUPABASE_SERVICE = 'test-only';
process.env.API_KEY = 'unit';
process.env.COMMITTEE_PROFILES = JSON.stringify([{ id: 'main' }, { id: 'banda' }]);
const { createEventsHandler } = await import('../api/events.js');

// In-memory stand-in for the parts of supabase-js the handler uses, with the revision trigger.
function database() {
  const tables = { calendar_events: [], calendar_settings: [] };
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  return {
    tables,
    from(name) {
      const rows = tables[name];
      let filters = [], op = 'read', patch = null, single = false, sort = null;
      const q = {
        select() { return q; },
        insert(p) { op = 'insert'; patch = p; return q; },
        upsert(p) { op = 'upsert'; patch = p; return q; },
        update(p) { op = 'update'; patch = p; return q; },
        delete() { op = 'delete'; return q; },
        eq(k, v) { filters.push((r) => r[k] === v); return q; },
        neq(k, v) { filters.push((r) => r[k] !== v); return q; },
        in(k, v) { filters.push((r) => v.includes(r[k])); return q; },
        order(k) { sort = (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0); return q; },
        single() { single = true; return q; },
        maybeSingle() { single = true; return q; },
        then(resolve) {
          const found = rows.filter((r) => filters.every((f) => f(r)));
          const out = (data) => resolve({ data: single ? data[0] ?? null : data, error: null });
          if (op === 'insert') {
            if ((patch.request_id && rows.some((r) => r.request_id === patch.request_id)) || (patch.id && rows.some((r) => r.id === patch.id)))
              return resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
            const row = { id: uuid(), revision: 0, created_at: 'now', updated_at: 'now', ...structuredClone(patch) };
            rows.push(row);
            return out([row]);
          }
          if (op === 'upsert') {
            const i = rows.findIndex((r) => r.id === patch.id);
            if (i >= 0) rows[i] = { ...rows[i], ...structuredClone(patch) }; else rows.push(structuredClone(patch));
            return out([patch]);
          }
          if (op === 'update') {
            for (const r of found) Object.assign(r, structuredClone(patch), { revision: r.revision + 1 });
            return out(found);
          }
          if (op === 'delete') {
            tables[name] = rows.filter((r) => !found.includes(r));
            return out(found);
          }
          return out(sort ? [...found].sort(sort) : found);
        },
      };
      return q;
    },
  };
}

function call(handler, { method = 'GET', query = {}, body } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
      end() { resolve({ status: this.statusCode, body: null }); return this; },
    };
    handler({ method, query, body, headers: { authorization: 'Bearer unit', origin: 'tauri://localhost' } }, res);
  });
}

const festa = { profile_id: 'main', title: 'Festa', allDay: false, start: '2026-08-15T19:00', end: '2026-08-15T19:30', label: 'Festa' };

test('create, list and default labels', async () => {
  const h = createEventsHandler(database());
  const made = await call(h, { method: 'POST', body: { ...festa, request_id: 'r-1' } });
  assert.equal(made.status, 201);
  assert.equal(made.body.title, 'Festa');
  assert.equal(made.body.start, '2026-08-15T19:00');
  assert.equal(made.body.allDay, false);
  const again = await call(h, { method: 'POST', body: { ...festa, request_id: 'r-1' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, made.body.id);
  const list = await call(h, { query: { profile_id: 'main' } });
  assert.equal(list.body.events.length, 1);
  assert.deepEqual(list.body.labels.map((l) => l.name), ['Festa', 'Quddiesa', 'Prova']);
  assert.equal((await call(h, { query: { profile_id: 'banda' } })).body.events.length, 0);
});

test('invalid events and unknown profiles are refused', async () => {
  const h = createEventsHandler(database());
  assert.equal((await call(h, { method: 'POST', body: { ...festa, end: '2026-08-15T18:00' } })).status, 400);
  assert.equal((await call(h, { method: 'POST', body: { ...festa, profile_id: 'nobody' } })).status, 400);
  assert.equal((await call(h, { method: 'POST', body: { ...festa, id: 'not-a-uuid' } })).status, 400);
});

test('edits check the revision', async () => {
  const h = createEventsHandler(database());
  const { body: e } = await call(h, { method: 'POST', body: festa });
  const ok = await call(h, { method: 'PATCH', query: { id: e.id }, body: { title: 'Festa Santa Marija', revision: 0 } });
  assert.equal(ok.body.title, 'Festa Santa Marija');
  assert.equal(ok.body.revision, 1);
  const stale = await call(h, { method: 'PATCH', query: { id: e.id }, body: { title: 'Old copy', revision: 0 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.current.title, 'Festa Santa Marija');
  assert.equal((await call(h, { method: 'PATCH', query: { id: 'gone' }, body: { title: 'x' } })).status, 404);
});

test('deleting twice is fine', async () => {
  const h = createEventsHandler(database());
  const { body: e } = await call(h, { method: 'POST', body: festa });
  assert.equal((await call(h, { method: 'DELETE', query: { id: e.id } })).status, 200);
  assert.equal((await call(h, { method: 'DELETE', query: { id: e.id } })).status, 200);
  assert.equal((await call(h, { query: { profile_id: 'main' } })).body.events.length, 0);
});

test('saving labels drops vanished ones from events', async () => {
  const db = database();
  const h = createEventsHandler(db);
  await call(h, { method: 'POST', body: festa });
  const r = await call(h, { method: 'PUT', query: { type: 'labels' }, body: { labels: [{ name: 'Prova', color: '#6D28D9' }] } });
  assert.deepEqual(r.body.map((l) => l.name), ['Prova']);
  const list = await call(h, { query: { profile_id: 'main' } });
  assert.equal(list.body.events[0].label, '');
  assert.equal((await call(h, { method: 'PUT', query: { type: 'labels' }, body: { labels: [{ name: 'A' }, { name: 'a' }] } })).status, 400);
});

test('import keeps ids, skips what is already there and merges labels', async () => {
  const h = createEventsHandler(database());
  const id = '11111111-2222-4333-8444-555555555555';
  const events = [{ ...festa, id }, { ...festa, id: 'bad', title: 'Bad id' }, { ...festa, id: '11111111-2222-4333-8444-666666666666', start: 'nope' }];
  const first = await call(h, { method: 'POST', query: { type: 'import' }, body: { profile_id: 'main', events, labels: [{ name: 'Purċissjoni', color: '#123456' }, { name: 'festa', color: '#000000' }] } });
  assert.deepEqual([first.body.imported, first.body.skipped, first.body.bad.length], [1, 0, 2]);
  const second = await call(h, { method: 'POST', query: { type: 'import' }, body: { profile_id: 'main', events: [{ ...festa, id }] } });
  assert.deepEqual([second.body.imported, second.body.skipped], [0, 1]);
  const list = await call(h, { query: { profile_id: 'main' } });
  assert.equal(list.body.events[0].id, id);
  assert.deepEqual(list.body.labels.map((l) => l.name), ['Festa', 'Quddiesa', 'Prova', 'Purċissjoni']);
});
