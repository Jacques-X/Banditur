# AGENTS.md

Guidance for AI coding agents working in this repository. Read this first; it is short on purpose.
Anything that explains *how a feature works* is in README.md → "Technical reference".

## Documents

Four project documents, all tracked in Git. Keep them in sync with the code in the same change.
Nothing is described in two places: put a fact where it belongs and link to it.

| File | Holds |
|------|-------|
| **AGENTS.md** (this file) | Commands, the architecture diagram, where each kind of code lives, conventions, gotchas |
| **README.md** | What the app does, setup, and the "Technical reference": module maps, data flows, the reference backend, build internals, dependencies, current limitations |
| **RELEASE.md** | Release runbook: shipping a version to the shared Mac (bump, commit, tag, push), post-release checks |
| **DECISIONS.md** | Why deliberate choices were made. Keep history; mark superseded details |

If a change makes a statement in any of them wrong, fix it in the same change. If a change is a
deliberate trade-off, add a DECISIONS.md entry. Bundled third-party Markdown (`sidecar-dist/`, `venv/`)
is not project documentation. Do not add other Markdown files; `update.md`-style plans are temporary.

## What this is

**Banditur** — a Tauri 2 desktop app (Rust + Svelte 5), fully local since 2.2.0: post-production (Ritratti: RAW → JPG
and watermarking, Maltese transcription and subtitles, Murtali, post maker, YouTube download) and planning (Kalendarju
with campaigns and planned posts, Xogħol to-do boards, per-profile). **Supabase and Vercel are gone**; scheduling,
publishing, the archive and sharing return with an own server (DECISIONS.md, 2026-11-27). `backend/` stays as a
**reference only** (not deployed, not called by the app, not part of a release). The UI is Maltese with English
technical terms. Transcription targets macOS Apple Silicon only.

## Setup and commands

```bash
npm install
python3 -m venv venv && venv/bin/pip install -r sidecar/requirements.txt   # + pyinstaller for engine builds
cp src-tauri/banditur-config.example.json src-tauri/banditur-config.json   # an empty {}; still needed by include_str!, gitignored, unused by the app
```

Needs Rust + Cargo, Node 20.x or 22+, cmake (mozjpeg), Python 3.10+. ffmpeg, yt-dlp and Deno are not needed
(the engine and the app bring their own).

| Command | Purpose |
|---------|---------|
| `npm run tauri dev` | App with hot reload |
| `npm run dev` → `http://127.0.0.1:5173/?mock` | UI in a browser with sample data; no Tauri (mock never ships) |
| `npm test` | All `*.test.mjs` under `src/`, `backend/tests/` (reference code, in memory), `scripts/` (by glob, `node:test`) |
| `npm run test:py` | `sidecar/test_maltese.py`, `test_passage.py`, `test_serve.py`, `test_fireworks.py` |
| `npm run build` | Vite build |
| `npm run check` | test + test:py + build |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Rust unit tests |
| `npm run build:local` | Build only changed pieces (interface, core, engine, model) and install on this Mac (`--dry-run`, `--force <pieces>`, `--yes`, `--no-app`, `--app <path>`) |
| `npm run build:transcribe` | Rebuild only the PyInstaller engine |
| `node scripts/update.mjs` | The in-app update (pull already done): dependencies, `build:local --yes`, clean build output (`CLEAN_PATHS`), result file, reopen. Started by the app; `--wait-pid <pid>`, `--relaunch <app>`, `--no-app` |
| `npm run smoke:meta -- --profile <id>` | Reference-backend tool: check a profile against the real Graph API without publishing |

Checks after any change: `npm run check`, the Rust tests when `src-tauri/` changed, and a click-through of the
touched screens at `?mock`.

## Architecture

```text
Desktop frontend (Svelte 5)
  |-- Tauri IPC --> Rust tools --> Python transcription/render sidecar
  |-- localStorage / app-data folder (Kalendarju, Xogħol, profiles, projects)
  '-- GitHub (git pull) --> in-app update --> build:local on the shared Mac

backend/  reference only (Vercel + Supabase code): not deployed, not called
```

## Where code lives

