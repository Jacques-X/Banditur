// A timer that rests while the window is hidden (minimised, another Space, tab in the background).
// `env` is for tests: { doc, setInterval, clearInterval }.

/** Run `fn` every `ms` while the page is visible. A tick that fell in a hidden stretch is made up with one run when it is visible again. → stop() */
export function everyVisible(fn, ms, env = {}) {
  const doc = env.doc ?? globalThis.document;
  const every = env.setInterval ?? globalThis.setInterval;
  const clear = env.clearInterval ?? globalThis.clearInterval;
  const visible = () => !doc || doc.visibilityState === 'visible';
  let missed = false;
  const timer = every(() => { if (visible()) fn(); else missed = true; }, ms);
  const onChange = () => { if (missed && visible()) { missed = false; fn(); } };
  doc?.addEventListener?.('visibilitychange', onChange);
  return () => { clear(timer); doc?.removeEventListener?.('visibilitychange', onChange); };
}
