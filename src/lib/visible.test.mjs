import { test } from 'node:test';
import assert from 'node:assert/strict';
import { everyVisible } from './visible.js';

function fakeEnv() {
  const listeners = new Set();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (_, h) => listeners.add(h),
    removeEventListener: (_, h) => listeners.delete(h),
  };
  let tick = null, cleared = false;
  return {
    doc, listeners,
    setInterval: (f) => { tick = f; return 1; },
    clearInterval: () => { cleared = true; },
    tick: () => tick(),
    get cleared() { return cleared; },
    show() { doc.visibilityState = 'visible'; [...listeners].forEach((h) => h()); },
    hide() { doc.visibilityState = 'hidden'; [...listeners].forEach((h) => h()); },
  };
}

test('runs on every tick while visible, skips while hidden, catches up once when shown', () => {
  const env = fakeEnv();
  let n = 0;
  everyVisible(() => n++, 1000, env);
  env.tick(); env.tick();
  assert.equal(n, 2);
  env.hide();
  env.tick(); env.tick(); env.tick();
  assert.equal(n, 2);
  env.show();
  assert.equal(n, 3); // one make-up run, not three
  env.show();
  assert.equal(n, 3); // nothing was missed since
});

test('no make-up run when no tick fell in the hidden stretch; stop clears timer and listener', () => {
  const env = fakeEnv();
  let n = 0;
  const stop = everyVisible(() => n++, 1000, env);
  env.hide(); env.show();
  assert.equal(n, 0);
  stop();
  assert.equal(env.cleared, true);
  assert.equal(env.listeners.size, 0);
});
