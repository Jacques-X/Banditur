# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Banditur** is an all-in-one social media management and post-production toolkit. It combines:

1. **Desktop application** (Tauri): Post-production tools for content creation
   - **Marka & Ssortja** — Watermark & Sort: Bulk-processes image folders, applies per-photographer watermark overlays, auto-detects EXIF orientation, sorts into portrait/landscape folders
   - **ARW → JPG** — RAW Conversion: Batch-converts RAW files by extracting embedded JPEG previews
   - **Traskrittura** — Video Transcription: Transcribes videos with word-level timestamps and inline video scrubbing

2. **Cloud backend** (Vercel): Social media scheduling and publishing
   - Schedule and publish posts to Facebook and Instagram
   - Multi-account/profile management for different organizations
   - Post history, archive, and analytics
   - Integration with Google Drive (browse media) and Google Calendar (view events)
   - Monthly PR performance reports
   - Post templates and draft management
   - Automatic retry for failed posts via cron jobs

The desktop app and cloud backend communicate via Supabase (Postgres database + storage) and HTTP calls to the Vercel backend API.

## Development Setup

### Install Dependencies
```bash
npm install
python3 -m venv venv
venv/bin/pip install -r sidecar/requirements.txt
```

Required system tools:
- Rust + Cargo (Tauri backend)
- Node.js + npm (Vite frontend)
- cmake (mozjpeg build requirement)
- ffmpeg (audio extraction for transcription)
- Python 3.10+ (transcription sidecar)

macOS (Homebrew):
```bash
brew install cmake ffmpeg
```

### Common Commands

| Command | Purpose |
|---------|---------|
| `npm run tauri dev` | Start dev server with hot reload |
| `npm run build` | Build frontend (Vite) |
| `npm run tauri build` | Full app build (produces `.app` or `.dmg`) |
| `npm run preview` | Preview production build locally |

## System Architecture

```
┌─────────────────────────────────────────┐
│     Tauri Desktop App                   │
│  (src/, src-tauri/src/)                 │
│                                         │
│  • Post-production (watermark, RAW, TX) │
│  • Post composer UI                     │
│  • Schedule posts → calls backend API   │
│  • View history ← polls backend API     │
│  • Browse Drive, Calendar ← backend API │
│  • Generate reports ← backend API       │
└──────────────┬──────────────────────────┘
               │
        ┌──────▼──────────┐
        │  Supabase       │
        │                 │
        │  • Postgres DB  │
        │  • Auth         │
        │  • Storage      │
        │  • Realtime     │
        └──────┬──────────┘
               │
    ┌──────────▼──────────────┐
    │  Vercel Serverless      │
    │  (backend/api/)         │
    │                         │
    │  • Schedule posts       │
    │  • Fetch history        │
    │  • Cron: publish posts  │
    │  • Google APIs proxy    │
    │  • Report generation    │
    └─────────────────────────┘
               │
    ┌──────────┴──────────────────────┐
    │                                  │
    ▼                                  ▼
 Facebook/Instagram         Google Drive/Calendar
 Graph API                   APIs
```

## Architecture Details

### Frontend (`src/`)
- **Vanilla JS + Vite**, no framework
- Single `main.js` with UI state and event handlers
- `styles.css` for styling
- `strings.js` for i18n/Maltese translations
- Communicates with Rust backend via Tauri commands and event listeners

### Backend (`src-tauri/src/lib.rs` — 777 lines)
- **Rust + Tauri 2**
- Core business logic:
  - `list_photographers()`: Enumerates watermark folders
  - `process_images()`: Watermark & sort images in parallel
  - `convert_raw_batch()`: Extract embedded JPEG previews from RAW files
  - `preload_transcribe()`: Warm the Python transcription model on tab open
  - `process_video()`: Transcribe video file (reuses warm sidecar or spawns new)
  - `save_srt()`: Write `.srt` file to disk
- Parallel processing via **Rayon** for images and RAW conversions
- Watermark scaling cached per (width, height) to avoid redundant resizing
- Event emission: `log`, `progress`, `done`, `raw-done`, `transcribe-update`
- All I/O operations run in `tauri::async_runtime::spawn_blocking()` to avoid blocking the UI thread

### Tauri Plugins
- `tauri_plugin_shell` — spawn Python sidecar process for transcription
- `tauri_plugin_dialog` — file/folder pickers
- `tauri_plugin_opener` — open output folder in Finder/Explorer

