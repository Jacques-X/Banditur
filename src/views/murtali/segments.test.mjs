import test from 'node:test';
import assert from 'node:assert/strict';
import { activity, findSegments, detect, redetect, DISTANCE, thresholds, withLight, hasLight, lightThreshold } from './segments.js';

const zeros = (n) => new Array(n).fill(0);
/** A score of `n` values (0.1 s each) with 1.0 plateaus at the given [from, to) seconds. */
function plateaus(n, ...spans) {
  const s = zeros(n);
  for (const [a, b] of spans) for (let i = Math.round(a * 10); i < Math.round(b * 10); i++) s[i] = 1;
  return s;
}
const opts = { sensitivity: 0.5, preRoll: 0, postRoll: 0, mergeGap: 2.5, minLen: 1 };

test('hysteresis: a run starts above "on" and holds above "off"', () => {
  const { on, off } = thresholds(0.5);
  const s = zeros(100);
  for (let i = 20; i < 40; i++) s[i] = off + 0.01; // never starts
  assert.equal(findSegments(s, opts).length, 0);
  s[25] = on + 0.05;                                // starts here, holds through the low part
  const segs = findSegments(s, opts);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].start, 2.5);
  assert.equal(segs[0].end, 4);
});

test('gaps shorter than mergeGap merge, longer ones stay separate', () => {
  const s = plateaus(300, [5, 8], [9.5, 12], [20, 23]);
  const segs = findSegments(s, opts);
  assert.deepEqual(segs.map((x) => [x.start, x.end]), [[5, 12], [20, 23]]);
});

test('runs shorter than minLen are dropped', () => {
  const s = plateaus(200, [5, 5.5], [10, 12]);
  assert.deepEqual(findSegments(s, opts).map((x) => x.start), [10]);
});

test('padding is asymmetric (pre-roll > post-roll) and clamped to the clip', () => {
  const s = plateaus(200, [1, 3], [15, 18]);
  const segs = findSegments(s, { ...opts, preRoll: 3, postRoll: 1 });
  assert.deepEqual(segs.map((x) => [x.start, x.end]), [[0, 4], [12, 19]]);
  const tail = findSegments(plateaus(200, [18.5, 19.9]), { ...opts, preRoll: 3, postRoll: 1, duration: 20 });
  assert.equal(tail[0].end, 20);
});

test('padded items that touch are joined, not overlapped', () => {
  const s = plateaus(300, [10, 12], [16, 18]);
  const segs = findSegments(s, { ...opts, preRoll: 3, postRoll: 1 });
  assert.equal(segs.length, 1);
  assert.deepEqual([segs[0].start, segs[0].end], [7, 19]);
});

test('distance presets set the pre-roll', () => {
  const s = plateaus(300, [15, 18]);
  const base = { sensitivity: 0.5, postRoll: 1 };
  const a = findSegments(s, { ...base, distance: 'qrib' })[0];
  const b = findSegments(s, { ...base, distance: 'bogħod' })[0];
  assert.equal(a.start, 15 - DISTANCE.qrib);
  assert.equal(b.start, 15 - DISTANCE.bogħod);
  assert.ok(DISTANCE.qrib < DISTANCE.medju && DISTANCE.medju < DISTANCE.bogħod);
});

test('sensitivity is monotonic: higher never keeps less time', () => {
  // a noisy score curve
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const s = Array.from({ length: 1200 }, (_, i) => (Math.sin(i / 17) > 0.4 ? rnd() : rnd() * 0.3));
  let prev = -1;
  for (let k = 0; k <= 10; k++) {
    const total = findSegments(s, { sensitivity: k / 10, preRoll: 3, postRoll: 1 }).reduce((t, x) => t + x.end - x.start, 0);
    assert.ok(total >= prev - 1e-9, `sensitivity ${k / 10}: ${total} < ${prev}`);
    prev = total;
  }
});

test('peak and peakAt come from the score', () => {
  const s = plateaus(200, [5, 8]);
  s[62] = 1.5;
  const seg = findSegments(s, opts)[0];
  assert.equal(seg.peak, 1.5);
  assert.equal(seg.peakAt, 6.25);
});

test('sustained loud sound (music, crowd) scores low; bangs score high', () => {
  const n = 600;
  const tr = zeros(n), low = zeros(n);
  // sustained: moderate transient everywhere (what a band looks like after normalising)
  for (let i = 0; i < n; i++) tr[i] = 40 + (i % 3) * 5;
  // bangs at 20 s, 40 s
  for (const t of [200, 400]) { tr[t] = 255; tr[t + 1] = 200; low[t] = 200; low[t + 1] = 180; }
  const score = activity({ transient: tr, low });
  assert.ok(score[100] < 0.2, `music ${score[100]}`);
  assert.ok(score[200] > 0.6, `bang ${score[200]}`);
  const segs = findSegments(score, { ...opts, sensitivity: 0.6, minLen: 0.2 });
  assert.equal(segs.length, 2);
});

