import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskFields, cleanChecklist, validDate, applyCheck } from '../api/_lib/task-rules.js';
process.env.SUPABASE_URL = 'https://unit.supabase.co';
process.env.SUPABASE_SERVICE = 'test-only';
process.env.API_KEY = 'unit';
process.env.COMMITTEE_PROFILES = JSON.stringify([{ id: 'main' }, { id: 'banda' }]);
const { createTasksHandler } = await import('../api/tasks.js');

// In-memory stand-in for the parts of supabase-js the handler uses, per table,
// with unique request_ids and the revision trigger.
function database() {
  const tables = { task_boards: [], task_columns: [], tasks: [] };
  let n = 0;
  const db = {
    tables,
    beforeWrite: null,
    from(name) {
      const rows = tables[name];
      let filters = [], op = 'read', patch = null, single = false, sort = null, max = Infinity;
      const q = {
        select() { return q; },
        insert(p) { op = 'insert'; patch = p; return q; },
        update(p) { op = 'update'; patch = p; return q; },
        delete() { op = 'delete'; return q; },
        eq(k, v) { filters.push((r) => r[k] === v); return q; },
        in(k, v) { filters.push((r) => v.includes(r[k])); return q; },
        order(k, { ascending = true } = {}) { sort = (a, b) => (ascending ? 1 : -1) * (a[k] - b[k]); return q; },
        limit(m) { max = m; return q; },
        single() { single = true; return q; },
        maybeSingle() { single = true; return q; },
        then(resolve, reject) {
          try {
            if (op !== 'read' && db.beforeWrite) { const f = db.beforeWrite; db.beforeWrite = null; f(tables); }
            let found = rows.filter((r) => filters.every((f) => f(r)));
            if (op === 'insert') {
              if (patch.request_id && rows.some((r) => r.request_id === patch.request_id))
                return resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
              const row = { id: `id${++n}`, revision: 0, notes: '', checklist: [], due_date: null, label: null, ...structuredClone(patch) };
              rows.push(row);
              found = [row];
            }
            if (op === 'update') for (const r of found) Object.assign(r, structuredClone(patch), { revision: r.revision + 1 });
            if (op === 'delete') for (const r of found) rows.splice(rows.indexOf(r), 1);
            if (sort) found = [...found].sort(sort);
            found = found.slice(0, max);
            resolve({ data: structuredClone(single ? found[0] || null : found), error: null });
          } catch (e) { reject(e); }
        },
      };
      return q;
    },
  };
  return db;
}

