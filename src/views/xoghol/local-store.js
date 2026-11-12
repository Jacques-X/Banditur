// Xogħol, stored on this computer: the same requests the backend's /api/tasks
// understands (see backend/api/tasks.js), answered from one JSON document in
// the app's local storage. Boards are per profile; nothing leaves the Mac.
// Kept request-shaped so the board can move to the shared backend later by
// swapping this module for api('/api/tasks', …). Tested in local-store.test.mjs.
import { DEFAULT_COLUMNS, TASK_LIMITS, taskFields, columnFields, applyCheck, datesProblem } from '../../../backend/api/_lib/task-rules.js';

export const STORAGE_KEY = 'banditur_xoghol';
const TABLES = { board: 'boards', column: 'columns', task: 'tasks' };
const GONE = { board: 'Il-board tneħħa.', column: 'Il-kolonna tneħħiet.', task: 'Il-kompitu tneħħa.' };

const fail = (status, message) => Object.assign(new Error(message), { status });
const clone = (x) => JSON.parse(JSON.stringify(x));
const typeOf = (v) => (v === 'board' || v === 'column' ? v : 'task');
const byPosition = (a, b) => a.position - b.position;

/**
 * A store over `storage` ({ getItem, setItem }, normally localStorage).
 * request({ method, query, body }) → the same shapes as the backend.
 */
export function createLocalStore(storage, { newId = () => crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
  function read() {
    try {
      const d = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
      if (d && Array.isArray(d.boards) && Array.isArray(d.columns) && Array.isArray(d.tasks)) return d;
    } catch { /* unreadable: start empty rather than crash */ }
    return { version: 1, boards: [], columns: [], tasks: [] };
  }
  function write(db) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      throw fail(507, 'Ma stajtx nissejvja Xogħol fuq dan il-kompjuter (spazju jew permess).');
    }
  }

  function create(db, body) {
    const type = typeOf(body.type);
    const list = db[TABLES[type]];
    if (body.request_id) {
      const same = list.find((x) => x.request_id === body.request_id);
      if (same) return type === 'board' ? { ...same, columns: db.columns.filter((c) => c.board_id === same.id).sort(byPosition) } : same;
    }
    const profile = String(body.profile_id || 'main');
    const { fields, error } = type === 'task' ? taskFields(body) : columnFields(body, { what: type });
    if (error) throw fail(400, error);
    const base = { id: newId(), profile_id: profile, request_id: body.request_id || null, revision: 0, created_at: now() };
    if (type === 'board') {
      if (db.boards.filter((b) => b.profile_id === profile).length >= TASK_LIMITS.boards) throw fail(400, `Massimu ${TASK_LIMITS.boards} boards.`);
      const board = { ...base, ...fields };
      db.boards.push(board);
      const columns = DEFAULT_COLUMNS.map((title, i) => ({
        id: newId(), profile_id: profile, board_id: board.id, title, position: (i + 1) * 1024, request_id: null, revision: 0, created_at: now(),
      }));
      db.columns.push(...columns);
      return { ...board, columns };
    }
    if (type === 'column') {
      const board = db.boards.find((b) => b.id === body.board_id && b.profile_id === profile);
      if (!board) throw fail(400, 'Il-board ma nstabx.');
      if (db.columns.filter((c) => c.board_id === board.id).length >= TASK_LIMITS.columns) throw fail(400, `Massimu ${TASK_LIMITS.columns} kolonni f’board.`);
      const column = { ...base, ...fields, board_id: board.id };
      db.columns.push(column);
      return column;
    }
    if (!db.columns.some((c) => c.id === fields.column_id && c.profile_id === profile)) throw fail(400, 'Il-kolonna ma nstabitx.');
    const task = { notes: '', checklist: [], start_date: null, due_date: null, label: null, budget_cents: null, spent_cents: null, ...base, ...fields, updated_at: now() };
    db.tasks.push(task);
    return task;
  }

  function edit(db, type, id, body) {
    const row = db[TABLES[type]].find((x) => x.id === id);
    if (!row) throw fail(404, GONE[type]);
    if (body.revision != null && body.revision !== '' && Number(body.revision) !== row.revision)
      throw fail(409, 'Dan inbidel. Erġa’ għabbi l-aħħar verżjoni.');
    let fields;
    if (type === 'task' && body.op === 'check') {
      const next = applyCheck(row.checklist, String(body.item_id || ''), body.done === true);
      if (!next) throw fail(404, 'Dan il-punt tneħħa mill-checklist.');
      fields = { checklist: next };
    } else {
      const r = type === 'task' ? taskFields(body, { partial: true }) : columnFields(body, { partial: true, what: type });
      if (r.error) throw fail(400, r.error);
      fields = r.fields;
      if (!Object.keys(fields).length) throw fail(400, 'Xejn x’tibdel.');
      if (fields.column_id && !db.columns.some((c) => c.id === fields.column_id && c.profile_id === row.profile_id))
        throw fail(400, 'Il-kolonna ma nstabitx.');
      if (type === 'task') {
        const problem = datesProblem(row, fields);
        if (problem) throw fail(400, problem);
      }
    }
    Object.assign(row, fields, { revision: row.revision + 1 }, type === 'task' ? { updated_at: now() } : {});
    return row;
  }

  function remove(db, type, id) {
    const row = db[TABLES[type]].find((x) => x.id === id);
    if (!row) return; // already gone
    if (type === 'column') {
      if (db.tasks.some((t) => t.column_id === id)) throw fail(409, 'Il-kolonna għandha kompiti. Ċaqlaqhom jew ħassarhom l-ewwel.');
      if (db.columns.filter((c) => c.board_id === row.board_id).length <= 1) throw fail(409, 'Board irid ikollu mill-inqas kolonna waħda.');
    }
    if (type === 'board') {
      const cols = new Set(db.columns.filter((c) => c.board_id === id).map((c) => c.id));
      db.tasks = db.tasks.filter((t) => !cols.has(t.column_id));
      db.columns = db.columns.filter((c) => c.board_id !== id);
    }
    db[TABLES[type]] = db[TABLES[type]].filter((x) => x.id !== id);
  }

  return {
    /** Same contract as the backend: { method, query, body } → JSON-like result; throws Error with .status. */
    async request({ method = 'GET', query = {}, body = {} } = {}) {
      const db = read();
      if (method === 'GET') {
        const own = (x) => x.profile_id === String(query.profile_id || 'main');
        return clone({
          boards: db.boards.filter(own).sort(byPosition),
          columns: db.columns.filter(own).sort(byPosition),
          tasks: db.tasks.filter(own).sort(byPosition),
        });
      }
      let result;
      if (method === 'POST') result = create(db, clone(body));
      else {
        if (!query.id) throw fail(400, 'id required');
        if (method === 'PATCH') result = edit(db, typeOf(query.type), String(query.id), clone(body));
        else if (method === 'DELETE') { remove(db, typeOf(query.type), String(query.id)); result = { ok: true }; }
        else throw fail(405, 'Method not allowed');
      }
      write(db);
      return clone(result);
    },
  };
}

// The app's store (falls back to memory where local storage is unavailable).
const memory = new Map();
const storage = (() => {
  try { if (globalThis.localStorage) return globalThis.localStorage; } catch { /* blocked */ }
  return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
})();
export const localTasks = createLocalStore(storage);
