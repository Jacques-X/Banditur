import test from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_PARTS, resolveTool, toolbarActive, restoreTool, isVideoPart } from './video-parts.js';

const BUTTONS = ['video', 'posts', 'ritratti', 'youtube'];

test('the Video button opens the part used last', () => {
  assert.equal(resolveTool('video', 'murtali'), 'murtali');
  assert.equal(resolveTool('video', 'awdjo'), 'awdjo');
  assert.equal(resolveTool('video', 'traskrittura'), 'traskrittura');
  assert.equal(resolveTool('video', undefined), 'traskrittura');
  assert.equal(resolveTool('video', 'nonsense'), 'traskrittura');
});

test('opening Traskrittura directly (drops, YouTube, handoffs) always lands in Traskrittura', () => {
  assert.equal(resolveTool('traskrittura', 'murtali'), 'traskrittura');
  assert.equal(resolveTool('murtali', 'traskrittura'), 'murtali');
  assert.equal(resolveTool('awdjo', 'traskrittura'), 'awdjo');
  assert.equal(resolveTool('posts', 'murtali'), 'posts');
  assert.equal(resolveTool(null, 'murtali'), null);
});

test('the Video button is highlighted for both parts, and only for them', () => {
  for (const p of VIDEO_PARTS) assert.ok(toolbarActive('video', p));
  assert.ok(!toolbarActive('video', 'posts'));
  assert.ok(toolbarActive('posts', 'posts'));
  assert.ok(!toolbarActive('posts', 'murtali'));
  assert.ok(!toolbarActive('video', null));
});

test('a saved tool restores: video, traskrittura, murtali, others; unknown → null', () => {
  assert.equal(restoreTool('video', BUTTONS, 'murtali'), 'murtali');
  assert.equal(restoreTool('video', BUTTONS, undefined), 'traskrittura');
  assert.equal(restoreTool('traskrittura', BUTTONS, 'murtali'), 'traskrittura');
  assert.equal(restoreTool('murtali', BUTTONS, 'traskrittura'), 'murtali');
  assert.equal(restoreTool('awdjo', BUTTONS, 'traskrittura'), 'awdjo');
  assert.equal(restoreTool('video', BUTTONS, 'awdjo'), 'awdjo');
  assert.equal(restoreTool('posts', BUTTONS, 'traskrittura'), 'posts');
  assert.equal(restoreTool('gone', BUTTONS, 'traskrittura'), null);
  assert.equal(restoreTool(null, BUTTONS, 'traskrittura'), null);
  assert.ok(isVideoPart('murtali') && isVideoPart('awdjo') && !isVideoPart('posts'));
  assert.deepEqual(VIDEO_PARTS, ['traskrittura', 'murtali', 'awdjo']);
});
