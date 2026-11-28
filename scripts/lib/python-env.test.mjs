import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parsePythonVersion, isSupported, minorOf, candidatePaths, pickPython, requiredImports, planEnv, describeEnv,
  explainPipFailure, noPythonMessage, planPythonEnv, ensurePythonEnv, BUILD_TOOLS,
} from './python-env.mjs';
import { depsToInstall } from './update.mjs';

test('parsePythonVersion and isSupported: 3.10 to 3.13 only', () => {
  assert.deepEqual(parsePythonVersion('Python 3.13.5\n'), { major: 3, minor: 13, patch: 5, text: '3.13.5' });
  assert.equal(parsePythonVersion('3.15.0a1').minor, 15);
  assert.equal(parsePythonVersion('3.12').patch, 0);
  assert.equal(parsePythonVersion('nonsense'), null);
  assert.equal(parsePythonVersion(null), null);
  for (const v of ['3.10.0', '3.11.9', '3.12.1', '3.13.5', '3.13']) assert.equal(isSupported(v), true, v);
  for (const v of ['3.9.18', '3.14.0', '3.15.0', '2.7.18', '4.0.0', '', 'x']) assert.equal(isSupported(v), false, v);
  assert.equal(minorOf('3.13.5'), '3.13');
  assert.equal(minorOf(null), null);
});

test('candidatePaths: versioned names newest first in Homebrew folders, then PATH, then plain python3', () => {
  const list = candidatePaths({ brewPrefix: '/opt/homebrew', pathDirs: ['/usr/bin', '/opt/homebrew/bin'] });
  assert.equal(list[0], '/opt/homebrew/bin/python3.13');
  assert.equal(list[1], '/usr/local/bin/python3.13');
  assert.ok(list.indexOf('/opt/homebrew/bin/python3.10') < list.indexOf('/usr/bin/python3.13'), 'Homebrew before PATH');
  assert.ok(list.indexOf('/usr/bin/python3.10') < list.indexOf('/opt/homebrew/bin/python3'), 'versioned before plain');
  assert.equal(new Set(list).size, list.length, 'no duplicates');
  assert.ok(list.every((p) => p.startsWith('/')));
  const custom = candidatePaths({ brewPrefix: '/custom/brew', pathDirs: [] });
  assert.ok(custom.includes('/custom/brew/bin/python3.12'));
  assert.equal(custom.at(-1), '/custom/brew/bin/python3');
});

test('pickPython: first supported candidate; a 3.15 python3 is never chosen', () => {
  const versions = { '/a/python3.13': null, '/b/python3.12': '3.12.4', '/c/python3.11': '3.11.1', '/d/python3': '3.15.0' };
  const seen = [];
  const got = pickPython(Object.keys(versions), (p) => { seen.push(p); return versions[p]; });
  assert.deepEqual(got, { path: '/b/python3.12', version: '3.12.4' });
  assert.deepEqual(seen, ['/a/python3.13', '/b/python3.12'], 'stops at the first match');
  assert.equal(pickPython(['/d/python3'], (p) => versions[p]), null);
  assert.equal(pickPython([], () => '3.13.0'), null);
});

test('requiredImports: from requirements.txt, no comments or git lines, plus PyInstaller', () => {
  const text = '# c\nmlx-whisper>=0.4.0\nimageio-ffmpeg>=0.6.0\nnumpy>=1.24,<2.6\n\nonnxruntime>=1.18  # x\ngit+https://github.com/x/y.git@abc\n-r other.txt\n';
  assert.deepEqual(requiredImports(text), ['mlx_whisper', 'imageio_ffmpeg', 'numpy', 'onnxruntime', 'PyInstaller']);
  assert.deepEqual(requiredImports(''), ['PyInstaller']);
});

