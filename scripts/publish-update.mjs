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

  run('git', [
    'add',
    'package.json',
    'package-lock.json',
    'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml',
    'src-tauri/Cargo.lock',
  ]);
  const hasStagedChanges = dryRun || sh('git diff --cached --quiet || echo changed', { capture: true }).trim() === 'changed';
  if (hasStagedChanges) {
    run('git', ['commit', '-m', `Release Banditur ${version}`]);
  } else {
    console.log('No version changes to commit.');
  }
  if (flags.has('--push')) run('git', ['push']);
}

function hostArch() {
  return process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch;
}

function classifyArtifact(artifact) {
  const rel = artifact.replace(root, '').replace(/^\/+/, '');
  const lower = rel.toLowerCase();

  let target = null;
  if (lower.includes('/macos/') || lower.endsWith('.app.tar.gz')) target = 'darwin';
  if (lower.includes('/msi/') || lower.includes('/nsis/') || lower.includes('setup') || lower.endsWith('.msi') || lower.endsWith('.exe') || lower.endsWith('.exe.zip')) {
    target = 'windows';
  }
  if (lower.includes('/appimage/') || lower.includes('/deb/') || lower.includes('/rpm/')) target = 'linux';

  let arch = null;
  if (lower.includes('aarch64') || lower.includes('arm64')) arch = 'aarch64';
  if (lower.includes('x86_64') || lower.includes('x64') || lower.includes('amd64')) arch = 'x86_64';
  if (lower.includes('i686') || lower.includes('x86')) arch = arch || 'i686';

  if (!target && process.platform === 'darwin') target = 'darwin';
  if (!arch && target === 'darwin') arch = hostArch();

  if (!target || !arch) {
    throw new Error(`Could not infer updater target/arch for ${rel}. Rename the artifact to include the platform and architecture.`);
  }

  return {
    target,
    arch,
    envSuffix: `${target}_${arch}`.replace(/[^A-Z0-9_]/gi, '_').toUpperCase(),
  };
}

function findArtifacts() {
  const output = sh(
    `find src-tauri/target/release/bundle -type f -name "*.sig"`,
    { capture: true }
  ).trim().split('\n').filter(Boolean);

  const artifacts = output.map(signatureFile => {
    const artifact = signatureFile.slice(0, -4);
    const artifactPath = join(root, artifact);
    const signaturePath = join(root, signatureFile);
    if (!existsSync(artifactPath) || !existsSync(signaturePath)) return null;
    return {
      artifact: artifactPath,
      signatureFile: signaturePath,
      ...classifyArtifact(artifactPath),
    };
  }).filter(Boolean);

  if (!artifacts.length && dryRun) {
    const target = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
    const arch = hostArch();
    const artifact = target === 'darwin'
      ? join(root, 'src-tauri/target/release/bundle/macos/Banditur.app.tar.gz')
      : target === 'windows'
        ? join(root, `src-tauri/target/release/bundle/msi/Banditur_${version}_${arch}.msi.zip`)
        : join(root, `src-tauri/target/release/bundle/appimage/Banditur_${version}_${arch}.AppImage.tar.gz`);
    return [{
      artifact,
      signatureFile: `${artifact}.sig`,
      ...classifyArtifact(artifact),
    }];
  }

  if (!artifacts.length) {
    throw new Error('Could not find updater artifacts with matching .sig files. Did the signed build complete?');
  }

  artifacts.sort((a, b) => `${a.target}-${a.arch}`.localeCompare(`${b.target}-${b.arch}`));
  return artifacts;
}

function githubRelease(artifacts) {
  ensureCli('gh', 'Install with: brew install gh');

  const tag = `v${version}`;
  const uploadArgs = artifacts.flatMap(item => [item.artifact, item.signatureFile]);
  let releaseExists = false;
  if (!dryRun) {
    try {
      execFileSync('gh', ['release', 'view', tag], {
        cwd: root,
        stdio: 'ignore',
      });
      releaseExists = true;
    } catch {}
  }

  if (releaseExists) {
    console.log(`GitHub release ${tag} already exists; updating assets.`);
    run('gh', [
      'release',
      'edit',
      tag,
      '--title',
      `Banditur ${version}`,
      '--notes',
      notes,
    ]);
    run('gh', [
      'release',
      'upload',
      tag,
      ...uploadArgs,
      '--clobber',
    ]);
  } else {
    run('gh', [
      'release',
      'create',
      tag,
      '--title',
      `Banditur ${version}`,
      '--notes',
      notes,
      ...uploadArgs,
    ]);
  }

  const repoJson = run('gh', ['repo', 'view', '--json', 'owner,name'], { capture: true });
  const repo = dryRun ? { owner: { login: 'OWNER' }, name: 'REPO' } : JSON.parse(repoJson);
  return artifacts.map(item => ({
    ...item,
    updateUrl: `https://github.com/${repo.owner.login}/${repo.name}/releases/download/${tag}/${encodeURIComponent(basename(item.artifact))}`,
  }));
}

function vercelEnv(releaseArtifacts) {
  const pubDate = new Date().toISOString();
  const values = {
    UPDATE_VERSION: version,
    UPDATE_NOTES: notes,
    UPDATE_PUB_DATE: pubDate,
  };

  for (const item of releaseArtifacts) {
    values[`UPDATE_URL_${item.envSuffix}`] = item.updateUrl;
    values[`UPDATE_SIGNATURE_${item.envSuffix}`] = dryRun ? '<signature>' : readFileSync(item.signatureFile, 'utf8').trim();
  }

  if (!flags.has('--vercel')) {
    console.log('\nSet these Vercel env vars, then redeploy Vercel:');
    for (const [key, value] of Object.entries(values)) {
      console.log(`${key}=${value}`);
    }
    console.log('\nRemove stale generic updater asset vars so other platforms are not pointed at the wrong artifact:');
    console.log('UPDATE_URL');
    console.log('UPDATE_SIGNATURE');
    return;
  }

  ensureCli('vercel', 'Install with: npm i -g vercel');
  for (const key of ['UPDATE_URL', 'UPDATE_SIGNATURE']) {
    sh(`cd backend && vercel env rm ${key} production --yes >/dev/null 2>&1 || true`);
  }
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

const artifacts = findArtifacts();
const releaseArtifacts = githubRelease(artifacts);
vercelEnv(releaseArtifacts);

console.log('\nDone.');
for (const item of releaseArtifacts) {
  console.log(`${item.target}/${item.arch} artifact: ${item.artifact}`);
  console.log(`${item.target}/${item.arch} signature: ${item.signatureFile}`);
  console.log(`${item.target}/${item.arch} update URL: ${item.updateUrl}`);
}
