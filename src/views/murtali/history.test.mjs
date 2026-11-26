import test from 'node:test';
import assert from 'node:assert/strict';
import { History } from './history.js';

test('commit / undo / redo', () => {
  const h = new History({ n: 0 });
  h.commit({ n: 1 }); h.commit({ n: 2 });
  assert.equal(h.present.n, 2);
  assert.equal(h.undo().n, 1);
  assert.equal(h.undo().n, 0);
  assert.equal(h.undo(), null);
  assert.equal(h.redo().n, 1);
  h.commit({ n: 9 });
  assert.equal(h.canRedo, false, 'a new edit clears redo');
});

test('committing the same document is not a step', () => {
  const d = { n: 0 };
  const h = new History(d);
  h.commit(d);
  assert.equal(h.canUndo, false);
});

test('a drag is one step', () => {
  const h = new History({ n: 0 });
  h.begin();
  for (let i = 1; i <= 50; i++) h.live({ n: i });
  h.end();
  assert.equal(h.present.n, 50);
  assert.equal(h.past.length, 1);
  assert.equal(h.undo().n, 0);
});

test('an unchanged drag adds no step; cancel restores', () => {
  const d = { n: 0 };
  const h = new History(d);
  h.begin(); h.end();
  assert.equal(h.canUndo, false);
  h.begin(); h.live({ n: 5 });
  assert.equal(h.cancel(), d);
  assert.equal(h.canUndo, false);
});

test('history is capped', () => {
  const h = new History({ n: 0 }, 5);
  for (let i = 1; i <= 20; i++) h.commit({ n: i });
  assert.equal(h.past.length, 5);
  assert.equal(h.past[0].n, 15);
});

test('reset drops history', () => {
  const h = new History({ n: 0 });
  h.commit({ n: 1 });
  h.reset({ n: 7 });
  assert.equal(h.canUndo, false);
  assert.equal(h.present.n, 7);
});