test('planEnv: ok venv does nothing; missing, broken and unsupported ones are rebuilt; missing packages are installed', () => {
  const ok = { exists: true, version: '3.13.2', missing: [] };
  assert.equal(planEnv({ info: ok }).action, 'none');
  assert.deepEqual(planEnv({ info: { exists: false } }), { action: 'create', reason: 'no venv' });
  assert.equal(planEnv({ info: { exists: true, version: null, missing: [] } }).action, 'recreate');
  assert.deepEqual(planEnv({ info: { ...ok, version: '3.15.0' } }), { action: 'recreate', reason: 'Python 3.15.0 unsupported' });
  assert.equal(planEnv({ info: { ...ok, version: '3.9.1' } }).action, 'recreate');
  assert.deepEqual(planEnv({ info: { ...ok, missing: ['onnxruntime'] } }), { action: 'install', reason: 'missing onnxruntime' });
  assert.equal(planEnv({ info: ok, reinstall: true }).action, 'install');
  // an unsupported Python is rebuilt even when the update would only reinstall
  assert.equal(planEnv({ info: { ...ok, version: '3.15.0' }, reinstall: true }).action, 'recreate');
});

test('describeEnv and messages are plain', () => {
  assert.equal(describeEnv({ action: 'recreate', reason: 'Python 3.15.0 unsupported', python: { path: '/opt/homebrew/bin/python3.13', version: '3.13.2' } }),
    'Python environment: recreate (Python 3.15.0 unsupported)  → uses /opt/homebrew/bin/python3.13 (3.13.2)');
  assert.match(describeEnv({ action: 'create', reason: 'no venv', brew: true }), /installs python@3\.13 with Homebrew/);
  assert.match(describeEnv({ action: 'none', reason: 'Python 3.13.2' }), /^Python environment: ok \(Python 3\.13\.2\)$/);
  assert.match(noPythonMessage(false), /No Python 3\.10–3\.13 found\. Install one: brew install python@3\.13/);
  assert.match(explainPipFailure('ERROR: No matching distribution found for onnxruntime>=1.18', '3.15.0'), /^pip could not install onnxruntime for Python 3\.15\.0/);
  assert.match(explainPipFailure('boom', null), /pip install failed/);
});

test('depsToInstall: a different Python (major.minor) means pip; a patch release does not', () => {
  const have = { nodeModules: true, venv: true };
  const base = { lock: 'a', req: 'b' };
  assert.deepEqual(depsToInstall({ saved: { ...base, python: '3.13.1' }, current: { ...base, python: '3.13.2' }, have }), { npm: false, pip: false });
  assert.deepEqual(depsToInstall({ saved: { ...base, python: '3.13.1' }, current: { ...base, python: '3.12.4' }, have }), { npm: false, pip: true });
  assert.deepEqual(depsToInstall({ saved: base, current: { ...base, python: '3.12.4' }, have }), { npm: false, pip: false }, 'first record only');
  assert.deepEqual(depsToInstall({ saved: { ...base, python: '3.13.1' }, current: { ...base, python: null }, have }), { npm: false, pip: false });
});

// ── ensurePythonEnv with fake steps over a real temporary folder ────────────

