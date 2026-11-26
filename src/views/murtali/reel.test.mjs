import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from './reel.js';

const it = (id, source, start, end, peak = 0.5, extra = {}) => ({ id, source, start, end, auto: true, keep: true, crop: null, label: '', peak, peakAt: start, ...extra });
const items = [it('a', 0, 10, 20, 0.2), it('b', 0, 30, 40, 0.9), it('c', 0, 50, 60, 0.7), it('d', 1, 5, 9, 0.8), it('e', 0, 70, 80, 0.1)];
const project = (extra = {}) => ({ sources: [{ path: '/a.mp4', duration: 100 }, { path: '/b.mp4', duration: 50 }], items, reel: ['c', 'a'], ...extra });

test('cropWindow centres by default and clamps to the frame (1920x1080)', () => {
  assert.deepEqual(R.cropWindow(undefined, 1920, 1080), { x: 657, w: 606, h: 1080 });
  assert.equal(R.cropWindow(0, 1920, 1080).x, 0);
  assert.equal(R.cropWindow(1, 1920, 1080).x, 1920 - 606);
  assert.equal(R.cropWindow(-4, 1920, 1080).x, 0);
  assert.equal(R.cropWindow(9, 1920, 1080).x, 1920 - 606);
  assert.equal(R.cropWindow(0.5, 3840, 2160).w, 1214);
});

test('cropWindow agrees with the renderer for a spread of positions (hand-computed from the formula)', () => {
  for (const x of [0, 0.1, 0.25, 0.5, 0.77, 1]) {
    const w = 606, srcW = 1920;
    const left = Math.max(0, Math.min(Math.floor(x * srcW - w / 2 + 0.5), srcW - w));
    assert.equal(R.cropWindow(x, srcW, 1080).x, left);
  }
});

test('a 9:16 (or narrower) source is used whole', () => {
  assert.deepEqual(R.cropWindow(0.3, 1080, 1920), { x: 0, w: 1080, h: 1920 });
  assert.deepEqual(R.cropWindow(0.3, 1080, 2340), { x: 0, w: 1080, h: 2340 });
});

test('centreOf is the inverse of the window position', () => {
  const win = R.cropWindow(0.8, 1920, 1080);
  assert.ok(Math.abs(R.centreOf(win.x, win.w, 1920) - 0.8) < 0.001);
  assert.equal(R.centreOf(-50, 606, 1920) >= 0, true);
});

test('bestN picks the highest peaks and returns them in time order', () => {
  assert.deepEqual(R.bestN(items, 3).map((i) => i.id), ['b', 'c', 'd'].sort((x, y) => items.find((i) => i.id === x).source - items.find((i) => i.id === y).source || items.find((i) => i.id === x).start - items.find((i) => i.id === y).start));
  assert.deepEqual(R.bestN(items, 2).map((i) => i.id), ['b', 'd']);
  assert.equal(R.bestN(items, 7).length, 5);
  const dropped = items.map((i) => (i.id === 'b' ? { ...i, keep: false } : i));
  assert.ok(!R.bestN(dropped, 2).some((i) => i.id === 'b'));
});

test('reelItems follows the reel order, not time order', () => {
  assert.deepEqual(R.reelItems(project()).map((i) => i.id), ['c', 'a']);
  assert.deepEqual(R.reelItems({ items, reel: ['zz', 'b'] }).map((i) => i.id), ['b']);
});

test('the counter is fine at 6-7 and a warning outside, never a block', () => {
  assert.equal(R.reelCount(5).tone, 'warn');
  assert.equal(R.reelCount(6).tone, 'ok');
  assert.equal(R.reelCount(7).tone, 'ok');
  assert.equal(R.reelCount(8).tone, 'warn');
});

test('exportJob full: kept items in time order across sources, no crop', () => {
  const p = project({ items: items.map((i) => (i.id === 'e' ? { ...i, keep: false } : i)) });
  const job = R.exportJob('full', p, { output: '/o.mp4', size: '1080p' });
  assert.equal(job.kind, 'full');
  assert.equal(job.size, '1080p');
  assert.deepEqual(job.items.map((i) => [i.path, i.start]), [['/a.mp4', 10], ['/a.mp4', 30], ['/a.mp4', 50], ['/b.mp4', 5]]);
  assert.ok(job.items.every((i) => i.crop === null));
});

test('exportJob reel: reel order with each item\'s crop', () => {
  const p = project({ items: items.map((i) => (i.id === 'c' ? { ...i, crop: { x: 0.2 } } : i)) });
  const job = R.exportJob('reel', p, { output: '/r.mp4' });
  assert.deepEqual(job.items.map((i) => [i.start, i.crop]), [[50, { x: 0.2 }], [10, null]]);
  assert.equal(job.size, 'auto');
});

test('unaimed lists reel items without a crop', () => {
  const p = project({ items: items.map((i) => (i.id === 'c' ? { ...i, crop: { x: 0.2 } } : i)) });
  assert.deepEqual(R.unaimed(p).map((i) => i.id), ['a']);
});

test('platform length warnings: Facebook Reel over 90 s, Instagram up to 15 min', () => {
  assert.deepEqual(R.reelWarnings(60), []);
  const w = R.reelWarnings(120);
  assert.equal(w.length, 1);
  assert.match(w[0], /Facebook/);
  assert.equal(R.reelWarnings(1000).length, 2);
  assert.match(R.reelWarnings(30, { bytes: 80 * 1024 * 1024 })[0], /50 MB/);
});

test('clock and summary', () => {
  assert.equal(R.clock(271), '4:31');
  assert.equal(R.clock(3725), '1:02:05');
  const p = project();
  assert.match(R.summary(p), /^5 murtali · 0:44 minn 2:30 · Reel: 2 · 0:20$/);
});

test('exportJob carries the LUT only when it is on', () => {
  const p = { sources: [{ path: '/a.mp4' }], items: [{ id: 'a', source: 0, start: 1, end: 3 }], reel: ['a'] };
  assert.equal(R.exportJob('full', p, { output: '/o.mp4' }).lut, null);
  assert.equal(R.exportJob('full', p, { output: '/o.mp4', lut: { path: '/l.cube', strength: 0 } }).lut, null);
  assert.deepEqual(R.exportJob('reel', p, { output: '/o.mp4', lut: { path: '/l.cube', name: 'L', strength: 0.7 } }).lut, { path: '/l.cube', strength: 0.7 });
});
