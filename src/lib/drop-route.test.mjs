import test from 'node:test';
import assert from 'node:assert/strict';
import { routeDrop, extOf, parentOf } from './drop-route.js';

test('extensions and parent folders', () => {
  assert.equal(extOf('/a/B.MOV'), 'mov');
  assert.equal(extOf('/a/Festa 2026'), '');
  assert.equal(extOf('/a/.hidden'), '');
  assert.equal(parentOf('/Users/x/Ritratti/DSC1.ARW'), '/Users/x/Ritratti');
  assert.equal(parentOf('/Users/x/Ritratti/'), '/Users/x');
});

test('a video goes to Traskrittura, even with photos alongside', () => {
  assert.deepEqual(routeDrop(['/a/p.jpg', '/a/v.mp4', '/a/w.mov']), { to: 'traskrittura', paths: ['/a/v.mp4'], label: 'Traskrittura' });
});

test('RAW files go to Ritratti with their folder', () => {
  assert.deepEqual(routeDrop(['/r/A.CR3', '/r/B.CR3']), { to: 'ritratti', paths: ['/r'], label: 'Ritratti' });
});

test('loose photos are not routed anywhere', () => {
  assert.equal(routeDrop(['/p/a.png', '/p/b.jpg']), null);
});

test('a folder goes to Ritratti', () => {
  assert.deepEqual(routeDrop(['/Users/x/Festa']), { to: 'ritratti', paths: ['/Users/x/Festa'], label: 'Ritratti' });
});

test('nothing usable', () => {
  assert.equal(routeDrop([]), null);
  assert.equal(routeDrop(['/a/notes.txt']), null);
});