| Kind of code | Place |
|--------------|-------|
| Screens (one per tab / Studio tool) | `src/views/*.svelte`, helpers in a folder of the same name (`views/kalendarju/`, `views/xoghol/`, `views/posts/`, `views/ritratti/`, `views/marka/` (watermark packs), `views/traskrittura/`, `views/murtali/`) |
| Toolbar, modal, toasts, shared widgets | `src/components/` |
| App state, profiles, Tauri wrappers, job lanes, dev mock | `src/lib/` (`app.svelte.js`, `profiles.js`, `tauri.js`, `mock.js`, `photojob.svelte.js`, `studio-jobs.svelte.js`, `projects.svelte.js`, …) |
| Subtitle engine (pure model, Maltese rules, ASS styles, preview, timeline, editor) | `src/subtitles/` |
| Post-maker logic (template format, fit/placement maths, canvas renderer) | `src/postmaker/` |
| Channels a planned post can name | `src/platforms.js` (ids match `SLOT_PLATFORMS` in `backend/api/_lib/event-rules.js`) |
| Strings / Maltese error text | `src/strings.js` |
| Tokens, shared controls, legacy tool CSS | `src/styles/` |
| Native commands | `src-tauri/src/<feature>.rs`, registered in `lib.rs` (in-app updates: `source_update.rs`; its interface side `lib/updates.svelte.js` + pure `lib/updates.js`, the card in `views/Settings.svelte`, the script `scripts/update.mjs`) |
| Transcription / render / peaks / fireworks sidecar | `sidecar/` (`transcribe.py`, `subtitle_render.py`, `peaks.py`, `maltese.py`, `fireworks.py`, `fireworks_render.py`, `lut.py`), built by `transcribe-bundle.spec` |
| Reference backend (not deployed) | `backend/` — handlers in `backend/api/`, shared modules in `backend/api/_lib/`, SQL in `backend/supabase/`. The desktop imports only `malta-time.js`, `task-rules.js` and `event-rules.js` from `_lib/` |
| Build, release, font and pack scripts | `scripts/` |

Module-by-module detail: README → Technical reference → Frontend modules / Native layer (Cloud API there is the reference backend).

## Conventions

- **Tauri commands**: `#[tauri::command]` in a feature module, registered in `lib.rs`; return `Result<T, String>`;
  take `AppHandle` for logging/resources; `TxState` / `RenderState` for sidecar state; CPU-heavy work goes through
  `tauri::async_runtime::spawn_blocking`; small config/file commands may be synchronous. Bump `CORE_API`
  (`components.rs`) when a command changes shape. Events and the sidecar JSON protocol: README → Native layer.
- **Frontend**: Svelte 5 runes. Logic that can be pure lives in `.js` beside the view and has a `*.test.mjs`.
  Saved data is read through `ls.list()` / `ls.object()` (`lib/app.svelte.js`) so a wrong-shaped value cannot break
  start-up. The app makes no server calls of its own (no `api()`, no keys); errors reach the user through `friendlyError()`.
  Xogħol and Kalendarju stores answer server-shaped requests locally (`local-store.js`), so an own server can replace them.
- **Navigation**: the app starts on Home (`0`). Planning: Kalendarju, Xogħol (`1`, `2`); Studio: Video (Traskrittura | Murtali, one toolbar button, `VIDEO_PARTS`), Posts, Ritratti, YouTube (`⌘3`–`⌘6`). `app.tool` holds the screen actually open (`traskrittura` or `murtali`), never `video`; `openTool('video')` opens the part used last, `openTool('traskrittura')` always Traskrittura (`lib/video-parts.js`). `⌘K` go anywhere, `⌘,` Settings. Plain number keys
  are off inside Studio tools, while typing and with a modal open. Window default 1280×780, minimum 960×580.
- **Look**: theme follows the system; Traskrittura, Murtali and Posts can force dark in Settings → Appearance. Toasts bottom-centre
  (errors stay until dismissed). `Modal.svelte` owns focus trap/Esc/focus return; `confirm()` uses `ConfirmDialog.svelte`.
  Preset ids stay stable while labels change (Deheb / Pillola / Klassiku).
- **Backend (reference)**: `backend/` is not deployed and not called. Keep the desktop's imports from it to the pure modules `malta-time.js`, `task-rules.js` and `event-rules.js` (and list them in `scripts/lib/pieces.mjs` so a change rebuilds the interface). Handler factories (`createXHandler(client)`) exist so its tests run against an in-memory database.
- **Money, dates**: Xogħol money is whole cents; dates are `YYYY-MM-DD` compared with Malta's date; Malta summer/winter
  boundaries matter (`malta-time.js`).
- **Docs and tests**: new behaviour gets a test and a README line; a deliberate trade-off gets a DECISIONS entry.

## Gotchas

- A fresh install has **no watermarks** until a pack is imported; Ritratti blocks a watermarked run until one is chosen.
  Packs must be 3:2 / 2:3: the overlay is stretched to each photo.
- Watermark compositing is `blend_rows()` in `image_processor.rs`, on an RGB photo: per output size the scaled mark is cached with its first/last visible rows, alpha 0 is skipped, 255 copied, anything between is `(src*a + dst*(255-a) + 127) / 255` per channel (same look as `imageops::overlay`: fully opaque white may show as pure white on dark photos).
- Output JPEGs are re-encoded by mozjpeg without EXIF; the RAW converter's no-resize path keeps the embedded preview's
  bytes and tags untouched.
