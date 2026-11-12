import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nameHasDate, posterNameVariants } from '../api/_lib/poster-date.js';

test('a poster name holds the date as DD:MM:YY, with the usual separators', () => {
  for (const n of ['15:11:26 Festa.jpg', 'Festa 15.11.26.png', '15-11-2026_festa.jpg', 'x 15/11/26 y', '15 11 26 Festa.jpg']) {
    assert.ok(nameHasDate(n, '2026-11-15'), n);
  }
});

test('other dates and longer numbers do not match', () => {
  assert.ok(!nameHasDate('16:11:26 Festa.jpg', '2026-11-15'));
  assert.ok(!nameHasDate('115:11:26.jpg', '2026-11-15'));
  assert.ok(!nameHasDate('15:11:265.jpg', '2026-11-15'));
  assert.ok(!nameHasDate('15:11:27 Festa.jpg', '2026-11-15'));
  assert.ok(!nameHasDate('Festa.jpg', 'not a date'));
});

test('the Drive search spellings cover every separator and both year lengths', () => {
  const v = posterNameVariants('2026-11-15');
  assert.ok(v.includes('15:11:26') && v.includes('15.11.2026') && v.includes('15-11-26'));
  assert.deepEqual(posterNameVariants('x'), []);
});
