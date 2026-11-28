// The engine's Python environment (<root>/venv), made self-healing. Used by scripts/update.mjs (the in-app update)
// and scripts/build-local.mjs. Pure decisions first (tested in python-env.test.mjs), then `ensurePythonEnv`, which
// takes its effects as injectable steps, then `realPythonEnv`, the steps that spawn real processes.
//
// Why a supported range: mlx-whisper, onnxruntime and PyInstaller publish arm64 macOS wheels for CPython 3.10-3.13.
// A newer Python (3.14, 3.15) has no onnxruntime wheel, so `pip install -r sidecar/requirements.txt` fails there.
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const PY_MIN = [3, 10];
export const PY_MAX = [3, 13];
export const PY_PREFERRED = '3.13';
export const RANGE_TEXT = `${PY_MIN.join('.')}–${PY_MAX.join('.')}`;
export const BREW_FORMULA = `python@${PY_PREFERRED}`;
/** Installed next to requirements.txt, never listed in it: it only builds the engine (see DECISIONS.md, 2026-11-28). */
export const BUILD_TOOLS = ['pyinstaller'];
/** Module names that are not derived from requirements.txt. */
export const EXTRA_IMPORTS = ['PyInstaller'];
export const HOMEBREW_BINS = ['/opt/homebrew/bin', '/usr/local/bin'];
export const BREW_PATHS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
/** Newest first: the first supported one found wins. */
export const CANDIDATE_NAMES = ['python3.13', 'python3.12', 'python3.11', 'python3.10'];

// ── Pure ────────────────────────────────────────────────────────────────────

/** "3.13.5" (or "Python 3.13.5", "3.15.0a1") → { major, minor, patch, text } or null. */
export function parsePythonVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text ?? ''));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: m[3] ? +m[3] : 0, text: `${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}` };
}

/** Is this version inside 3.10-3.13? Accepts a string or a parsed version. */
export function isSupported(version) {
  const v = typeof version === 'object' && version ? version : parsePythonVersion(version);
  if (!v) return false;
  const n = v.major * 1000 + v.minor;
  return n >= PY_MIN[0] * 1000 + PY_MIN[1] && n <= PY_MAX[0] * 1000 + PY_MAX[1];
}

/** "3.13" from "3.13.5": what is compared between runs (a patch release does not reinstall anything). */
export const minorOf = (version) => { const v = parsePythonVersion(version); return v ? `${v.major}.${v.minor}` : null; };

/**
 * Where to look for a Python, in order: the versioned names (newest first) in the Homebrew folders (/opt/homebrew/bin,
 * /usr/local/bin, `brew --prefix`/bin), then the same names on PATH, then plain `python3` (Homebrew folders, then
 * PATH), which is only used when its version is in range. Absolute paths only; no duplicates.
 */
export function candidatePaths({ brewPrefix = null, pathDirs = [] } = {}) {
  const brewDirs = [...HOMEBREW_BINS, ...(brewPrefix ? [join(brewPrefix, 'bin')] : [])];
  const out = [];
  const add = (dir, name) => { const p = `${dir}/${name}`; if (!out.includes(p)) out.push(p); };
  for (const name of CANDIDATE_NAMES) for (const d of brewDirs) add(d, name);
  for (const name of CANDIDATE_NAMES) for (const d of pathDirs) add(d, name);
  for (const d of [...brewDirs, ...pathDirs]) add(d, 'python3');
  return out;
}

/** The first candidate whose `probe(path)` gives a supported version → { path, version } or null. */
export function pickPython(paths, probe) {
  for (const path of paths) {
    const version = probe(path);
    if (version && isSupported(version)) return { path, version: String(version) };
  }
  return null;
}

/**
 * Module names the engine needs, from requirements.txt ("mlx-whisper>=0.4" → mlx_whisper), skipping comments,
 * options and git+ lines (the dev-only aligner), plus EXTRA_IMPORTS.
 */
export function requiredImports(requirementsText) {
  const names = [];
  for (const raw of String(requirementsText || '').split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line || line.startsWith('-') || /^git\+|:\/\//.test(line)) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
    if (m) names.push(m[1].replace(/[-.]/g, '_'));
  }
  return [...new Set([...names, ...EXTRA_IMPORTS])];
}

/**
 * What to do with the venv. `info` = { exists, version (string or null when it does not run), missing: [modules] }.
 * → { action: 'none' | 'install' | 'create' | 'recreate', reason }
 *   create/recreate build a new venv; install runs pip inside the one that is there.
 */
export function planEnv({ info, reinstall = false } = {}) {
  if (!info || !info.exists) return { action: 'create', reason: 'no venv' };
  if (!info.version) return { action: 'recreate', reason: 'venv/bin/python does not run' };
  if (!isSupported(info.version)) return { action: 'recreate', reason: `Python ${info.version} unsupported` };
  if (info.missing && info.missing.length) return { action: 'install', reason: `missing ${info.missing.join(', ')}` };
  if (reinstall) return { action: 'install', reason: 'requirements or Python changed' };
  return { action: 'none', reason: `Python ${info.version}` };
}

