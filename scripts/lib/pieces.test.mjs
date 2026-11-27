import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, readFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, fingerprintAll, makePlan, describePlan, listFiles, treeHash } from './pieces.mjs';
import { installPiece, readInstalled, writeInstalled, prune, readSource, writeSource } from './components.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'bt-pieces-'));
  const put = (rel, text) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };
  put('src/main.js', 'a'); put('src/views/X.svelte', 'x'); put('src/views/x.test.mjs', 't1'); put('index.html', 'h');
  put('vite.config.js', 'v'); put('package-lock.json', 'l'); put('public/logo.svg', 's'); put('public/fonts/a.ttf', 'font');
  put('backend/api/_lib/malta-time.js', 'm'); put('backend/api/_lib/event-rules.js', 'p'); put('backend/api/_lib/task-rules.js', 't');
  put('backend/api/_lib/delivery.js', 'd');
  put('src-tauri/src/lib.rs', 'r'); put('src-tauri/Cargo.toml', 'c'); put('src-tauri/tauri.conf.json', '{}');
  put('src-tauri/binaries/transcribe-aarch64-apple-darwin', 'sh');
  put('sidecar/transcribe.py', 'py'); put('sidecar/requirements.txt', 'mlx'); put('transcribe-bundle.spec', 'spec');
  put('mlx-maltese-whisper-4bit/config.json', '{}'); put('mlx-maltese-whisper-4bit/weights.safetensors', 'w'.repeat(100));
  return { root, put };
}

test('a screen change moves only the interface (and, while it is built into the app, the core)', async () => {
  const { root, put } = project();
  const a = await fingerprintAll({ root, python: '3.13', uiLoader: false });
  put('src/views/X.svelte', 'x2');
  const b = await fingerprintAll({ root, python: '3.13', uiLoader: false });
  assert.notEqual(a.ui, b.ui);
  assert.notEqual(a.core, b.core);
  assert.equal(a.engine, b.engine);
  assert.equal(a.model, b.model);
  // With its own loader the core no longer cares about screens.
  const c = await fingerprintAll({ root, python: '3.13', uiLoader: true });
  put('src/views/X.svelte', 'x3');
  const d = await fingerprintAll({ root, python: '3.13', uiLoader: true });
  assert.notEqual(c.ui, d.ui);
  assert.equal(c.core, d.core);
  rmSync(root, { recursive: true });
});

test('tests, fonts and unrelated backend files do not change the interface', async () => {
  const { root, put } = project();
  const a = await fingerprint('ui', { root });
  put('src/views/x.test.mjs', 'changed'); put('public/fonts/a.ttf', 'newfont'); put('backend/api/_lib/delivery.js', 'd2');
  assert.equal(await fingerprint('ui', { root }), a);
  put('backend/api/_lib/task-rules.js', 't2');
  assert.notEqual(await fingerprint('ui', { root }), a);
  rmSync(root, { recursive: true });
});

test('Rust, fonts and the launcher script move the core; Python version and sidecar code move the engine', async () => {
  const { root, put } = project();
  const base = await fingerprintAll({ root, python: '3.13', uiLoader: true });
  put('public/fonts/a.ttf', 'newfont');
  assert.notEqual((await fingerprintAll({ root, python: '3.13', uiLoader: true })).core, base.core);
  put('public/fonts/a.ttf', 'font');
  put('src-tauri/binaries/transcribe-aarch64-apple-darwin', 'sh2');
  assert.notEqual((await fingerprintAll({ root, python: '3.13', uiLoader: true })).core, base.core);
  put('src-tauri/binaries/transcribe-aarch64-apple-darwin', 'sh');
  assert.equal((await fingerprintAll({ root, python: '3.13', uiLoader: true })).engine, base.engine);
  assert.notEqual((await fingerprintAll({ root, python: '3.14', uiLoader: true })).engine, base.engine);
  put('sidecar/transcribe.py', 'py2');
  assert.notEqual((await fingerprintAll({ root, python: '3.13', uiLoader: true })).engine, base.engine);
  rmSync(root, { recursive: true });
});

