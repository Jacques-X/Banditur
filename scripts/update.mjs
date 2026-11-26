#!/usr/bin/env node
// node scripts/update.mjs [--wait-pid <pid>] [--relaunch <app path>] [--no-app]
//
// The one place an in-app update runs (started by the app through a login shell, see
// src-tauri/src/source_update.rs). The code is already pulled; this installs changed
// dependencies, runs `build-local --yes`, writes .build-cache/update-result.json and,
// with --relaunch, opens the app again whether or not the build worked (a failed build
// leaves the old app in place). After a successful build it removes build output that is no longer
// needed (CLEAN_PATHS in lib/update.mjs). Everything is logged to .build-cache/update.log.
import { spawnSync, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib/pieces.mjs';
import { CLEAN_PATHS, depsToInstall, lockState, makeResult, toolPath } from './lib/update.mjs';

const sha = (file) => { try { return createHash('sha256').update(readFileSync(file)).digest('hex'); } catch { return null; } };
const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The real steps. Tests pass fakes. Each runs with its output going to the log file. */
export function realSteps(root, logFile) {
  const run = (cmd, args) => {
    appendFileSync(logFile, `$ ${[cmd, ...args].join(' ')}\n`);
    const fd = openSync(logFile, 'a');
    try {
      const r = spawnSync(cmd, args, { cwd: root, stdio: ['ignore', fd, fd] });
      if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
      if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status}).`);
    } finally { closeSync(fd); }
  };
  return {
    isAlive,
    npmInstall: () => run('npm', ['install']),
    pipInstall: () => run(join(root, 'venv', 'bin', 'pip'), ['install', '-r', 'sidecar/requirements.txt']),
    build: (noApp, app) => run('node', ['scripts/build-local.mjs', '--yes', ...(noApp ? ['--no-app'] : []), ...(app ? ['--app', app] : [])]),
    head: () => {
      try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; }
    },
    open: (path) => run('open', [path]),
    clean: (rel) => {
      const p = join(root, rel);
      if (!existsSync(p)) return false;
      rmSync(p, { recursive: true, force: true });
      return true;
    },
  };
}

/**
 * Run the update. → { code, result? } ; code 0 ok, 1 failed, 2 another update is running.
 * `readLog` returns the log text (for the failure tail).
 */
export async function runUpdate({
  root = ROOT, waitPid = null, relaunch = null, noApp = false, steps, now = () => new Date(),
  waitMs = 120_000, pollMs = 250, log = () => {}, startLog = () => {}, readLog = () => '', clock = Date.now,
} = {}) {
  const cache = join(root, '.build-cache');
  mkdirSync(cache, { recursive: true });
  const lockFile = join(cache, 'update.lock');

  // 1. The lock (a pid; stale when that process is gone).
  const take = () => { writeFileSync(lockFile, String(process.pid), { flag: 'wx' }); };
  try { take(); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let text = null;
    try { text = readFileSync(lockFile, 'utf8'); } catch { /* vanished */ }
    if (lockState(text, steps.isAlive) === 'busy') { log('Another update is already running.'); return { code: 2 }; }
    rmSync(lockFile, { force: true });
    take();
  }

  startLog(); // 2. truncate the log now that this run owns it
  let result;
  try {
    try {
      // 3. Wait for the app to quit.
      if (waitPid) {
        log(`Waiting for Banditur (pid ${waitPid}) to quit…`);
        const until = clock() + waitMs;
        while (steps.isAlive(waitPid)) {
          if (clock() > until) throw new Error('Banditur did not quit within 2 minutes.');
          await sleep(pollMs);
        }
      }
      // 5. Dependencies, then the build.
      const depsFile = join(cache, 'deps.json');
      let saved = {};
      try { saved = JSON.parse(readFileSync(depsFile, 'utf8')) || {}; } catch { /* first run */ }
      const current = { lock: sha(join(root, 'package-lock.json')), req: sha(join(root, 'sidecar', 'requirements.txt')) };
      const need = depsToInstall({
        saved, current,
        have: { nodeModules: existsSync(join(root, 'node_modules')), venv: existsSync(join(root, 'venv', 'bin', 'pip')) },
      });
      // npm install runs on every update (the shared Mac's flow: stash, pull, pop, npm install, build:local).
      log('▸ npm install'); steps.npmInstall();
      if (need.pip) { log('▸ sidecar/requirements.txt changed: pip install'); steps.pipInstall(); }
      const tmp = `${depsFile}.tmp`;
      writeFileSync(tmp, `${JSON.stringify({ ...saved, ...Object.fromEntries(Object.entries(current).filter(([, v]) => v)) }, null, 2)}\n`);
      renameSync(tmp, depsFile);

      log('▸ build:local');
      steps.build(noApp, relaunch); // the app being replaced is the one to reopen
      result = makeResult({ ok: true, at: now().toISOString(), head: steps.head() });
      // Only after a successful build: tidy away build output that build:local no longer needs.
      for (const rel of CLEAN_PATHS) {
        try { if (steps.clean(rel)) log(`▸ removed ${rel}`); }
        catch (e) { log(`Could not remove ${rel}: ${e.message}`); }
      }
    } catch (e) {
      log(`\nFAILED: ${e.message}`);
      result = makeResult({ ok: false, at: now().toISOString(), head: steps.head(), error: e.message, log: readLog() });
    }
    // 6. The result file.
    const out = join(cache, 'update-result.json');
    writeFileSync(`${out}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
    renameSync(`${out}.tmp`, out);
    // 7. Reopen the app, build or no build.
    if (relaunch) {
      try { steps.open(relaunch); } catch (e) { log(`Could not reopen ${relaunch}: ${e.message}`); }
    }
  } finally {
    rmSync(lockFile, { force: true });
  }
  return { code: result.ok ? 0 : 1, result };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const val = (flag) => { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
  const waitPid = Number.parseInt(val('--wait-pid') ?? '', 10);
  process.env.PATH = toolPath(process.env.PATH, homedir());
  const cache = join(ROOT, '.build-cache');
  mkdirSync(cache, { recursive: true });
  const logFile = join(cache, 'update.log');
  let started = false; // a run that finds the lock taken must not touch the running update's log
  const log = (m) => { if (started) appendFileSync(logFile, `${m}\n`); console.log(m); };
  const { code } = await runUpdate({
    startLog: () => { started = true; writeFileSync(logFile, `Update started ${new Date().toISOString()}\n`); },
    waitPid: Number.isInteger(waitPid) && waitPid > 0 ? waitPid : null,
    relaunch: val('--relaunch') || null,
    noApp: a.includes('--no-app'),
    steps: realSteps(ROOT, logFile), log,
    readLog: () => { try { return readFileSync(logFile, 'utf8'); } catch { return ''; } },
  });
  process.exit(code);
}