function world({ venv = null, found = { path: '/opt/homebrew/bin/python3.13', version: '3.13.2' }, brew = null, afterBrew = null, pipFails = null, verifyMissing = [], createFails = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bt-py-'));
  if (venv) { mkdirSync(join(root, 'venv'), { recursive: true }); writeFileSync(join(root, 'venv', 'marker'), venv.marker || 'old'); }
  const calls = [];
  let current = found;
  let created = null;
  const steps = {
    exists: (p) => existsSync(p),
    rename: (a, b) => { calls.push('rename'); renameSync(a, b); },
    remove: (p) => { calls.push('remove'); rmSync(p, { recursive: true, force: true }); },
    inspect: () => (venv ? { exists: true, version: venv.version, missing: venv.missing || [] } : { exists: false, version: null, missing: [] }),
    findPython: () => { calls.push('find'); return current; },
    brewPath: () => brew,
    brewInstall: () => { calls.push('brew install'); current = afterBrew; },
    createVenv: (py) => {
      calls.push(`create ${py}`);
      if (createFails) throw new Error('venv failed');
      mkdirSync(join(root, 'venv'), { recursive: true }); writeFileSync(join(root, 'venv', 'marker'), 'new'); created = py;
    },
    pip: (args) => {
      calls.push(`pip ${args.join(' ')}`);
      if (pipFails && args.includes('-r')) throw new Error(pipFails);
    },
    verify: () => ({ version: created ? current.version : venv?.version, missing: verifyMissing }),
  };
  const lines = [];
  return { root, calls, steps, lines, log: (m) => lines.push(m), marker: () => (existsSync(join(root, 'venv', 'marker')) ? readFileSync(join(root, 'venv', 'marker'), 'utf8') : null) };
}
const done = (w) => rmSync(w.root, { recursive: true, force: true });

test('ensure: a good venv is left alone', async () => {
  const w = world({ venv: { version: '3.13.2' } });
  const r = await ensurePythonEnv({ steps: w.steps, root: w.root, log: w.log });
  assert.deepEqual([r.action, r.version], ['none', '3.13.2']);
  assert.deepEqual(w.calls, []);
  assert.equal(w.marker(), 'old');
  done(w);
});

test('ensure: a missing venv is created with the best Python and pyinstaller is installed with the requirements', async () => {
  const w = world();
  const r = await ensurePythonEnv({ steps: w.steps, root: w.root, log: w.log });
  assert.deepEqual([r.action, r.version], ['create', '3.13.2']);
  assert.ok(w.calls.includes('create /opt/homebrew/bin/python3.13'));
  assert.ok(w.calls.includes(`pip install -r sidecar/requirements.txt ${BUILD_TOOLS.join(' ')}`));
  assert.equal(w.marker(), 'new');
  assert.ok(!existsSync(join(w.root, 'venv.old')) && !existsSync(join(w.root, 'venv.new')));
  done(w);
});

test('ensure: an unsupported venv is replaced, and venv.old is gone afterwards', async () => {
  const w = world({ venv: { version: '3.15.0' } });
  const r = await ensurePythonEnv({ steps: w.steps, root: w.root, log: w.log });
  assert.equal(r.action, 'recreate');
  assert.equal(w.marker(), 'new');
  assert.ok(!existsSync(join(w.root, 'venv.old')));
  assert.ok(w.lines.some((l) => /recreate \(Python 3\.15\.0 unsupported\)/.test(l)));
  done(w);
});

test('ensure: a failed pip keeps the old venv and leaves no temporary folder', async () => {
  const w = world({ venv: { version: '3.15.0' }, pipFails: 'pip could not install onnxruntime for Python 3.13.2' });
  await assert.rejects(ensurePythonEnv({ steps: w.steps, root: w.root, log: w.log }), /pip could not install onnxruntime/);
  assert.equal(w.marker(), 'old', 'the previous venv is back');
  assert.ok(!existsSync(join(w.root, 'venv.old')) && !existsSync(join(w.root, 'venv.new')));
  done(w);

  const w2 = world({ pipFails: 'nope' }); // no old venv: nothing is left behind
  await assert.rejects(ensurePythonEnv({ steps: w2.steps, root: w2.root, log: w2.log }), /nope/);
  assert.ok(!existsSync(join(w2.root, 'venv')));
  done(w2);

  const w3 = world({ venv: { version: '3.15.0' }, createFails: true });
  await assert.rejects(ensurePythonEnv({ steps: w3.steps, root: w3.root, log: w3.log }), /venv failed/);
  assert.equal(w3.marker(), 'old');
  done(w3);

  const w4 = world({ venv: { version: '3.15.0' }, verifyMissing: ['onnxruntime'] });
  await assert.rejects(ensurePythonEnv({ steps: w4.steps, root: w4.root, log: w4.log }), /cannot import onnxruntime/);
  assert.equal(w4.marker(), 'old');
  done(w4);
});

test('ensure: pip upgrade failing is not fatal', async () => {
  const w = world();
  const orig = w.steps.pip;
  w.steps.pip = (args) => { if (args.includes('--upgrade')) throw new Error('offline'); return orig(args); };
  assert.equal((await ensurePythonEnv({ steps: w.steps, root: w.root, log: w.log })).action, 'create');
  assert.ok(w.lines.some((l) => /pip upgrade skipped/.test(l)));
  done(w);
});

test('ensure: Homebrew only when no Python was found; none at all gives the plain message', async () => {
  const withPython = world({ brew: '/opt/homebrew/bin/brew' });
  await ensurePythonEnv({ steps: withPython.steps, root: withPython.root, log: withPython.log });
  assert.ok(!withPython.calls.includes('brew install'));
  done(withPython);

  const viaBrew = world({ found: null, brew: '/opt/homebrew/bin/brew', afterBrew: { path: '/opt/homebrew/bin/python3.13', version: '3.13.2' } });
  const r = await ensurePythonEnv({ steps: viaBrew.steps, root: viaBrew.root, log: viaBrew.log });
  assert.equal(r.version, '3.13.2');
  assert.ok(viaBrew.calls.indexOf('brew install') < viaBrew.calls.findIndex((c) => c.startsWith('create')));
  done(viaBrew);

  const noBrew = world({ found: null, venv: { version: '3.15.0' } });
  await assert.rejects(ensurePythonEnv({ steps: noBrew.steps, root: noBrew.root, log: noBrew.log }), /No Python 3\.10–3\.13 found\. Install one: brew install python@3\.13/);
  assert.equal(noBrew.marker(), 'old', 'nothing was touched');
  assert.ok(!noBrew.calls.includes('rename'));
  done(noBrew);

  const brewFails = world({ found: null, brew: '/opt/homebrew/bin/brew', afterBrew: null, venv: { version: '3.15.0' } });
  await assert.rejects(ensurePythonEnv({ steps: brewFails.steps, root: brewFails.root, log: brewFails.log }), /Homebrew did not produce one/);
  assert.equal(brewFails.marker(), 'old');
  done(brewFails);
});

test('ensure: a venv with missing packages is repaired in place, with pip only', async () => {
  const w = world({ venv: { version: '3.13.2', missing: ['PyInstaller'] } });
  w.steps.verify = () => ({ version: '3.13.2', missing: [] });
  const r = await ensurePythonEnv({ steps: w.steps, root: w.root, log: w.log });
  assert.equal(r.action, 'install');
  assert.deepEqual(w.calls, [`pip install -r sidecar/requirements.txt ${BUILD_TOOLS.join(' ')}`]);
  done(w);
});

test('ensure: a killed rebuild is recovered (venv.old is put back when venv is gone)', async () => {
  const w = world({ venv: { version: '3.13.2' } });
  renameSync(join(w.root, 'venv'), join(w.root, 'venv.old'));
  await ensurePythonEnv({ steps: w.steps, root: w.root, log: w.log });
  assert.equal(w.marker(), 'old');
  assert.ok(!existsSync(join(w.root, 'venv.old')));
  done(w);
});

test('dry run creates, renames and deletes nothing, and reports the plan', async () => {
  const w = world({ venv: { version: '3.15.0' } });
  const r = await ensurePythonEnv({ steps: w.steps, root: w.root, log: w.log, dryRun: true });
  assert.equal(r.action, 'recreate');
  assert.deepEqual(w.calls.filter((c) => c !== 'find'), []);
  assert.equal(w.marker(), 'old');
  assert.ok(w.lines.some((l) => /recreate \(Python 3\.15\.0 unsupported\).*python3\.13/.test(l)));
  const plan = await planPythonEnv({ steps: world({ found: null, brew: '/x/brew' }).steps });
  assert.equal(plan.brew, true);
  done(w);
});
