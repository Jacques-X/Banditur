import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays, addMonths, mondayOf, weekday, monthGrid, shiftWall, cleanEvent, occurrences, layoutDay, moved, resized, daysInMonth, touches,
} from './model.js';

const ev = (o) => ({ id: 'e1', title: 'Festa', allDay: false, start: '2026-11-12T19:00', end: '2026-11-12T21:00', repeat: null, ...o });

test('date arithmetic works on plain strings', () => {
  assert.equal(addDays('2026-02-27', 3), '2026-03-02');
  assert.equal(addDays('2026-11-12T19:00', 1), '2026-11-13T19:00');
  assert.equal(weekday('2026-11-12'), 4);
  assert.equal(mondayOf('2026-11-15'), '2026-11-09');
  assert.equal(mondayOf('2026-11-09'), '2026-11-09');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-01');
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(shiftWall('2026-11-12T23:30', 45), '2026-11-13T00:15');
});

test('monthGrid covers the month in whole Monday-first weeks', () => {
  const w = monthGrid('2026-11-12');
  assert.equal(w[0][0], '2026-10-26');
  assert.equal(w.at(-1)[6], '2026-12-06');
  assert.ok(w.every((x) => x.length === 7));
  assert.equal(monthGrid('2026-02-10').length, 5); // 1 Feb 2026 is a Sunday: 26 Jan – 1 Mar
  assert.equal(monthGrid('2026-02-10')[0][0], '2026-01-26');
});

test('cleanEvent trims, validates and normalises', () => {
  assert.equal(cleanEvent({ title: '  ', start: 'x' }).error, 'It-titlu huwa meħtieġ.');
  assert.ok(cleanEvent({ title: 'A', start: '2026-11-12T10:00', end: '2026-11-12T10:00' }).error);
  assert.ok(cleanEvent({ title: 'A', start: '2026-02-30T10:00', end: '2026-03-01T10:00' }).error, 'impossible date');
  assert.ok(cleanEvent({ title: 'A', start: '2026-11-12T24:00', end: '2026-11-13T10:00' }).error, 'hour 24');
  assert.ok(cleanEvent({ title: 'A', allDay: true, start: '2026-11-12T10:00', end: '2026-11-13' }).error, 'all-day needs dates');
  const ok = cleanEvent({ title: ' Festa ', label: ' Festa', start: '2026-11-12T19:00', end: '2026-11-12T21:00', location: ' Rabat ' });
  assert.deepEqual(ok.event, { title: 'Festa', label: 'Festa', allDay: false, start: '2026-11-12T19:00', end: '2026-11-12T21:00', location: 'Rabat', description: '', repeat: null, poster: null });
  assert.ok(cleanEvent({ title: 'A', start: '2026-11-12T10:00', end: '2026-11-12T11:00', repeat: { freq: 'hourly' } }).error);
  assert.ok(cleanEvent({ title: 'A', start: '2026-11-12T10:00', end: '2026-11-12T11:00', repeat: { freq: 'daily', until: '2026-11-01' } }).error);
  assert.deepEqual(cleanEvent({ title: 'A', start: '2026-11-12T10:00', end: '2026-11-12T11:00', repeat: { freq: 'weekly', interval: '2' } }).event.repeat, { freq: 'weekly', interval: 2, until: null });
});

test('a single event appears once, only in its window', () => {
  const o = occurrences([ev()], '2026-11-09', '2026-11-16');
  assert.equal(o.length, 1);
  assert.equal(o[0].first, '2026-11-12');
  assert.equal(occurrences([ev()], '2026-11-13', '2026-11-20').length, 0);
});

test('an event ending exactly at midnight does not touch the next day; one passing midnight does', () => {
  const a = occurrences([ev({ start: '2026-11-12T22:00', end: '2026-11-13T00:00' })], '2026-11-12', '2026-11-15')[0];
  assert.equal(a.last, '2026-11-12');
  const b = occurrences([ev({ start: '2026-11-12T22:00', end: '2026-11-13T01:00' })], '2026-11-12', '2026-11-15')[0];
  assert.equal(b.last, '2026-11-13');
  assert.ok(touches(b, '2026-11-13') && !touches(b, '2026-11-14'));
});

test('all-day events: end is exclusive, multi-day spans several days', () => {
  const one = occurrences([ev({ allDay: true, start: '2026-11-12', end: '2026-11-13' })], '2026-11-01', '2026-12-01')[0];
  assert.equal(one.first, one.last);
  const three = occurrences([ev({ allDay: true, start: '2026-11-12', end: '2026-11-15' })], '2026-11-01', '2026-12-01')[0];
  assert.equal(three.last, '2026-11-14');
});

