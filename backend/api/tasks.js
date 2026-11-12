// Xogħol: shared per-profile boards, each with columns of task cards.
//
//   GET    /api/tasks?profile_id=…            → { boards, columns, tasks } of the profile
//   POST   /api/tasks  { type: board|column|task, request_id, profile_id, … } → create (idempotent).
//          A new board comes back with its starting columns: { ...board, columns }.
//   PATCH  /api/tasks?type=board|column|task&id=…  { revision?, …fields }    → edit
//   PATCH  /api/tasks?id=…  { op: 'check', item_id, done }                  → tick one checklist item
//   DELETE /api/tasks?type=board|column|task&id=…
//
// A `revision` in the request must match the stored row, otherwise 409 with the
// current row — so an edit made from an older copy never silently overwrites
// someone else's change. Moves and single ticks send no revision on purpose:
// they are last-writer-wins and must not collide with unrelated edits.
import { createClient } from '@supabase/supabase-js';
import { cors } from './_lib/cors.js';
import { requireAuth } from './_lib/auth.js';
import { knownProfileIds } from './_lib/profiles.js';
import {
  DEFAULT_COLUMNS,
  TASK_LIMITS,
  taskFields,
  columnFields,
  applyCheck,
  datesProblem,
  validRequestId,
} from './_lib/task-rules.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

const CHANGED = 'Dan inbidel minn xi ħadd ieħor. Erġa’ għabbi l-aħħar verżjoni.';
const TABLES = { board: 'task_boards', column: 'task_columns', task: 'tasks' };
const GONE = { board: 'Il-board tneħħa.', column: 'Il-kolonna tneħħiet.', task: 'Il-kompitu tneħħa.' };

class HttpError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

async function run(query) {
  const { data, error } = await query;
  if (error) throw Object.assign(new Error(error.message || 'Database error'), { db: error });
  return data;
}

function profileOf(value) {
  const id = String(value || 'main');
  const known = knownProfileIds();
  if (known.size && !known.has(id)) throw new HttpError(400, 'invalid profile_id');
  return id;
}

const typeOf = (value) => (value === 'board' || value === 'column' ? value : 'task');

