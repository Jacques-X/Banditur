import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLEAN_PATHS, depsToInstall, lockState, makeResult, tailLines, toolPath } from './update.mjs';
import { runUpdate } from '../update.mjs';

test('depsToInstall: install on change, only record on the first run, install when nothing is installed', () => {
  const have = { nodeModules: true, venv: true };
  assert.deepEqual(depsToInstall({ saved: {}, current: { lock: 'a', req: 'b' }, have }), { npm: false, pip: false });
  assert.deepEqual(depsToInstall({ saved: { lock: 'a', req: 'b' }, current: { lock: 'a', req: 'b' }, have }), { npm: false, pip: false });
  assert.deepEqual(depsToInstall({ saved: { lock: 'a', req: 'b' }, current: { lock: 'A', req: 'b' }, have }), { npm: true, pip: false });
  assert.deepEqual(depsToInstall({ saved: { lock: 'a', req: 'b' }, current: { lock: 'a', req: 'B' }, have }), { npm: false, pip: true });
  assert.deepEqual(depsToInstall({ saved: {}, current: { lock: 'a', req: 'b' }, have: {} }), { npm: true, pip: true });
  assert.deepEqual(depsToInstall({ saved: {}, current: { lock: null, req: null }, have: {} }), { npm: false, pip: false });
});

test('lockState: free, busy, stale', () => {
  const alive = (pid) => pid === 42;
  assert.equal(lockState(null, alive), 'free');
  assert.equal(lockState('42\n', alive), 'busy');
  assert.equal(lockState('43', alive), 'stale');
  assert.equal(lockState('junk', alive), 'stale');
  assert.equal(lockState('', alive), 'stale');
});

test('makeResult: failure carries the error and the last 40 log lines', () => {
  const log = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n') + '\n\n';
  assert.deepEqual(makeResult({ ok: true, at: 't', head: 'abc1234' }), { ok: true, at: 't', head: 'abc1234' });
  const bad = makeResult({ ok: false, at: 't', head: null, error: 'boom', log });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'boom');
  assert.equal(bad.logTail.split('\n').length, 40);
  assert.ok(bad.logTail.endsWith('line 59'));
  assert.equal(tailLines('a\n\nb\n', 5), 'a\nb');
});

test('toolPath prepends the tool folders once', () => {
  assert.equal(toolPath('/usr/bin:/bin', '/Users/x'), '/opt/homebrew/bin:/usr/local/bin:/Users/x/.cargo/bin:/usr/bin:/bin');
  assert.equal(toolPath('/usr/local/bin:/bin', ''), '/opt/homebrew/bin:/usr/local/bin:/bin');
});

function setup(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bt-up-'));
  writeFileSync(join(root, 'package-lock.json'), 'lock1');
  mkdirSync(join(root, 'sidecar'), { recursive: true });
  writeFileSync(join(root, 'sidecar', 'requirements.txt'), 'req1');
  mkdirSync(join(root, 'node_modules'));
  mkdirSync(join(root, 'venv', 'bin'), { recursive: true });
  writeFileSync(join(root, 'venv', 'bin', 'pip'), '');
  const calls = [];
  const steps = {
    isAlive: () => false,
    npmInstall: () => calls.push('npm'),
    pipInstall: () => calls.push('pip'),
    build: (noApp) => calls.push(noApp ? 'build --no-app' : 'build'),
    head: () => 'abc1234',
    open: (p) => calls.push(`open ${p}`),
    clean: () => false,
    ...extra,
  };
  const lines = [];
  return { root, calls, steps, lines, opts: { root, steps, log: (m) => lines.push(m), now: () => new Date('2026-11-24T10:00:00Z') } };
}
const readResult = (root) => JSON.parse(readFileSync(join(root, '.build-cache', 'update-result.json'), 'utf8'));

