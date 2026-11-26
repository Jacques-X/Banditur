import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from './timeline.js';

const view = { start: 10, pps: 20 };

test('pixels and time convert both ways', () => {
  assert.equal(T.timeToX(12, view), 40);
  assert.equal(T.xToTime(40, view), 12);
});

test('fitView shows the whole clip', () => {
  const v = T.fitView(600, 1200);
  assert.equal(v.start, 0);
  assert.equal(v.pps, 2);
});

test('clampView keeps the view inside the clip', () => {
  assert.equal(T.clampView({ start: -5, pps: 10 }, 100, 500).start, 0);
  assert.equal(T.clampView({ start: 90, pps: 10 }, 100, 500).start, 50);
  assert.equal(T.clampView({ start: 3, pps: 1 }, 100, 500).start, 0, 'zoomed out beyond the clip');
  assert.equal(T.clampView({ start: 0, pps: 10000 }, 100, 500).pps, T.MAX_PPS);
});

test('zoomAt keeps the time under the pointer in place', () => {
  const v = { start: 20, pps: 10 };
  const t = T.xToTime(200, v);
  const z = T.zoomAt(v, 2, 200, 600, 1000);
  assert.ok(Math.abs(T.xToTime(200, z) - t) < 1e-9);
  assert.equal(z.pps, 20);
});

test('hitTest: edges win near an edge, then the body, then nothing', () => {
  const items = [{ id: 'a', start: 12, end: 15 }, { id: 'b', start: 15.1, end: 20 }];
  // a: x 40..100 ; b: x 102..200
  assert.deepEqual(T.hitTest(items, 42, view), { id: 'a', part: 'start' });
  assert.deepEqual(T.hitTest(items, 99, view), { id: 'a', part: 'end' });
  assert.deepEqual(T.hitTest(items, 102, view), { id: 'b', part: 'start' }, 'the nearer edge wins');
  assert.deepEqual(T.hitTest(items, 70, view), { id: 'a', part: 'body' });
  assert.equal(T.hitTest(items, 10, view), null);
  assert.equal(T.hitTest(items, 300, view), null);
});

test('hitTest: a tiny item still has a body', () => {
  const tiny = [{ id: 't', start: 12, end: 12.3 }]; // 6 px wide
  assert.equal(T.hitTest(tiny, 43, view).id, 't');
});

test('snap pulls to a target within SNAP_PX only', () => {
  assert.equal(T.snap(12.2, [12], view), 12);        // 4 px away
  assert.equal(T.snap(12.6, [12], view), 12.6);      // 12 px away
  assert.equal(T.snap(12.2, [null, 12.1], view), 12.1);
});

test('columns: max of the samples under each pixel column', () => {
  const series = [0, 255, 0, 0, 128, 0, 0, 0, 0, 0];
  const cols = T.columns(series, 10, { start: 0, pps: 5 }, 3); // 2 samples per px
  assert.deepEqual(cols, [1, 0, 128 / 255]);
  assert.deepEqual(T.columns([], 10, view, 3), [0, 0, 0]);
});

test('ticks pick a step that keeps labels apart', () => {
  const { step, times } = T.ticks({ start: 0, pps: 2 }, 400);
  assert.ok(step * 2 >= 80);
  assert.equal(times[0], 0);
  assert.ok(times.every((t) => t * 2 <= 400));
});

test('reveal follows the playhead only when it leaves the view', () => {
  const v = { start: 0, pps: 10 };
  assert.equal(T.reveal(v, 20, 300, 400), v);
  const r = T.reveal(v, 100, 300, 400);
  assert.ok(T.timeToX(100, r) > 0 && T.timeToX(100, r) < 400);
});

test('jumpTarget: Shift+arrows go from firework to firework', () => {
  const items = [{ id: 'b', start: 30, end: 40 }, { id: 'a', start: 10, end: 20 }, { id: 'c', start: 50, end: 55, keep: false }];
  assert.equal(T.jumpTarget(items, 0, 1).id, 'a');
  assert.equal(T.jumpTarget(items, 10, 1).id, 'b', 'at a start: the next one, not the same');
  assert.equal(T.jumpTarget(items, 15, 1).id, 'b');
  assert.equal(T.jumpTarget(items, 45, 1).id, 'c', 'hidden items are still stops');
  assert.equal(T.jumpTarget(items, 52, 1), null);
  assert.equal(T.jumpTarget(items, 35, -1).id, 'b', 'inside an item: back to its start');
  assert.equal(T.jumpTarget(items, 30.1, -1).id, 'a', 'just after a start: the previous one');
  assert.equal(T.jumpTarget(items, 25, -1).id, 'a', 'in a gap: the one before');
  assert.equal(T.jumpTarget(items, 10, -1), null);
  assert.equal(T.jumpTarget([], 5, 1), null);
});