export function createTasksHandler(client = sb) {
  const sb = client;

  const byId = (table, id) => run(sb.from(table).select('*').eq('id', id).maybeSingle());
  const byRequest = (table, requestId) =>
    run(sb.from(table).select('*').eq('request_id', requestId).maybeSingle());
  const ordered = (table, key, value) =>
    run(sb.from(table).select('*').eq(key, value).order('position', { ascending: true }));

  async function everything(profile) {
    const [boards, columns, tasks] = await Promise.all([
      ordered('task_boards', 'profile_id', profile),
      ordered('task_columns', 'profile_id', profile),
      ordered('tasks', 'profile_id', profile),
    ]);
    return { boards, columns, tasks };
  }

  async function owned(type, id, profile) {
    const row = await byId(TABLES[type], id);
    if (!row || row.profile_id !== profile) throw new HttpError(400, type === 'board' ? 'Il-board ma nstabx.' : 'Il-kolonna ma nstabitx.');
    return row;
  }

  /** A board's starting columns; deterministic request_ids make a retried create safe. */
  async function startingColumns(board) {
    const existing = await ordered('task_columns', 'board_id', board.id);
    if (existing.length || !board.request_id) return existing;
    for (const [i, title] of DEFAULT_COLUMNS.entries()) {
      const { error } = await sb.from('task_columns').insert({
        profile_id: board.profile_id, board_id: board.id, title,
        position: (i + 1) * 1024, request_id: `${board.request_id}-c${i}`,
      });
      if (error && error.code !== '23505') throw new Error(error.message);
    }
    return ordered('task_columns', 'board_id', board.id);
  }

  async function create(body) {
    const type = typeOf(body.type);
    const table = TABLES[type];
    if (!validRequestId(body.request_id)) throw new HttpError(400, 'request_id required');
    const existing = await byRequest(table, body.request_id);
    if (existing) return [200, type === 'board' ? { ...existing, columns: await startingColumns(existing) } : existing];
    const profile = profileOf(body.profile_id);
    const { fields, error } = type === 'task' ? taskFields(body) : columnFields(body, { what: type });
    if (error) throw new HttpError(400, error);
    if (type === 'board') {
      const boards = await ordered('task_boards', 'profile_id', profile);
      if (boards.length >= TASK_LIMITS.boards) throw new HttpError(400, `Massimu ${TASK_LIMITS.boards} boards.`);
    } else if (type === 'column') {
      const board = await owned('board', String(body.board_id || ''), profile);
      const columns = await ordered('task_columns', 'board_id', board.id);
      if (columns.length >= TASK_LIMITS.columns) throw new HttpError(400, `Massimu ${TASK_LIMITS.columns} kolonni f’board.`);
      fields.board_id = board.id;
    } else {
      await owned('column', fields.column_id, profile);
    }
    const { data, error: insertError } = await sb
      .from(table)
      .insert({ ...fields, profile_id: profile, request_id: body.request_id })
      .select()
      .single();
    let row = data;
    if (insertError?.code === '23505') row = await byRequest(table, body.request_id);
    else if (insertError) throw new Error(insertError.message);
    if (type === 'board') row = { ...row, columns: await startingColumns(row) };
    return [insertError ? 200 : 201, row];
  }

  function checkRevision(row, revision) {
    if (revision === undefined || revision === null || revision === '') return;
    if (Number(revision) !== row.revision) throw new HttpError(409, CHANGED, { current: row });
  }

  async function tick(row, body) {
    // Read-modify-write with compare-and-swap, so two people ticking different
    // items at the same moment both keep their tick.
    for (let attempt = 0; attempt < 4; attempt++) {
      const next = applyCheck(row.checklist, String(body.item_id || ''), body.done === true);
      if (!next) throw new HttpError(404, 'Dan il-punt tneħħa mill-checklist.', { current: row });
      const saved = await run(
        sb.from('tasks').update({ checklist: next }).eq('id', row.id).eq('revision', row.revision).select().maybeSingle(),
      );
      if (saved) return saved;
      row = await byId('tasks', row.id);
      if (!row) throw new HttpError(404, GONE.task);
    }
    throw new HttpError(409, CHANGED, { current: row });
  }

  async function edit(type, id, body) {
    const table = TABLES[type];
    const row = await byId(table, id);
    if (!row) throw new HttpError(404, GONE[type]);
    checkRevision(row, body.revision);
    if (type === 'task' && body.op === 'check') return tick(row, body);
    const { fields, error } = type === 'task' ? taskFields(body, { partial: true }) : columnFields(body, { partial: true, what: type });
    if (error) throw new HttpError(400, error);
    if (!Object.keys(fields).length) throw new HttpError(400, 'Xejn x’tibdel.');
    // A card may move to a column of another board of the same profile.
    if (fields.column_id && fields.column_id !== row.column_id) await owned('column', fields.column_id, row.profile_id);
    if (type === 'task' && datesProblem(row, fields)) throw new HttpError(400, datesProblem(row, fields));
    let query = sb.from(table).update(fields).eq('id', id);
    if (body.revision !== undefined && body.revision !== null) query = query.eq('revision', row.revision);
    const saved = await run(query.select().maybeSingle());
    if (!saved) throw new HttpError(409, CHANGED, { current: await byId(table, id) });
    return saved;
  }

  async function remove(type, id, revision) {
    const row = await byId(TABLES[type], id);
    if (!row) return; // already gone: deleting twice is fine
    checkRevision(row, revision);
    if (type === 'column') {
      const inside = await run(sb.from('tasks').select('id').eq('column_id', id).limit(1));
      if (inside.length) throw new HttpError(409, 'Il-kolonna għandha kompiti. Ċaqlaqhom jew ħassarhom l-ewwel.');
      const siblings = await ordered('task_columns', 'board_id', row.board_id);
      if (siblings.length <= 1) throw new HttpError(409, 'Board irid ikollu mill-inqas kolonna waħda.');
    }
    if (type === 'board') {
      // The foreign keys cascade too; deleting explicitly keeps the order clear
      // (cards, then columns, then the board) and works the same in tests.
      const columns = await ordered('task_columns', 'board_id', id);
      if (columns.length) {
        await run(sb.from('tasks').delete().in('column_id', columns.map((c) => c.id)));
        await run(sb.from('task_columns').delete().eq('board_id', id));
      }
    }
    let query = sb.from(TABLES[type]).delete().eq('id', id);
    if (revision !== undefined && revision !== null && revision !== '') query = query.eq('revision', row.revision);
    await run(query);
  }

  return async function handler(req, res) {
    if (cors(req, res) || requireAuth(req, res)) return;
    const q = req.query || {};
    const body = req.body || {};
    const type = typeOf(q.type);
    try {
      if (req.method === 'GET') return res.status(200).json(await everything(profileOf(q.profile_id)));
      if (req.method === 'POST') {
        const [code, row] = await create(body);
        return res.status(code).json(row);
      }
      if (!q.id) return res.status(400).json({ error: 'id required' });
      if (req.method === 'PATCH') return res.status(200).json(await edit(type, String(q.id), body));
      if (req.method === 'DELETE') {
        await remove(type, String(q.id), q.revision ?? body.revision);
        return res.status(200).json({ ok: true });
      }
      return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.code).json({ error: e.message, ...e.extra });
      // The tables don't exist yet: say exactly what to do instead of a database error.
      if (['PGRST205', '42P01'].includes(e.db?.code) || /(could not find the table|relation).*\btask(s|_boards|_columns)\b.*(does not exist|schema cache)|could not find the table '[^']*\btask(s|_boards|_columns)'/i.test(e.message || ''))
        return res.status(503).json({ error: 'Xogħol għadu mhux lest fuq is-server: applika l-migration 20261103_tasks.sql fuq Supabase.' });
      console.error('[tasks]', e);
      return res.status(500).json({ error: e.message || 'Server error' });
    }
  };
}

export default createTasksHandler();
