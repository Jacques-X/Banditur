// Pure parts of scripts/update.mjs (the in-app update): which dependency steps to run,
// whether a lock is stale, and the shape of update-result.json. Tested in update.test.mjs.

/**
 * Which dependency installs are needed. `saved` is .build-cache/deps.json from the last successful update
 * ({ lock, req } SHA-256 hashes, either may be missing); `current` the hashes now; `have` says whether
 * node_modules / venv exist. A hash that was never recorded counts as unchanged when the folder exists
 * (first run only records), and as changed when it does not.
 * → { npm, pip }
 */
export function depsToInstall({ saved = {}, current = {}, have = {} } = {}) {
  const need = (key, present) => {
    if (!current[key]) return false;           // the file is not there: nothing to install from
    if (!present) return true;                 // nothing installed yet
    if (!saved[key]) return false;             // first run: record only
    return saved[key] !== current[key];
  };
  return { npm: need('lock', !!have.nodeModules), pip: need('req', !!have.venv) };
}

/** The lock file holds a pid. → 'free' (no lock), 'busy' (that process is alive) or 'stale'. */
export function lockState(text, isAlive) {
  if (text == null) return 'free';
  const pid = Number.parseInt(String(text).trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return 'stale';
  return isAlive(pid) ? 'busy' : 'stale';
}

/** The last `n` non-empty lines of a log. */
export function tailLines(text, n = 40) {
  return String(text || '').split('\n').filter((l) => l.trim() !== '').slice(-n).join('\n');
}

/** update-result.json: { ok, at, head, error?, logTail? } (error and logTail only on failure). */
export function makeResult({ ok, at, head, error, log }) {
  const out = { ok: !!ok, at, head: head || null };
  if (!ok) {
    out.error = String(error || 'Unknown error');
    out.logTail = tailLines(log, 40);
  }
  return out;
}

/** The directories prepended to PATH (an app opened from Finder has a minimal one). */
export function toolPath(current, home) {
  const add = ['/opt/homebrew/bin', '/usr/local/bin', ...(home ? [`${home}/.cargo/bin`] : [])];
  const have = String(current || '').split(':').filter(Boolean);
  return [...add.filter((d) => !have.includes(d)), ...have].join(':');
}

/**
 * Build output removed after a successful update, relative to the project root. Only what build:local does
 * not need next time: the PyInstaller work folder, the built engine (already copied into the components folder),
 * debug Rust builds (only `tauri dev` makes them) and the built .app (already copied into place).
 * Kept on purpose: src-tauri/target/release (Rust's compiled dependencies; without them every app change is a
 * full compile) and dist/ (the app core embeds it when it is rebuilt).
 */
export const CLEAN_PATHS = ['build', 'sidecar-dist', 'src-tauri/target/debug', 'src-tauri/target/release/bundle'];
