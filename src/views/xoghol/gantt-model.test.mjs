import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCALES, span, chartRange, ticks, barOf, dragDates, daysFor, newSpan, dayAt, ganttRows, addDays } from './gantt-model.js';

const t = (o) => ({ id: o.id || 'x', column_id: 'c1', position: 1, start_date: null, due_date: null, ...o });

test('a card spans start…due; a lone date is one day; no dates, no bar', () => {
  assert.deepEqual(span(t({ start_date: '2026-11-02', due_date: '2026-11-06' })), ['2026-11-02', '2026-11-06']);
  assert.deepEqual(span(t({ due_date: '2026-11-06' })), ['2026-11-06', '2026-11-06']);
  assert.deepEqual(span(t({ start_date: '2026-11-02' })), ['2026-11-02', '2026-11-02']);
  assert.equal(span(t({})), null);
  const range = { start: '2026-11-02', days: 56 };
  assert.deepEqual(barOf(t({ start_date: '2026-11-03', due_date: '2026-11-05' }), range, 30), { x: 30, w: 90 });
  assert.deepEqual(barOf(t({ due_date: '2026-11-02' }), range, 30), { x: 0, w: 30 });
});

test('week range: starts on a Monday, covers today and cards, at least 8 weeks', () => {
  const r = chartRange([], '2026-11-06', 'week'); // a Friday
  assert.equal(r.start, '2026-10-26');            // Monday on/before 30 Oct
  assert.equal(r.days, 56);
  const far = chartRange([t({ start_date: '2026-09-01', due_date: '2027-02-10' })], '2026-11-06', 'week');
  assert.equal(new Date(far.start).getUTCDay(), 1);
  assert.ok(far.start <= '2026-08-29');
  assert.ok(addDays(far.start, far.days) > '2027-02-13');
  assert.equal(far.days % 7, 0);
});

test('month range: whole months, at least ~6', () => {
  const r = chartRange([t({ due_date: '2026-12-20' })], '2026-11-06', 'month');
  assert.equal(r.start, '2026-10-01');
  assert.equal(addDays(r.start, r.days).slice(8), '01');
  assert.ok(r.days >= 180);
});

test('ticks: month bands, Monday lines with the day, weekends', () => {
  const { months, lines, weekends } = ticks({ start: '2026-10-26', days: 14 }, 'week', 10);
  assert.deepEqual(months.map((m) => [m.x, m.w]), [[0, 60], [60, 80]]);
  assert.match(months[1].label, /2026$/);
  assert.deepEqual(lines, [{ x: 0, label: '26' }, { x: 70, label: '2' }]);
  assert.deepEqual(weekends.map((w) => w.x), [50, 120]);
  const m = ticks({ start: '2026-10-01', days: 61 }, 'month', 2);
  assert.deepEqual(m.lines.map((l) => l.x), [0, 62]);
  assert.equal(m.weekends.length, 0);
});

test('dragging: move both ends, resize one, never shorter than a day', () => {
  const task = t({ start_date: '2026-11-02', due_date: '2026-11-06' });
  assert.deepEqual(dragDates(task, 'move', 3), { start_date: '2026-11-05', due_date: '2026-11-09' });
  assert.deepEqual(dragDates(task, 'move', -5), { start_date: '2026-10-28', due_date: '2026-11-01' });
  assert.deepEqual(dragDates(task, 'start', 2), { start_date: '2026-11-04', due_date: '2026-11-06' });
  assert.deepEqual(dragDates(task, 'start', 9), { start_date: '2026-11-06', due_date: '2026-11-06' });
  assert.deepEqual(dragDates(task, 'end', -9), { start_date: '2026-11-02', due_date: '2026-11-02' });
  // A due-only card gains a start when moved or resized.
  assert.deepEqual(dragDates(t({ due_date: '2026-11-06' }), 'start', -2), { start_date: '2026-11-04', due_date: '2026-11-06' });
  assert.equal(daysFor(44, 30), 1);
  assert.equal(daysFor(-14, 30), 0);
  assert.equal(daysFor(-16, 30), -1);
});

test('placing an undated card, and the day under the pointer', () => {
  assert.deepEqual(newSpan('2026-11-09'), { start_date: '2026-11-09', due_date: '2026-11-15' });
  assert.equal(dayAt(65, { start: '2026-11-02', days: 56 }, 30), '2026-11-04');
});

test('rows follow the board: columns in order, cards in order', () => {
  const columns = [{ id: 'c2', position: 2 }, { id: 'c1', position: 1 }];
  const tasks = [t({ id: 'b', column_id: 'c1', position: 2, due_date: '2026-11-06' }), t({ id: 'a', column_id: 'c1', position: 1 }), t({ id: 'z', column_id: 'c2', position: 1 })];
  const r = ganttRows(columns, tasks);
  assert.deepEqual(r.groups.map((g) => [g.column.id, g.tasks.map((x) => x.id)]), [['c1', ['a', 'b']], ['c2', ['z']]]);
  assert.deepEqual([r.dated, r.undated], [1, 2]);
});

test('year zoom: whole months covering at least a year, short month names', () => {
  const r = chartRange([], '2026-11-06', 'year');
  assert.equal(r.start, '2026-10-01');
  assert.ok(r.days >= 365);
  assert.equal(addDays(r.start, r.days).slice(8), '01');
  const { months, lines } = ticks(r, 'year', SCALES.year.px);
  assert.ok(months.length >= 12);
  assert.equal(months[1].label, 'Nov 2026');
  assert.equal(lines.length, months.length);
});

test('the range can be stretched to fill the screen', () => {
  assert.equal(chartRange([], '2026-11-06', 'week', 100).days, 105);
  const y = chartRange([], '2026-11-06', 'year', 500);
  assert.ok(y.days >= 500);
  assert.equal(addDays(y.start, y.days).slice(8), '01');
});
