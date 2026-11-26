# AGENTS.md

Guidance for AI coding agents working in this repository. Read this first; it is short on purpose.
Anything that explains *how a feature works* is in README.md → "Technical reference".

## Documents

Four project documents, all tracked in Git. Keep them in sync with the code in the same change.
Nothing is described in two places: put a fact where it belongs and link to it.

| File | Holds |
|------|-------|
| **AGENTS.md** (this file) | Commands, the architecture diagram, where each kind of code lives, conventions, gotchas |
| **README.md** | What the app does, setup, and the "Technical reference": module maps, data flows, API endpoints, build internals, dependencies, current limitations |
| **RELEASE.md** | Release runbook: migrations, backend deployment, shipping a version to the shared Mac, post-release checks |
| **DECISIONS.md** | Why deliberate choices were made. Keep history; mark superseded details |

If a change makes a statement in any of them wrong, fix it in the same change. If a change is a
deliberate trade-off, add a DECISIONS.md entry. Bundled third-party Markdown (`sidecar-dist/`, `venv/`)
is not project documentation. Do not add other Markdown files; `update.md`-style plans are temporary.

## What this is

**Banditur** — a Tauri 2 desktop app (Rust + Svelte 5) for post-production (Ritratti: RAW → JPG and watermarking,
Maltese transcription and subtitles, post maker, YouTube download) plus a Vercel serverless backend
(`backend/`) that schedules and publishes to Facebook and Instagram, with Google Drive,
reports and Xogħol (to-do boards, kept locally). The UI is Maltese with English technical terms.
Transcription targets macOS Apple Silicon only.

## Setup and commands

```bash
npm install
python3 -m venv venv && venv/bin/pip install -r sidecar/requirements.txt   # + pyinstaller for engine builds
cp src-tauri/banditur-config.example.json src-tauri/banditur-config.json   # fill in; baked in via include_str!, gitignored
```

Needs Rust + Cargo, Node 20.x or 22+, cmake (mozjpeg), Python 3.10+. ffmpeg, yt-dlp and Deno are not needed
(the engine and the app bring their own).

| Command | Purpose |
|---------|---------|
| `npm run tauri dev` | App with hot reload |
| `npm run dev` → `http://127.0.0.1:5173/?mock` | UI in a browser with sample data; no Tauri, no backend (mock never ships) |
| `npm test` | All `*.test.mjs` under `src/`, `backend/tests/`, `scripts/` (by glob, `node:test`) |
| `npm run test:py` | `sidecar/test_maltese.py`, `test_passage.py`, `test_serve.py`, `test_fireworks.py` |
| `npm run build` | Vite build |
| `npm run check` | test + test:py + build |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Rust unit tests |
| `npm run build:local` | Build only changed pieces (interface, core, engine, model) and install on this Mac (`--dry-run`, `--force <pieces>`, `--yes`, `--no-app`, `--app <path>`) |
| `npm run build:transcribe` | Rebuild only the PyInstaller engine |
| `node scripts/update.mjs` | The in-app update (pull already done): dependencies, `build:local --yes`, clean build output (`CLEAN_PATHS`), result file, reopen. Started by the app; `--wait-pid <pid>`, `--relaunch <app>`, `--no-app` |
| `npm run smoke:meta -- --profile <id>` | Check a profile against the real Graph API without publishing |

Checks after any change: `npm run check`, the Rust tests when `src-tauri/` changed, and a click-through of the
touched screens at `?mock`.

## Architecture

```text
Desktop frontend (Svelte 5)
  |-- Tauri IPC --> Rust tools --> Python transcription/render sidecar
  |-- HTTP/API_KEY --> Vercel API --> Supabase Postgres + Storage
  |                              |--> Facebook / Instagram
  |                              |--> Google Drive
  |-- Signed media uploads ----------> Supabase Storage

GitHub Actions (15 min) -- CRON_SECRET --> Vercel publishing worker
Vercel Cron (daily) ---- CRON_SECRET --> same worker (fallback)
```

## Where code lives

