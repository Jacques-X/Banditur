// The components folder (~/Library/Application Support/app.banditur.desktop/components):
// versioned copies of the engine and model plus installed.json saying which
// version the app uses. All writes go beside the target first and switch over
// at the end, so an interrupted copy never leaves a broken piece in use.
// The Rust side reads the same layout (src-tauri/src/components.rs).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { treeHash } from './pieces.mjs';

export const APP_ID = 'app.banditur.desktop';

export function componentsDir(env = process.env) {
  return env.BANDITUR_COMPONENTS_DIR || join(homedir(), 'Library', 'Application Support', APP_ID, 'components');
}

/** installed.json → { ui?: string, engine?: number, model?: number }; missing or unreadable → {}. */
export function readInstalled(dir) {
  try {
    const d = JSON.parse(readFileSync(join(dir, 'installed.json'), 'utf8'));
    const out = {};
    if (Number.isInteger(d.engine) && d.engine > 0) out.engine = d.engine;
    if (Number.isInteger(d.model) && d.model > 0) out.model = d.model;
    if (typeof d.ui === 'string') out.ui = d.ui;
    return out;
  } catch { return {}; }
}

/** Written last, through a temporary file, so it is never half-written. */
export function writeInstalled(dir, installed) {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, 'installed.json.tmp');
  writeFileSync(tmp, `${JSON.stringify(installed, null, 2)}\n`);
  renameSync(tmp, join(dir, 'installed.json'));
}

/** Copy a folder. Tries an APFS clone (instant, no extra disk) and falls back to a plain copy. */
export function copyTree(src, dest) {
  if (process.platform === 'darwin') {
    try { execFileSync('cp', ['-Rc', src, dest], { stdio: 'ignore' }); return; } catch { rmSync(dest, { recursive: true, force: true }); }
    try { execFileSync('cp', ['-Rp', src, dest], { stdio: 'ignore' }); return; } catch { rmSync(dest, { recursive: true, force: true }); }
  }
  cpSync(src, dest, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
}

/**
 * Install `srcDir` as <dir>/<kind>/<version>/ : copy to <version>.partial, check the
 * copy's hash against the source, rename, then record the version in installed.json
 * (last). Older versions are removed except the previous one, which stays so a bad
 * build can be rolled back by editing one number. → the final folder.
 */
export async function installPiece({ dir, kind, version, srcDir, extra = {}, log = () => {} }) {
  if (!existsSync(srcDir)) throw new Error(`${kind}: nothing to install at ${srcDir}`);
  const parent = join(dir, kind);
  const target = join(parent, String(version));
  const partial = `${target}.partial`;
  mkdirSync(parent, { recursive: true });
  rmSync(partial, { recursive: true, force: true });

  log(`  copying ${kind} ${version}…`);
  copyTree(srcDir, partial);
  const [want, got] = [await treeHash(srcDir), await treeHash(partial)];
  if (want !== got) {
    rmSync(partial, { recursive: true, force: true });
    throw new Error(`${kind}: the copy does not match the source (checksum). Nothing was changed.`);
  }
  // Small files that describe the piece (ui.json) are added after the check, before it goes live.
  for (const [name, content] of Object.entries(extra)) writeFileSync(join(partial, name), content);
  rmSync(target, { recursive: true, force: true });
  renameSync(partial, target);

  const before = readInstalled(dir);
  writeInstalled(dir, { ...before, [kind]: version });
  prune(parent, version, before[kind]);
  return target;
}

/** The core's API number, read from the Rust source (bumped by hand when a command changes shape). */
export function readCoreApi(root) {
  const text = readFileSync(join(root, 'src-tauri', 'src', 'components.rs'), 'utf8');
  const m = text.match(/CORE_API:\s*u32\s*=\s*(\d+)/);
  if (!m) throw new Error('CORE_API not found in src-tauri/src/components.rs');
  return Number(m[1]);
}

/** The installed interface may not use inline scripts: the app's CSP only allows script files. → list of problems. */
export function inlineScriptProblems(distDir) {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(m[1]) && m[2].trim()) out.push('an inline <script> in index.html');
  }
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) out.push('an inline event handler in index.html');
  return out;
}

/** Remove every version folder except `current` and `previous` (and stray .partial folders). */
export function prune(parent, current, previous) {
  if (!existsSync(parent)) return [];
  const keep = new Set([String(current), previous == null ? '' : String(previous)]);
  const removed = [];
  for (const name of readdirSync(parent)) {
    if (!keep.has(name)) { rmSync(join(parent, name), { recursive: true, force: true }); removed.push(name); }
  }
  return removed;
}
