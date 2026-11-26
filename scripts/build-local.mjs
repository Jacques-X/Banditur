#!/usr/bin/env node
// npm run build:local — build only what changed and install it on this Mac.
//
//   npm run build:local                 plan, ask, build + install what changed
//   npm run build:local -- --dry-run    only show the plan
//   npm run build:local -- --force engine,core   redo pieces even if unchanged
//   npm run build:local -- --yes        don't ask
//   npm run build:local -- --app ~/Applications/Banditur.app   where the app goes
//   npm run build:local -- --no-app     leave the installed app alone
//   npm run build:local -- --dry-run --json   print one JSON line { work, core, ui, engine, model } (log goes to stderr)
//
// Pieces: see scripts/lib/pieces.mjs. The engine and model are copied into the
// app's components folder (scripts/lib/components.mjs), and so is the interface
// (the app serves the newest installed one; a screen change needs no new app).
// The app core is built with `tauri build --bundles app` and replaces the installed app.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { ROOT, UI_LOADER, fingerprintAll, makePlan, describePlan } from './lib/pieces.mjs';
import { componentsDir, copyTree, inlineScriptProblems, installPiece, readCoreApi, readInstalled, writeSource } from './lib/components.mjs';

const BUILT_APP = (root) => join(root, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Banditur.app');
export const DEFAULT_APP = '/Applications/Banditur.app';

export const loadCache = (root) => {
  try { return JSON.parse(readFileSync(join(root, '.build-cache', 'manifest.json'), 'utf8')); } catch { return {}; }
};
export function saveCache(root, cache) {
  mkdirSync(join(root, '.build-cache'), { recursive: true });
  const tmp = join(root, '.build-cache', 'manifest.json.tmp');
  writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`);
  renameSync(tmp, join(root, '.build-cache', 'manifest.json'));
}

/** The real build steps. Tests pass fakes. */
export function realSteps(root) {
  const sh = (cmd, args) => {
    console.log(`$ ${[cmd, ...args].join(' ')}`);
    const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status}).`);
  };
  return {
    buildEngine: () => sh('bash', ['scripts/build-transcribe-sidecar.sh']),
    buildUi: () => sh('npm', ['run', 'build']),
    buildCore: () => {
      sh('npm', ['run', 'tauri', '--', 'build', '--bundles', 'app', '--config', 'src-tauri/tauri.local.json']);
    },
    isAppRunning: () => {
      try { execFileSync('pgrep', ['-f', 'Banditur.app/Contents/MacOS/']); return true; } catch { return false; }
    },
    installApp: (src, dest) => {
      const staged = `${dest}.new`;
      mkdirSync(dirname(dest), { recursive: true });
      rmSync(staged, { recursive: true, force: true });
      copyTree(src, staged);
      rmSync(dest, { recursive: true, force: true });
      renameSync(staged, dest);
    },
  };
}

/** What a plan would do, as the one JSON line `--dry-run --json` prints (the app reads it). */
export function summarizePlan(plan) {
  const core = !!(plan.core.build || plan.core.install);
  const ui = !!(plan.ui.build || plan.ui.install);
  const engine = !!(plan.engine.build || plan.engine.install);
  const model = !!plan.model.install;
  return { work: core || ui || engine || model, core, ui, engine, model };
}

const nextVersion = (...seen) => Math.max(0, ...seen.filter(Number.isInteger)) + 1;

