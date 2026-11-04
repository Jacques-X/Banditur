// Xogħol board — pure helpers (no Svelte, no I/O), unit-tested in model.test.mjs.
// Validation rules are shared with the backend (backend/api/_lib/task-rules.js).
import { maltaWall } from '../../lib/malta-time.js';
import { MONTHS_SHORT } from '../../lib/format.js';
export { TASK_LABELS, TASK_LIMITS, taskFields, columnFields, cleanChecklist, applyCheck } from '../../../backend/api/_lib/task-rules.js';

/** The fixed colour labels: id (stored) → Maltese name + colour. */
export const LABELS = [
  { id: 'red', name: 'Aħmar', color: '#D9483B' },
  { id: 'orange', name: 'Oranġjo', color: '#E07A1F' },
  { id: 'yellow', name: 'Isfar', color: '#D2A30F' },
  { id: 'green', name: 'Aħdar', color: '#2E9A5A' },
  { id: 'blue', name: 'Blu', color: '#3463D6' },
  { id: 'purple', name: 'Vjola', color: '#8A4DD0' },
];
export const labelById = (id) => LABELS.find((l) => l.id === id) || null;

const STEP = 1024;
const byPosition = (a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id));

/** Columns (or boards) in display order. */
export const sortedColumns = (columns) => [...columns].sort(byPosition);

/** Cards of one column, in order. */
export const cardsIn = (tasks, columnId) => tasks.filter((t) => t.column_id === columnId).sort(byPosition);

/**
 * Position for an item dropped at `index` among `siblings` (already sorted,
 * WITHOUT the moved item). Returns null when the neighbours are too close to
 * split — the caller then renumbers the list (see renumber()).
 */
export function positionAt(siblings, index) {
  const i = Math.max(0, Math.min(index, siblings.length));
  const before = siblings[i - 1]?.position;
  const after = siblings[i]?.position;
  if (before === undefined && after === undefined) return STEP;
  if (before === undefined) return after - STEP;
  if (after === undefined) return before + STEP;
  const mid = (before + after) / 2;
  return mid > before && mid < after && after - before > 1e-6 ? mid : null;
}

/** Evenly spaced positions for a list, in its current order: [{ id, position }]. */
export const renumber = (items) => items.map((x, i) => ({ id: x.id, position: (i + 1) * STEP }));

/**
 * Plan a move of `taskId` to `columnId` at `index`. Returns the position
 * updates to send: usually just the moved card; all cards of the target
 * column when there was no room left between neighbours.
 */
export function planMove(tasks, taskId, columnId, index) {
  const siblings = cardsIn(tasks, columnId).filter((t) => t.id !== taskId);
  const position = positionAt(siblings, index);
  if (position !== null) return [{ id: taskId, column_id: columnId, position }];
  const order = [...siblings];
  order.splice(Math.max(0, Math.min(index, order.length)), 0, { id: taskId });
  return renumber(order).map((u) => ({ ...u, column_id: columnId }));
}

/** Where Alt+arrow moves a card: { columnId, index } or null at the edge. */
export function keyboardTarget(columns, tasks, taskId, key) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const cols = sortedColumns(columns);
  const ci = cols.findIndex((c) => c.id === task.column_id);
  const own = cardsIn(tasks, task.column_id);
  const i = own.findIndex((t) => t.id === taskId);
  if (key === 'ArrowUp') return i > 0 ? { columnId: task.column_id, index: i - 1 } : null;
  if (key === 'ArrowDown') return i < own.length - 1 ? { columnId: task.column_id, index: i + 1 } : null;
  const next = cols[ci + (key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0)];
  if (!next || next.id === task.column_id) return null;
  const there = cardsIn(tasks, next.id);
  return { columnId: next.id, index: Math.min(i, there.length) };
}

/** Index a dragged card would take in a column, from the pointer's y and the cards' boxes. */
export function dropIndex(boxes, y) {
  // boxes: [{ top, height }] of the column's cards (excluding the dragged one), top to bottom.
  for (let i = 0; i < boxes.length; i++) if (y < boxes[i].top + boxes[i].height / 2) return i;
  return boxes.length;
}

/** Checklist progress { done, total }. */
export function progress(checklist = []) {
  return { done: checklist.filter((x) => x.done).length, total: checklist.length };
}

/** Today's date in Malta, YYYY-MM-DD. */
export const maltaToday = (now = new Date()) => maltaWall(now).slice(0, 10);

const dayNumber = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000);

/**
 * Due-date chip: { text, tone } with tone 'overdue' | 'today' | 'soon' | ''.
 * `finished` (card in the last column) turns off the warning colours.
 */
export function dueInfo(due, today = maltaToday(), finished = false) {
  if (!due) return null;
  const diff = dayNumber(due) - dayNumber(today);
  const [y, m, d] = due.split('-').map(Number);
  let text = `${d} ${MONTHS_SHORT[m - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`;
  if (diff === 0) text = 'Illum';
  else if (diff === 1) text = 'Għada';
  else if (diff === -1) text = 'Il-bieraħ';
  if (finished) return { text, tone: '' };
  return { text, tone: diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff <= 2 ? 'soon' : '' };
}

let seq = 0;
/** A short id for a new checklist item (unique within a card). */
export const itemId = () => `i${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