/** One line for the build plan: "Python environment: recreate (Python 3.15 unsupported)". */
export function describeEnv(plan) {
  if (!plan) return '';
  const base = `Python environment: ${plan.action === 'none' ? 'ok' : plan.action}`;
  const detail = plan.reason ? ` (${plan.reason})` : '';
  const use = plan.python ? `  → uses ${plan.python.path} (${plan.python.version})`
    : plan.brew ? `  → installs ${BREW_FORMULA} with Homebrew first` : plan.missingPython ? '  → no Python 3.10–3.13 and no Homebrew' : '';
  return `${base}${detail}${use}`;
}

export const noPythonMessage = (hasBrew) => (hasBrew
  ? `No Python ${RANGE_TEXT} found, and installing it with Homebrew did not produce one. Install one: brew install ${BREW_FORMULA}`
  : `No Python ${RANGE_TEXT} found. Install one: brew install ${BREW_FORMULA} (Homebrew is not installed: https://brew.sh)`);

/** A plain sentence for a failed pip run, from its output. */
export function explainPipFailure(output, version) {
  const m = /No matching distribution found for ([A-Za-z0-9._-]+)/.exec(String(output || ''));
  const py = version ? `Python ${version}` : 'this Python';
  if (m) return `pip could not install ${m[1]} for ${py} (no compatible package). Supported: ${RANGE_TEXT}.`;
  return `pip install failed for ${py}; see the log.`;
}

// ── The flow, with injectable steps ─────────────────────────────────────────

/**
 * Steps (all may be async): inspect() → { exists, version, missing }; findPython() → { path, version } | null;
 * brewPath() → string | null; brewInstall(brew); createVenv(pythonPath); pip(args) → runs `venv/bin/python -m pip …`
 * (throws, with the output in the message, on failure); verify() → { version, missing }; and the file steps
 * exists / rename / remove. Folder names: `venv` is final, `venv.old` holds the previous one during a rebuild.
 */

/** Decide without touching anything (build:local --dry-run, and the first half of ensure). */
export async function planPythonEnv({ steps, reinstall = false } = {}) {
  const info = await steps.inspect();
  const plan = planEnv({ info, reinstall });
  plan.info = info;
  if (plan.action === 'create' || plan.action === 'recreate') {
    const python = await steps.findPython();
    if (python) plan.python = python;
    else if (await steps.brewPath()) plan.brew = true;
    else plan.missingPython = true;
  }
  return plan;
}

/**
 * Make `venv` usable. → { action, version, reason }. Throws an Error with a plain message when it cannot,
 * leaving the previous venv exactly as it was.
 *
 * Rebuilding: the old venv is moved to `venv.old`, the new one is created at its final path `venv` (a venv's scripts
 * embed its absolute path, so one built elsewhere cannot be renamed into place), and on any failure it is deleted and
 * `venv.old` moved back. A run that finds `venv.old` without `venv` (killed half-way) puts it back first.
 */
export async function ensurePythonEnv({ steps, root, reinstall = false, log = () => {}, dryRun = false } = {}) {
  const venv = join(root, 'venv');
  const old = join(root, 'venv.old');
  if (!dryRun) {
    if (!steps.exists(venv) && steps.exists(old)) { log('▸ Restoring the previous venv (an earlier rebuild did not finish)'); steps.rename(old, venv); }
    else if (steps.exists(old)) steps.remove(old);
  }
  const plan = await planPythonEnv({ steps, reinstall });
  const label = describeEnv(plan);
  if (dryRun || plan.action === 'none') {
    log(label);
    return { action: plan.action, version: plan.info?.version ?? null, reason: plan.reason, plan };
  }
  log(`▸ ${label}`);

  if (plan.action === 'install') {
    await steps.pip(['install', '-r', 'sidecar/requirements.txt', ...BUILD_TOOLS]);
    const v = await steps.verify();
    if (v.missing.length) throw new Error(`Still missing after pip install: ${v.missing.join(', ')}. See the log.`);
    return { action: 'install', version: v.version, reason: plan.reason };
  }

  // create / recreate: a Python first.
  let python = plan.python;
  if (!python) {
    const brew = await steps.brewPath();
    if (!brew) throw new Error(noPythonMessage(false));
    log(`▸ No Python ${RANGE_TEXT} found: brew install ${BREW_FORMULA} (this can take a few minutes)`);
    await steps.brewInstall(brew);
    python = await steps.findPython();
    if (!python) throw new Error(noPythonMessage(true));
  }
  log(`▸ Using ${python.path} (Python ${python.version})`);

  const hadOld = steps.exists(venv);
  if (hadOld) steps.rename(venv, old);
  let version;
  try {
    await steps.createVenv(python.path);
    try { await steps.pip(['install', '--upgrade', 'pip']); } catch (e) { log(`pip upgrade skipped: ${e.message.split('\n')[0]}`); }
    await steps.pip(['install', '-r', 'sidecar/requirements.txt', ...BUILD_TOOLS]);
    const v = await steps.verify();
    if (v.missing.length) throw new Error(`The new environment cannot import ${v.missing.join(', ')}. See the log.`);
    if (!isSupported(v.version)) throw new Error(`The new environment runs Python ${v.version}, outside ${RANGE_TEXT}.`);
    version = v.version;
  } catch (e) {
    try { steps.remove(venv); } catch (r) { log(`Could not remove the failed venv: ${r.message}`); }
    if (hadOld) { steps.rename(old, venv); log('The previous venv was put back.'); }
    throw e;
  }
  if (hadOld) { try { steps.remove(old); } catch (e) { log(`Could not remove venv.old: ${e.message}`); } }
  return { action: plan.action, version, reason: plan.reason };
}

