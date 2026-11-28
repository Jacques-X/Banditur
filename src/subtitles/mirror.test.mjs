import test from 'node:test';
import assert from 'node:assert/strict';
import { needsSeek, DRIFT_PAUSED, DRIFT_PLAYING } from './mirror.js';

test('the twin follows the visible video: exact while paused, loose while playing', () => {
  assert.equal(needsSeek(3, 3, false), false);
  assert.equal(needsSeek(3, 3 + DRIFT_PAUSED * 2, false), true);
  assert.equal(needsSeek(3, 3 + DRIFT_PLAYING / 2, true), false);
  assert.equal(needsSeek(3, 3 - DRIFT_PLAYING * 2, true), true);
});

test('a twin with no time yet is moved; a video with no time is left alone', () => {
  assert.equal(needsSeek(2, NaN, false), true);
  assert.equal(needsSeek(NaN, 0, false), false);
});
