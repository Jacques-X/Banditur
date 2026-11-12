import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionAt, planMove, keyboardTarget, dropIndex, dueInfo, datesInfo, progress, cardsIn, LABELS, TASK_LABELS } from './model.js';

const cols = [{ id: 'a', position: 1024 }, { id: 'b', position: 2048 }, { id: 'c', position: 3072 }];
const tasks = [
  { id: 't1', column_id: 'a', position: 1024 },
  { id: 't2', column_id: 'a', position: 2048 },
  { id: 't3', column_id: 'a', position: 3072 },
  { id: 't4', column_id: 'b', position: 1024 },
];

test('labels in the UI match the ones the backend accepts', () => {
  assert.deepEqual(LABELS.map((l) => l.id), TASK_LABELS);
});

test('a dropped card lands between its neighbours', () => {
  const s = [{ position: 1024 }, { position: 2048 }];
  assert.equal(positionAt([], 0), 1024);
  assert.equal(positionAt(s, 0), 0);
  assert.equal(positionAt(s, 1), 1536);
  assert.equal(positionAt(s, 2), 3072);
  assert.equal(positionAt([{ position: 1 }, { position: 1 + 1e-9 }], 1), null);
});

test('moving updates one card, or renumbers the column when there is no room', () => {
  assert.deepEqual(planMove(tasks, 't3', 'a', 0), [{ id: 't3', column_id: 'a', position: 0 }]);
  assert.deepEqual(planMove(tasks, 't1', 'b', 1), [{ id: 't1', column_id: 'b', position: 2048 }]);
  const tight = [{ id: 'x', column_id: 'a', position: 1 }, { id: 'y', column_id: 'a', position: 1 + 1e-9 }, { id: 'z', column_id: 'b', position: 5 }];
  assert.deepEqual(planMove(tight, 'z', 'a', 1).map((u) => u.id), ['x', 'z', 'y']);
  // Applying the plan gives the intended order.
  const after = tasks.map((t) => ({ ...t, ...(planMove(tasks, 't1', 'a', 2).find((u) => u.id === t.id) || {}) }));
  assert.deepEqual(cardsIn(after, 'a').map((t) => t.id), ['t2', 't3', 't1']);
});

test('Alt+arrows move within and across columns, and stop at the edges', () => {
  assert.equal(keyboardTarget(cols, tasks, 't1', 'ArrowUp'), null);
  assert.deepEqual(keyboardTarget(cols, tasks, 't1', 'ArrowDown'), { columnId: 'a', index: 1 });
  assert.deepEqual(keyboardTarget(cols, tasks, 't3', 'ArrowRight'), { columnId: 'b', index: 1 });
  assert.equal(keyboardTarget(cols, tasks, 't1', 'ArrowLeft'), null);
});

test('drop index follows the pointer against card midpoints', () => {
  const boxes = [{ top: 0, height: 100 }, { top: 110, height: 100 }];
  assert.equal(dropIndex(boxes, 10), 0);
  assert.equal(dropIndex(boxes, 120), 1);
  assert.equal(dropIndex(boxes, 400), 2);
  assert.equal(dropIndex([], 5), 0);
});

test('due dates read in Maltese and warn only for unfinished cards', () => {
  assert.deepEqual(dueInfo('2026-11-03', '2026-11-03'), { text: 'Illum', tone: 'today' });
  assert.deepEqual(dueInfo('2026-11-04', '2026-11-03'), { text: 'Għada', tone: 'soon' });
  assert.deepEqual(dueInfo('2026-11-01', '2026-11-03'), { text: '1 Nov', tone: 'overdue' });
  assert.deepEqual(dueInfo('2026-11-01', '2026-11-03', true), { text: '1 Nov', tone: '' });
  assert.deepEqual(dueInfo('2027-01-15', '2026-11-03'), { text: '15 Jan 2027', tone: '' });
  assert.equal(dueInfo(null), null);
});

test('checklist progress', () => {
  assert.deepEqual(progress([{ done: true }, { done: false }]), { done: 1, total: 2 });
});

test('a card with a start date shows the range', () => {
  assert.deepEqual(datesInfo('2026-11-01', '2026-11-04', '2026-11-03'), { text: '1 Nov – Għada', tone: 'soon' });
  assert.deepEqual(datesInfo('2026-11-10', null, '2026-11-03'), { text: 'Mill- 10 Nov', tone: '' });
  assert.deepEqual(datesInfo('2026-11-03', '2026-11-03', '2026-11-03'), { text: 'Illum', tone: 'today' });
  assert.equal(datesInfo(null, null), null);
});