// ── Real steps ──────────────────────────────────────────────────────────────

const PROBE = 'import sys,platform;print("%d.%d.%d %s"%(sys.version_info[0],sys.version_info[1],sys.version_info[2],platform.machine()))';
const CHECK = 'import importlib,sys\nbad=[]\nfor n in sys.argv[1:]:\n    try: importlib.import_module(n)\n    except BaseException: bad.append(n)\nprint(" ".join(bad))';

/** Run a program with an argument array; output goes to `emit` and is returned. Never uses a shell. */
function runCaptured(cmd, args, { cwd, env, emit }) {
  return new Promise((resolve, reject) => {
    emit(`$ ${[cmd, ...args].join(' ')}\n`);
    let out = '';
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const take = (b) => { const s = b.toString(); out += s; emit(s); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    child.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(Object.assign(new Error(`${cmd} ${args.join(' ')} failed (exit ${code}).`), { output: out }))));
  });
}

/**
 * The real steps for `root`. Output goes to `logFile` when given (the update), else to the terminal.
 * `pathEnv` is the PATH to search (default process.env.PATH).
 */
export function realPythonEnv(root, { logFile = null, pathEnv = process.env.PATH, log = () => {} } = {}) {
  const venv = join(root, 'venv');
  const py = join(venv, 'bin', 'python');
  const emit = (s) => { if (logFile) appendFileSync(logFile, s); else process.stdout.write(s); };
  const probe = (path) => {
    if (!existsSync(path)) return null;
    try {
      const out = execFileSync(path, ['-c', PROBE], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const [version, machine] = out.split(/\s+/);
      if (process.platform === 'darwin' && machine !== 'arm64') return null; // MLX needs Apple Silicon
      return parsePythonVersion(version) ? version : null;
    } catch { return null; }
  };
  const brewPath = () => BREW_PATHS.find((p) => existsSync(p)) || null;
  const brewPrefix = () => {
    const brew = brewPath();
    if (!brew) return null;
    try { return execFileSync(brew, ['--prefix'], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
  };
  const steps = {
    exists: (p) => existsSync(p),
    rename: (a, b) => renameSync(a, b),
    remove: (p) => rmSync(p, { recursive: true, force: true }),
    brewPath,
    inspect: async () => {
      if (!existsSync(py)) return { exists: false, version: null, missing: [] };
      const out = probe(py);
      const version = out ? out.split(/\s+/)[0] : null;
      if (!version) return { exists: true, version: null, missing: [] };
      if (!isSupported(version)) return { exists: true, version, missing: [] };
      return { exists: true, version, missing: await steps.missingImports() };
    },
    missingImports: async () => {
      let text = '';
      try { text = readFileSync(join(root, 'sidecar', 'requirements.txt'), 'utf8'); } catch { /* none */ }
      try {
        const out = execFileSync(py, ['-c', CHECK, ...requiredImports(text)], { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'ignore'] });
        return out.split(/\s+/).filter(Boolean);
      } catch { return requiredImports(text); }
    },
    findPython: () => {
      const dirs = String(pathEnv || '').split(delimiter).filter(Boolean);
      return pickPython(candidatePaths({ brewPrefix: brewPrefix(), pathDirs: dirs }), probe);
    },
    brewInstall: async (brew) => {
      const env = { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1', NONINTERACTIVE: '1' };
      try { await runCaptured(brew, ['install', BREW_FORMULA], { cwd: root, env, emit }); }
      catch (e) { throw new Error(`brew install ${BREW_FORMULA} failed: ${e.message} See the log.`); }
    },
    createVenv: async (pythonPath) => {
      try { await runCaptured(pythonPath, ['-m', 'venv', venv], { cwd: root, env: process.env, emit }); }
      catch (e) { throw new Error(`Could not create the venv with ${pythonPath}: ${e.message}`); }
    },
    pip: async (args) => {
      try { await runCaptured(py, ['-m', 'pip', ...args], { cwd: root, env: process.env, emit }); }
      catch (e) {
        const v = probe(py);
        throw new Error(explainPipFailure(e.output, v ? v.split(/\s+/)[0] : null));
      }
    },
    verify: async () => {
      const out = probe(py);
      return { version: out ? out.split(/\s+/)[0] : null, missing: await steps.missingImports() };
    },
  };
  return steps;
}
