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
/** "3 Nov" (with the year when it isn't this year). */
export function dateText(date, today = maltaToday()) {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`;
}

/**
 * The date chip on a card: the due date as in dueInfo(), prefixed with the
 * start ("3 Nov – Għada"), or "Mill- 3 Nov" when only a start is set.
 */
export function datesInfo(start, due, today = maltaToday(), finished = false) {
  const d = dueInfo(due, today, finished);
  if (!start) return d;
  if (!d) return { text: `Mill- ${dateText(start, today)}`, tone: '' };
  return { ...d, text: start === due ? d.text : `${dateText(start, today)} – ${d.text}` };
}

export function dueInfo(due, today = maltaToday(), finished = false) {
  if (!due) return null;
  const diff = dayNumber(due) - dayNumber(today);
  let text = dateText(due, today);
  if (diff === 0) text = 'Illum';
  else if (diff === 1) text = 'Għada';
  else if (diff === -1) text = 'Il-bieraħ';
  if (finished) return { text, tone: '' };
  return { text, tone: diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff <= 2 ? 'soon' : '' };
}

let seq = 0;
/** A short id for a new checklist item (unique within a card). */
export const itemId = () => `i${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ── Money (cards carry whole cents: budget_cents = planned, spent_cents = paid so far) ──

const TASK_LIMITS_CENTS = 1_000_000_000; // same as TASK_LIMITS.cents

/**
 * "12,50", "12.5", "€1 200" → cents. Empty → null (no amount). Anything else
 * (letters, three decimals, negative) → undefined, so the caller can say it is invalid.
 */
export function eurosToCents(text) {
  const t = String(text ?? '').replace(/[€\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!t) return null;
  const m = t.match(/^(\d+)(?:[.,](\d{1,2}))?$/);
  if (!m) return undefined;
  const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
  return Number.isSafeInteger(cents) && cents <= TASK_LIMITS_CENTS ? cents : undefined;
}

/** Cents → what goes in an input ("12.50", "200"); null → "". */
export const centsToInput = (c) => (c == null ? '' : c % 100 ? (c / 100).toFixed(2) : String(c / 100));

/** "€1,200" or "€12.50". */
export function moneyText(c) {
  const n = (c ?? 0) / 100;
  return `€${n.toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** The money chip on a card: { text, tone } or null. tone 'over' when more is spent than planned. */
export function moneyInfo(task) {
  const b = task.budget_cents ?? null;
  const s = task.spent_cents ?? null;
  if (b == null && s == null) return null;
  if (b == null) return { text: `${moneyText(s)} spent`, tone: '' };
  if (s == null) return { text: `${moneyText(b)} budget`, tone: '' };
  return { text: `${moneyText(s)} / ${moneyText(b)}`, tone: s > b ? 'over' : '' };
}

/** Totals over some cards: { budget, spent, left, count } (count = cards with an amount). */
export function budgetTotals(tasks) {
  let budget = 0, spent = 0, count = 0;
  for (const t of tasks) {
    if (t.budget_cents == null && t.spent_cents == null) continue;
    count++;
    budget += t.budget_cents ?? 0;
    spent += t.spent_cents ?? 0;
  }
  return { budget, spent, left: budget - spent, count };
}
