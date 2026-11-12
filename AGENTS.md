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
| **RELEASE.md** | Release runbook: migrations, backend deployment, signed builds, updater, post-release checks |
| **DECISIONS.md** | Why deliberate choices were made. Keep history; mark superseded details |

If a change makes a statement in any of them wrong, fix it in the same change. If a change is a
deliberate trade-off, add a DECISIONS.md entry. Bundled third-party Markdown (`sidecar-dist/`, `venv/`)
is not project documentation. Do not add other Markdown files; `update.md`-style plans are temporary.

## What this is

**Banditur** — a Tauri 2 desktop app (Rust + Svelte 5) for post-production (watermarking, RAW → JPG,
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
| `npm run test:py` | `sidecar/test_maltese.py` + `test_passage.py` |
| `npm run build` | Vite build |
| `npm run check` | test + test:py + build |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Rust unit tests |
| `npm run build:local` | Build only changed pieces (interface, core, engine, model) and install on this Mac (`--dry-run`, `--force <pieces>`, `--yes`, `--no-app`, `--app <path>`) |
| `npm run build:transcribe` | Rebuild only the PyInstaller engine |
| `npm run release:app` / `publish:update` | Signed updater build / full release (dormant; see RELEASE.md) |
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
| Screens (one per tab / Studio tool) | `src/views/*.svelte`, helpers in a folder of the same name (`views/skeda/`, `views/xoghol/`, `views/posts/`, `views/marka/`, `views/traskrittura/`) |
| Toolbar, modal, toasts, shared widgets | `src/components/` |
| App state, backend API, Tauri wrappers, job lanes, dev mock | `src/lib/` (`app.svelte.js`, `api.js`, `tauri.js`, `mock.js`, `photojob.svelte.js`, `studio-jobs.svelte.js`, `projects.svelte.js`, …) |
| Subtitle engine (pure model, Maltese rules, ASS styles, preview, timeline, editor) | `src/subtitles/` |
| Post-maker logic (template format, fit/placement maths, canvas renderer) | `src/postmaker/` |
| Publish targets and their rules | `src/platforms.js` (backend counterpart: `ALLOWED_PLATFORMS` in `backend/api/schedule.js`) |
| Strings / Maltese error text | `src/strings.js` |
| Tokens, shared controls, legacy tool CSS | `src/styles/` |
| Native commands | `src-tauri/src/<feature>.rs`, registered in `lib.rs` |
| Transcription / render / peaks sidecar | `sidecar/` (`transcribe.py`, `subtitle_render.py`, `peaks.py`, `maltese.py`), built by `transcribe-bundle.spec` |
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
- **Navigation**: the app starts on Home (`0`). Social: Skeda, Kalendarju, L-Arkivju, Rapporti, Xogħol (`1`–`5`);
  Studio: Traskrittura, Posts, Marka, RAW, YouTube (`⌘5`–`⌘9`). `⌘K` archive search, `⌘,` Settings. Plain number keys
  are off inside Studio tools, while typing and with a modal open. Window default 1280×780, minimum 960×580.
- **Look**: theme follows the system; Traskrittura and Posts can force dark in Settings → Dehra. Toasts bottom-centre
  (errors stay until dismissed). `Modal.svelte` owns focus trap/Esc/focus return; `confirm()` uses `ConfirmDialog.svelte`.
  Preset ids stay stable while labels change (Deheb / Pillola / Klassiku).
- **Backend**: handlers accept `Authorization: Bearer ${API_KEY}`; the cron accepts only `CRON_SECRET`; the updater
  manifest is public. Handler factories (`createXHandler(client)`) exist so tests run against an in-memory database.
  Keep backend imports inside `backend/`; the desktop imports only `malta-time.js`, `task-rules.js` and `post-rules.js`.
- **Money, dates**: Xogħol money is whole cents; dates are `YYYY-MM-DD` compared with Malta's date; Malta summer/winter
  boundaries matter (`malta-time.js`).
- **Docs and tests**: new behaviour gets a test and a README line; a deliberate trade-off gets a DECISIONS entry.

## Gotchas

- A **function in `backend/api/`** outside an underscore folder counts toward Vercel's limit (12 on Hobby), with or
  without a default export. Consolidate routes before adding one; helpers go in `_lib/`.
- `COMMITTEE_PROFILES` is read only by `_lib/profiles.js`; the Graph API version is set only by `GRAPH` in `_lib/delivery.js`.
- An **unknown** delivery outcome is never reset or re-posted automatically; it needs the operator's acknowledgement
  after checking Meta.
- A fresh install has **no watermarks** until a pack is imported; Marka blocks a watermarked run until one is chosen.
  Packs must be 3:2 / 2:3: the overlay is stretched to each photo.
- Watermark compositing uses `imageops::overlay`: fully opaque white may show as pure white on dark photos.
- Output JPEGs are re-encoded by mozjpeg without EXIF; the RAW converter's no-resize path keeps the embedded preview's
  bytes and tags untouched.
- **PyInstaller must be `--onedir`**: `--onefile` extracts to `/tmp` and MLX cannot start Metal.
- Release engine bundles exclude `torch`, `scipy`, `hf_xet`, so the MASRI alignment pass runs only in dev
  (`timing_source: "whisper"` otherwise). The aligner and its model are non-commercial licensed.
- Each warm transcription sidecar handles **one** media file and exits; opening Traskrittura preloads the next.
  If the warm channel is closed, `process_video()` falls back to a fresh sidecar.
- The sidecar finds ffmpeg itself (`_find_ffmpeg()`: imageio-ffmpeg first) because app bundles launch with a minimal `PATH`.
- Missing model falls back to `mlx-community/whisper-large-v3-mlx`, which is the non-Maltese model.
- YouTube: `yt-dlp` is spawned directly with `--` before the URL; the app downloads its own `yt-dlp` and Deno on first use.
- `src-tauri/gen/schemas/` is generated and untracked; only macOS/Windows icons are kept.
- `_to_delete*/` and `.xfer*/` transfer leftovers are git-ignored; delete them rather than commit them.
- Do not imply production services or the installed app were updated because the source was edited; migrations,
  backend deployment and `npm run build:local` are separate steps (RELEASE.md).
- Current limitations (publishing cadence, unknown outcomes, local-only drafts, estimated SRT timings, report scope):
  README → Current limitations. Keep them explicit when describing behaviour.
