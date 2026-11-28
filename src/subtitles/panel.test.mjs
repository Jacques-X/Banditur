import test from 'node:test';
import assert from 'node:assert/strict';
import { TABS, normalizeTab, checkBadge, badgeLabel, restoreSections, sectionOpen, withSection } from './panel.js';

test('an unknown or missing remembered tab opens the first one', () => {
  assert.deepEqual(TABS, ['text', 'style', 'check']);
  assert.equal(normalizeTab('style'), 'style');
  assert.equal(normalizeTab('names'), 'text');
  assert.equal(normalizeTab(null), 'text');
});

test('the check badge adds unsure words and hard-to-read captions', () => {
  assert.equal(checkBadge(2, 3), 5);
  assert.equal(checkBadge(0, 0), 0);
  assert.equal(checkBadge(-1, undefined), 0);
  assert.equal(badgeLabel(0), '');
  assert.equal(badgeLabel(7), '7');
  assert.equal(badgeLabel(250), '99+');
});

test('folded sections: stored map is cleaned, defaults apply, changes are remembered', () => {
  assert.deepEqual(restoreSections({ more: true, junk: 'x', pos: false }), { more: true, pos: false });
  assert.deepEqual(restoreSections(['more']), {});
  assert.deepEqual(restoreSections(null), {});
  assert.equal(sectionOpen({}, 'more'), false);
  assert.equal(sectionOpen({}, 'caps', true), true);
  assert.equal(sectionOpen({ caps: false }, 'caps', true), false);
  const m = withSection({ more: true }, 'pos', true);
  assert.deepEqual(m, { more: true, pos: true });
  assert.deepEqual(withSection(m, 'more', false), { more: false, pos: true });
});
