# Banditur

An all-in-one social media management and post-production toolkit for organizations. Built with [Tauri](https://tauri.app) (Rust backend + Vanilla JS frontend) and deployed on Vercel.

**Desktop tools** (post-production):
- **Marka & Ssortja** — Watermark photos and auto-sort into portrait/landscape folders
- **ARW → JPG** — Batch-convert RAW files (Sony ARW, Canon CR2/CR3, Nikon NEF, etc.) to JPEG
- **Traskrittura** — Transcribe videos with word-level timestamps and low-confidence word highlighting
- **YouTube Download** — Save a YouTube URL as MP4 (video) or MP3 (audio) with live progress

**Cloud platform** (social media scheduling):
- **Schedule & Publish** — Compose and schedule posts to Facebook, Instagram, and WordPress
- **Multi-Account** — Manage multiple organization profiles/committees
- **History & Archive** — Track all published, pending, and failed posts
- **Google Drive** — Browse and insert media from Drive folders
- **Google Calendar** — View upcoming events for context-aware posting
- **Monthly Reports** — Generate PR performance reports (reach, likes, followers, impressions)
- **Templates** — Pre-built post templates (condolences, announcements, etc.)
- **Drafts & Offline** — Save drafts offline, sync when connected

## Quick Start

### Prerequisites

- **macOS** (Intel or Apple Silicon)
- **Rust** + Cargo (Tauri backend)
- **Node.js 18+** + npm (Vite frontend)
- **Python 3.10+** (transcription sidecar)
- **yt-dlp** (YouTube download) — `brew install yt-dlp`
- **cmake** — `brew install cmake`
- **ffmpeg** — `brew install ffmpeg`

### Install & Run

```bash
# Install JavaScript dependencies
npm install

# Create Python virtual environment
python3 -m venv venv
venv/bin/pip install -r sidecar/requirements.txt

# Start development server with hot reload
npm run tauri dev
```

### Build Release

```bash
npm run tauri build
# Produces app artifacts under src-tauri/target/release/bundle/
```

For a signed updater-capable desktop release:

```bash
npm run release:app
```

## Architecture Overview

Banditur is split into two main components:

1. **Desktop App** (Tauri) — Post-production tools for content creation
2. **Cloud Backend** (Vercel) — Social media API for scheduling, publishing, and analytics

Both communicate via Supabase and the Vercel backend API.

## Features

### Desktop: Marka & Ssortja — Watermark & Sort

Bulk-process a folder of images (JPG, PNG, TIFF, BMP, WebP):

- **Per-photographer watermarks**: Applies `portrait.png` and `landscape.png` overlays from `src-tauri/watermarks/<name>/`
- **Auto-orientation**: Detects EXIF orientation and rotates before compositing
- **Smart sorting**: Outputs to `portrett/` (portrait) and `pajsaġġ/` (landscape) subfolders
- **Compression controls**: Quality (60–95%) and max dimension (1080–4096 px)
- **Parallel processing**: Powered by Rayon; real-time progress and per-file logs
- **Watermark caching**: Avoids redundant scaling when processing many images

### Desktop: ARW → JPG — RAW Conversion

Batch-converts RAW files and preserves quality:

- **Supported formats**: Sony ARW, Canon CR2/CR3, Nikon NEF, Olympus ORF, Panasonic RW2, DNG, Fujifilm RAF
- **Fast preview extraction**: Extracts embedded JPEG from RAW container (no demosaicing)
- **Fallback parsing**: Full binary scan if TIFF parsing fails
- **Batch processing**: Parallel conversion with compression options
- **Metadata-preserving**: Outputs JPEG alongside original RAW

### Desktop: Traskrittura — Video Transcription

Transcribe videos with precision and ease:

- **Supported formats**: MP4, MOV, MP3, WAV
- **Word-level timestamps**: Click any timestamp to jump to that moment
- **Confidence highlighting**: Low-confidence words shown in red
- **Model preloading**: Whisper model warms in the background when tab opens
- **Inline editing**: Edit transcript directly; save as `.srt` with Cmd/Ctrl+S
- **Apple Silicon optimized**: Uses MLX Whisper for GPU acceleration on M1/M2/M3
- **Language support**: Maltese by default; configurable via `WHISPER_LANG` environment variable

### Desktop: YouTube Download

Download media from a YouTube URL into a chosen folder:

- **Two formats**: MP4 (best video+audio, remuxed to mp4) or MP3 (extracted audio at 192 kbps)
- **Live progress**: Real-time download percentage and a conversion/merge indicator
- **Powered by `yt-dlp`**: Resolved from `PATH` or common install locations; `ffmpeg` used for extraction/merge
- **Input validation**: Accepts only http(s) YouTube links into an existing output folder

### Cloud: Schedule & Publish

Compose posts in the desktop app and schedule them to Facebook, Instagram, and WordPress:

- **Multi-platform posting**: Publish to Facebook, Instagram, and/or WordPress simultaneously
- **Media handling**: Support for single photos, carousels (multiple images), and videos
- **Scheduled publishing**: Queue posts for specific dates/times
- **Content types**: Regular posts, reels, carousel posts with captions
- **Organization profiles**: Manage multiple committee/organization accounts
- **Automatic retry**: Failed posts are queued for retry via scheduled cron jobs

### Cloud: History & Archive

Track all social media activity and performance:

- **Post history**: View all published posts with timestamps and platform info
- **Pending queue**: Monitor posts awaiting publication
- **Failed posts**: Identify and retry failed postings with error details
- **Filter & search**: Filter by status (pending, published, failed) and search captions
- **Pagination**: Browse large post archives efficiently

### Cloud: Google Drive Integration

Browse and use media from shared Drive folders:

- **Folder browsing**: Navigate Drive folders to discover poster designs and media
- **Thumbnail preview**: Quick visual preview of images before inserting
- **Direct URL insertion**: Media URLs fetched from Drive and embedded in posts
- **Requires configuration**: Drive folder ID and Google service account credentials

### Cloud: Google Calendar Integration

Manage the shared Google Calendar from Banditur without mixing it with scheduled posts:

- **Full calendar views**: Month, week, day, and agenda views via FullCalendar
- **Two-way editing**: Create, edit, drag, resize, and delete single Google Calendar events
- **Colour labels**: Per-event labels stored in Google Calendar private extended properties, with local show/hide toggles
- **Recurring safety**: Repeating-event instances are shown, but writes are blocked and users are pointed to Google Calendar
- **Requires configuration**: Google Calendar ID and a service account with write access to that calendar

### Cloud: Monthly Reports

Generate PDF reports of PR activity and social metrics:

- **Metrics tracked**: Total posts published, pending, failed, likes, comments
- **Reach & followers**: Facebook and Instagram follower counts and page impressions
- **Post list**: Full list of published posts for the period
- **PDF export**: Download as formatted PDF for stakeholder sharing
- **Date range selection**: Report for any custom month or period

### Cloud: Templates & Drafts

Accelerate post composition with reusable templates:

- **Built-in templates**: Pre-written templates for common posts (condolences, announcements, etc.)
- **Custom templates**: Save your own post templates for reuse
- **Draft management**: Auto-save drafts locally; sync when connection available
- **Offline support**: Compose and save posts without internet; upload when reconnected

## Adding Photographer Watermarks

Create a folder under `src-tauri/watermarks/` with the photographer's name:

```
src-tauri/watermarks/
└── Maria Borg/
    ├── portrait.png   ← 9:16 or taller aspect ratio
    └── landscape.png  ← 16:9 or wider aspect ratio
```

Watermarks are PNG images with transparency. Design them at your target output resolution; the app scales them to match each image before compositing.

## Configuration

### Environment Variables

| Variable | Default | Options | Purpose |
|----------|---------|---------|---------|
| `WHISPER_LANG` | `mt` | `en`, `fr`, `es`, `mt`, etc. | Transcription language code |
| `MLX_MODEL_PATH` | — | Path or HF repo | Custom Whisper model location (overrides default) |

Example:
```bash
WHISPER_LANG=en npm run tauri dev
```

### Transcription Models

By default, uses a pre-trained **Maltese-optimized MLX Whisper model** located at `mlx-maltese-whisper-4bit/` (bundled in release builds).

To use a different model, set `MLX_MODEL_PATH`:
```bash
MLX_MODEL_PATH=mlx-community/whisper-large-v3-mlx npm run tauri dev
```

### Secrets & Sensitive Config

The file `src-tauri/banditur-config.json` is baked into the binary at build time and is returned to the local renderer so the desktop app can call the configured backend. Keep it local and do not commit it.

Updater signing files are stored outside the repo and must be backed up securely:

```text
~/.tauri/banditur-updater.key
~/.tauri/banditur-updater.key.password
```

## Architecture Overview

```
┌─────────────────────────────────┐
│   Tauri Desktop App             │
│  (Rust + Vanilla JS + Vite)     │
│                                 │
│  • Watermarking                 │
│  • RAW conversion               │
│  • Transcription                │
│  • YouTube download             │
│  • Post composer UI             │
│                                 │
│  Communicates via:              │
│  - Tauri commands (IPC)         │
│  - Tauri events (real-time)     │
│  - HTTP to backend API          │
└──────────────┬──────────────────┘
               │
        ┌──────▼──────────┐
        │  Supabase       │
        │  • Auth         │
        │  • DB           │
        │  • Storage      │
        └──────┬──────────┘
               │
┌──────────────▼──────────────────┐
│  Vercel Serverless Backend      │
│  (Node.js / JavaScript)         │
│                                 │
│  • Schedule posts to FB/IG      │
│  • Cron: Process scheduled posts│
│  • History & archive API        │
│  • Google Drive API client      │
│  • Google Calendar API client   │
│  • Reports generation           │
│  • Multi-profile management     │
└─────────────────────────────────┘
```

### Desktop Layer: Tauri (Rust + Vanilla JS)

- **Frontend** (`src/main.js`): Single HTML/CSS/JS UI with all features
- **Backend** (`src-tauri/src/lib.rs`): Rust business logic
  - Image processing pipeline (EXIF, watermarking, JPEG compression)
  - RAW file parsing and JPEG extraction
  - Transcription sidecar spawning and event management
  - YouTube download via `yt-dlp` (`ytmp3.rs`)
  - HTTP calls to Vercel backend for scheduling
- **Python Sidecars**:
  - `sidecar/transcribe.py`: MLX Whisper wrapper (the only Python sidecar)

### Cloud Layer: Vercel Backend (Node.js)

- **Serverless functions** in `backend/api/` (9 functions; utility endpoints are consolidated)
  - `schedule.js` — Create new scheduled posts
  - `history.js` — Fetch post history (paginated, filterable)
  - `posts/[id].js` — POST: retry a failed post; DELETE: remove a pending post + media
  - `cron/process.js` — Cron job: publish due posts to FB/IG (see scheduling note below)
  - `calendar.js` — Google Calendar CRUD: range reads plus create/update/move/resize/delete for single events
  - `meta.js` — Consolidated utility endpoint: `?type=version|profiles|calendar|live-posts` (GET) and `{action:'cleanup'}` (POST); `?type=calendar` is legacy read-only compatibility
  - `drive/[...slug].js` — Google Drive proxy: `posters` (list folder) and `file/:id` (stream file)
  - `reports/monthly.js` — Monthly PR metrics report data
  - `updates/[target]/[arch]/[current_version].js` — Tauri updater manifest
  - `cors.js`, `auth.js` — shared helpers (no default export, not counted as functions)

> **Scheduling note:** `backend/vercel.json` runs the cron **once daily** (`0 0 * * *`) — the Vercel Hobby ceiling. Facebook posts within 30 days are handed to FB's native scheduler; for on-time Instagram/WordPress publishing, trigger `/api/cron/process` externally every minute with `CRON_SECRET`.

- **Integrations**:
  - **Supabase**: Postgres database + storage for media
  - **Facebook Graph API**: Publish posts, handle carousels and videos
  - **Instagram Graph API**: Publish via Business Account
  - **Google APIs**: Drive (read files), Calendar (read/write events)

### Transcription Sidecar
- **Python script** (`sidecar/transcribe.py`)
- Wraps MLX Whisper with word-level timestamp support
- Runs as a subprocess; communicates via JSON over stdout
- **Preload mode**: Model loads once per session when tab opens; subsequent videos reuse the warm process
- **Direct mode**: Spawns fresh sidecar if preload unavailable

### Image Processing Pipeline

1. Load photographer's watermarks (portrait/landscape variants)
2. Scan input folder for supported image formats
3. For each image in parallel:
   - Decode JPEG/PNG/TIFF/etc. (mozjpeg for JPEG speed)
   - Read EXIF orientation and apply rotation
   - Resize if max dimension specified
   - Detect portrait vs landscape and load matching watermark
   - Scale watermark to image dimensions (cached per size)
   - Composite watermark onto image
   - Encode JPEG with mozjpeg at target quality
   - Save to `portrett/` or `pajsaġġ/` subfolder
4. Emit real-time progress and per-file logs
5. Summary report with file counts and output path

### RAW Extraction Pipeline

1. Parse TIFF IFD (Image File Directory) structure
2. Recursively search for embedded JPEG preview (tag 0x0201/0x0202)
3. If TIFF parsing fails, fall back to binary scan for JPEG markers
4. Extract raw JPEG bytes (> 50KB minimum)
5. Optionally resize if max dimension specified
6. Save as `.jpg` alongside original

### YouTube Download Pipeline

1. User enters a YouTube URL, picks an output folder, and chooses MP4 or MP3
2. Frontend calls `yt_download(url, output_dir, format)`
3. Rust (`ytmp3.rs`) resolves `yt-dlp`/`ffmpeg`, validates the URL and folder, and spawns `yt-dlp` with a `--` argument guard
4. stdout is parsed for `[download] NN%` progress and conversion/merge markers, emitted as `yt-update` events
5. On completion the frontend offers to open the downloaded file

## Troubleshooting

### Watermarks not found
Ensure photographer folders exist under `src-tauri/watermarks/` with exact names (case-sensitive). Both `portrait.png` and `landscape.png` must be present.

### RAW conversion produces no output
- Check that RAW file contains an embedded JPEG preview > 50KB
- Some newer RAW formats require fallback binary scanning (slower but supported)

### Transcription errors
- Ensure `ffmpeg` is installed: `brew install ffmpeg`
- Check Python environment: `venv/bin/python -c "import mlx_whisper; print(mlx_whisper.__version__)"`
- Verify video format is MP4 or MOV

### YouTube download errors
- Ensure `yt-dlp` is installed: `brew install yt-dlp`
- Ensure `ffmpeg` is installed (used for MP3 extraction / MP4 merge): `brew install ffmpeg`
- The URL must be an http(s) YouTube link and the output folder must already exist

### Performance issues
- Image processing uses all CPU cores via Rayon — performance scales with core count
- Transcription on Apple Silicon is ~2–3× faster than Intel via MLX GPU acceleration
- Watermark scaling is cached per-size; large batches of identically-sized images are optimized

## Development

### Release & Update Flow

Banditur supports two update paths:

1. **Backend-only updates** — commit and push backend changes; Vercel deploys from Git.
2. **Desktop app updates** — build signed updater artifacts, publish them to GitHub Releases, and point Vercel updater environment variables at the artifact.

Before deploying backend code that depends on schema changes, run the matching Supabase migration first. The current release foundation migration is:

```text
backend/supabase/migrations/20260528_release_update_foundation.sql
```

Every desktop app release should:

Use the helper script for the normal path:

```bash
npm run publish:update -- 1.0.1 "Describe what changed." --commit --push --vercel
```

Without `--vercel`, the script prints the Vercel env vars to set manually.

If no desktop update is live yet, or the updater shows a metadata error such as an invalid `pub_date`, clear the updater env vars from Vercel and redeploy:

```bash
cd backend
vercel env rm UPDATE_VERSION production
vercel env rm UPDATE_URL production
vercel env rm UPDATE_SIGNATURE production
vercel env rm UPDATE_URL_DARWIN_AARCH64 production
vercel env rm UPDATE_SIGNATURE_DARWIN_AARCH64 production
vercel env rm UPDATE_URL_WINDOWS_X86_64 production
vercel env rm UPDATE_SIGNATURE_WINDOWS_X86_64 production
vercel env rm UPDATE_NOTES production
vercel env rm UPDATE_PUB_DATE production
vercel --prod
```

Manual desktop app releases should:

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
2. Commit and push the source changes.
3. Build signed artifacts:

   ```bash
   npm run release:app
   ```

   On macOS, the updater files should include:

   ```text
   src-tauri/target/release/bundle/macos/Banditur.app.tar.gz
   src-tauri/target/release/bundle/macos/Banditur.app.tar.gz.sig
   ```

4. Create a GitHub Release with the updater artifact and matching `.sig`.
5. Update Vercel environment variables:

   ```text
   UPDATE_VERSION
   UPDATE_URL_DARWIN_AARCH64
   UPDATE_SIGNATURE_DARWIN_AARCH64
   UPDATE_URL_WINDOWS_X86_64
   UPDATE_SIGNATURE_WINDOWS_X86_64
   UPDATE_NOTES
   UPDATE_PUB_DATE
   MIN_DESKTOP_VERSION
   BACKEND_VERSION
   ```

   Keep updater asset URLs/signatures platform-specific so Windows builds are not pointed at macOS artifacts. GitHub Releases can contain all platform artifacts under the same tag; Vercel selects the correct one through `/api/updates/{{target}}/{{arch}}/{{current_version}}`.

Installed apps check for updates from Settings via **Iċċekkja**.

### Project Structure

```
.
├── src/                          # JavaScript/frontend
│   ├── main.js
│   ├── styles.css
│   └── strings.js                # Maltese translations
├── src-tauri/                    # Rust/backend
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # Tauri setup and command registration
│   │   ├── image_processor.rs    # Watermark & sort
│   │   ├── jpeg.rs               # mozjpeg encode/decode helpers
│   │   ├── raw_converter.rs      # RAW preview extraction
│   │   ├── transcription.rs      # Transcription sidecar bridge
│   │   └── ytmp3.rs              # YouTube download via yt-dlp
│   ├── watermarks/               # Photographer overlays
│   ├── tauri.conf.json           # Tauri configuration
│   └── Cargo.toml
├── sidecar/                      # Python sidecar
│   ├── transcribe.py
│   └── requirements.txt
├── venv/                         # Python virtual environment (gitignored)
├── backend/                      # Vercel social media scheduler/API
├── scripts/                      # Release helper scripts
├── RELEASE.md                    # Local ignored release notes/runbook
└── vite.config.js
```

### Key Files

- `README.md` — Canonical tracked documentation
- `src-tauri/src/lib.rs` — Tauri setup and command registration
- `src-tauri/src/image_processor.rs` — Watermarking/sorting pipeline
- `src-tauri/src/raw_converter.rs` — RAW preview extraction
- `src-tauri/src/transcription.rs` — Transcription sidecar management
- `src-tauri/src/ytmp3.rs` — YouTube download via yt-dlp
- `sidecar/transcribe.py` — Whisper wrapper with JSON protocol
- `backend/api/cron/process.js` — Publishing cron and stale media cleanup
- `backend/supabase/schema.sql` — Current Supabase schema/policies/RPC
- `backend/supabase/migrations/` — SQL migrations to apply before dependent backend deploys
- `.gitignore` — Covers build artifacts, secrets, release artifacts, and non-README Markdown docs

### Testing

No test suite currently in place. Manual testing via:
```bash
npm run tauri dev
```

### Common Tasks

**Add a new command to the Tauri backend:**
1. Define the command in `src-tauri/src/lib.rs` as an async function with `#[tauri::command]`
2. Register it in the `invoke_handler!` macro at the bottom of `lib.rs`
3. Call it from `main.js` via the imported `invoke('command_name', { ...args })` (`@tauri-apps/api/core`)

**Change transcription language:**
```bash
WHISPER_LANG=en npm run tauri dev
```

**Rebuild with clean artifacts:**
```bash
rm -rf src-tauri/target dist node_modules
npm install
npm run tauri build
```

## Tech Stack

### Desktop (Tauri)
| Layer | Technology |
|-------|-----------|
| **App Framework** | Tauri 2 (Rust + Vite) |
| **Frontend** | Vanilla JavaScript + CSS (no framework) |
| **Build** | Vite |
| **Desktop Plugins** | shell, dialog, opener, updater |
| **Image Processing** | `image` crate, mozjpeg, kamadak-exif |
| **RAW Parsing** | Custom TIFF IFD parser (manual byte-level) |
| **Parallel Processing** | Rayon |
| **Transcription** | MLX Whisper (Apple Silicon GPU) via Python sidecar |
| **YouTube Download** | `yt-dlp` + `ffmpeg` (resolved at runtime) |

### Cloud (Vercel Backend)
| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 18+ |
| **Database** | Supabase (Postgres) |
| **Storage** | Supabase Storage |
| **API Integrations** | Facebook Graph API v25.0, Instagram Graph API, Google APIs (Drive read, Calendar read/write) |
| **PDF Generation** | (via Node.js) |
| **Authentication** | Service account (Google) + API key (internal) |
| **Deployment** | Vercel Serverless Functions |
| **Updates** | Tauri updater + GitHub Releases + Vercel update manifest endpoint |

### Database Schema
- `scheduled_posts` — Queue of posts pending publication
- `media` — Supabase Storage bucket for uploaded images/videos
- `claim_scheduled_post(...)` — RPC used by cron for `FOR UPDATE SKIP LOCKED` row claiming

### Package Managers
| Platform | Manager |
|----------|---------|
| **JavaScript** | npm |
| **Rust** | Cargo |
| **Python** | pip (venv)

## License

See LICENSE file (if present).
