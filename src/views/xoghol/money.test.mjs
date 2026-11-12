import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eurosToCents, centsToInput, moneyText, moneyInfo, budgetTotals, taskFields } from './model.js';
import { createLocalStore } from './local-store.js';

test('amounts typed by hand become whole cents; nonsense is refused', () => {
  assert.equal(eurosToCents('120'), 12000);
  assert.equal(eurosToCents('45,5'), 4550);
  assert.equal(eurosToCents('45.50'), 4550);
  assert.equal(eurosToCents(' €1 200 '), 120000);
  assert.equal(eurosToCents('1,200.50'), 120050);
  assert.equal(eurosToCents(''), null);
  for (const bad of ['abc', '-5', '1.234', '12,', '1e3', '99999999999']) assert.equal(eurosToCents(bad), undefined, bad);
});

test('cents print back the way they were typed', () => {
  assert.equal(centsToInput(null), '');
  assert.equal(centsToInput(12000), '120');
  assert.equal(centsToInput(4550), '45.50');
  assert.equal(moneyText(120000), '€1,200');
  assert.equal(moneyText(4550), '€45.50');
  assert.equal(moneyText(0), '€0');
});

test('the card chip shows spent against budget and warns when over', () => {
  assert.equal(moneyInfo({}), null);
  assert.deepEqual(moneyInfo({ budget_cents: 20000 }), { text: '€200 budget', tone: '' });
  assert.deepEqual(moneyInfo({ spent_cents: 5000 }), { text: '€50 spent', tone: '' });
  assert.deepEqual(moneyInfo({ budget_cents: 20000, spent_cents: 4550 }), { text: '€45.50 / €200', tone: '' });
  assert.equal(moneyInfo({ budget_cents: 1000, spent_cents: 1001 }).tone, 'over');
  assert.equal(moneyInfo({ budget_cents: 1000, spent_cents: 1000 }).tone, '');
});

test('board totals add only the cards that have an amount', () => {
  const t = budgetTotals([{ budget_cents: 10000, spent_cents: 2500 }, { spent_cents: 500 }, {}, { budget_cents: 5000 }]);
  assert.deepEqual(t, { budget: 15000, spent: 3000, left: 12000, count: 3 });
  assert.equal(budgetTotals([{ budget_cents: 100, spent_cents: 300 }]).left, -200);
});

test('the rules accept whole non-negative cents or nothing, and the store keeps them', async () => {
  assert.deepEqual(taskFields({ budget_cents: 500, spent_cents: null }, { partial: true }).fields, { budget_cents: 500, spent_cents: null });
  for (const bad of [-1, 1.5, '12', 2_000_000_000]) assert.ok(taskFields({ budget_cents: bad }, { partial: true }).error, String(bad));
  const mem = new Map();
  const store = createLocalStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
  const b = await store.request({ method: 'POST', body: { type: 'board', title: 'Festa', position: 1024 } });
  const task = await store.request({ method: 'POST', body: { title: 'Bandalori', column_id: b.columns[0].id, position: 1024 } });
  assert.equal(task.budget_cents, null);
  const saved = await store.request({ method: 'PATCH', query: { id: task.id }, body: { budget_cents: 25000, spent_cents: 1999 } });
  assert.deepEqual([saved.budget_cents, saved.spent_cents], [25000, 1999]);
});

import { stepsOf, chartRange } from './gantt-model.js';
import { cleanChecklist } from './model.js';

test('dated checklist steps form the sub-timeline and widen the chart', () => {
  const task = { start_date: '2026-11-10', due_date: '2026-11-12', checklist: [
    { id: 'a', text: 'Skript', done: true, start_date: '2026-11-10', due_date: '2026-11-11' },
    { id: 'b', text: 'Bla dati', done: false },
    { id: 'c', text: 'Għadd', done: false, start_date: '2027-03-01' },
  ] };
  assert.deepEqual(stepsOf(task).map((s) => s.id), ['a', 'c']);
  const r = chartRange([task], '2026-11-11', 'week');
  assert.ok(r.start <= '2026-11-10' && Date.parse(r.start) + r.days * 86400000 > Date.parse('2027-03-01'));
});

test('step dates are checked and kept; undated steps stay as before', () => {
  const ok = cleanChecklist([{ id: 'a', text: 'x', start_date: '2026-11-01', due_date: '2026-11-05' }, { id: 'b', text: 'y', start_date: '' }]);
  assert.deepEqual(ok.items, [{ id: 'a', text: 'x', done: false, start_date: '2026-11-01', due_date: '2026-11-05' }, { id: 'b', text: 'y', done: false }]);
  assert.ok(cleanChecklist([{ id: 'a', text: 'x', start_date: '2026-11-09', due_date: '2026-11-05' }]).error);
  assert.ok(cleanChecklist([{ id: 'a', text: 'x', due_date: '2026-13-40' }]).error);
});

test('steps can carry their own amounts; they show on the step but stay out of board totals', () => {
  const ok = cleanChecklist([{ id: 'a', text: 'x', budget_cents: 5000, spent_cents: 0 }, { id: 'b', text: 'y', budget_cents: null }]);
  assert.deepEqual(ok.items, [{ id: 'a', text: 'x', done: false, budget_cents: 5000, spent_cents: 0 }, { id: 'b', text: 'y', done: false }]);
  assert.ok(cleanChecklist([{ id: 'a', text: 'x', spent_cents: -3 }]).error);
  assert.ok(cleanChecklist([{ id: 'a', text: 'x', budget_cents: 1.5 }]).error);
  assert.equal(moneyInfo(ok.items[0]).text, '€50 / €0'.replace('€50 / €0', '€0 / €50'));
  assert.deepEqual(budgetTotals([{ budget_cents: 10000, checklist: ok.items }]), { budget: 10000, spent: 0, left: 10000, count: 1 });
});
