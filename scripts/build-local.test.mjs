import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild, loadCache, summarizePlan } from './build-local.mjs';
import { readInstalled, readSource } from './lib/components.mjs';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'bt-bl-'));
  const dir = join(mkdtempSync(join(tmpdir(), 'bt-bl-c-')), 'components');
  const put = (rel, text) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };
  put('src/main.js', 'a'); put('index.html', 'h'); put('vite.config.js', 'v'); put('package-lock.json', 'l');
  put('backend/api/_lib/malta-time.js', 'm'); put('backend/api/_lib/event-rules.js', 'p'); put('backend/api/_lib/task-rules.js', 't');
  put('src-tauri/src/lib.rs', 'r'); put('src-tauri/src/components.rs', 'pub(crate) const CORE_API: u32 = 1;'); put('src-tauri/Cargo.toml', 'c'); put('src-tauri/tauri.conf.json', '{}');
  put('sidecar/transcribe.py', 'py'); put('transcribe-bundle.spec', 'spec');
  put('mlx-maltese-whisper-4bit/config.json', '{}'); put('mlx-maltese-whisper-4bit/weights.safetensors', 'w');
  const appPath = join(mkdtempSync(join(tmpdir(), 'bt-bl-a-')), 'Banditur.app');
  const calls = [];
  const steps = {
    buildUi: () => { calls.push('ui'); mkdirSync(join(root, 'dist/assets'), { recursive: true }); writeFileSync(join(root, 'dist/index.html'), '<script type="module" src="/assets/a.js"></script>'); writeFileSync(join(root, 'dist/assets/a.js'), 'x'); },
    buildEngine: () => { calls.push('engine'); mkdirSync(join(root, 'sidecar-dist/transcribe-bundle'), { recursive: true }); writeFileSync(join(root, 'sidecar-dist/transcribe-bundle/transcribe-bundle'), 'bin'); },
    buildCore: () => { calls.push('core'); mkdirSync(join(root, 'src-tauri/target/release/bundle/macos/Banditur.app'), { recursive: true }); writeFileSync(join(root, 'src-tauri/target/release/bundle/macos/Banditur.app/x'), 'app'); },
    isAppRunning: () => false,
    installApp: (src, dest) => { calls.push('installApp'); mkdirSync(dest, { recursive: true }); writeFileSync(join(dest, 'x'), readFileSync(join(src, 'x'))); },
  };
  const out = [];
  const opts = { root, dir, appPath, steps, python: '3.13', log: (m) => out.push(m) };
  return { root, dir, appPath, calls, steps, out, opts, put };
}

test('first run builds and installs everything; the second run does nothing', async () => {
  const t = setup();
  await runBuild(t.opts);
  assert.deepEqual(t.calls, ['engine', 'ui', 'core', 'installApp']);
  assert.deepEqual(readInstalled(t.dir), { engine: 1, model: 1, ui: '1' });
  assert.deepEqual(JSON.parse(readFileSync(join(t.dir, 'ui/1/ui.json'), 'utf8')), { version: '1', needsCoreApi: 1 });
  assert.ok(existsSync(join(t.dir, 'engine/1/transcribe-bundle')));
  assert.ok(existsSync(join(t.dir, 'model/1/weights.safetensors')));
  assert.ok(existsSync(join(t.appPath, 'x')));
  assert.equal(loadCache(t.root).engine.version, 1);

  t.calls.length = 0; t.out.length = 0;
  const again = await runBuild(t.opts);
  assert.deepEqual(t.calls, []);
  assert.deepEqual(again.done, []);
  assert.match(t.out.join('\n'), /Nothing to do/);
  rmSync(t.root, { recursive: true });
});

test('a screen change builds and installs only the interface: no new app, engine or model', async () => {
  const t = setup();
  await runBuild(t.opts);
  t.calls.length = 0;
  t.put('src/main.js', 'changed');
  const r = await runBuild(t.opts);
  assert.deepEqual(t.calls, ['ui']);
  assert.equal(r.plan.engine.build, false);
  assert.equal(r.plan.core.build, false);
  assert.deepEqual(readInstalled(t.dir), { engine: 1, model: 1, ui: '2' });
  assert.ok(existsSync(join(t.dir, 'ui/1')) && existsSync(join(t.dir, 'ui/2')), 'previous interface kept');
  rmSync(t.root, { recursive: true });
});

test('a Rust change rebuilds the app but not the installed interface', async () => {
  const t = setup();
  await runBuild(t.opts);
  t.calls.length = 0;
  t.put('src-tauri/src/lib.rs', 'r2');
  await runBuild(t.opts);
  assert.deepEqual(t.calls, ['core', 'installApp']);
  assert.equal(readInstalled(t.dir).ui, '1');
  rmSync(t.root, { recursive: true });
});

test('an interface with an inline script is refused and nothing is installed', async () => {
  const t = setup();
  const steps = { ...t.steps, buildUi: () => { mkdirSync(join(t.root, 'dist'), { recursive: true }); writeFileSync(join(t.root, 'dist/index.html'), '<script>alert(1)</script>'); } };
  await assert.rejects(runBuild({ ...t.opts, steps }), /inline <script>/);
  assert.equal(readInstalled(t.dir).ui, undefined);
  rmSync(t.root, { recursive: true });
});

test('a sidecar change builds a new engine version and keeps the previous one; the app is untouched', async () => {
  const t = setup();
  await runBuild(t.opts);
  t.calls.length = 0;
  t.put('sidecar/transcribe.py', 'py2');
  await runBuild(t.opts);
  assert.deepEqual(t.calls, ['engine']);
  assert.deepEqual(readInstalled(t.dir), { engine: 2, model: 1, ui: '1' });
  assert.ok(existsSync(join(t.dir, 'engine/1')) && existsSync(join(t.dir, 'engine/2')));
  rmSync(t.root, { recursive: true });
});

