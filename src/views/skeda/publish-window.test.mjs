import test from 'node:test';
import assert from 'node:assert/strict';
import { publishWindow } from './publish-window.js';

const now = Date.UTC(2026, 10, 22, 18, 0);
const at = (min) => now + min * 60000;

test('a Facebook post an hour ahead goes out on the minute', () => {
  assert.deepEqual(publishWindow({ at: at(60), now, platforms: ['fb'] }).exact, ['fb']);
});

test('Instagram, Reels and Stories are published by the worker', () => {
  const r = publishWindow({ at: at(60), now, platforms: ['fb', 'ig'] });
  assert.deepEqual(r.exact, ['fb']);
  assert.deepEqual(r.late, ['ig']);
  assert.equal(r.until, at(75));
  assert.deepEqual(publishWindow({ at: at(60), now, platforms: ['fb'], contentType: 'reel' }).late, ['fb']);
  assert.deepEqual(publishWindow({ at: at(60), now, platforms: ['fb'], contentType: 'story' }).late, ['fb']);
});

test('a Facebook post due soon or too far ahead is not handed to Facebook', () => {
  assert.deepEqual(publishWindow({ at: at(20), now, platforms: ['fb'] }).late, ['fb']);
  assert.deepEqual(publishWindow({ at: at(25), now, platforms: ['fb'] }).exact, ['fb']);
  assert.deepEqual(publishWindow({ at: at(31 * 24 * 60), now, platforms: ['fb'] }).late, ['fb']);
});
