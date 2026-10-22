import assert from 'node:assert/strict';
import {
  FRAME_W, FRAME_H, newZone, normalizeZone, normalizeTemplate, makeId, applyCase, fileSlug, fitText,
  coverScale, initialPhoto, photoRect, clampPhoto, panPhoto, zoomPhotoAt, resolutionLevel,
} from './model.js';

let n = 0;
const test = (name, fn) => { fn(); n++; };
// A monospace-ish measure: every character is 0.6 of the size wide.
const measure = (s, size) => s.length * size * 0.6;

test('applyCase handles Maltese capitals', () => {
  assert.equal(applyCase('  ħaġa   żgħira ', 'upper'), 'ĦAĠA ŻGĦIRA');
  assert.equal(applyCase('ĦAĠA', 'lower'), 'ħaġa');
  assert.equal(applyCase(' Marija  Borg ', 'none'), 'Marija Borg');
});

test('fileSlug and makeId fold Maltese letters', () => {
  assert.equal(fileSlug('Ġużeppi Borġ'), 'Guzeppi-Borg');
  assert.equal(fileSlug('Ħamrun / 2026'), 'Hamrun-2026');
  assert.equal(makeId('Kondoljanzi ġdid'), 'kondoljanzi-gdid');
  assert.equal(makeId('Awguri', ['awguri']), 'awguri-2');
  assert.equal(makeId('???'), 'template');
});

test('zones are clamped into the frame and defaults fill gaps', () => {
  const z = normalizeZone({ x: 5000, y: -3, w: 99999, h: 10, color: 'red', align: 'x', maxSize: 5, minSize: 40 });
  assert.equal(z.w, FRAME_W); assert.equal(z.x, 0); assert.equal(z.y, 0); assert.equal(z.h, 40);
  assert.equal(z.color, '#ffffff'); assert.equal(z.align, 'center');
  assert.ok(z.maxSize >= z.minSize);
});

test('normalizeTemplate rejects junk, caps zones, keeps ids unique', () => {
  assert.equal(normalizeTemplate(null), null);
  assert.equal(normalizeTemplate({ id: 'a', zones: [] }), null);
  const t = normalizeTemplate({ id: 'a', name: 'A', zones: [{ id: 'n' }, { id: 'n' }, { id: 'c' }] });
  assert.equal(t.zones.length, 2);
  assert.notEqual(t.zones[0].id, t.zones[1].id);
});

test('fitText: short name uses the max size on one line', () => {
  const zone = newZone({ w: 900, h: 160, maxSize: 90, minSize: 30, maxLines: 2, case: 'none' });
  const r = fitText('Anna', zone, measure);
  assert.equal(r.fits, true); assert.equal(r.size, 90); assert.deepEqual(r.lines, ['Anna']);
});

test('fitText: a long name shrinks, then wraps into balanced lines', () => {
  const zone = newZone({ w: 600, h: 200, maxSize: 90, minSize: 30, maxLines: 2, case: 'none' });
  const r = fitText('Ġużeppi Maria Borg Cassar', zone, measure);
  assert.equal(r.fits, true);
  assert.ok(r.lines.length <= 2);
  for (const l of r.lines) assert.ok(measure(l, r.size) <= 600);
  if (r.lines.length === 2) assert.ok(Math.abs(r.lines[0].length - r.lines[1].length) <= 9);
});

test('fitText: reports when nothing fits, at the minimum size', () => {
  const zone = newZone({ w: 200, h: 60, maxSize: 60, minSize: 30, maxLines: 1, case: 'none' });
  const r = fitText('Wieħed Isem Twil Ħafna', zone, measure);
  assert.equal(r.fits, false); assert.equal(r.size, 30);
});

test('fitText: empty text fits trivially', () => {
  assert.deepEqual(fitText('   ', newZone(), measure).lines, []);
});

test('photo: initial placement covers the frame exactly', () => {
  const r = photoRect(4000, 3000, initialPhoto());
  assert.ok(r.left <= 0 && r.top <= 0);
  assert.ok(r.left + r.w >= FRAME_W - 1e-6 && r.top + r.h >= FRAME_H - 1e-6);
  assert.equal(coverScale(1080, 1350), 1);
});

test('photo: panning can never expose an empty strip', () => {
  const img = [4000, 3000];
  let st = zoomPhotoAt(...img, initialPhoto(), 2);
  st = panPhoto(...img, st, 99999, 99999);
  let r = photoRect(...img, st);
  assert.ok(r.left <= 1e-6 && r.top <= 1e-6);
  st = panPhoto(...img, st, -99999, -99999);
  r = photoRect(...img, st);
  assert.ok(r.left + r.w >= FRAME_W - 1e-6 && r.top + r.h >= FRAME_H - 1e-6);
});

test('photo: zoom keeps the point under the cursor fixed', () => {
  const img = [4000, 3000];
  const st = panPhoto(...img, zoomPhotoAt(...img, initialPhoto(), 2), 120, 0);
  const fx = 400, fy = 600;
  const a = photoRect(...img, st);
  const ix = (fx - a.left) / a.scale, iy = (fy - a.top) / a.scale;
  const st2 = zoomPhotoAt(...img, st, 3, fx, fy);
  const b = photoRect(...img, st2);
  assert.ok(Math.abs(b.left + ix * b.scale - fx) < 1e-6);
  assert.ok(Math.abs(b.top + iy * b.scale - fy) < 1e-6);
});

test('photo: zoom stays within 1..8 and a portrait photo needs no pan to fill', () => {
  assert.equal(zoomPhotoAt(2000, 2500, initialPhoto(), 0.2).zoom, 1);
  assert.equal(zoomPhotoAt(2000, 2500, initialPhoto(), 50).zoom, 8);
  const st = clampPhoto(2000, 2500, { zoom: 1, cx: 0, cy: 0 });
  assert.ok(Math.abs(st.cx - FRAME_W / 2) < 1e-6 && Math.abs(st.cy - FRAME_H / 2) < 1e-6);
});

test('resolutionLevel flags enlarged photos', () => {
  assert.equal(resolutionLevel(4000, 3000, initialPhoto()), 'ok');
  assert.equal(resolutionLevel(900, 1125, initialPhoto()), 'soft');
  assert.equal(resolutionLevel(500, 625, initialPhoto()), 'bad');
});

console.log(`postmaker model: ${n} tests passed`);