export async function runBuild({
  root = ROOT, dir = componentsDir(), appPath = DEFAULT_APP, installApp = true,
  dryRun = false, force = [], log = console.log, confirm = async () => true,
  steps = realSteps(root), uiLoader = UI_LOADER, python,
} = {}) {
  const current = await fingerprintAll({ root, ...(python !== undefined ? { python } : {}), uiLoader });
  const cache = loadCache(root);
  const installed = readInstalled(dir);
  const exists = (...p) => existsSync(join(...p));
  const have = {
    engineBuilt: exists(root, 'sidecar-dist', 'transcribe-bundle', 'transcribe-bundle'),
    modelPresent: exists(root, 'mlx-maltese-whisper-4bit', 'config.json') && exists(root, 'mlx-maltese-whisper-4bit', 'weights.safetensors'),
    engineInstalled: !!installed.engine && exists(dir, 'engine', String(installed.engine), 'transcribe-bundle'),
    modelInstalled: !!installed.model && exists(dir, 'model', String(installed.model), 'weights.safetensors'),
    uiBuilt: exists(root, 'dist', 'index.html'),
    uiInstalled: !!installed.ui && exists(dir, 'ui', installed.ui, 'index.html'),
    appBuilt: exists(BUILT_APP(root)),
    appInstalled: !installApp || existsSync(appPath),
  };
  const plan = makePlan({ current, cache, installed, have, force, uiLoader });
  if (!installApp) plan.core.install = false;
  // Remember which clone this is, so the app can check it for updates (Settings → Aġġornamenti).
  if (!dryRun) writeSource(dir, root);

  log('Banditur — what will happen:');
  log(describePlan(plan, { uiLoader }));
  const { work } = summarizePlan(plan);
  if (!work) { log('\nNothing to do: everything is up to date.'); return { plan, done: [] }; }
  if (dryRun) { log('\n(dry run: nothing was changed)'); return { plan, done: [] }; }
  if (plan.model.install && !have.modelPresent) throw new Error('The model is missing: mlx-maltese-whisper-4bit/ needs config.json and weights.safetensors.');
  if (plan.core.install && installApp && steps.isAppRunning()) throw new Error('Banditur is running. Quit it first, then run this again.');
  if (!(await confirm())) { log('Cancelled.'); return { plan, done: [] }; }

  const done = [];
  const next = { ...cache };

  // Engine: build (slow), copy into the components folder.
  if (plan.engine.build) {
    log('\n▸ Building the transcription engine…');
    steps.buildEngine();
  }
  if (plan.engine.install) {
    const version = plan.engine.build || !cache.engine?.version ? nextVersion(cache.engine?.version, installed.engine) : cache.engine.version;
    log('\n▸ Installing the engine…');
    await installPiece({ dir, kind: 'engine', version, srcDir: join(root, 'sidecar-dist', 'transcribe-bundle'), log });
    next.engine = { fingerprint: current.engine, version };
    saveCache(root, next);
    done.push(`engine ${version}`);
  } else if (!cache.engine) {
    next.engine = { fingerprint: current.engine, version: installed.engine };
  }

  // Model: copy only.
  if (plan.model.install) {
    const changed = cache.model?.fingerprint !== current.model;
    const version = changed || !cache.model?.version ? nextVersion(cache.model?.version, installed.model) : cache.model.version;
    log('\n▸ Installing the model…');
    await installPiece({ dir, kind: 'model', version, srcDir: join(root, 'mlx-maltese-whisper-4bit'), log });
    next.model = { fingerprint: current.model, version };
    saveCache(root, next);
    done.push(`model ${version}`);
  }

  // Interface: build once (the core embeds the result as its fallback), copy into the components folder.
  if (plan.ui.build) {
    log('\n▸ Building the interface…');
    steps.buildUi();
    const problems = inlineScriptProblems(join(root, 'dist'));
    if (problems.length) throw new Error(`The built interface has ${problems.join(' and ')}; the app only allows script files. Nothing was installed.`);
  }
  if (plan.ui.install) {
    const changed = cache.ui?.fingerprint !== current.ui || plan.ui.build;
    const version = changed || !cache.ui?.version ? nextVersion(cache.ui?.version, Number(installed.ui)) : cache.ui.version;
    log('\n▸ Installing the interface…');
    const needsCoreApi = readCoreApi(root);
    await installPiece({
      dir, kind: 'ui', version: String(version), srcDir: join(root, 'dist'), log,
      extra: { 'ui.json': `${JSON.stringify({ version: String(version), needsCoreApi })}\n` },
    });
    next.ui = { fingerprint: current.ui, version };
    saveCache(root, next);
    done.push(`interface ${version}`);
  }

  // App core.
  if (plan.core.build) {
    log('\n▸ Building the app…');
    steps.buildCore();
    next.core = { fingerprint: current.core };
    if (!uiLoader) next.ui = { fingerprint: current.ui };
    saveCache(root, next);
    done.push('app core');
  }
  if (plan.core.install && installApp) {
    log(`\n▸ Replacing ${appPath}…`);
    if (steps.isAppRunning()) throw new Error('Banditur is running. Quit it first, then run this again.');
    steps.installApp(BUILT_APP(root), appPath);
    done.push(`installed ${appPath}`);
  }
  if (!uiLoader && !plan.core.build) { next.ui = { fingerprint: current.ui }; saveCache(root, next); }

  const now = readInstalled(dir);
  log(`\nDone: ${done.join(', ') || 'nothing'}.`);
  log(`Installed pieces: interface ${now.ui ?? '—'}, engine ${now.engine ?? '—'}, model ${now.model ?? '—'}.`);
  if (plan.ui.install && !plan.core.install) log('The new interface shows the next time Banditur starts (or Settings → Updates → Reload the interface).');
  return { plan, done };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const val = (flag) => { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
  const untilde = (p) => (p && p.startsWith('~') ? join(homedir(), p.slice(1)) : p);
  const force = (val('--force') || '').split(',').filter(Boolean);
  const bad = force.filter((p) => !['ui', 'core', 'engine', 'model'].includes(p));
  if (bad.length) { console.error(`Unknown piece to force: ${bad.join(', ')} (use ui, core, engine, model)`); process.exit(1); }
  const yes = a.includes('--yes') || !process.stdin.isTTY;
  const json = a.includes('--json');
  try {
    const result = await runBuild({
      dryRun: a.includes('--dry-run'), force, log: json ? console.error : console.log, installApp: !a.includes('--no-app'),
      appPath: untilde(val('--app')) || DEFAULT_APP,
      confirm: async () => {
        if (yes) return true;
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question('\nContinue? [Y/n] ')).trim().toLowerCase();
        rl.close();
        return answer === '' || answer === 'y' || answer === 'yes';
      },
    });
    if (json && a.includes('--dry-run')) console.log(JSON.stringify(summarizePlan(result.plan)));
  } catch (e) {
    console.error(`\n${e.message}`);
    process.exit(1);
  }
}
