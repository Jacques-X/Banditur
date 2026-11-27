# Banditur Release Flow

Checked against the local release scripts and configuration on **2026-11-27** (the shared Mac follows `main`; versions are tagged and published as GitHub releases).

Since 2.2.0 there is nothing to deploy: **no migrations, no backend deployment, no Vercel, no Supabase, no publishing cron.**
`backend/` is a reference folder only (see DECISIONS.md, 2026-11-27) and is not part of a release. Shipping a version is:
bump, commit, tag, push to `main`.

## One-time setup

There is no signing key any more: the signed Tauri updater was removed (DECISIONS.md → "Signed updater removed; the
shared Mac builds from GitHub"). The one-time setup that remains is the shared Mac's (clone, GitHub token, first
`npm run build:local`): README → "Updates on the shared Mac".

## Build prerequisites

- Use Node.js 20.x or 22+ for the checked-in dependency locks. Install frontend dependencies with `npm install`.
- Rust/Cargo and cmake are required for the desktop build. The packaged transcription flow
  currently targets macOS Apple Silicon and uses `install_name_tool` and `codesign`.
- Provide `src-tauri/banditur-config.json` (copy the example: an empty `{}`). It is compiled into the binary; the app
  reads nothing from it any more, and it must never hold a key.
- Provide `venv/` with `sidecar/requirements.txt` and PyInstaller installed, and
  `mlx-maltese-whisper-4bit/config.json` plus `weights.safetensors`.
- The sidecar build finds the MLX extension (`core.cpython-*-darwin.so`) for whichever CPython the
  `venv` uses, and stops if it finds none or more than one.

## Desktop App

There is no release artifact. The desktop is built on the shared Mac, from the repository, by the app itself
(README → "Updates on the shared Mac").

### Shipping a new version

1. Run the checks (`npm run check`, and `cargo test --manifest-path src-tauri/Cargo.toml --lib` when `src-tauri/` changed).
2. Bump the version, commit, tag and push (see "Version numbers" below) to **`main`**, which the shared
   Mac's clone follows. Nothing else is deployed.
3. On the shared Mac, Banditur shows a dot on the Settings button within 3 hours, or at once with Settings →
   Components → Aġġornamenti → Iċċekkja issa. Pressing **Aġġorna** pulls (fast-forward only) and builds. A change to
   screens, the engine or the model needs no quit; a change to the app core quits, rebuilds and reopens (up to
   15 minutes; nothing should be pressed meanwhile).
4. If it fails, the old app stays and reopens; read the error in Settings or `.build-cache/update.log` in the clone.
   Local edits to tracked files in the clone are stashed and put back around the pull; if they clash with the new
   code they stay in `git stash` (`git stash list` in the clone) and the update finishes with the pulled code.

### Version numbers

`MAJOR.MINOR.PATCH`: a new feature bumps MINOR (2.1.0), fixes and small changes bump PATCH (2.1.1). Set the same number
in `package.json`, `package-lock.json` (its two top-level `version` fields), `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml` and the `banditur` entry of `src-tauri/Cargo.lock`. Then:

```bash
git commit -am "Version X.Y.Z: <what changed>"
git tag -a vX.Y.Z -m "Banditur X.Y.Z"
git push origin main vX.Y.Z
gh release create vX.Y.Z --verify-tag --title "Banditur X.Y.Z" --notes "<what changed>"
```

Never move a tag that is already on GitHub: release the next number instead. The version is shown in Settings;
nothing else reads it.

## Verification after a release

- On the shared Mac, test an update both ways: push a screen-only commit and press Aġġorna (no quit); push a Rust
  commit (quit, rebuild, reopen); break the build on purpose (the old app reopens and Settings shows the error).
- Open Xogħol: create a board, add/tick/move a card, quit and reopen the app, and check it is all still there.
  Switch to Gantt, drag and resize a bar and a step bar, add a card and a step from the chart, give a card a Budget and check the totals, and save a PNG and a PDF (open both; the PDF must be one A4 page).
- Open Kalendarju: add a campaign and a planned post, mark it *Ippubblikat*, quit and reopen, and check Home's *Issa* and *Jmiss*. In Settings → Profili check that the profiles you expect are listed and that each shows its own boards and calendar.
- After `npm run build:local` with a changed core: the interface and core must agree on `CORE_API` (now 5: the fireworks commands); `build:local` builds both together, and Settings → Components shows a mismatch. Transcribe two videos in a row (the second starts without loading the model) and try *Ikkanċella*.- After `npm run build:local`: Settings → Components lists the engine and model versions; open Traskrittura and transcribe a short clip.
- Open the installed build, resume a subtitle session, check a sample export's font/timing,
  and verify watermark/template data survives the update. The release sidecar excludes the
  optional CTC aligner, so installed word timings use Whisper rather than the dev MASRI pass.

## Reference backend (`backend/`, not released)

`backend/` (Vercel functions, Supabase migrations, the Meta smoke test `npm run smoke:meta`) is kept only as a reference
for porting to an own server. Do not deploy it, and do not apply its migrations to a live project from here. Its tests
run with `npm test`. If an own server is built, its runbook belongs in this file.
