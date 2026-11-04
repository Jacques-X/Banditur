import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaIssues, fitPlan, ratioText, photoTarget, RATIO } from './media-check.js';

const MB = 1024 * 1024;
const jpg = (width, height, size = 2 * MB) => ({ type: 'image/jpeg', size, width, height });
const vid = (width, height, duration, size = 20 * MB) => ({ type: 'video/mp4', size, width, height, duration });
const errors = (list) => list.filter((i) => i.level === 'error');

test('shapes read as ratios', () => {
  assert.equal(ratioText(1080, 1350), '4:5');
  assert.equal(ratioText(1080, 1920), '9:16');
  assert.equal(ratioText(4000, 3000), '4:3');
  assert.equal(ratioText(1000, 3000), '1:3.00');
});

test('unmeasured media has no issues', () => {
  assert.deepEqual(mediaIssues({ type: 'image/png', size: 1 }, { platforms: ['ig'] }), []);
});

test('Instagram feed photos must be JPG and between 4:5 and 1.91:1', () => {
  const ok = { platforms: ['fb', 'ig'], contentType: 'post' };
  assert.deepEqual(mediaIssues(jpg(1080, 1350), ok), []);
  assert.deepEqual(mediaIssues(jpg(1910, 1000), ok), []);
  const png = mediaIssues({ ...jpg(1080, 1080), type: 'image/png' }, ok);
  assert.equal(png[0].fixes[0].op, 'jpeg');
  const tall = errors(mediaIssues(jpg(1080, 1920), ok));
  assert.match(tall[0].text, /9:16/);
  assert.deepEqual(tall[0].fixes.map((f) => f.op), ['crop', 'pad']);
  assert.equal(errors(mediaIssues(jpg(3000, 1000), ok)).length, 1);
  // Facebook alone accepts any shape and PNG.
  assert.deepEqual(mediaIssues({ ...jpg(1080, 1920), type: 'image/png' }, { platforms: ['fb'] }), []);
});

test('size limits follow the strictest platform', () => {
  assert.equal(errors(mediaIssues(jpg(1080, 1080, 9 * MB), { platforms: ['ig'] })).length, 1);
  assert.equal(errors(mediaIssues(jpg(1080, 1080, 9 * MB), { platforms: ['fb'] })).length, 0);
  assert.equal(errors(mediaIssues(jpg(1080, 1920, 5 * MB), { platforms: ['fb'], contentType: 'story' })).length, 1);
  assert.deepEqual(photoTarget(['fb', 'ig'], 'post'), { maxWidth: 1440, maxHeight: 3600, maxBytes: 8 * MB });
});

test('a carousel photo with another shape than the first is a warning', () => {
  const first = jpg(1080, 1080);
  const r = mediaIssues(jpg(1080, 1350), { platforms: ['ig'], first, count: 3 });
  assert.equal(r.length, 1);
  assert.equal(r[0].level, 'warn');
  assert.equal(r[0].fixes[0].ratio, 1);
  assert.deepEqual(mediaIssues(first, { platforms: ['ig'], first, count: 3 }), []);
});

test('Stories prefer 9:16', () => {
  const r = mediaIssues(jpg(1080, 1080), { platforms: ['ig'], contentType: 'story' });
  assert.equal(r[0].level, 'warn');
  assert.equal(r[0].fixes[0].ratio, RATIO.story);
});

test('video length limits per type and platform', () => {
  assert.equal(errors(mediaIssues(vid(1080, 1920, 2), { platforms: ['ig'], contentType: 'reel' })).length, 1);
  assert.deepEqual(mediaIssues(vid(1080, 1920, 120), { platforms: ['ig'], contentType: 'reel' }), []);
  assert.equal(errors(mediaIssues(vid(1080, 1920, 120), { platforms: ['fb', 'ig'], contentType: 'reel' })).length, 1);
  assert.equal(errors(mediaIssues(vid(1080, 1920, 75), { platforms: ['ig'], contentType: 'story' })).length, 1);
  const wide = mediaIssues(vid(1920, 1080, 30), { platforms: ['fb'], contentType: 'reel' });
  assert.equal(wide.length, 1);
  assert.equal(wide[0].level, 'warn');
});

test('crop and pad plans keep the picture centred and inside the limits', () => {
  const max = { maxWidth: 1440, maxHeight: 3600 };
  const crop = fitPlan(1080, 1920, 'crop', 4 / 5, max);
  assert.deepEqual([crop.width, crop.height], [1080, 1350]);
  assert.deepEqual(crop.src, [0, 285, 1080, 1350]);
  const pad = fitPlan(1080, 1080, 'pad', 9 / 16, max);
  assert.deepEqual([pad.width, pad.height], [1080, 1920]);
  assert.deepEqual(pad.dst, [0, 420, 1080, 1080]);
  assert.ok(pad.pad);
  const big = fitPlan(6000, 4000, 'jpeg', null, max);
  assert.deepEqual([big.width, big.height], [1440, 960]);
});