async function call(handler, method, { query = {}, body = {} } = {}) {
  const res = {
    code: 200, body: null,
    setHeader() {},
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  await handler({ method, query, body, headers: { authorization: 'Bearer unit' } }, res);
  return res;
}
const rid = (s) => `req-${s}`.padEnd(20, '0');

async function makeBoard(h, title = 'Videos', profile = 'main') {
  const r = await call(h, 'POST', { body: { type: 'board', request_id: rid(`b-${title}-${profile}`), profile_id: profile, title, position: 1024 } });
  assert.ok([200, 201].includes(r.code), JSON.stringify(r.body));
  return r.body;
}
async function setup() {
  const db = database();
  const h = createTasksHandler(db);
  const board = await makeBoard(h);
  return { db, h, board, columns: board.columns };
}
async function addTask(h, columns, extra = {}) {
  const r = await call(h, 'POST', {
    body: { request_id: rid(Math.random().toString(36).slice(2)), profile_id: 'main', column_id: columns[0].id, title: 'Ġib il-banners', position: 1024, ...extra },
  });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  return r.body;
}

test('a profile has no boards until someone makes one', async () => {
  const h = createTasksHandler(database());
  const r = await call(h, 'GET', { query: { profile_id: 'main' } });
  assert.deepEqual(r.body, { boards: [], columns: [], tasks: [] });
  assert.equal((await call(h, 'GET', { query: { profile_id: 'nobody' } })).code, 400);
});

test('a new board starts with three columns, and a retried create makes no duplicates', async () => {
  const { db, h, board } = await setup();
  assert.deepEqual(board.columns.map((c) => c.title), ['Biex isir', 'Għaddej', 'Lest']);
  assert.ok(board.columns.every((c) => c.board_id === board.id));
  const again = await makeBoard(h);
  assert.equal(again.id, board.id);
  assert.equal(db.tables.task_boards.length, 1);
  assert.equal(db.tables.task_columns.length, 3);
  await makeBoard(h, 'Elementi');
  const all = await call(h, 'GET', { query: { profile_id: 'main' } });
  assert.deepEqual(all.body.boards.map((b) => b.title), ['Videos', 'Elementi']);
  assert.equal(all.body.columns.length, 6);
});

test('repeating a create with the same request_id makes one card', async () => {
  const { db, h, columns } = await setup();
  const body = { request_id: rid('same'), profile_id: 'main', column_id: columns[0].id, title: 'Ikkonferma l-banda', position: 1 };
  const a = await call(h, 'POST', { body });
  const b = await call(h, 'POST', { body });
  assert.equal(a.code, 201);
  assert.equal(b.code, 200);
  assert.equal(a.body.id, b.body.id);
  assert.equal(db.tables.tasks.length, 1);
});

test('cards and columns stay inside their own profile', async () => {
  const { h, columns, board } = await setup();
  const banda = await makeBoard(h, 'Banda', 'banda');
  const wrong = await call(h, 'POST', { body: { request_id: rid('x1'), profile_id: 'main', column_id: banda.columns[0].id, title: 'X', position: 1 } });
  assert.equal(wrong.code, 400);
  const empty = await call(h, 'POST', { body: { request_id: rid('x2'), profile_id: 'main', column_id: columns[0].id, title: '  ', position: 1 } });
  assert.equal(empty.code, 400);
  const col = await call(h, 'POST', { body: { type: 'column', request_id: rid('x3'), profile_id: 'main', board_id: banda.id, title: 'X', position: 1 } });
  assert.equal(col.code, 400);
  const ok = await call(h, 'POST', { body: { type: 'column', request_id: rid('x4'), profile_id: 'main', board_id: board.id, title: 'Approvazzjoni', position: 4096 } });
  assert.equal(ok.code, 201);
  assert.equal(ok.body.board_id, board.id);
});

test('an edit from an old revision is refused with the current card', async () => {
  const { h, columns } = await setup();
  const t = await addTask(h, columns);
  const ok = await call(h, 'PATCH', { query: { id: t.id }, body: { revision: 0, title: 'Ġib il-banners kollha' } });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.revision, 1);
  const stale = await call(h, 'PATCH', { query: { id: t.id }, body: { revision: 0, notes: 'antika' } });
  assert.equal(stale.code, 409);
  assert.equal(stale.body.current.title, 'Ġib il-banners kollha');
});