test('runUpdate: records deps on the first run, builds, writes the result, reopens, frees the lock', async () => {
  const t = setup();
  const r = await runUpdate({ ...t.opts, relaunch: '/Applications/Banditur.app' });
  assert.equal(r.code, 0);
  assert.deepEqual(t.calls, ['build', 'open /Applications/Banditur.app']);
  assert.deepEqual(readResult(t.root), { ok: true, at: '2026-11-24T10:00:00.000Z', head: 'abc1234' });
  assert.ok(!existsSync(join(t.root, '.build-cache', 'update.lock')));
  assert.ok(existsSync(join(t.root, '.build-cache', 'deps.json')));

  // The lock file changes: the next update installs, then records.
  writeFileSync(join(t.root, 'package-lock.json'), 'lock2');
  t.calls.length = 0;
  await runUpdate({ ...t.opts, noApp: true });
  assert.deepEqual(t.calls, ['npm', 'build --no-app']);
  t.calls.length = 0;
  await runUpdate({ ...t.opts });
  assert.deepEqual(t.calls, ['build']);
  rmSync(t.root, { recursive: true });
});

test('runUpdate: a failed build is reported and the app is still reopened', async () => {
  const t = setup({ build: () => { throw new Error('tauri build failed'); } });
  const r = await runUpdate({ ...t.opts, relaunch: '/A.app', readLog: () => 'x\ny' });
  assert.equal(r.code, 1);
  const res = readResult(t.root);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'tauri build failed');
  assert.equal(res.logTail, 'x\ny');
  assert.deepEqual(t.calls, ['open /A.app']);
  assert.ok(!existsSync(join(t.root, '.build-cache', 'update.lock')));
  rmSync(t.root, { recursive: true });
});

test('runUpdate: a live lock stops it without touching anything; a stale lock is taken over', async () => {
  const t = setup({ isAlive: (pid) => pid === 4242 });
  mkdirSync(join(t.root, '.build-cache'), { recursive: true });
  writeFileSync(join(t.root, '.build-cache', 'update.lock'), '4242');
  let started = false;
  const r = await runUpdate({ ...t.opts, startLog: () => { started = true; } });
  assert.equal(r.code, 2);
  assert.equal(started, false);
  assert.deepEqual(t.calls, []);
  assert.equal(readFileSync(join(t.root, '.build-cache', 'update.lock'), 'utf8'), '4242');

  writeFileSync(join(t.root, '.build-cache', 'update.lock'), '777');
  const r2 = await runUpdate({ ...t.opts });
  assert.equal(r2.code, 0);
  assert.deepEqual(t.calls, ['build']);
  rmSync(t.root, { recursive: true });
});

test('runUpdate: waits for the app to quit, and gives up after the limit', async () => {
  let polls = 0;
  const t = setup({ isAlive: (pid) => pid === 99 && ++polls < 3 });
  const r = await runUpdate({ ...t.opts, waitPid: 99, pollMs: 1 });
  assert.equal(r.code, 0);
  assert.ok(polls >= 3);

  const t2 = setup({ isAlive: () => true });
  let tick = 0;
  const r2 = await runUpdate({ ...t2.opts, waitPid: 99, pollMs: 1, waitMs: 5, clock: () => tick++ * 3, relaunch: '/A.app' });
  assert.equal(r2.code, 1);
  assert.match(readResult(t2.root).error, /did not quit/);
  assert.deepEqual(t2.calls, ['open /A.app']);
  rmSync(t.root, { recursive: true }); rmSync(t2.root, { recursive: true });
});

test('runUpdate: cleans build output only after a successful build, and a cleaning error is not a failure', async () => {
  const cleaned = [];
  const t = setup({ clean: (rel) => { cleaned.push(rel); if (rel === 'build') throw new Error('busy'); return true; } });
  const r = await runUpdate({ ...t.opts });
  assert.equal(r.code, 0);
  assert.deepEqual(cleaned, CLEAN_PATHS);
  assert.ok(t.lines.some((l) => /Could not remove build/.test(l)));
  assert.ok(!CLEAN_PATHS.includes('dist') && !CLEAN_PATHS.includes('src-tauri/target/release'), 'keeps what build:local needs');
  rmSync(t.root, { recursive: true });

  const failed = [];
  const t2 = setup({ build: () => { throw new Error('no'); }, clean: (rel) => { failed.push(rel); return true; } });
  assert.equal((await runUpdate({ ...t2.opts })).code, 1);
  assert.deepEqual(failed, []);
  rmSync(t2.root, { recursive: true });
});