### Cloud Backend (`backend/` — Vercel Serverless Functions)

The `backend/` directory contains Node.js serverless functions deployed on Vercel. These handle all social media scheduling and publishing:

**Core API endpoints:**
- `api/schedule.js` — POST: Create a new scheduled post (saves to Supabase)
- `api/history.js` — GET: Fetch paginated post history (filterable by status, searchable by caption)
- `api/posts/[id].js` — DELETE: Remove pending posts; cleanup media from Supabase Storage
- `api/cron/process.js` — POST: Scheduled cron job (runs every minute) to publish due posts to FB/IG
- `api/profiles.js` — GET: List available committee profiles (returns id + name, never exposes tokens)
- `api/calendar/events.js` — GET: Fetch next 10 upcoming events from Google Calendar
- `api/drive/posters.js` — GET: List files in a Google Drive folder (with thumbnails)
- `api/reports/monthly.js` — POST: Generate monthly PDF report of PR metrics
- `api/retry.js` — POST: Manually retry a failed post

**Authentication:**
- All endpoints require `Authorization: Bearer ${API_KEY}` header
- Facebook/Instagram credentials stored in `COMMITTEE_PROFILES` env var (JSON array of committee accounts)
- Google service account credentials in `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS` env var

**Integrations:**
- **Supabase**: `scheduled_posts` table, media storage bucket
- **Facebook Graph API v25.0**: Posts, carousels, videos to Facebook pages
- **Instagram Graph API**: Media containers, publishing to Business Accounts
- **Google APIs**: Drive (read), Calendar (read)

**Data flow:**
1. Desktop app calls `POST /api/posts` to schedule a new post
2. Cron job (`/api/cron/process.js`) runs every minute, finds due posts
3. For each due post:
   - Resolves credentials from `COMMITTEE_PROFILES` by profile_id
   - Calls `fbPost()` or `igPublish()` depending on platforms array
   - For Instagram, polls container status (async processing)
   - Updates `scheduled_posts` status to `published` or `failed`
4. Desktop app fetches history via `GET /api/history` to show results

### Key Data Flows

#### Watermark & Sort
1. User picks input folder, photographer, quality, max dimension, watermark toggle
2. UI calls `process_images()` command
3. Rust backend:
   - Loads portrait/landscape watermarks for photographer (fails gracefully if missing)
   - Scans input directory for supported formats (JPG, PNG, TIFF, BMP, WebP)
   - Spawns blocking task with parallel iterator over files
   - For each file:
     - Decode (mozjpeg or image crate)
     - Read EXIF orientation; apply rotation in-memory (8 orientations handled)
     - Resize if max_dim specified (Triangle filter)
     - Detect portrait vs landscape by height > width
     - Fetch cached, pre-scaled watermark; composite onto image
     - Encode JPEG with mozjpeg at target quality
     - Save to `portrett/` or `pajsaġġ/` subfolder
     - Emit `log` event with filename and result
   - Emits `progress` event (fraction done) per file
4. Frontend updates progress bar and log viewer
5. Backend emits `done` event with summary (portrait count, landscape count, failed count, output path)
6. Frontend offers to open output folder

#### RAW Conversion
1. User picks input folder, quality, max dimension
2. UI calls `convert_raw_batch()` command
3. Rust backend:
   - Scans for RAW formats (ARW, CR2, CR3, NEF, ORF, RW2, DNG, RAF)
   - For each file:
     - Parses TIFF IFD (big-endian or little-endian) to find embedded JPEG
     - Validates JPEG is > 50KB (sufficient resolution)
     - Extracts raw bytes without transcoding
     - If extraction fails, falls back to binary scan (`0xFF 0xD8` marker) — slower but robust
     - Optionally resizes if max_dim specified
     - Saves as `.jpg` alongside original
     - Emits `log` event per file
4. Backend emits `raw-done` event with success/skipped counts and output path

#### Video Transcription
1. User opens Transcription tab → Rust backend calls `preload_transcribe()`
2. Sidecar spawned in **preload mode** (no video path as argument)
   - Python script: loads MLX Whisper model, emits `{"type": "ready"}`, waits on stdin for video path
   - Rust backend stores the sidecar's stdin channel in `TxState` for later reuse
3. User picks video file → UI calls `process_video(video_path)`
4. Rust backend:
   - Sends path to preloaded sidecar via its stdin channel, OR
   - If no preloaded sidecar, spawns fresh sidecar in **direct mode** (path as CLI arg)
