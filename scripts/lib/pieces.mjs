// The four pieces Banditur is built and installed in (see "Banditur — local
// modular builds plan"): interface, app core, transcription engine, model.
// A piece's fingerprint is a SHA-256 over its inputs, so `npm run build:local`
// can rebuild and install only what changed. Pure functions here are tested in
// scripts/lib/pieces.test.mjs; the CLI at the bottom prints the fingerprints.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Until the interface can be loaded from the components folder (phase 3 of the
 * plan, which needs a spike on a real Mac), the interface is embedded in the
 * app core: a screen change rebuilds the (small) core.
 */
export const UI_LOADER = true;

const IGNORE_DIR = new Set(['node_modules', '__pycache__', '.git', '.build-cache', 'target', '.DS_Store']);
const IGNORE_FILE = /(^\.DS_Store$)|(\.test\.m?js$)|(\.pyc$)/;

/** Each piece's inputs: paths (files or folders) relative to the project root. */
export const INPUTS = {
  ui: {
    paths: ['src', 'index.html', 'vite.config.js', 'package-lock.json', 'public',
      'backend/api/_lib/malta-time.js', 'backend/api/_lib/event-rules.js', 'backend/api/_lib/task-rules.js'],
    skip: (rel) => rel.startsWith('public/fonts/'),
  },
  core: {
    paths: [
      'src-tauri/src', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json',
      'src-tauri/tauri.local.json', 'src-tauri/capabilities', 'src-tauri/icons', 'src-tauri/banditur-config.json',
      'src-tauri/binaries', 'public/fonts',
    ],
  },
  engine: {
    paths: ['sidecar', 'transcribe-bundle.spec', 'scripts/build-transcribe-sidecar.sh'],
  },
  model: { paths: ['mlx-maltese-whisper-4bit'], statOnly: true },
};

/** Every file under `rel` (a file or a folder), sorted, as project-relative paths with "/" separators. */
export function listFiles(root, rel, skip = () => false) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (IGNORE_DIR.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      const r = relative(root, full).split(sep).join('/');
      if (st.isDirectory()) walk(full);
      else if (!IGNORE_FILE.test(name) && !skip(r)) out.push(r);
    }
  };
  if (statSync(abs).isDirectory()) walk(abs);
  else out.push(rel);
  return out;
}

const hashFile = (path) => new Promise((ok, fail) => {
  const h = createHash('sha256');
  createReadStream(path).on('data', (c) => h.update(c)).on('error', fail).on('end', () => ok(h.digest('hex')));
});

