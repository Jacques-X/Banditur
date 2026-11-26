import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from './items.js';

const it = (id, start, end, extra = {}) => ({ id, source: 0, start, end, auto: true, keep: true, crop: null, label: '', peak: 0.5, peakAt: start + 1, ...extra });
const doc = () => ({ items: [it('i1', 10, 20), it('i2', 30, 40, { peak: 0.9 }), it('i3', 50, 60)], reel: ['i2', 'i1'] });
const D = { duration: 100 };

test('trim moves an edge, marks the item touched, and stops at neighbours and the clip', () => {
  let d = I.trim(doc(), 'i1', { start: 8 }, D);
  assert.equal(I.find(d, 'i1').start, 8);
  assert.equal(I.find(d, 'i1').auto, false);
  d = I.trim(doc(), 'i1', { end: 35 }, D);
  assert.equal(I.find(d, 'i1').end, 30, 'cannot run into the next item');
  d = I.trim(doc(), 'i2', { start: 5 }, D);
  assert.equal(I.find(d, 'i2').start, 20, 'cannot run into the previous item');
  d = I.trim(doc(), 'i3', { end: 500 }, D);
  assert.equal(I.find(d, 'i3').end, 100);
  d = I.trim(doc(), 'i1', { start: 19.9 }, D);
  assert.equal(I.find(d, 'i1').start, 20 - I.MIN_ITEM);
  const same = doc();
  assert.equal(I.trim(same, 'i1', { start: 10 }, D), same, 'no change → same object');
});

test('operations never mutate their input', () => {
  const d = doc();
  const snap = JSON.stringify(d);
  I.trim(d, 'i1', { start: 8 }, D); I.split(d, 15); I.join(d, 'i1'); I.remove(d, 'i1');
  I.add(d, 0, 22, 28, D); I.toggleReel(d, 'i3'); I.setCrop(d, 'i1', 0.2); I.reorderReel(d, 0, 1); I.copyCropToAll(d, 'i1');
  assert.equal(JSON.stringify(d), snap);
});

test('split cuts the item under the time into two touched halves', () => {
  const d = I.split(doc(), 15);
  const [a, b] = d.items.filter((i) => i.start < 20 && i.end > 10);
  assert.deepEqual([a.start, a.end, b.start, b.end], [10, 15, 15, 20]);
  assert.ok(!a.auto && !b.auto);
  assert.notEqual(a.id, b.id);
  assert.equal(new Set(d.items.map((i) => i.id)).size, 4);
  assert.equal(I.split(doc(), 25).items.length, 3, 'outside any item: unchanged');
  assert.equal(I.split(doc(), 10.2).items.length, 3, 'too close to an edge');
});

test('join merges with the next item of the same source and drops its reel entry', () => {
  const d = I.join(doc(), 'i1');
  assert.deepEqual(d.items.map((i) => [i.id, i.start, i.end]), [['i1', 10, 40], ['i3', 50, 60]]);
  assert.equal(I.find(d, 'i1').peak, 0.9);
  assert.deepEqual(d.reel, ['i1']);
  const last = doc();
  assert.equal(I.join(last, 'i3'), last);
});

test('remove drops the item and its reel entry', () => {
  const d = I.remove(doc(), 'i2');
  assert.deepEqual(d.items.map((i) => i.id), ['i1', 'i3']);
  assert.deepEqual(d.reel, ['i1']);
});

test('add fits a manual item into the free space', () => {
  let d = I.add(doc(), 0, 22, 28, D);
  assert.equal(d.items.length, 4);
  assert.equal(d.items.find((i) => i.start === 22).auto, false);
  d = I.add(doc(), 0, 15, 35, D);   // overlaps i1 and i2: largest free piece is 20-30
  assert.deepEqual([d.items[1].start, d.items[1].end], [20, 30]);
  const same = doc();
  assert.equal(I.add(same, 0, 12, 18, D), same, 'fully covered');
  assert.equal(I.add(same, 0, 21, 21.2, D), same, 'too short');
});

test('reel selection toggles, reorders, and setReel de-duplicates and ignores unknown ids', () => {
  let d = I.toggleReel(doc(), 'i3');
  assert.deepEqual(d.reel, ['i2', 'i1', 'i3']);
  d = I.toggleReel(d, 'i2');
  assert.deepEqual(d.reel, ['i1', 'i3']);
  assert.deepEqual(I.reorderReel(doc(), 0, 1).reel, ['i1', 'i2']);
  const d0 = doc();
  assert.equal(I.reorderReel(d0, 0, 5), d0);
  assert.deepEqual(I.setReel(doc(), ['i3', 'zz', 'i3', 'i1']).reel, ['i3', 'i1']);
  assert.equal(I.toggleReel(d0, 'nope'), d0);
});

test('crop: set (clamped) and copy to every reel item', () => {
  let d = I.setCrop(doc(), 'i1', 1.7);
  assert.deepEqual(I.find(d, 'i1').crop, { x: 1 });
  d = I.setCrop(d, 'i1', 0.25);
  d = I.copyCropToAll(d, 'i1');
  assert.deepEqual(I.find(d, 'i2').crop, { x: 0.25 });
  assert.equal(I.find(d, 'i3').crop, null, 'not in the reel');
  const none = doc();
  assert.equal(I.copyCropToAll(none, 'i1'), none, 'nothing aimed yet');
});

test('keep toggles', () => {
  const d = I.toggleKeep(doc(), 'i1');
  assert.equal(I.find(d, 'i1').keep, false);
  assert.equal(I.find(I.toggleKeep(d, 'i1'), 'i1').keep, true);
});

test('setItems sorts and drops reel entries of vanished items', () => {
  const d = I.setItems(doc(), [it('i3', 50, 60), it('i1', 10, 20)]);
  assert.deepEqual(d.items.map((i) => i.id), ['i1', 'i3']);
  assert.deepEqual(d.reel, ['i1']);
});
