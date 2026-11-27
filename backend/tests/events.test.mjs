import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://unit.supabase.co';
process.env.SUPABASE_SERVICE = 'test-only';
process.env.API_KEY = 'unit';
process.env.COMMITTEE_PROFILES = JSON.stringify([{ id: 'main' }, { id: 'banda' }]);
const { createEventsHandler } = await import('../api/events.js');

// In-memory stand-in for the parts of supabase-js the handler uses, with the revision trigger.
function database() {
  const tables = { calendar_events: [], calendar_settings: [], calendar_campaigns: [], calendar_slots: [] };
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  return {
    tables,
    from(name) {
      const rows = tables[name];
      if (!rows) throw new Error(`unknown table ${name}`);
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

test('campaigns and slots: create, list, revisions, links', async () => {
  const db = database();
  const h = createEventsHandler(db);
  const c = await call(h, { method: 'POST', query: { type: 'campaign' }, body: { profile_id: 'main', name: 'Festa 2027', from: '2027-06-01', to: '2027-07-20', target: 4, request_id: 'c-1' } });
  assert.equal(c.status, 201);
  assert.deepEqual([c.body.name, c.body.from, c.body.to, c.body.target], ['Festa 2027', '2027-06-01', '2027-07-20', 4]);
  assert.equal((await call(h, { method: 'POST', query: { type: 'campaign' }, body: { profile_id: 'main', name: 'Festa 2027', from: '2027-06-01', to: '2027-07-20', request_id: 'c-1' } })).body.id, c.body.id);
  assert.equal((await call(h, { method: 'POST', query: { type: 'campaign' }, body: { profile_id: 'main', name: 'X', from: '2027-06-02', to: '2027-06-01' } })).status, 400);
  const e = await call(h, { method: 'POST', body: { ...festa, campaign: c.body.id } });
  assert.equal(e.body.campaign, c.body.id);
  const s = await call(h, { method: 'POST', query: { type: 'slot' }, body: { profile_id: 'main', title: 'Teaser', day: '2027-06-10', time: '18:30', platforms: ['ig'], campaign: c.body.id, event: e.body.id, owner: 'Marija', due: '2027-06-08', category: 'Reel' } });
  assert.deepEqual([s.body.owner, s.body.due, s.body.category], ['Marija', '2027-06-08', 'Reel']);
  assert.equal(s.status, 201);
  assert.deepEqual([s.body.status, s.body.campaign, s.body.event, s.body.time], ['idea', c.body.id, e.body.id, '18:30']);
  const done = await call(h, { method: 'PATCH', query: { type: 'slot', id: s.body.id }, body: { status: 'done', post_id: 'post-1', revision: 0 } });
  assert.deepEqual([done.body.status, done.body.post_id, done.body.revision], ['done', 'post-1', 1]);
  assert.equal((await call(h, { method: 'PATCH', query: { type: 'slot', id: s.body.id }, body: { title: 'Old', revision: 0 } })).status, 409);
  assert.equal((await call(h, { method: 'PATCH', query: { type: 'campaign', id: 'gone' }, body: { name: 'X' } })).status, 404);
  const list = await call(h, { query: { profile_id: 'main' } });
  assert.deepEqual([list.body.campaigns.length, list.body.slots.length], [1, 1]);
  assert.equal((await call(h, { query: { profile_id: 'banda' } })).body.slots.length, 0);
  // A link to a campaign that is not there is dropped rather than refused.
  const orphan = await call(h, { method: 'POST', query: { type: 'slot' }, body: { profile_id: 'main', title: 'Y', day: '2027-06-11', campaign: '99999999-2222-4333-8444-555555555555' } });
  assert.equal(orphan.body.campaign, '');
  // Deleting the event unlinks its slots; deleting the campaign unlinks events and slots.
  await call(h, { method: 'DELETE', query: { id: e.body.id } });
  assert.equal((await call(h, { query: { profile_id: 'main' } })).body.slots[0].event, '');
  const e2 = await call(h, { method: 'POST', body: { ...festa, campaign: c.body.id } });
  await call(h, { method: 'DELETE', query: { type: 'campaign', id: c.body.id } });
  const after = await call(h, { query: { profile_id: 'main' } });
  assert.equal(after.body.campaigns.length, 0);
  assert.ok(after.body.slots.every((x) => x.campaign === ''));
  assert.equal(after.body.events.find((x) => x.id === e2.body.id).campaign, '');
});

test('import carries campaigns and slots with their links', async () => {
  const h = createEventsHandler(database());
  const cid = '11111111-2222-4333-8444-000000000001', eid = '11111111-2222-4333-8444-000000000002', sid = '11111111-2222-4333-8444-000000000003';
  const r = await call(h, { method: 'POST', query: { type: 'import' }, body: {
    profile_id: 'main',
    campaigns: [{ id: cid, name: 'Festa', from: '2027-06-01', to: '2027-06-30' }],
    events: [{ ...festa, id: eid, campaign: cid }],
    slots: [{ id: sid, title: 'Teaser', day: '2027-06-05', campaign: cid, event: eid }, { id: 'bad', title: 'Bad' }],
  } });
  assert.deepEqual([r.body.imported, r.body.bad.length], [3, 1]);
  const list = await call(h, { query: { profile_id: 'main' } });
  assert.equal(list.body.events[0].campaign, cid);
  assert.deepEqual([list.body.slots[0].campaign, list.body.slots[0].event], [cid, eid]);
});