test('detect() runs the whole chain on curves', () => {
  const n = 300;
  const tr = zeros(n), low = zeros(n);
  for (let i = 100; i < 130; i++) { tr[i] = i % 2 ? 255 : 150; low[i] = 150; }
  const segs = detect({ transient: tr, low }, { sensitivity: 0.5 });
  assert.equal(segs.length, 1);
  assert.ok(segs[0].start < 10 && segs[0].end > 13);
});

test('redetect keeps manual items and replaces the automatic ones', () => {
  const old = [
    { id: 'i1', source: 0, start: 10, end: 20, auto: true, keep: true, crop: { x: 0.3 }, peak: 0.5 },
    { id: 'i2', source: 0, start: 30, end: 40, auto: false, keep: true, crop: null, peak: 0.5 },
    { id: 'i3', source: 0, start: 60, end: 70, auto: true, keep: true, crop: null, peak: 0.5 },
    { id: 'j1', source: 1, start: 5, end: 9, auto: true, keep: true, crop: null, peak: 0.5 },
  ];
  const segs = [
    { start: 9, end: 21, peak: 0.9, peakAt: 12 },     // takes over i1
    { start: 35, end: 50, peak: 0.8, peakAt: 36 },    // overlaps manual i2 → only 40-50 remains
    { start: 100, end: 110, peak: 0.7, peakAt: 101 }, // new
  ];
  const out = redetect(old, segs, 0);
  assert.deepEqual(out.map((i) => [i.source, i.start, i.end, i.auto]),
    [[0, 9, 21, true], [0, 30, 40, false], [0, 40, 50, true], [0, 100, 110, true], [1, 5, 9, true]]);
  assert.equal(out[0].id, 'i1');
  assert.deepEqual(out[0].crop, { x: 0.3 });
  assert.equal(out[1].id, 'i2');
  assert.ok(!out.some((i) => i.id === 'i3'));
  assert.equal(new Set(out.map((i) => i.id)).size, out.length);
  for (let k = 1; k < out.length; k++) if (out[k].source === out[k - 1].source) assert.ok(out[k].start >= out[k - 1].end);
});

// ── light: sound AND a light peak ────────────────────────────────────────────
/** curves of `secs` seconds: transient bangs at the given seconds (0.5 s each), flashes of light at the given seconds. */
function curves(secs, { bangs = [], flashes = null }) {
  const n = secs * 10;
  const transient = zeros(n), low = new Array(n).fill(200);
  for (const t of bangs) for (let i = Math.round(t * 10); i < Math.round(t * 10) + 15; i++) transient[i] = 255;
  const c = { transient, low, rms: zeros(n) };
  if (flashes) { c.light = zeros(n); for (const t of flashes) for (let i = Math.round(t * 10); i < Math.round(t * 10) + 3; i++) c.light[i] = 255; }
  return c;
}
const run = (c, o = {}) => detect(c, { sensitivity: 0.5, distance: 'medju', duration: 60, ...o });

test('wind: a bang with no light is dropped, one with a flash before it stays', () => {
  const c = curves(60, { bangs: [14, 40], flashes: [11.5] }); // the flash is 2.5 s before the first bang, nothing before the second
  const segs = run(c);
  assert.equal(segs.length, 1);
  assert.ok(segs[0].start < 14 && segs[0].end > 14);
  assert.equal(run(c, { useLight: false }).length, 2);
});

test('a curve without light (old project, unreadable video) falls back to sound only', () => {
  const c = curves(60, { bangs: [14, 40] });
  assert.equal(hasLight(c), false);
  assert.equal(run(c).length, 2);
  assert.equal(hasLight({ light: [] }), false);
  assert.equal(run({ ...c, light: [] }).length, 2);
});

test('light has to come before the sound, within the distance window', () => {
  const near = curves(60, { bangs: [20], flashes: [17.5] });   // 2.5 s ahead: inside medju (3 s + 1)
  const far = curves(60, { bangs: [20], flashes: [10] });      // 10 s ahead: unrelated
  const after = curves(60, { bangs: [20], flashes: [22] });    // after the bang: unrelated
  assert.equal(run(near).length, 1);
  assert.equal(run(far).length, 0);
  assert.equal(run(after).length, 0);
});

test('a longer distance looks further back for the light', () => {
  const c = curves(60, { bangs: [20], flashes: [15.5] });      // 4.5 s ahead
  assert.equal(run(c, { distance: 'medju' }).length, 0);
  assert.equal(run(c, { distance: 'bogħod' }).length, 1);
});

test('light never raises a score and only scales it', () => {
  const c = curves(60, { bangs: [20], flashes: [18] });
  const s = activity(c);
  const g = withLight(s, c, { sensitivity: 0.5, distance: 'medju' });
  assert.equal(g.length, s.length);
  for (let i = 0; i < s.length; i++) assert.ok(g[i] <= s[i] + 1e-9);
  assert.equal(withLight(s, c, { useLight: false }), s);
});

test('higher sensitivity needs less light', () => {
  assert.ok(lightThreshold(1) < lightThreshold(0));
});