test('weekly repetition, with interval and until', () => {
  const e = ev({ repeat: { freq: 'weekly', interval: 2, until: '2026-12-31' } });
  const days = occurrences([e], '2026-11-01', '2027-02-01').map((o) => o.first);
  assert.deepEqual(days, ['2026-11-12', '2026-11-26', '2026-12-10', '2026-12-24']);
  assert.deepEqual(occurrences([e], '2026-11-20', '2026-12-01').map((o) => o.first), ['2026-11-26']);
});

test('daily and a window far from the start stay fast and correct', () => {
  const e = ev({ start: '2020-01-01T08:00', end: '2020-01-01T09:00', repeat: { freq: 'daily', interval: 1 } });
  const o = occurrences([e], '2026-11-09', '2026-11-16');
  assert.equal(o.length, 7);
  assert.equal(o[0].start, '2026-11-09T08:00');
});

test('monthly on the 31st skips short months; yearly keeps the date', () => {
  const m = ev({ start: '2026-01-31T10:00', end: '2026-01-31T11:00', repeat: { freq: 'monthly', interval: 1 } });
  assert.deepEqual(occurrences([m], '2026-01-01', '2026-06-01').map((o) => o.first), ['2026-01-31', '2026-03-31', '2026-05-31']);
  const y = ev({ allDay: true, start: '2026-06-29', end: '2026-06-30', repeat: { freq: 'yearly', interval: 1 } });
  assert.deepEqual(occurrences([y], '2027-01-01', '2029-01-01').map((o) => o.first), ['2027-06-29', '2028-06-29']);
});

test('a multi-day repeating event that started before the window still shows', () => {
  const e = ev({ allDay: true, start: '2026-11-08', end: '2026-11-12', repeat: { freq: 'weekly', interval: 1 } });
  const o = occurrences([e], '2026-11-16', '2026-11-18');
  assert.equal(o.length, 1);
  assert.equal(o[0].first, '2026-11-15');
});

test('occurrences sort all-day first, then by time', () => {
  const list = occurrences([ev({ id: 'a', start: '2026-11-12T10:00', end: '2026-11-12T11:00', title: 'B' }), ev({ id: 'b', allDay: true, start: '2026-11-12', end: '2026-11-13', title: 'Z' }), ev({ id: 'c', start: '2026-11-12T08:00', end: '2026-11-12T09:00', title: 'A' })], '2026-11-12', '2026-11-13');
  assert.deepEqual(list.map((o) => o.event.id), ['b', 'c', 'a']);
});

test('layoutDay puts overlapping items side by side and clips at midnight', () => {
  const day = '2026-11-12';
  const L = layoutDay([
    { id: 1, start: day + 'T09:00', end: day + 'T11:00' },
    { id: 2, start: day + 'T10:00', end: day + 'T12:00' },
    { id: 3, start: day + 'T11:00', end: day + 'T11:30' },
    { id: 4, start: day + 'T15:00', end: day + 'T15:05' },
    { id: 5, start: day + 'T23:00', end: '2026-11-13T02:00' },
  ], day);
  const by = Object.fromEntries(L.map((r) => [r.item.id, r]));
  assert.deepEqual([by[1].col, by[2].col, by[3].col], [0, 1, 0]);
  assert.equal(by[1].cols, 2);
  assert.equal(by[4].cols, 1);
  assert.equal(by[4].height, 20, 'tiny items stay clickable');
  assert.equal(by[5].top + by[5].height, 1440);
});

test('moved and resized', () => {
  const e = ev();
  assert.deepEqual(moved(e, 1, -60), { start: '2026-11-13T18:00', end: '2026-11-13T20:00' });
  assert.deepEqual(moved(ev({ allDay: true, start: '2026-11-12', end: '2026-11-13' }), 2, 999), { start: '2026-11-14', end: '2026-11-15' });
  assert.equal(resized(e, 30).end, '2026-11-12T21:30');
  assert.equal(resized(e, -500).end, '2026-11-12T19:15', 'never shorter than 15 minutes');
});

test('cleanEvent keeps a poster as id + name, and drops a broken one', () => {
  const base = { title: 'Festa', start: '2026-11-12T19:00', end: '2026-11-12T19:30' };
  assert.deepEqual(cleanEvent({ ...base, poster: { id: 'abc', name: '2026-11-12 Festa.jpg' } }).event.poster, { id: 'abc', name: '2026-11-12 Festa.jpg' });
  assert.equal(cleanEvent({ ...base, poster: { name: 'x' } }).event.poster, null);
  assert.equal(cleanEvent(base).event.poster, null);
});