/** SHA-256 over [name, content-hash] pairs. Entries are sorted so order never matters. */
export function combine(entries) {
  const h = createHash('sha256');
  for (const [name, value] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.update(`${name}\0${value}\n`);
  return h.digest('hex');
}

/**
 * The fingerprint of one piece. `extra` are strings mixed in (e.g. the Python
 * version for the engine). statOnly pieces (the 837 MB model) hash name + size
 * instead of reading the content.
 */
export async function fingerprint(piece, { root = ROOT, extra = [] } = {}) {
  const spec = INPUTS[piece];
  if (!spec) throw new Error(`Unknown piece: ${piece}`);
  const entries = extra.map((e, i) => [`#extra${i}`, e]);
  for (const p of spec.paths) {
    for (const rel of listFiles(root, p, spec.skip)) {
      const abs = join(root, rel);
      entries.push([rel, spec.statOnly ? `size:${statSync(abs).size}` : await hashFile(abs)]);
    }
  }
  return combine(entries);
}

/** The venv's Python version ("3.13.5"), or "" when there is no venv. */
export function pythonVersion(root = ROOT) {
  const py = join(root, 'venv', 'bin', 'python');
  if (!existsSync(py)) return '';
  try { return execFileSync(py, ['-c', 'import platform;print(platform.python_version())'], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

/** All pieces' fingerprints. The core also depends on the interface until the interface has its own loader. */
export async function fingerprintAll({ root = ROOT, python = pythonVersion(root), uiLoader = UI_LOADER } = {}) {
  const ui = await fingerprint('ui', { root });
  const core = await fingerprint('core', { root, extra: uiLoader ? [] : [`ui:${ui}`] });
  const engine = await fingerprint('engine', { root, extra: [`python:${python}`] });
  const model = await fingerprint('model', { root });
  return { ui, core, engine, model };
}

// ── Plan ────────────────────────────────────────────────────────────────────

/**
 * What `build:local` should do, from the current fingerprints, the project's
 * cache (.build-cache/manifest.json: what was last built) and what is installed
 * (components/installed.json plus what exists on disk).
 *   cache:     { ui?: {fingerprint, version}, core?: {…}, engine?: {fingerprint, version}, model?: {…} }
 *   installed: { engine?: number, model?: number }   // versions the app will use
 *   have:      { engineBuilt: bool, modelPresent: bool, engineInstalled: bool, modelInstalled: bool }
 *   force:     array of pieces to redo
 * → { ui, core, engine, model } each { build, install, reason }.
 */
export function makePlan({ current, cache = {}, installed = {}, have = {}, force = [], uiLoader = UI_LOADER }) {
  const changed = (p) => cache[p]?.fingerprint !== current[p];
  const forced = (p) => force.includes(p);
  const plan = {};

  // An unchanged engine that is already installed is not rebuilt just because its build output was
  // cleaned away (the in-app update removes sidecar-dist/ after installing; see scripts/update.mjs).
  const engineThere = have.engineInstalled && !!installed.engine;
  plan.engine = {
    build: forced('engine') || changed('engine') || (!have.engineBuilt && !engineThere),
    install: false, reason: '',
  };
  plan.engine.install = plan.engine.build || !have.engineInstalled || !installed.engine;
  plan.engine.reason = forced('engine') ? 'forced'
    : changed('engine') ? (cache.engine ? 'sidecar code, requirements or Python changed' : 'first build')
      : !have.engineBuilt && !engineThere ? 'no engine build yet'
        : !engineThere ? 'not installed in the components folder' : '';

  plan.model = { build: false, install: forced('model') || changed('model') || !have.modelInstalled || !installed.model, reason: '' };
  plan.model.reason = forced('model') ? 'forced'
    : changed('model') ? (cache.model ? 'model files changed' : 'first install')
      : !have.modelInstalled || !installed.model ? 'not installed in the components folder' : '';

  // have.uiBuilt / have.uiInstalled: only an explicit false counts (callers that don't know leave them out).
  const noDist = uiLoader && have.uiBuilt === false;
  plan.ui = { build: forced('ui') || changed('ui') || noDist, install: false, reason: '' };
  plan.ui.reason = forced('ui') ? 'forced' : changed('ui') ? (cache.ui ? 'screens or shared logic changed' : 'first build') : noDist ? 'no interface build yet' : '';
  plan.ui.install = uiLoader && (plan.ui.build || have.uiInstalled === false);
  if (plan.ui.install && !plan.ui.reason) plan.ui.reason = 'not installed in the components folder';

  // Likewise an unchanged, installed app is not rebuilt because target/release/bundle was cleaned.
  const coreBuild = forced('core') || changed('core') || (!have.appBuilt && !have.appInstalled);
  plan.core = { build: coreBuild, install: coreBuild || !have.appInstalled, reason: '' };
  plan.core.reason = forced('core') ? 'forced'
    : changed('core') ? (!cache.core ? 'first build' : !uiLoader && plan.ui.build ? 'Rust code or the interface (built into the app) changed' : 'Rust code or app settings changed')
      : !have.appBuilt && !have.appInstalled ? 'no app build yet'
        : !have.appInstalled ? 'app not installed' : '';
  return plan;
}

/** Human-readable plan: one line per piece. */
export function describePlan(plan, { uiLoader = UI_LOADER } = {}) {
  const lines = [];
  const name = { ui: 'interface', core: 'app core', engine: 'engine', model: 'model' };
  for (const p of ['ui', 'core', 'engine', 'model']) {
    const x = plan[p];
    const act = p === 'ui' && !uiLoader ? (x.build ? 'rebuild (inside the app core)' : 'unchanged')
      : x.build && x.install ? 'build + install'
        : x.install ? 'install' : x.build ? 'build' : 'unchanged';
    lines.push(`  ${name[p].padEnd(9)} ${act}${x.reason ? `  (${x.reason})` : ''}`);
  }
  return lines.join('\n');
}

// ── Hash of a whole folder (for checking a copy) ───────────────────────────

/** SHA-256 of a folder's files (relative names + contents). Symlinks count by target. */
export async function treeHash(dir) {
  const { lstatSync, readlinkSync } = await import('node:fs');
  const entries = [];
  const walk = async (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const st = lstatSync(full);
      const rel = relative(dir, full).split(sep).join('/');
      if (st.isSymbolicLink()) entries.push([rel, `link:${readlinkSync(full)}`]);
      else if (st.isDirectory()) await walk(full);
      else entries.push([rel, await hashFile(full)]);
    }
  };
  await walk(dir);
  return combine(entries);
}

// ── CLI: node scripts/lib/pieces.mjs → prints the fingerprints ────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await fingerprintAll(), null, 2));
}
