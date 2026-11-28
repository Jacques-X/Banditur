import test from 'node:test';
import assert from 'node:assert/strict';
import {
  outputExt, soundFormat, outputCandidates, freeOutput, clampStrength, strengthFraction, addFiles, nextWaiting, isRunning,
  removeItem, clearFinished, retryFailed, counts, overallPct, isSupported, isAudioOnly, extOf, stemOf, dirOf, baseOf, makeItem,
} from './awdjo.js';

test('path helpers', () => {
  assert.equal(baseOf('/a/b/Festa 1.MOV'), 'Festa 1.MOV');
  assert.equal(dirOf('/a/b/Festa 1.MOV'), '/a/b');
  assert.equal(extOf('/a/b/Festa 1.MOV'), 'mov');
  assert.equal(stemOf('/a/b/Festa.v2.mp4'), 'Festa.v2');
  assert.equal(extOf('/a/.hidden'), '');
});

test('the output keeps MOV, MP4, M4V and MXF; other videos become MOV; sound-only files become WAV', () => {
  for (const e of ['mov', 'mp4', 'm4v', 'mxf']) assert.equal(outputExt(`/x/a.${e.toUpperCase()}`), e);
  for (const e of ['mkv', 'avi', 'mts', 'webm', 'mpg']) assert.equal(outputExt(`/x/a.${e}`), 'mov');
  for (const e of ['wav', 'mp3', 'm4a', 'flac']) assert.equal(outputExt(`/x/a.${e}`), 'wav');
});

test('MP4 and M4V get AAC 320, the rest PCM 24-bit', () => {
  assert.deepEqual(soundFormat('mp4'), { codec: 'aac', label: 'AAC 320 kbps' });
  assert.equal(soundFormat('m4v').codec, 'aac');
  for (const e of ['mov', 'mxf', 'wav']) assert.deepEqual(soundFormat(e), { codec: 'pcm_s24le', label: 'PCM 24-bit' });
});

test('the new file sits next to the original: "name (nadif).ext", then " 2", " 3"…', () => {
  const c = outputCandidates('/Volumes/SSD/Festa/A001.MOV', 4);
  assert.deepEqual(c, [
    '/Volumes/SSD/Festa/A001 (nadif).mov',
    '/Volumes/SSD/Festa/A001 (nadif) 2.mov',
    '/Volumes/SSD/Festa/A001 (nadif) 3.mov',
    '/Volumes/SSD/Festa/A001 (nadif) 4.mov',
  ]);
  assert.equal(outputCandidates('/x/clip.mkv', 1)[0], '/x/clip (nadif).mov');
  assert.equal(outputCandidates('/x/voice.mp3', 1)[0], '/x/voice (nadif).wav');
  assert.ok(!outputCandidates('/x/a.mp4', 3).includes('/x/a.mp4'));
});

test('freeOutput skips names that exist and never offers the original', async () => {
  const existing = new Set(['/x/a (nadif).mp4', '/x/a (nadif) 2.mp4']);
  const taken = async (paths) => paths.map((p) => existing.has(p));
  assert.equal(await freeOutput('/x/a.mp4', taken), '/x/a (nadif) 3.mp4');
  assert.equal(await freeOutput('/x/b.mp4', taken), '/x/b (nadif).mp4');
  await assert.rejects(freeOutput('/x/a.mp4', async (p) => p.map(() => true)));
  // names beyond the first batch of 20
  const many = new Set(outputCandidates('/x/c.mov', 25));
  assert.equal(await freeOutput('/x/c.mov', async (p) => p.map((n) => many.has(n))), '/x/c (nadif) 26.mov');
});

test('strength: whole percent 0-100, junk falls back to 100', () => {
  assert.equal(clampStrength(80.4), 80);
  assert.equal(clampStrength(-5), 0);
  assert.equal(clampStrength(250), 100);
  assert.equal(clampStrength('abc'), 100);
  assert.equal(strengthFraction(50), 0.5);
});

test('supported files', () => {
  assert.ok(isSupported('/a/b.MOV') && isSupported('/a/b.wav') && !isSupported('/a/b.jpg') && !isSupported('/a/b'));
  assert.ok(isAudioOnly('/a/b.mp3') && !isAudioOnly('/a/b.mp4'));
});

let n = 0;
const id = () => `i${++n}`;

test('adding files: unsupported ones are reported, a file already waiting is not added twice', () => {
  const a = addFiles([], ['/x/a.mov', '/x/b.jpg', '/x/c.mp4', ''], id);
  assert.equal(a.added, 2);
  assert.deepEqual(a.rejected, ['b.jpg']);
  const b = addFiles(a.queue, ['/x/a.mov', '/x/d.mxf'], id);
  assert.equal(b.added, 1);
  assert.deepEqual(b.queue.map((q) => q.name), ['a.mov', 'c.mp4', 'd.mxf']);
  // a finished file can be queued again
  const done = b.queue.map((q) => (q.name === 'a.mov' ? { ...q, state: 'done' } : q));
  assert.equal(addFiles(done, ['/x/a.mov'], id).added, 1);
});

test('queue moves: next waiting, remove (not the running one), clear finished, retry', () => {
  let q = ['a', 'b', 'c', 'd'].map((x) => makeItem(`/x/${x}.mov`, x));
  q[0].state = 'done'; q[1].state = 'run'; q[2].state = 'error';
  assert.equal(nextWaiting(q).id, 'd');
  assert.ok(isRunning(q));
  assert.equal(removeItem(q, 'b').length, 4);
  assert.equal(removeItem(q, 'd').length, 3);
  assert.deepEqual(clearFinished(q).map((x) => x.id), ['b', 'd']);
  const r = retryFailed(q);
  assert.equal(r[2].state, 'wait');
  assert.equal(r[0].state, 'done');
  assert.deepEqual(counts(q), { wait: 1, run: 1, done: 1, error: 1, cancelled: 0 });
});

test('overall progress counts finished files whole and the running one by its own percentage', () => {
  const q = ['a', 'b', 'c', 'd'].map((x) => makeItem(`/x/${x}.mov`, x));
  assert.equal(overallPct(q), 0);
  q[0].state = 'done'; q[1].state = 'run'; q[1].pct = 50;
  assert.equal(overallPct(q), Math.round((100 + 50) / 4));
  assert.equal(overallPct([]), 0);
});
