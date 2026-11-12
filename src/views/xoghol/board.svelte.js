// Xogħol state: loads the profile's boards and applies changes optimistically
// (the screen updates at once; a failed save is rolled back with a toast).
// Boards are kept on this computer (local-store.js), in the same request shape
// as the backend's /api/tasks, so sharing them later means swapping `api` back.
import { localTasks } from './local-store.js';
import { toast, ls } from '../../lib/app.svelte.js';
import { cardsIn, sortedColumns, planMove, positionAt, itemId, TASK_LIMITS } from './model.js';

export const board = $state({
  profileId: '',
  boardId: '',      // the board on screen (remembered per profile)
  boards: [],
  columns: [],
  tasks: [],
  loaded: false,
  loading: false,
  error: '',
  dragging: false,
});

let pending = 0; // local writes in flight: polling waits until they finish
let seq = 0;
const uuid = () => crypto.randomUUID();
const clone = (x) => JSON.parse(JSON.stringify(x));
export const isTemp = (id) => String(id).startsWith('tmp-');

const api = (_path, options) => localTasks.request(options);

/** Load (or refresh, with quiet) the board of a profile. */
export async function load(profileId, { quiet = false, force = false } = {}) {
  if (profileId !== board.profileId) {
    Object.assign(board, { profileId, boardId: '', boards: [], columns: [], tasks: [], loaded: false, error: '' });
    quiet = false;
  }
  if (quiet && !force && (pending || board.dragging)) return;
  const my = ++seq;
  if (!quiet) board.loading = true;
  try {
    const r = await api('/api/tasks', { query: { profile_id: profileId } });
    if (my !== seq || profileId !== board.profileId) return;
    if (quiet && !force && (pending || board.dragging)) return; // a local change started meanwhile; next poll catches up
    board.boards = r?.boards || [];
    board.columns = r?.columns || [];
    board.tasks = r?.tasks || [];
    pickBoard();
    board.loaded = true;
    board.error = '';
  } catch (e) {
    if (my === seq && !quiet) board.error = e.message;
  } finally {
    if (my === seq) board.loading = false;
  }
}

const refresh = () => load(board.profileId, { quiet: true });

const boardKey = () => `banditur_xoghol_board:${board.profileId}`;
/** Keep the shown board valid: the current one, else the remembered one, else the first. */
function pickBoard() {
  const ok = (id) => board.boards.some((b) => b.id === id);
  if (ok(board.boardId)) return;
  const saved = ls.get(boardKey(), '');
  board.boardId = ok(saved) ? saved : sortedColumns(board.boards)[0]?.id || '';
}
export function selectBoard(id) {
  board.boardId = id;
  if (!isTemp(id)) ls.set(boardKey(), id);
}

function putTask(row, replaceId = row.id) {
  const i = board.tasks.findIndex((t) => t.id === replaceId);
  if (i >= 0) board.tasks[i] = row;
  else board.tasks.push(row);
}
function putColumn(row) {
  const i = board.columns.findIndex((c) => c.id === row.id);
  if (i >= 0) board.columns[i] = row;
  else board.columns.push(row);
}

/** Run a save; on failure restore the snapshot, explain, and re-read the board. */
async function write(run, snapshot) {
  pending++;
  try {
    return await run();
  } catch (e) {
    if (snapshot) {
      board.tasks = snapshot.tasks;
      board.columns = snapshot.columns;
      board.boards = snapshot.boards;
      pickBoard();
    }
    toast(e.message, 'error');
    return null;
  } finally {
    pending--;
    if (!pending) refresh();
  }
}
const snap = () => ({ tasks: clone(board.tasks), columns: clone(board.columns), boards: clone(board.boards) });

// ── Cards ──────────────────────────────────────────────────────────────────
/** `extra`: optional start_date / due_date for a card made from the Gantt view. */
export function addTask(columnId, title, extra = {}) {
  const text = title.trim();
  if (!text) return;
  const siblings = cardsIn(board.tasks, columnId);
  const position = positionAt(siblings, siblings.length) ?? siblings.length * 1024 + 1024;
  const request_id = uuid();
  const temp = {
    id: `tmp-${request_id}`, column_id: columnId, position, title: text, notes: '',
    checklist: [], start_date: extra.start_date || null, due_date: extra.due_date || null, label: null, revision: 0,
  };
  const before = snap();
  board.tasks.push(temp);
  return write(async () => {
    const row = await api('/api/tasks', {
      method: 'POST',
      body: { type: 'task', request_id, profile_id: board.profileId, column_id: columnId, title: text, position, ...(extra.start_date ? { start_date: extra.start_date } : {}), ...(extra.due_date ? { due_date: extra.due_date } : {}) },
    });
    putTask(row, temp.id);
    return row;
  }, before);
}