test('two people ticking different items at the same moment both keep their tick', async () => {
  const { db, h, columns } = await setup();
  const t = await addTask(h, columns, { checklist: [{ id: 'a', text: 'Ritratti', done: false }, { id: 'b', text: 'Caption', done: false }] });
  // Someone else's tick lands between our read and our write.
  db.beforeWrite = (tables) => {
    const row = tables.tasks.find((r) => r.id === t.id);
    row.checklist = row.checklist.map((x) => (x.id === 'b' ? { ...x, done: true } : x));
    row.revision++;
  };
  const r = await call(h, 'PATCH', { query: { id: t.id }, body: { op: 'check', item_id: 'a', done: true } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.checklist.map((x) => x.done), [true, true]);
  const gone = await call(h, 'PATCH', { query: { id: t.id }, body: { op: 'check', item_id: 'zz', done: true } });
  assert.equal(gone.code, 404);
});

test('moving a card needs no revision, keeps another person’s edit, and can change board', async () => {
  const { h, columns } = await setup();
  const t = await addTask(h, columns);
  await call(h, 'PATCH', { query: { id: t.id }, body: { revision: 0, notes: 'Mill-kumitat' } });
  const moved = await call(h, 'PATCH', { query: { id: t.id }, body: { column_id: columns[1].id, position: 512 } });
  assert.equal(moved.code, 200);
  assert.equal(moved.body.column_id, columns[1].id);
  assert.equal(moved.body.notes, 'Mill-kumitat');
  const other = await makeBoard(h, 'Elementi');
  const across = await call(h, 'PATCH', { query: { id: t.id }, body: { column_id: other.columns[0].id, position: 1 } });
  assert.equal(across.code, 200);
  const banda = await makeBoard(h, 'Banda', 'banda');
  const foreign = await call(h, 'PATCH', { query: { id: t.id }, body: { column_id: banda.columns[0].id, position: 1 } });
  assert.equal(foreign.code, 400);
});

test('a column with cards, or a board’s last column, cannot be deleted', async () => {
  const { h, columns } = await setup();
  const t = await addTask(h, columns);
  assert.equal((await call(h, 'DELETE', { query: { type: 'column', id: columns[0].id } })).code, 409);
  assert.equal((await call(h, 'DELETE', { query: { id: t.id, revision: '0' } })).code, 200);
  assert.equal((await call(h, 'DELETE', { query: { id: t.id } })).code, 200, 'deleting twice is fine');
  assert.equal((await call(h, 'DELETE', { query: { type: 'column', id: columns[0].id } })).code, 200);
  assert.equal((await call(h, 'DELETE', { query: { type: 'column', id: columns[1].id } })).code, 200);
  assert.equal((await call(h, 'DELETE', { query: { type: 'column', id: columns[2].id } })).code, 409);
});

test('deleting a board removes its columns and cards only', async () => {
  const { db, h, board, columns } = await setup();
  await addTask(h, columns);
  const keep = await makeBoard(h, 'Elementi');
  await addTask(h, keep.columns);
  const r = await call(h, 'DELETE', { query: { type: 'board', id: board.id } });
  assert.equal(r.code, 200);
  assert.deepEqual(db.tables.task_boards.map((b) => b.title), ['Elementi']);
  assert.ok(db.tables.task_columns.every((c) => c.board_id === keep.id));
  assert.equal(db.tables.tasks.length, 1);
  const renamed = await call(h, 'PATCH', { query: { type: 'board', id: keep.id }, body: { title: 'Elementi tal-festa' } });
  assert.equal(renamed.body.title, 'Elementi tal-festa');
});

test('task rules: dates, checklist and labels', () => {
  assert.ok(validDate('2026-02-28'));
  assert.ok(!validDate('2026-02-30'));
  assert.ok(!validDate('3/11/2026'));
  assert.deepEqual(cleanChecklist([{ id: 'a', text: ' x ' }, { id: 'b', text: '' }]).items, [{ id: 'a', text: 'x', done: false }]);
  assert.ok(cleanChecklist([{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }]).error);
  assert.ok(taskFields({ label: 'pink' }, { partial: true }).error);
  assert.deepEqual(taskFields({ label: '', due_date: '' }, { partial: true }).fields, { label: null, due_date: null });
  assert.equal(applyCheck([{ id: 'a', done: false }], 'b', true), null);
});

test('missing tables give a clear “apply the migration” message', async () => {
  const query = {
    select() { return query; }, eq() { return query; }, order() { return query; },
    then(resolve) { resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.task_boards' in the schema cache" } }); },
  };
  const h = createTasksHandler({ from: () => query });
  const r = await call(h, 'GET', { query: { profile_id: 'main' } });
  assert.equal(r.code, 503);
  assert.match(r.body.error, /20261103_tasks\.sql/);
});
