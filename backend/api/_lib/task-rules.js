// Pure rules for the Xogħol board (tasks + columns). Shared by api/tasks.js and
// the desktop (src/views/xoghol/model.js imports this file), so both sides
// validate the same way. No I/O here.

export const TASK_LABELS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
export const TASK_LIMITS = { title: 200, notes: 10000, items: 50, itemText: 200, column: 60, columns: 12, boards: 20 };
/** Columns a new board starts with (renamable/removable like any other). */
export const DEFAULT_COLUMNS = ['Biex isir', 'Għaddej', 'Lest'];

const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const ITEM_ID = /^[A-Za-z0-9_-]{1,40}$/;

export const validRequestId = (id) => typeof id === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(id);

/** A calendar date "YYYY-MM-DD" that actually exists. */
export function validDate(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

function position(body) {
  if (body.position === null || body.position === undefined || body.position === '') return null;
  const p = Number(body.position);
  return Number.isFinite(p) ? p : null;
}

/** Checklist → { items } with trimmed text, or { error }. Empty items are dropped. */
export function cleanChecklist(list) {
  if (!Array.isArray(list)) return { error: 'Il-checklist mhix valida.' };
  const items = [];
  const ids = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') return { error: 'Il-checklist mhix valida.' };
    const id = String(raw.id ?? '');
    if (!ITEM_ID.test(id) || ids.has(id)) return { error: 'Il-checklist mhix valida.' };
    const text = String(raw.text ?? '').trim();
    if (text.length > TASK_LIMITS.itemText)
      return { error: `Punt fil-checklist twil wisq (massimu ${TASK_LIMITS.itemText} karattru).` };
    if (!text) continue;
    ids.add(id);
    items.push({ id, text, done: raw.done === true });
  }
  if (items.length > TASK_LIMITS.items)
    return { error: `Massimu ${TASK_LIMITS.items} punt f'checklist waħda.` };
  return { items };
}

/**
 * Validated task fields from a request body. With `partial`, only the keys
 * present are checked and returned (PATCH); otherwise title, column_id and
 * position are required (create). Returns { fields } or { error }.
 */
export function taskFields(body = {}, { partial = false } = {}) {
  const f = {};
  if (!partial || has(body, 'title')) {
    const t = String(body.title ?? '').trim();
    if (!t) return { error: 'Ikteb titlu għall-kompitu.' };
    if (t.length > TASK_LIMITS.title) return { error: `Titlu twil wisq (massimu ${TASK_LIMITS.title} karattru).` };
    f.title = t;
  }
  if (has(body, 'notes')) {
    const n = body.notes ?? '';
    if (typeof n !== 'string') return { error: 'In-noti mhumiex validi.' };
    if (n.length > TASK_LIMITS.notes) return { error: `Noti twal wisq (massimu ${TASK_LIMITS.notes} karattru).` };
    f.notes = n;
  }
  if (has(body, 'checklist')) {
    const c = cleanChecklist(body.checklist);
    if (c.error) return c;
    f.checklist = c.items;
  }
  if (has(body, 'due_date')) {
    const d = body.due_date || null;
    if (d && !validDate(d)) return { error: 'Data mhux valida.' };
    f.due_date = d;
  }
  if (has(body, 'label')) {
    const l = body.label || null;
    if (l && !TASK_LABELS.includes(l)) return { error: 'Kulur mhux validu.' };
    f.label = l;
  }
  if (!partial || has(body, 'column_id')) {
    if (typeof body.column_id !== 'string' || !body.column_id) return { error: 'Agħżel kolonna.' };
    f.column_id = body.column_id;
  }
  if (!partial || has(body, 'position')) {
    const p = position(body);
    if (p === null) return { error: 'Pożizzjoni mhux valida.' };
    f.position = p;
  }
  return { fields: f };
}

/** Title + position of a column or a board (same rules; `what` only changes the message). */
export function columnFields(body = {}, { partial = false, what = 'kolonna' } = {}) {
  const f = {};
  if (!partial || has(body, 'title')) {
    const t = String(body.title ?? '').trim();
    if (!t) return { error: what === 'board' ? 'Ikteb isem għall-board.' : 'Ikteb isem għall-kolonna.' };
    if (t.length > TASK_LIMITS.column) return { error: `Isem twil wisq (massimu ${TASK_LIMITS.column} karattru).` };
    f.title = t;
  }
  if (!partial || has(body, 'position')) {
    const p = position(body);
    if (p === null) return { error: 'Pożizzjoni mhux valida.' };
    f.position = p;
  }
  return { fields: f };
}

/** Tick/untick one checklist item. Returns the new list, or null if the item is gone. */
export function applyCheck(list, itemId, done) {
  const items = Array.isArray(list) ? list : [];
  const i = items.findIndex((x) => x.id === itemId);
  if (i < 0) return null;
  return items.map((x, j) => (j === i ? { ...x, done: done === true } : x));
}
