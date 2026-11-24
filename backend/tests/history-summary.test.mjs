import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historySummary } from '../api/_lib/history-summary.js';

// A recording fake of the Supabase query builder: every call is kept, awaiting it gives `answer(calls)`.
function fakeClient(answer) {
  const queries = [];
  return {
    queries,
    from(table) {
      const q = { table, calls: [] };
      queries.push(q);
      const b = new Proxy({}, {
        get: (_, name) => {
          if (name === 'then') return (res, rej) => Promise.resolve(answer(q)).then(res, rej);
          return (...args) => { q.calls.push([name, ...args]); return b; };
        },
      });
      return b;
    },
  };
}
const has = (q, ...call) => q.calls.some((c) => JSON.stringify(c) === JSON.stringify(call));

test('summary: four light queries, scoped to the profile', async () => {
  const client = fakeClient((q) => {
    const head = q.calls.some((c) => c[0] === 'select' && c[2]?.head);
    if (head) return { count: has(q, 'eq', 'status', 'failed') ? 3 : 7 };
    if (has(q, 'eq', 'status', 'failed')) return { data: [{ id: 'f1', status: 'failed' }] };
    return { data: [{ id: 'a' }, { id: 'b' }] };
  });
  const r = await historySummary(client, 'p1');
  assert.deepEqual(r, { upcoming: [{ id: 'a' }, { id: 'b' }], pending: 7, failed: 3, latestFailed: { id: 'f1', status: 'failed' } });
  assert.equal(client.queries.length, 4);
  for (const q of client.queries) assert.ok(has(q, 'eq', 'profile_id', 'p1'));
  const upcoming = client.queries[0];
  assert.ok(has(upcoming, 'in', 'status', ['pending', 'fb_native', 'processing']));
  assert.ok(has(upcoming, 'order', 'scheduled_time', { ascending: true }));
  assert.ok(has(upcoming, 'limit', 4));
});

test('summary: "all" profiles are not filtered; nothing failed gives null; errors are thrown', async () => {
  const empty = fakeClient(() => ({ data: [], count: 0 }));
  const r = await historySummary(empty, 'all');
  assert.deepEqual(r, { upcoming: [], pending: 0, failed: 0, latestFailed: null });
  assert.ok(empty.queries.every((q) => !q.calls.some((c) => c[1] === 'profile_id')));
  const broken = fakeClient(() => ({ error: new Error('db down') }));
  await assert.rejects(historySummary(broken, ''), /db down/);
});