- **PyInstaller must be `--onedir`**: `--onefile` extracts to `/tmp` and MLX cannot start Metal.
- Release engine bundles exclude `torch`, `torchaudio`, `scipy`, `hf_xet`, `transformers`, `tokenizers`, `nltk`, `ctc_forced_aligner` and `pyannote` (the build script fails if any is present; `huggingface_hub`, `safetensors`, `numba`, `tiktoken` stay, mlx-whisper needs them), so the MASRI alignment pass runs only in dev
  (`timing_source: "whisper"` otherwise). The aligner and its model are non-commercial licensed.
- Transcription is **one long-lived worker** (sidecar serve mode): the model stays loaded between videos, every event
  carries the request id, one request at a time, stopped after 10 idle minutes or by `cancel_transcribe`. `CORE_API` is 5.
- Xogħol and Kalendarju are local only. Profiles are a local list (`banditur_profiles`, `lib/profiles.js`): never rename an id, because both stores key their data by it; removing a profile only hides its data. Undo-in-the-toast puts the saved localStorage value back (`lib/undo.js`).
- Kalendarju **campaigns and planned posts (slots)** ride on the same local store; rules in `backend/api/_lib/event-rules.js` (imported), maths in `views/kalendarju/campaigns.js`. A slot's status is set by hand; *Ippubblikat* (`done`) means it went out, is closed for work (`isOpen`) but still counts for weekly targets and gaps. `post_id` stays in the data and is unused.
- The sidecar finds ffmpeg itself (`_find_ffmpeg()`: imageio-ffmpeg first) because app bundles launch with a minimal `PATH`.
- **Murtali** (`views/murtali/`, `src-tauri/src/fireworks.rs`, `sidecar/fireworks*.py`) detects from the sound plus a light peak: Python measures (audio curves, and a `light` curve from a 10 fps 32×18 grey decode of the picture; empty when the video can't be read), `segments.js` decides (`withLight`: a sound counts only after a light peak within the distance window), so a slider re-segments instantly. Saved projects without `curves.light` are re-analysed once on open. The video is never re-encoded except in the two exports (own sound only, no music); one Murtali analysis or export at a time; it never starts the Whisper model. `aresample` after `loudnorm` fails in ffmpeg 4.4: pin the format with `aformat` instead. A project LUT (`.cube`) goes through `sidecar/lut.py` (copied to `lut.cube` in the work folder — never put a user path inside a filter graph) and is previewed by `views/murtali/LutPreview.svelte` (WebGL2); the `<video>` uses `crossorigin="anonymous"` for that and falls back without it.
- Missing model falls back to `mlx-community/whisper-large-v3-mlx`, which is the non-Maltese model.
- YouTube: `yt-dlp` is spawned directly with `--` before the URL; the app downloads its own `yt-dlp` and Deno on first use.
- `src-tauri/gen/schemas/` is generated and untracked; only macOS/Windows icons are kept.
- `_to_delete*/` and `.xfer*/` transfer leftovers are git-ignored; delete them rather than commit them.
- **In-app updates** (README → Updates on the shared Mac): git is `stash` (tracked edits only, never `-u`) → `pull --ff-only` → `stash pop` (a clashing pop keeps the stash and resets the files to the pulled code), then `update.mjs` always runs `npm install` before `build:local`; never merge/rebase/push, and a diverged branch is refused; the clone follows its branch's upstream and is found through `<components>/source.json` (written by `build:local`). Rust runs node tools through `/bin/zsh -lc` with the root in `BANDITUR_ROOT` (a Finder-launched app has a minimal PATH; never put paths in the shell string) and git as `/usr/bin/git` with `GIT_TERMINAL_PROMPT=0`. `.build-cache/update.lock` holds a pid (stale when dead), `update.log` is truncated per run, `update-result.json` is read once by the app and cleared. A core update quits the app and a detached helper (`--wait-pid`) finishes it, so keep `update.mjs` free of anything that needs the app. `CORE_API` is 5 (4: the `update_*` commands; 5: the fireworks commands). `archive_*` and `get_config` in `src-tauri/` are registered but unused since 2.2.0 (remove them when `cargo` is available).
- Do not imply the installed app was updated because the source was edited; `npm run build:local` (or the in-app update) is a separate step (RELEASE.md).
- Current limitations (local-only features, estimated SRT timings, Murtali detection, unused Rust):
  README → Current limitations. Keep them explicit when describing behaviour.
