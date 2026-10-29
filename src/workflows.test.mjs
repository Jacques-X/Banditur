import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maltaInstant, maltaWall, schedulePreset } from './lib/malta-time.js';
import { parseSrt, replacePassage } from './subtitles/import.js';
import { normalizeTemplate, photoRect, initialPhoto, clampPhoto } from './postmaker/model.js';

test('Malta time is independent of host timezone and seasonal offset', () => {
  assert.equal(maltaInstant('2026-12-01T18:30'), '2026-12-01T17:30:00.000Z');
  assert.equal(maltaInstant('2026-07-01T18:30'), '2026-07-01T16:30:00.000Z');
  assert.equal(maltaWall('2026-07-01T16:30:00Z'), '2026-07-01T18:30');
});
test('missing and ambiguous daylight-saving times are rejected', () => {
  assert.throws(() => maltaInstant('2026-03-29T02:30'), /ma jeżistix/);
  assert.throws(() => maltaInstant('2026-10-25T02:30'), /jirrepeti/);
  assert.throws(() => maltaInstant('2026-02-31T12:00'));
});
test('SRT import preserves cue boundaries and Maltese text', () => {
  const cues = parseSrt(
    '1\r\n00:00:01,100 --> 00:00:03,500\r\nĠużeppi ħareġ\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nfil-pjazza\r\n',
  );
  assert.equal(cues[0].start, 1.1);
  assert.equal(cues[0].end, 3.5);
  assert.equal(cues[0].words.map((w) => w.text).join(' '), 'Ġużeppi ħareġ');
  assert.equal(cues[1].end, 5);
});
test('invalid SRT never silently discards the rest of the file', () =>
  assert.throws(() => parseSrt('1\n00:00:01,000 --> 00:00:00,000\nbad')));
test('passage replacement preserves corrections and style outside selection', () => {
  const cues = parseSrt(
    '1\n00:00:00,000 --> 00:00:01,000\nĦares\n\n2\n00:00:02,000 --> 00:00:03,000\nżball\n\n3\n00:00:04,000 --> 00:00:05,000\nġewwa',
  );
  cues[1].look = { color: '#ff0000' };
  cues[2].style = 'classic';
  const next = replacePassage(cues, 2, 3, [
    { text: 'Tajjeb', start: 2, end: 3, prob: 1, speaker: 'SPEAKER_00' },
  ]);
  assert.deepEqual(next[0], cues[0]);
  assert.deepEqual(next.at(-1), cues[2]);
  assert.deepEqual(next[1].look, cues[1].look);
  assert.equal(cues[1].words[0].text, 'żball');
});
test('legacy templates retain 4:5 coordinates; new formats cover their frame', () => {
  const legacy = normalizeTemplate({ id: 'old', name: 'Old', zones: [{ x: 80, y: 1090, w: 920, h: 120 }] });
  assert.equal(legacy.height, 1350);
  assert.equal(legacy.zones[0].y, 1090);
  for (const height of [1080, 1350, 1920]) {
    const st = clampPhoto(1600, 900, initialPhoto(1080, height), 1080, height),
      r = photoRect(1600, 900, st, 1080, height);
    assert.ok(r.w >= 1080);
    assert.ok(r.h >= height);
    assert.ok(r.left <= 0);
    assert.ok(r.top <= 0);
  }
});

import { shortDateTime, whenLabel } from './lib/format.js';
test('labels and presets apply the Malta offset once', () => {
  assert.equal(shortDateTime('2026-07-01T16:30:00Z'), 'Erb 1 Lul · 18:30');
  assert.equal(schedulePreset('am', new Date('2026-10-29T23:30:00Z')), '2026-10-31T09:00');
  assert.equal(schedulePreset('pm', new Date('2026-07-01T16:30:00Z')), '2026-07-02T18:30');
  assert.match(whenLabel('2026-07-01T16:30:00Z'), /18:30$/);
});