/** Drop/keyboard move of a card to `index` in `columnId`. */
export function moveTask(taskId, columnId, index) {
  if (isTemp(taskId)) return;
  const updates = planMove(board.tasks, taskId, columnId, index);
  const before = snap();
  for (const u of updates) {
    const t = board.tasks.find((x) => x.id === u.id);
    if (t) Object.assign(t, { column_id: u.column_id, position: u.position });
  }
  return write(async () => {
    for (const u of updates) {
      const row = await api('/api/tasks', {
        method: 'PATCH', query: { id: u.id },
        body: { column_id: u.column_id, position: u.position },
      });
      putTask(row);
    }
  }, before);
}

/** Tick or untick one checklist item (straight from the card). */
export function toggleItem(taskId, itemId, done) {
  if (isTemp(taskId)) return;
  const before = snap();
  const t = board.tasks.find((x) => x.id === taskId);
  const item = t?.checklist?.find((x) => x.id === itemId);
  if (!item) return;
  item.done = done;
  return write(async () => {
    const row = await api('/api/tasks', {
      method: 'PATCH', query: { id: taskId }, body: { op: 'check', item_id: itemId, done },
    });
    putTask(row);
  }, before);
}

/**
 * Save the edit dialog. Sends the revision the dialog was opened with, so a
 * change someone else made meanwhile is not overwritten: that throws an Error
 * with status 409 (the board is re-read first, so the caller can show the
 * newer version and offer to save anyway).
 */
export async function saveTask(taskId, fields, revision) {
  pending++;
  try {
    const row = await api('/api/tasks', { method: 'PATCH', query: { id: taskId }, body: { ...fields, revision } });
    putTask(row);
    return row;
  } catch (e) {
    if (e.status === 409 || e.status === 404) await load(board.profileId, { quiet: true, force: true });
    throw e;
  } finally {
    pending--;
  }
}

/**
 * Set a card's dates from the Gantt view (drag or placing it). Saved at once,
 * without a revision check: dates are all the drag changes.
 */
export function setDates(taskId, { start_date, due_date }) {
  if (isTemp(taskId)) return;
  const t = board.tasks.find((x) => x.id === taskId);
  if (!t || (t.start_date === start_date && t.due_date === due_date)) return;
  const before = snap();
  Object.assign(t, { start_date, due_date });
  return write(async () => {
    putTask(await api('/api/tasks', { method: 'PATCH', query: { id: taskId }, body: { start_date, due_date } }));
  }, before);
}

/** Add a checklist step (with dates, for the Gantt view's sub-timeline) to a card. */
export function addStep(taskId, text, { start_date = null, due_date = null } = {}) {
  const t = board.tasks.find((x) => x.id === taskId);
  const clean = String(text || '').trim();
  if (!t || isTemp(taskId) || !clean) return;
  if ((t.checklist || []).length >= TASK_LIMITS.items) { toast(`Massimu ${TASK_LIMITS.items} punt.`, 'error'); return; }
  const before = snap();
  t.checklist = [...(t.checklist || []), { id: itemId(), text: clean, done: false, ...(start_date ? { start_date } : {}), ...(due_date ? { due_date } : {}) }];
  const checklist = t.checklist.map((x) => ({ ...x }));
  return write(async () => {
    putTask(await api('/api/tasks', { method: 'PATCH', query: { id: taskId }, body: { checklist } }));
  }, before);
}

/** Set the dates of one checklist step (dragged in the Gantt view's sub-timeline). Saved at once. */
export function setStepDates(taskId, itemId, { start_date, due_date }) {
  if (isTemp(taskId)) return;
  const t = board.tasks.find((x) => x.id === taskId);
  const item = t?.checklist?.find((x) => x.id === itemId);
  if (!item || (item.start_date === start_date && item.due_date === due_date)) return;
  const before = snap();
  Object.assign(item, { start_date, due_date });
  const checklist = t.checklist.map((x) => ({ ...x }));
  return write(async () => {
    putTask(await api('/api/tasks', { method: 'PATCH', query: { id: taskId }, body: { checklist } }));
  }, before);
}

