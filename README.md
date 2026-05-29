# Banditur

An all-in-one social media management and post-production toolkit for organizations. Built with [Tauri](https://tauri.app) (Rust backend + Vanilla JS frontend) and deployed on Vercel.

**Desktop tools** (post-production):
- **Marka & Ssortja** — Watermark photos and auto-sort into portrait/landscape folders
- **ARW → JPG** — Batch-convert RAW files (Sony ARW, Canon CR2/CR3, Nikon NEF, etc.) to JPEG
- **Traskrittura** — Transcribe videos with word-level timestamps and low-confidence word highlighting
- **Beat Sync** — Detect audio beats and generate DaVinci Resolve `.fcpxml` timelines from image folders

**Cloud platform** (social media scheduling):
- **Schedule & Publish** — Compose and schedule posts to Facebook and Instagram
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
- **Python 3.10+** (transcription and beat-sync sidecars)
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

- **Supported formats**: MP4, MOV
- **Word-level timestamps**: Click any timestamp to jump to that moment
- **Confidence highlighting**: Low-confidence words shown in red
- **Model preloading**: Whisper model warms in the background when tab opens
- **Inline editing**: Edit transcript directly; save as `.srt` with Cmd/Ctrl+S
- **Apple Silicon optimized**: Uses MLX Whisper for GPU acceleration on M1/M2/M3
- **Language support**: Maltese by default; configurable via `WHISPER_LANG` environment variable

### Desktop: Beat Sync — Resolve Timeline Generator

Generate a DaVinci Resolve-importable FCPXML timeline from an audio track and an image folder:

- **Audio onset detection**: Uses `librosa` to find beats/transients and convert them to exact video frames
- **Image sequencing**: Sorts supported images by filename and places them on the timeline between detected cuts
- **Resolve workflow**: Exports `.fcpxml` for **File > Import > Timeline...** in DaVinci Resolve
- **Timing controls**: FPS, sensitivity, minimum frames per clip, and image looping
- **Source references**: The FCPXML references the original audio and image paths on disk, so keep media in place until imported

### Cloud: Schedule & Publish

Compose posts in the desktop app and schedule them to Facebook and Instagram:

- **Multi-platform posting**: Publish to Facebook, Instagram, or both simultaneously
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

View upcoming events alongside post scheduling:

- **Event listing**: Display next 10 upcoming calendar events
- **Event details**: Show summary, description, location, and event links
- **Context-aware posting**: Reference events when composing captions
- **Requires configuration**: Google Calendar ID and service account credentials

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
│  • Beat-sync FCPXML export      │
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
  - Beat Sync sidecar spawning and FCPXML export
  - HTTP calls to Vercel backend for scheduling
- **Python Sidecars**:
  - `sidecar/transcribe.py`: MLX Whisper wrapper
  - `sidecar/beat_sync.py`: librosa onset detection and FCPXML generation

### Cloud Layer: Vercel Backend (Node.js)

- **Serverless functions** in `backend/api/`
  - `schedule.js` — Create new scheduled posts
  - `history.js` — Fetch post history (paginated, filterable)
  - `posts/[id].js` — Update/delete posts
  - `cron/process.js` — Scheduled job: publish pending posts to FB/IG
  - `profiles.js` — List committee profiles
  - `calendar/events.js` — Fetch upcoming Google Calendar events
  - `drive/posters.js` — List files in Google Drive folder
  - `media/cleanup.js` — Remove uploaded media that should not be kept
  - `reports/monthly.js` — Generate PDF performance reports
  - `retry.js` — Retry failed posts
  - `updates/[target]/[arch]/[current_version].js` — Tauri updater manifest
  - `version.js` — Backend/app compatibility metadata

- **Integrations**:
  - **Supabase**: Postgres database + storage for media
  - **Facebook Graph API**: Publish posts, handle carousels and videos
  - **Instagram Graph API**: Publish via Business Account
  - **Google APIs**: Drive (read files), Calendar (read events)

### Transcription Sidecar
- **Python script** (`sidecar/transcribe.py`)
- Wraps MLX Whisper with word-level timestamp support
- Runs as a subprocess; communicates via JSON over stdout
- **Preload mode**: Model loads once per session when tab opens; subsequent videos reuse the warm process
- **Direct mode**: Spawns fresh sidecar if preload unavailable

### Beat Sync Sidecar
- **Python script** (`sidecar/beat_sync.py`)
- Uses `librosa` to load the selected audio file and detect onset times
- Converts detected onset times to frame numbers using the selected FPS
- Writes FCPXML with an audio asset and image `asset-clip` entries on lane 1
- Runs through the Tauri shell sidecar named `beat-sync`

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

### Beat Sync Pipeline

1. User selects an audio file, image folder, output `.fcpxml`, FPS, sensitivity, minimum clip length, and image-looping option
2. Frontend calls `generate_beat_sync_timeline`
3. Rust validates paths and starts the `beat-sync` Python sidecar
4. Python detects audio onsets with `librosa`, filters cuts by minimum frame gap, and writes FCPXML
5. Rust emits `beat-sync-done`; the frontend enables **Iftaħ ir-Riżultat**

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

### Beat Sync errors
- Install sidecar dependencies: `venv/bin/pip install -r sidecar/requirements.txt`
- Check Python environment: `venv/bin/python -c "import librosa; print(librosa.__version__)"`
- Use supported audio formats: MP3, WAV, AIFF, M4A, or FLAC
- Use a folder containing supported image formats: JPG, PNG, TIFF, BMP, or WebP
- Keep the source audio/images in place when importing the generated FCPXML into Resolve

### Performance issues
- Image processing uses all CPU cores via Rayon — performance scales with core count
- Transcription on Apple Silicon is ~2–3× faster than Intel via MLX GPU acceleration
- Watermark scaling is cached per-size; large batches of identically-sized images are optimized
- Beat Sync performance is mostly audio-analysis bound; long audio tracks may take a few seconds on first run while Python imports `librosa`

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
   UPDATE_URL
   UPDATE_SIGNATURE
   UPDATE_NOTES
   UPDATE_PUB_DATE
   MIN_DESKTOP_VERSION
   BACKEND_VERSION
   ```

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
│   │   ├── beat_sync.rs          # Beat Sync sidecar bridge
│   │   ├── image_processor.rs    # Watermark & sort
│   │   ├── raw_converter.rs      # RAW preview extraction
│   │   └── transcription.rs      # Transcription sidecar bridge
│   ├── watermarks/               # Photographer overlays
│   ├── tauri.conf.json           # Tauri configuration
│   └── Cargo.toml
├── sidecar/                      # Python sidecars
│   ├── beat_sync.py
│   ├── transcribe.py
│   ├── requirements.txt
│   └── venv/                     # Python virtual environment
├── backend/                      # Vercel social media scheduler/API
├── scripts/                      # Release helper scripts
├── UPDATE.md                     # Local ignored update runbook
├── RELEASE.md                    # Local ignored release notes/runbook
└── vite.config.js
```

### Key Files

- `README.md` — Canonical tracked documentation
- `src-tauri/src/lib.rs` — Tauri setup and command registration
- `src-tauri/src/beat_sync.rs` — Beat Sync sidecar management
- `src-tauri/src/image_processor.rs` — Watermarking/sorting pipeline
- `src-tauri/src/raw_converter.rs` — RAW preview extraction
- `src-tauri/src/transcription.rs` — Transcription sidecar management
- `sidecar/beat_sync.py` — librosa onset detection and FCPXML writer
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
3. Call it from `main.js` via `window.__TAURI__.invoke("command_name", { ...args })`

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
| **Desktop Plugins** | shell, dialog, opener, updater, process |
| **Image Processing** | `image` crate, mozjpeg, kamadak-exif |
| **RAW Parsing** | Custom TIFF IFD parser (manual byte-level) |
| **Parallel Processing** | Rayon |
| **Transcription** | MLX Whisper (Apple Silicon GPU) via Python sidecar |
| **Beat Sync** | librosa onset detection + FCPXML via Python sidecar |

### Cloud (Vercel Backend)
| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 18+ |
| **Database** | Supabase (Postgres) |
| **Storage** | Supabase Storage |
| **API Integrations** | Facebook Graph API v25.0, Instagram Graph API, Google APIs (Drive, Calendar) |
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
