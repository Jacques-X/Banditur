import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, score, search } from './palette.js';

const items = [
  { title: 'Skeda', hint: 'Screen', rank: 0 },
  { title: 'Xogħol', hint: 'Screen', rank: 0 },
  { title: 'Post ġdid', hint: 'Azzjoni', keywords: 'new post schedule', rank: 1 },
  { title: 'Festa San Ġużepp', hint: 'Avveniment · 19/3', rank: 2 },
  { title: 'Kalendarju', hint: 'Screen', rank: 0 },
];

test('Maltese letters fold to plain ones', () => {
  assert.equal(fold('Xogħol Ġużepp ċens żejt'), 'xoghol guzepp cens zejt');
});

test('plain typing finds Maltese titles', () => {
  assert.equal(search(items, 'xoghol')[0].title, 'Xogħol');
  assert.equal(search(items, 'guzepp')[0].title, 'Festa San Ġużepp');
});

test('every word has to match; keywords count', () => {
  assert.deepEqual(search(items, 'post gdid').map((i) => i.title), ['Post ġdid']);
  assert.deepEqual(search(items, 'new post').map((i) => i.title), ['Post ġdid']);
  assert.equal(score(items[0], 'zzz'), null);
});

test('a title that starts with the word beats one that only contains it', () => {
  const r = search([{ title: 'Ara l-kalendarju' }, { title: 'Kalendarju' }], 'kal');
  assert.equal(r[0].title, 'Kalendarju');
});

test('empty query keeps the order by rank, then as given', () => {
  assert.deepEqual(search(items, '', 3).map((i) => i.title), ['Skeda', 'Xogħol', 'Kalendarju']);
});