export function deleteTask(taskId) {
  const before = snap();
  board.tasks = board.tasks.filter((t) => t.id !== taskId);
  return write(() => api('/api/tasks', { method: 'DELETE', query: { id: taskId } }), before);
}

// ── Columns and boards (same shape: title + position) ──────────────────────
const LISTS = { column: 'columns', board: 'boards' };

function putRow(type, row) {
  const list = board[LISTS[type]];
  const i = list.findIndex((x) => x.id === row.id);
  if (i >= 0) list[i] = row;
  else list.push(row);
}

/** Add a column to the board on screen. */
export function addColumn(title) {
  const text = title.trim();
  const boardId = board.boardId;
  if (!text || !boardId || isTemp(boardId)) return;
  const cols = sortedColumns(board.columns.filter((c) => c.board_id === boardId));
  const position = positionAt(cols, cols.length) ?? cols.length * 1024 + 1024;
  const request_id = uuid();
  const before = snap();
  const temp = { id: `tmp-${request_id}`, board_id: boardId, title: text, position, revision: 0 };
  board.columns.push(temp);
  return write(async () => {
    const row = await api('/api/tasks', {
      method: 'POST', body: { type: 'column', request_id, profile_id: board.profileId, board_id: boardId, title: text, position },
    });
    board.columns = board.columns.filter((c) => c.id !== temp.id);
    putRow('column', row);
  }, before);
}

/** Create a board (it comes back with its starting columns) and show it. */
export function addBoard(title) {
  const text = title.trim();
  if (!text) return;
  const boards = sortedColumns(board.boards);
  const position = positionAt(boards, boards.length) ?? boards.length * 1024 + 1024;
  const request_id = uuid();
  const before = snap();
  const temp = { id: `tmp-${request_id}`, title: text, position, revision: 0 };
  board.boards.push(temp);
  selectBoard(temp.id);
  return write(async () => {
    const { columns = [], ...row } = await api('/api/tasks', {
      method: 'POST', body: { type: 'board', request_id, profile_id: board.profileId, title: text, position },
    });
    board.boards = board.boards.filter((b) => b.id !== temp.id);
    putRow('board', row);
    for (const c of columns) putRow('column', c);
    if (board.boardId === temp.id) selectBoard(row.id);
  }, before);
}

export function rename(type, id, title) {
  const text = title.trim();
  const row = board[LISTS[type]].find((x) => x.id === id);
  if (!text || !row || row.title === text || isTemp(id)) return;
  const before = snap();
  row.title = text;
  return write(async () => {
    putRow(type, await api('/api/tasks', { method: 'PATCH', query: { type, id }, body: { title: text } }));
  }, before);
}

/** Move a column (within its board) or a board one place left (-1) or right (+1). */
export function shift(type, id, dir) {
  const all = board[LISTS[type]];
  const me = all.find((x) => x.id === id);
  if (!me || isTemp(id)) return;
  const list = sortedColumns(type === 'column' ? all.filter((c) => c.board_id === me.board_id) : all);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const others = list.filter((x) => x.id !== id);
  const position = positionAt(others, j);
  const plan = position === null
    ? (() => { const order = [...others]; order.splice(j, 0, me); return order.map((x, k) => ({ id: x.id, position: (k + 1) * 1024 })); })()
    : [{ id, position }];
  const before = snap();
  for (const u of plan) all.find((x) => x.id === u.id).position = u.position;
  return write(async () => {
    for (const u of plan)
      putRow(type, await api('/api/tasks', { method: 'PATCH', query: { type, id: u.id }, body: { position: u.position } }));
  }, before);
}

export function deleteColumn(columnId) {
  const before = snap();
  board.columns = board.columns.filter((c) => c.id !== columnId);
  return write(() => api('/api/tasks', { method: 'DELETE', query: { type: 'column', id: columnId } }), before);
}

/** Delete a board with its columns and cards, then show its neighbour. */
export function deleteBoard(boardId) {
  const before = snap();
  const order = sortedColumns(board.boards);
  const i = order.findIndex((b) => b.id === boardId);
  const cols = new Set(board.columns.filter((c) => c.board_id === boardId).map((c) => c.id));
  board.tasks = board.tasks.filter((t) => !cols.has(t.column_id));
  board.columns = board.columns.filter((c) => c.board_id !== boardId);
  board.boards = board.boards.filter((b) => b.id !== boardId);
  if (board.boardId === boardId) selectBoard((order[i + 1] || order[i - 1])?.id || '');
  return write(() => api('/api/tasks', { method: 'DELETE', query: { type: 'board', id: boardId } }), before);
}