test('the model is fingerprinted by name and size, not content', async () => {
  const { root, put } = project();
  const a = await fingerprint('model', { root });
  put('mlx-maltese-whisper-4bit/weights.safetensors', 'x'.repeat(100)); // same size, other bytes
  assert.equal(await fingerprint('model', { root }), a);
  put('mlx-maltese-whisper-4bit/weights.safetensors', 'x'.repeat(101));
  assert.notEqual(await fingerprint('model', { root }), a);
  rmSync(root, { recursive: true });
});

test('listFiles skips junk and is stable', () => {
  const { root, put } = project();
  put('src/.DS_Store', 'x'); put('src/node_modules/p/i.js', 'x'); put('src/__pycache__/a.pyc', 'x');
  assert.deepEqual(listFiles(root, 'src'), ['src/main.js', 'src/views/X.svelte']);
  assert.deepEqual(listFiles(root, 'nope'), []);
  rmSync(root, { recursive: true });
});

const cur = { ui: 'u2', core: 'c2', engine: 'e1', model: 'm1' };
const cache = { ui: { fingerprint: 'u1' }, core: { fingerprint: 'c1' }, engine: { fingerprint: 'e1', version: 3 }, model: { fingerprint: 'm1', version: 1 } };
const have = { engineBuilt: true, modelPresent: true, engineInstalled: true, modelInstalled: true, appBuilt: true, appInstalled: true };

test('plan: a screen change rebuilds the core only; engine and model stay', () => {
  const p = makePlan({ current: cur, cache, installed: { engine: 3, model: 1 }, have, uiLoader: false });
  assert.deepEqual([p.core.build, p.core.install, p.engine.build, p.engine.install, p.model.install], [true, true, false, false, false]);
  assert.match(describePlan(p, { uiLoader: false }), /interface\s+rebuild \(inside the app core\)/);
  assert.match(describePlan(p, { uiLoader: false }), /engine\s+unchanged/);
});

test('plan: with its own loader a screen change installs the interface and leaves the core alone', () => {
  const p = makePlan({ current: { ...cur, core: 'c1' }, cache, installed: { engine: 3, model: 1 }, have, uiLoader: true });
  assert.deepEqual([p.ui.build, p.ui.install, p.core.build], [true, true, false]);
});

test('plan: first run builds and installs everything', () => {
  const p = makePlan({ current: cur, cache: {}, installed: {}, have: {}, uiLoader: false });
  assert.deepEqual([p.engine.build, p.engine.install, p.model.install, p.core.build], [true, true, true, true]);
});

test('plan: an engine that is built but missing from the components folder is only installed', () => {
  const p = makePlan({ current: { ...cur, core: 'c1', ui: 'u1' }, cache: { ...cache, core: { fingerprint: 'c1' }, ui: { fingerprint: 'u1' } },
    installed: { model: 1 }, have: { ...have, engineInstalled: false }, uiLoader: false });
  assert.deepEqual([p.engine.build, p.engine.install, p.core.build], [false, true, false]);
});

test('plan: --force redoes a piece', () => {
  const p = makePlan({ current: { ui: 'u1', core: 'c1', engine: 'e1', model: 'm1' }, cache, installed: { engine: 3, model: 1 }, have, force: ['engine'], uiLoader: false });
  assert.deepEqual([p.engine.build, p.engine.install, p.core.build], [true, true, false]);
});