| Kind of code | Place |
|--------------|-------|
| Screens (one per tab / Studio tool) | `src/views/*.svelte`, helpers in a folder of the same name (`views/skeda/`, `views/xoghol/`, `views/posts/`, `views/ritratti/`, `views/marka/` (watermark packs), `views/traskrittura/`, `views/murtali/`) |
| Toolbar, modal, toasts, shared widgets | `src/components/` |
| App state, backend API, Tauri wrappers, job lanes, dev mock | `src/lib/` (`app.svelte.js`, `api.js`, `tauri.js`, `mock.js`, `photojob.svelte.js`, `studio-jobs.svelte.js`, `projects.svelte.js`, …) |
| Subtitle engine (pure model, Maltese rules, ASS styles, preview, timeline, editor) | `src/subtitles/` |
| Post-maker logic (template format, fit/placement maths, canvas renderer) | `src/postmaker/` |
| Publish targets and their rules | `src/platforms.js` (backend counterpart: `ALLOWED_PLATFORMS` in `backend/api/schedule.js`) |
| Strings / Maltese error text | `src/strings.js` |
| Tokens, shared controls, legacy tool CSS | `src/styles/` |
| Native commands | `src-tauri/src/<feature>.rs`, registered in `lib.rs` (in-app updates: `source_update.rs`; its interface side `lib/updates.svelte.js` + pure `lib/updates.js`, the card in `views/Settings.svelte`, the script `scripts/update.mjs`) |
| Transcription / render / peaks / fireworks sidecar | `sidecar/` (`transcribe.py`, `subtitle_render.py`, `peaks.py`, `maltese.py`, `fireworks.py`, `fireworks_render.py`, `lut.py`), built by `transcribe-bundle.spec` |
| Serverless handlers (max 12 on Vercel Hobby) | `backend/api/*.js` — 10 today |
| Shared backend modules (not functions) | `backend/api/_lib/` |
| SQL | `backend/supabase/migrations/` (apply in date order) and `schema.sql` |
| Build, release, font and pack scripts | `scripts/` |

Module-by-module detail: README → Technical reference → Frontend modules / Native layer / Cloud API.

## Conventions

- **Tauri commands**: `#[tauri::command]` in a feature module, registered in `lib.rs`; return `Result<T, String>`;
  take `AppHandle` for logging/resources; `TxState` / `RenderState` for sidecar state; CPU-heavy work goes through
  `tauri::async_runtime::spawn_blocking`; small config/file commands may be synchronous. Bump `CORE_API`
  (`components.rs`) when a command changes shape. Events and the sidecar JSON protocol: README → Native layer.
- **Frontend**: Svelte 5 runes. Logic that can be pure lives in `.js` beside the view and has a `*.test.mjs`.
  Saved data is read through `ls.list()` / `ls.object()` (`lib/app.svelte.js`) so a wrong-shaped value cannot break
  start-up. Backend calls go through `api()` in `lib/api.js`; errors reach the user through `friendlyError()`.
- **Navigation**: the app starts on Home (`0`). Social: Skeda (with L-Arkivju and Rapporti as tabs inside, `SKEDA_PARTS`),
  Kalendarju, Xogħol (`1`–`3`); Studio: Video (Traskrittura | Murtali, one toolbar button, `VIDEO_PARTS`), Posts, Ritratti, YouTube (`⌘5`–`⌘8`). `app.tool` holds the screen actually open (`traskrittura` or `murtali`), never `video`; `openTool('video')` opens the part used last, `openTool('traskrittura')` always Traskrittura (`lib/video-parts.js`). `⌘K` go anywhere, `⌘,` Settings. Plain number keys
  are off inside Studio tools, while typing and with a modal open. Window default 1280×780, minimum 960×580.
- **Look**: theme follows the system; Traskrittura, Murtali and Posts can force dark in Settings → Appearance. Toasts bottom-centre
  (errors stay until dismissed). `Modal.svelte` owns focus trap/Esc/focus return; `confirm()` uses `ConfirmDialog.svelte`.
  Preset ids stay stable while labels change (Deheb / Pillola / Klassiku).
- **Backend**: handlers accept `Authorization: Bearer ${API_KEY}`; the cron accepts only `CRON_SECRET`. Handler factories (`createXHandler(client)`) exist so tests run against an in-memory database.
  Keep backend imports inside `backend/`; the desktop imports only `malta-time.js`, `task-rules.js`, `post-rules.js` and `event-rules.js`.