test('--dry-run changes nothing; an unchanged project with --force redoes just that piece', async () => {
  const t = setup();
  const d = await runBuild({ ...t.opts, dryRun: true });
  assert.deepEqual(t.calls, []);
  assert.equal(readInstalled(t.dir).engine, undefined);
  assert.equal(d.plan.engine.build, true);
  await runBuild(t.opts);
  t.calls.length = 0;
  await runBuild({ ...t.opts, force: ['engine'] });
  assert.deepEqual(t.calls, ['engine']);
  assert.equal(readInstalled(t.dir).engine, 2);
  rmSync(t.root, { recursive: true });
});

test('a running app is never replaced, and nothing is built first', async () => {
  const t = setup();
  await assert.rejects(runBuild({ ...t.opts, steps: { ...t.steps, isAppRunning: () => true } }), /Banditur is running/);
  assert.deepEqual(t.calls, []);
  rmSync(t.root, { recursive: true });
});

test('declining the question builds nothing; --no-app builds the core but leaves the installed app', async () => {
  const t = setup();
  const r = await runBuild({ ...t.opts, confirm: async () => false });
  assert.deepEqual([t.calls, r.done], [[], []]);
  await runBuild({ ...t.opts, installApp: false });
  assert.deepEqual(t.calls, ['engine', 'ui', 'core']);
  assert.ok(!existsSync(t.appPath));
  rmSync(t.root, { recursive: true });
});

test('a missing model stops the run before anything is built', async () => {
  const t = setup();
  rmSync(join(t.root, 'mlx-maltese-whisper-4bit/weights.safetensors'));
  await assert.rejects(runBuild(t.opts), /model is missing/);
  assert.deepEqual(t.calls, []);
  rmSync(t.root, { recursive: true });
});

test('every real run records the clone in source.json; a dry run does not', async () => {
  const t = setup();
  await runBuild({ ...t.opts, dryRun: true });
  assert.equal(readSource(t.dir), null);
  await runBuild(t.opts);
  assert.equal(readSource(t.dir).root, t.root);
  rmSync(join(t.dir, 'source.json'));
  await runBuild(t.opts); // nothing to do, still recorded
  assert.equal(readSource(t.dir).root, t.root);
  rmSync(t.root, { recursive: true });
});

test('summarizePlan: the --json line says which pieces have work', async () => {
  const t = setup();
  const first = await runBuild({ ...t.opts, dryRun: true });
  assert.deepEqual(summarizePlan(first.plan), { work: true, core: true, ui: true, engine: true, model: true });
  await runBuild(t.opts);
  t.put('src/main.js', 'changed');
  const screen = await runBuild({ ...t.opts, dryRun: true });
  assert.deepEqual(summarizePlan(screen.plan), { work: true, core: false, ui: true, engine: false, model: false });
  await runBuild(t.opts);
  const none = await runBuild({ ...t.opts, dryRun: true });
  assert.deepEqual(summarizePlan(none.plan), { work: false, core: false, ui: false, engine: false, model: false });
  rmSync(t.root, { recursive: true });
});

function fakePython(t, info = { action: 'recreate', reason: 'Python 3.15.0 unsupported', python: { path: '/opt/homebrew/bin/python3.13', version: '3.13.2' } }) {
  const calls = [];
  const fake = {
    inspect: () => ({ exists: true, version: '3.15.0', missing: [] }),
    exists: () => false, rename: () => calls.push('rename'), remove: () => calls.push('remove'),
    findPython: () => info.python ?? null, brewPath: () => null,
    createVenv: () => calls.push('create'), pip: () => calls.push('pip'), brewInstall: () => calls.push('brew'),
    verify: () => ({ version: '3.13.2', missing: [] }),
  };
  t.steps.python = fake;
  t.steps.buildEngine = () => { calls.push('engine'); mkdirSync(join(t.root, 'sidecar-dist/transcribe-bundle'), { recursive: true }); writeFileSync(join(t.root, 'sidecar-dist/transcribe-bundle/transcribe-bundle'), 'bin'); };
  return calls;
}

test('the plan shows the Python environment when the engine is built, and the venv is prepared before the engine', async () => {
  const t = setup();
  const calls = fakePython(t);
  await runBuild({ ...t.opts, force: ['engine'] });
  assert.match(t.out.join('\n'), /Python environment: recreate \(Python 3\.15\.0 unsupported\)/);
  assert.ok(calls.indexOf('create') >= 0 && calls.indexOf('create') < calls.indexOf('engine'));
  rmSync(t.root, { recursive: true });
});

test('--dry-run shows the Python plan but creates and deletes nothing; no engine build, no Python line', async () => {
  const t = setup();
  const calls = fakePython(t);
  await runBuild({ ...t.opts, dryRun: true });
  assert.match(t.out.join('\n'), /Python environment: recreate/);
  assert.deepEqual(calls, []);

  const t2 = setup();
  await runBuild(t2.opts);
  const calls2 = fakePython(t2);
  t2.out.length = 0;
  t2.put('src/main.js', 'changed'); // interface only
  await runBuild(t2.opts);
  assert.doesNotMatch(t2.out.join('\n'), /Python environment/);
  assert.deepEqual(calls2, []);
  rmSync(t.root, { recursive: true }); rmSync(t2.root, { recursive: true });
});

test('a Python environment that cannot be fixed stops the run before the engine is built', async () => {
  const t = setup();
  const calls = fakePython(t, { action: 'recreate', python: null });
  await assert.rejects(runBuild({ ...t.opts, force: ['engine'] }), /No Python 3\.10.3\.13 found/);
  assert.ok(!calls.includes('engine'));
  rmSync(t.root, { recursive: true });
});