test('installPiece: copies, verifies, switches, records last, keeps the previous version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bt-comp-'));
  const src = mkdtempSync(join(tmpdir(), 'bt-src-'));
  writeFileSync(join(src, 'transcribe-bundle'), '#!/bin/sh\n'); chmodSync(join(src, 'transcribe-bundle'), 0o755);
  mkdirSync(join(src, '_internal')); writeFileSync(join(src, '_internal', 'a.bin'), 'bin');
  symlinkSync('a.bin', join(src, '_internal', 'link'));

  await installPiece({ dir, kind: 'engine', version: 3, srcDir: src });
  assert.deepEqual(readInstalled(dir), { engine: 3 });
  assert.ok(existsSync(join(dir, 'engine', '3', '_internal', 'a.bin')));
  assert.ok(statSync(join(dir, 'engine', '3', 'transcribe-bundle')).mode & 0o111, 'keeps the executable bit');
  assert.equal(await treeHash(join(dir, 'engine', '3')), await treeHash(src));

  writeFileSync(join(src, '_internal', 'a.bin'), 'bin2');
  await installPiece({ dir, kind: 'engine', version: 4, srcDir: src });
  await installPiece({ dir, kind: 'model', version: 1, srcDir: src });
  assert.deepEqual(readInstalled(dir), { engine: 4, model: 1 });
  assert.ok(existsSync(join(dir, 'engine', '3')) && existsSync(join(dir, 'engine', '4')), 'previous kept');
  await installPiece({ dir, kind: 'engine', version: 5, srcDir: src });
  assert.ok(!existsSync(join(dir, 'engine', '3')), 'older removed');
  assert.ok(existsSync(join(dir, 'engine', '4')) && existsSync(join(dir, 'engine', '5')));
  assert.ok(!existsSync(join(dir, 'engine', '5.partial')));
  rmSync(dir, { recursive: true }); rmSync(src, { recursive: true });
});

test('installPiece: a missing source changes nothing; unreadable installed.json reads as empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bt-comp-'));
  writeInstalled(dir, { engine: 2 });
  await assert.rejects(installPiece({ dir, kind: 'engine', version: 3, srcDir: join(dir, 'nope') }), /nothing to install/);
  assert.deepEqual(readInstalled(dir), { engine: 2 });
  writeFileSync(join(dir, 'installed.json'), '{oops');
  assert.deepEqual(readInstalled(dir), {});
  writeFileSync(join(dir, 'installed.json'), JSON.stringify({ engine: 'x', model: -1, ui: '1.2.0' }));
  assert.deepEqual(readInstalled(dir), { ui: '1.2.0' });
  assert.deepEqual(prune(join(dir, 'none'), 1, 0), []);
  rmSync(dir, { recursive: true });
});

test('source.json: written atomically, read leniently', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'bt-src-')), 'components');
  assert.equal(readSource(dir), null);
  writeSource(dir, '/Users/x/Banditur', new Date('2026-11-24T10:00:00Z'));
  assert.deepEqual(readSource(dir), { root: '/Users/x/Banditur', recordedAt: '2026-11-24T10:00:00.000Z' });
  assert.ok(!existsSync(join(dir, 'source.json.tmp')));
  writeFileSync(join(dir, 'source.json'), '{ nope');
  assert.equal(readSource(dir), null);
  writeFileSync(join(dir, 'source.json'), JSON.stringify({ root: 'relative/path' }));
  assert.equal(readSource(dir), null);
  writeFileSync(join(dir, 'source.json'), JSON.stringify({ root: '/ok' }));
  assert.deepEqual(readSource(dir), { root: '/ok', recordedAt: null });
  rmSync(dir, { recursive: true });
});

test('plan: cleaned build output does not force a rebuild of an unchanged, installed engine or app', () => {
  const same = { ui: 'u1', core: 'c1', engine: 'e1', model: 'm1' };
  const c = { ...cache, ui: { fingerprint: 'u1' }, core: { fingerprint: 'c1' } };
  const cleaned = { ...have, engineBuilt: false, appBuilt: false };
  const p = makePlan({ current: same, cache: c, installed: { engine: 3, model: 1 }, have: cleaned, uiLoader: true });
  assert.deepEqual([p.engine.build, p.engine.install, p.core.build, p.core.install], [false, false, false, false]);
  // A real change still rebuilds; nothing installed and nothing built still builds.
  const changed = makePlan({ current: { ...same, engine: 'e2', core: 'c2' }, cache: c, installed: { engine: 3, model: 1 }, have: cleaned, uiLoader: true });
  assert.deepEqual([changed.engine.build, changed.core.build], [true, true]);
  const bare = makePlan({ current: same, cache: c, installed: { model: 1 }, have: { ...cleaned, engineInstalled: false, appInstalled: false }, uiLoader: true });
  assert.deepEqual([bare.engine.build, bare.core.build], [true, true]);
});