- **Money, dates**: Xogħol money is whole cents; dates are `YYYY-MM-DD` compared with Malta's date; Malta summer/winter
  boundaries matter (`malta-time.js`).
- **Docs and tests**: new behaviour gets a test and a README line; a deliberate trade-off gets a DECISIONS entry.

## Cards → Arkivju
`src-tauri/src/archive.rs` (scan + chunked resumable upload), `lib/archive.svelte.js` (watcher, review state, job queue in
`banditur_archive_jobs`), `lib/archive-job.js` (pure: items, event matching, safe-to-format), shared rules in
`backend/api/_lib/archive-rules.js`, Drive side `backend/api/_lib/archive.js` routed from `api/drive/[...slug].js`
(`POST archive/<op>`). The fingerprint must use `taken0` (the camera's time), never the corrected `taken`. Try it without a
card: `npm run dev` → `http://127.0.0.1:5173/?mock&card`.

## Gotchas

- A **function in `backend/api/`** outside an underscore folder counts toward Vercel's limit (12 on Hobby), with or
  without a default export. Consolidate routes before adding one; helpers go in `_lib/`.
- `COMMITTEE_PROFILES` is read only by `_lib/profiles.js`; the Graph API version is set only by `GRAPH` in `_lib/delivery.js`.
- An **unknown** delivery outcome is never reset or re-posted automatically; it needs the operator's acknowledgement
  after checking Meta.
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
- Xogħol and Kalendarju are local unless **sharing** is on (`lib/sharing.svelte.js`); then the same requests go to
  `/api/tasks` / `/api/events`. Undo-in-the-toast only works for local data; shared deletes ask first.
- The sidecar finds ffmpeg itself (`_find_ffmpeg()`: imageio-ffmpeg first) because app bundles launch with a minimal `PATH`.
- **Murtali** (`views/murtali/`, `src-tauri/src/fireworks.rs`, `sidecar/fireworks*.py`) detects from the audio only: Python measures, `segments.js` decides, so a slider re-segments instantly. The video is never re-encoded except in the two exports (own sound only, no music); one Murtali analysis or export at a time; it never starts the Whisper model. `aresample` after `loudnorm` fails in ffmpeg 4.4: pin the format with `aformat` instead. A project LUT (`.cube`) goes through `sidecar/lut.py` (copied to `lut.cube` in the work folder — never put a user path inside a filter graph) and is previewed by `views/murtali/LutPreview.svelte` (WebGL2); the `<video>` uses `crossorigin="anonymous"` for that and falls back without it.
- Missing model falls back to `mlx-community/whisper-large-v3-mlx`, which is the non-Maltese model.
- YouTube: `yt-dlp` is spawned directly with `--` before the URL; the app downloads its own `yt-dlp` and Deno on first use.
- `src-tauri/gen/schemas/` is generated and untracked; only macOS/Windows icons are kept.
- `_to_delete*/` and `.xfer*/` transfer leftovers are git-ignored; delete them rather than commit them.
- **In-app updates** (README → Updates on the shared Mac): git is `git pull --ff-only` only (never reset/stash/merge/push) and refuses when tracked files are modified or the branch diverged; the clone follows its branch's upstream and is found through `<components>/source.json` (written by `build:local`). Rust runs node tools through `/bin/zsh -lc` with the root in `BANDITUR_ROOT` (a Finder-launched app has a minimal PATH; never put paths in the shell string) and git as `/usr/bin/git` with `GIT_TERMINAL_PROMPT=0`. `.build-cache/update.lock` holds a pid (stale when dead), `update.log` is truncated per run, `update-result.json` is read once by the app and cleared. A core update quits the app and a detached helper (`--wait-pid`) finishes it, so keep `update.mjs` free of anything that needs the app. `CORE_API` is 5 (4: the `update_*` commands; 5: the fireworks commands).
- Do not imply production services or the installed app were updated because the source was edited; migrations,
  backend deployment and `npm run build:local` are separate steps (RELEASE.md).
- Current limitations (publishing cadence, unknown outcomes, local-only drafts, estimated SRT timings, report scope):
  README → Current limitations. Keep them explicit when describing behaviour.
