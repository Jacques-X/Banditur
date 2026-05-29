#!/usr/bin/env node
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function usage() {
  console.log(`Usage:
  npm run publish:update -- <version> "release notes" [options]

Options:
  --commit         Commit version bumps before building
  --push           Push the commit before building
  --vercel         Set Vercel env vars and redeploy
  --dry-run        Show what would happen without changing files or calling CLIs

Example:
  npm run publish:update -- 1.0.1 "Fix updater flow" --commit --push --vercel
`);
}

const args = process.argv.slice(2);
const version = args[0];
const notes = args[1];
const flags = new Set(args.slice(2));
const dryRun = flags.has('--dry-run');

if (!version || !notes || flags.has('--help')) {
  usage();
  process.exit(version && notes ? 0 : 1);
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Version must be semver-like, got "${version}"`);
}

function run(cmd, cmdArgs, options = {}) {
  console.log(`$ ${[cmd, ...cmdArgs].join(' ')}`);
  if (dryRun) return '';
  return execFileSync(cmd, cmdArgs, {
    cwd: root,
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
}

function sh(command, options = {}) {
  console.log(`$ ${command}`);
  if (dryRun) return '';
  return execSync(command, {
    cwd: root,
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function writeJson(path, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  console.log(`write ${path}`);
  if (!dryRun) writeFileSync(join(root, path), body);
}

function replaceFile(path, replacer) {
  const fullPath = join(root, path);
  const before = readFileSync(fullPath, 'utf8');
  const after = replacer(before);
  if (before === after) return;
  console.log(`write ${path}`);
  if (!dryRun) writeFileSync(fullPath, after);
}

function bumpVersions() {
  const pkg = readJson('package.json');
  pkg.version = version;
  writeJson('package.json', pkg);

  const lock = readJson('package-lock.json');
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  writeJson('package-lock.json', lock);

  const tauri = readJson('src-tauri/tauri.conf.json');
  tauri.version = version;
  writeJson('src-tauri/tauri.conf.json', tauri);

  replaceFile('src-tauri/Cargo.toml', text =>
    text.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`)
  );
}

function ensureCli(name, installHint) {
  try {
    run(name, ['--version'], { capture: true });
  } catch {
    throw new Error(`${name} is required. ${installHint}`);
  }
}

function commitAndMaybePush() {
  if (!flags.has('--commit') && !flags.has('--push')) return;

  run('git', ['add', 'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml']);
  run('git', ['commit', '-m', `Release Banditur ${version}`]);
  if (flags.has('--push')) run('git', ['push']);
}

function findArtifact() {
  const macArtifact = join(root, 'src-tauri/target/release/bundle/macos/Banditur.app.tar.gz');
  const macSig = `${macArtifact}.sig`;
  if (existsSync(macArtifact) && existsSync(macSig)) {
    return { artifact: macArtifact, signatureFile: macSig };
  }

  const output = sh(
    `find src-tauri/target/release/bundle -type f \\( -name "*.sig" -o -name "*.tar.gz" -o -name "*.zip" -o -name "*.msi" \\)`,
    { capture: true }
  ).trim().split('\n').filter(Boolean);

  const signatureFile = output.find(p => p.endsWith('.sig'));
  const artifact = signatureFile
    ? signatureFile.slice(0, -4)
    : output.find(p => !p.endsWith('.sig'));

  if (!artifact || !signatureFile || !existsSync(join(root, artifact)) || !existsSync(join(root, signatureFile))) {
    throw new Error('Could not find updater artifact and .sig. Did the signed build complete?');
  }

  return {
    artifact: join(root, artifact),
    signatureFile: join(root, signatureFile),
  };
}

function githubRelease(artifact, signatureFile) {
  ensureCli('gh', 'Install with: brew install gh');

  const tag = `v${version}`;
  run('gh', [
    'release',
    'create',
    tag,
    '--title',
    `Banditur ${version}`,
    '--notes',
    notes,
    artifact,
    signatureFile,
  ]);

  const repoJson = run('gh', ['repo', 'view', '--json', 'owner,name'], { capture: true });
  const repo = dryRun ? { owner: { login: 'OWNER' }, name: 'REPO' } : JSON.parse(repoJson);
  return `https://github.com/${repo.owner.login}/${repo.name}/releases/download/${tag}/${encodeURIComponent(basename(artifact))}`;
}

function vercelEnv(updateUrl, signature) {
  const pubDate = new Date().toISOString();
  const values = {
    UPDATE_VERSION: version,
    UPDATE_URL: updateUrl,
    UPDATE_SIGNATURE: signature,
    UPDATE_NOTES: notes,
    UPDATE_PUB_DATE: pubDate,
  };

  if (!flags.has('--vercel')) {
    console.log('\nSet these Vercel env vars, then redeploy Vercel:');
    for (const [key, value] of Object.entries(values)) {
      console.log(`${key}=${value}`);
    }
    return;
  }

  ensureCli('vercel', 'Install with: npm i -g vercel');
  for (const [key, value] of Object.entries(values)) {
    sh(`cd backend && vercel env rm ${key} production --yes >/dev/null 2>&1 || true`);
    sh(`cd backend && printf %s ${JSON.stringify(value)} | vercel env add ${key} production`);
  }
  sh('cd backend && vercel --prod');
}

console.log(`Publishing Banditur ${version}`);
bumpVersions();
commitAndMaybePush();

sh('rm -rf src-tauri/target/release/bundle');
run('npm', ['run', 'release:app']);

const { artifact, signatureFile } = findArtifact();
const updateUrl = githubRelease(artifact, signatureFile);
const signature = dryRun ? '<signature>' : readFileSync(signatureFile, 'utf8').trim();
vercelEnv(updateUrl, signature);

console.log('\nDone.');
console.log(`Artifact: ${artifact}`);
console.log(`Signature: ${signatureFile}`);
console.log(`Update URL: ${updateUrl}`);