5. Python sidecar:
   - Extracts audio (ffmpeg, 16kHz mono)
   - Transcribes with MLX Whisper (language: `WHISPER_LANG` env var, default: Maltese)
   - Emits JSON events: `status`, `progress`, `done` (with SRT path and word list)
   - Frontend listens to `transcribe-update` events
6. Frontend:
   - Displays transcript with timestamps and low-confidence words highlighted (red)
   - Inline editor: click timestamp to seek video preview to that moment
   - Cmd/Ctrl+S saves `.srt` file next to source video via `save_srt()` command

## Key Dependencies

### Rust (Tauri Backend)
| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2.x | Desktop app framework, IPC, event emission |
| `tauri-plugin-shell` | 2.x | Subprocess spawning (transcription sidecar) |
| `tauri-plugin-dialog` | 2.x | File/folder picker dialogs |
| `tauri-plugin-opener` | 2.x | Open folders in Finder/Explorer |
| `image` | — | Image format detection, pixel manipulation |
| `mozjpeg` | — | JPEG encoding/decoding with quality control |
| `kamadak-exif` | — | EXIF metadata parsing (orientation tag) |
| `rayon` | — | Data parallelism for file processing |
| `serde_json` | — | JSON serialization for events |
| `tokio` | — | Async runtime (selected via Tauri) |

### Python (Transcription Sidecar)
| Package | Purpose |
|---------|---------|
| `mlx-whisper>=0.4.0` | Whisper inference on Apple Silicon (MLX backend) |
| `pyannote.audio` (optional) | Speaker diarization; requires HuggingFace token |

### JavaScript/Frontend
| Package | Purpose |
|---------|---------|
| `vite` | Dev server and production bundler |
| `@tauri-apps/api` | Tauri command and event bindings |

## Configuration

### Build-Time Config
- `src-tauri/banditur-config.json`: Baked into binary at build time (never exposed to user)
- Loaded via `get_config()` command

### Watermarks
- Located at `src-tauri/watermarks/<photographer_name>/`
- Each folder contains `portrait.png` and `landscape.png`
- Full-resolution PNG overlays (design at target output resolution; watermark scales to each image)
- Bundled into app at build time

### Transcription
- `WHISPER_MODEL` env var (default: `medium`; options: `tiny`, `base`, `small`, `medium`, `large-v3`)
- Python venv **not bundled** — must exist at project root at runtime

## Build & Distribution

- `npm run tauri build` produces a signed `.dmg` (macOS) or `.exe`/.`.msi` (Windows)
- Watermarks folder is bundled into the app
- Transcription sidecar wrapper is bundled; Python venv must be present at runtime
- Tauri config: `src-tauri/tauri.conf.json`

## Testing & Debugging

- No test suite currently in place
- Development mode runs with console for debugging (`main.rs` prevents console window in release)
- Log events emitted from Rust backend are captured in frontend UI log viewer
- File I/O and external command failures are surfaced as `Err(String)` back to the UI

## Code Patterns

### Tauri Commands
All commands in `lib.rs` follow these conventions:
- Annotated with `#[tauri::command]` macro
- Accept `AppHandle` as first parameter (for logging, window access)
- Accept `tauri::State<'_, TxState>` for persistent state (transcription sidecar channel)
- Return `Result<T, String>` — errors are converted to JS exceptions
- CPU-intensive operations use `tauri::async_runtime::spawn_blocking()` to avoid blocking the UI
- Async commands marked with `async fn`

Example:
```rust
#[tauri::command]
async fn process_images(
    app: AppHandle,
    input_dir: String,
    output_dir: String,
    photographer: String,
    quality: u8,
    max_dim: u32,
    watermark: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_processing(app, input_dir, output_dir, photographer, quality, max_dim, watermark)
    })
    .await
    .map_err(|e| e.to_string())?
}
```

### Event Emission
- Backend emits events via `app.emit("event_name", payload)`
- Payloads are structs that derive `serde::Serialize`
- Frontend listens via Tauri's `listen()` API in `main.js`
- Common events:
  - `log(tag: String, msg: String)` — info, warn, error, ok, file tags
  - `progress(fraction: f64)` — 0 to 1 progress indicator
  - `done(portrett: u32, pajsagg: u32, imqabbla: u32, output_dir: String)` — watermark summary
  - `raw-done(converted: u32, skipped: u32, output_dir: String)` — RAW conversion summary
  - `transcribe-update(serde_json::Value)` — transcription events from sidecar

### JPEG Handling
- Decoding: mozjpeg via `mozjpeg::Decompress` (fast, handles corrupted JPEGs better than image crate)
- Other formats: image crate fallback
- Encoding: mozjpeg via `mozjpeg::Compress` with quality 60–95 (integer, not float; converted internally)

### EXIF Orientation
- Read via `kamadak-exif` from raw bytes
- Applied in-memory: 8 orientations (1=no-op, 2=fliph, 3=rotate180, 4=flipv, 5-8=rotate+flip combos)
- **Not reset in output** — EXIF tag remains unchanged; image bytes are rotated

### Watermark Caching
- Per-photographer portrait/landscape PNG loaded once at start
- Scaling cached in `HashMap<(width, height), Arc<RgbaImage>>` per orientation
- `Arc` allows safe sharing across Rayon parallel threads
- `RwLock` for concurrent read access during parallel processing

### RAW TIFF IFD Parsing
- Manual byte-level parsing to avoid external dependencies
- Supports both little-endian (Intel, `II`) and big-endian (Motorola, `MM`) byte order
- Recursively searches IFD chain for JPEG preview (tag 0x0201 = offset, 0x0202 = length)
- Recursively searches sub-IFDs (ExifIFD, SubIFD) via tags 0x014a (ExifOffset) and 0x8769 (ExifIFD)
- Falls back to binary scan if TIFF parsing fails: finds largest `0xFF 0xD8...0xFF 0xD9` JPEG in file

### Python Sidecar Protocol
Stdout is newline-delimited JSON. Each message must include `"type"` field:
```json
{"type": "status", "message": "Loading model..."}
{"type": "progress", "value": 45.5}
{"type": "ready"}
{"type": "done", "srt_path": "/path/to/file.srt", "all_words": [...]}
{"type": "error", "message": "..."}
```
- Preload mode emits `ready` to signal model is warm; Rust backend withholds from frontend
- Direct mode skips `ready` event entirely
- All messages flushed with `flush=True` to ensure real-time delivery

### File Path Resolution
- Input/output paths are `String` from JavaScript, converted to `PathBuf` in Rust
- Watermarks dir:
  - Debug: `${CARGO_MANIFEST_DIR}/watermarks` (source tree)
  - Release: `app.path().resource_dir().join("watermarks")` (bundled in app)
- Sidecar executable resolved via Tauri's `shell().sidecar("transcribe")` — bundled in app

## Known Quirks & Gotchas

### Image Processing
- Watermark caching is per-size, not per-image — two images of different dimensions get separate scaled watermarks
- Watermark compositing uses `image::imageops::overlay()` which treats watermark as an RGBA overlay; fully opaque white pixels may show as fully white on dark images
- EXIF orientation is applied in-memory but the EXIF tag itself is **not** reset in the output JPEG — image viewers that respect EXIF may rotate twice

### RAW Extraction
- Embedded JPEG extraction is fast but only extracts the preview-quality JPEG; it is **not** the full-resolution demosaiced image
- Binary fallback scan is slow and may pick up spurious JPEG data in metadata; it requires the found JPEG to be > 50KB to qualify
- Some newer RAW formats (e.g., Sony A1/A7RV ARW) may have different TIFF structures; fallback scan handles these but slowly

### Transcription
- Sidecar model loading is synchronous in Python; it blocks on first `preload_transcribe()` call
- Preload mode spawns sidecar at the start of the Transcription tab, but the model doesn't load until `preload_transcribe()` is called — tab opening **does not** trigger preload
- Language is set via `WHISPER_LANG` env var and baked in at sidecar start; switching languages requires restarting the sidecar
- MLX Whisper (Apple Silicon GPU) is significantly faster than the standard Whisper library but requires the custom `mlx-maltese-whisper-4bit` model
- Default model fallback is `mlx-community/whisper-large-v3-mlx` if local model not found (different than the pre-trained Maltese model)

### Parallel Processing
- Rayon's thread pool is shared across all bulk operations (watermarking, RAW conversion)
- Progress updates are emitted per-file after completion; atomic counters ensure thread-safe updates
- File order in output is **not** guaranteed to match input order due to parallelism

### App State
- `TxState` holds a single `Option<Sender<String>>` for the warm transcription sidecar
- If two transcription requests arrive simultaneously, the second one spawns a fresh sidecar; the first one has already consumed the warm one
- Only one warm sidecar persists between videos; subsequent videos (in the same session) reuse the same sidecar process
