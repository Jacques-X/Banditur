# Banditur

An all-in-one social media management and post-production toolkit for organizations. Built with [Tauri](https://tauri.app) (Rust backend + Svelte 5 frontend) and deployed on Vercel.

**Desktop tools** (post-production):
- **Marka & Ssortja** — Watermark photos in one ordered output folder
- **ARW → JPG** — Batch-convert RAW files (Sony ARW, Canon CR2/CR3, Nikon NEF, etc.) to JPEG
- **Traskrittura** — Transcribe videos, edit them as subtitles, style and animate them, and export SRT / ASS / MP4 / transparent MOV
- **YouTube Download** — Save a YouTube URL as MP4 (video) or MP3 (audio) with live progress
- **Posts** — Make repetitive posts (Awguri, Kondoljanzi…) from a template: portrait + overlay + a name, exported as a 4:5 JPG or sent straight to Skeda

**Cloud platform** (social media scheduling):
- **Schedule & Publish** — Compose and schedule posts to Facebook and Instagram (TikTok and a website/app backend are planned: placeholders in `src/platforms.js`)
- **Multi-Account** — Manage multiple organization profiles/committees
- **History & Archive** — Track all published, pending, and failed posts
- **Google Drive** — Browse and insert media from Drive folders
- **Google Calendar** — Plan events, and see the day's scheduled posts next to them (read-only)
- **Monthly Reports** — Generate PR performance reports (reach, likes, followers, impressions)
- **Templates** — Pre-built post templates (condolences, announcements, etc.)
- **Drafts & Offline** — Save drafts with their photos and videos, offline too; reopen them later

## Quick Start

### Prerequisites

- **macOS** (Intel or Apple Silicon)
- **Rust** + Cargo (Tauri backend)
- **Node.js 18+** + npm (Vite frontend)
- **Python 3.10+** (transcription sidecar)
- **yt-dlp** (YouTube download) — `brew install yt-dlp` (or `python3 -m pip install -U yt-dlp`)
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

This also rebuilds the transcription sidecar (`npm run build:desktop` → `scripts/build-transcribe-sidecar.sh`),
which needs PyInstaller in the venv: `venv/bin/pip install pyinstaller`.

For a signed updater-capable desktop release:

```bash
npm run release:app
```

## Components

Banditur is split into two main components:

1. **Desktop App** (Tauri) — Post-production tools for content creation
2. **Cloud Backend** (Vercel) — Social media API for scheduling, publishing, and analytics

Both communicate via Supabase and the Vercel backend API.

## Features

### Desktop: Marka & Ssortja — Watermark

Bulk-process a folder of images (JPG, PNG, TIFF, BMP, WebP):

- **Per-photographer watermarks**: Applies `portrait.png` and `landscape.png` overlays from installed **watermark packs** (not bundled with the app — add/remove them at runtime, see below)
- **Auto-orientation**: Detects EXIF orientation and rotates before compositing
- **Single ordered output**: Keeps all processed photos in the chosen output folder, in filename order
- **Safe duplicate names**: Adds a numeric suffix instead of overwriting when two photos would produce the same JPEG filename
- **Compression controls**: Quality (60–95%) and max dimension (1080–4096 px)
- **Sequential processing**: Stable progress and per-file logs in filename order
- **Watermark caching**: Avoids redundant scaling when processing many images

### Desktop: ARW → JPG — RAW Conversion

Batch-converts RAW files and preserves quality:

- **Supported formats**: Sony ARW, Canon CR2/CR3, Nikon NEF, Olympus ORF, Panasonic RW2, DNG, Fujifilm RAF
- **Fast preview extraction**: Extracts embedded JPEG from RAW container (no demosaicing)
- **Fallback parsing**: Full binary scan if TIFF parsing fails
- **Batch processing**: Parallel conversion with compression options
- **Output folder**: Writes `<name>.jpg` files to the chosen output folder (defaults to a sibling `<input-folder>-riżultat` folder); RAW originals are left untouched

### Desktop: Traskrittura — Video Transcription

Transcribe videos with precision and ease:

- **Supported formats**: MP4, MOV, MP3, WAV
- **Word-level timestamps**: Click any timestamp to jump to that moment
- **Precise Maltese timing**: Refines Whisper's word estimates locally with a MASRI Wav2Vec2 CTC alignment pass (dev builds only — see Transcription Models)
- **Confidence highlighting**: Low-confidence words shown in red
- **Model preloading**: Whisper model warms in the background when tab opens
- **Subtitle editor**: Laptop-friendly layout — video, one-line subtitle list and a timeline with the audio waveform.
  Drag subtitle edges on the timeline to change timing (snaps to words), or use the keys: split (B), join (J),
  trim to the playhead (I / O), roll the cut (Q / W), move a word to the next/previous subtitle (1 / 2, or drag it),
  keyword (K), big line (P: a large, slanted, upper-case caption in the middle of the frame), next unsure word (U), next hard-to-read subtitle (E). To retime one word's highlight, drag its handle on the timeline (select the caption first) or press `[` / `]` to nudge it 50 ms (`{` / `}` for 10 ms). Every edit is undoable and the toast says what was
  undone; buttons explain why when an action can't be done. `?` shows all shortcuts
- **Maltese articles kept together**: "L -festa" / "il- festa" / "f' Malta" become "l-festa" / "il-festa" / "f'Malta"
  after transcription and when retyping. The *Articles* check flags `il-ċens` → `iċ-ċens`, `f'il-` → `fil-` and
  leftover articles for one-click fixing
- **Name consistency**: The *Names* tab finds names spelled more than one way ("Ġużeppi" / "Guzeppi") and
  fixes them all at once; plus find & replace
- **Styles & animation**: 3 presets shown as animated tiles — Gold (default: one line, white text with the spoken word in
  gold), Pill (coloured box behind the spoken word) and Classic (plain, no animation) — built from layers you can change: entry (fade, slide, pop), word effect
  (karaoke, coloured word, box behind the word, pop, bounce, word by word, one word at a time), keyword emphasis,
  weight, colours, outline/shadow/glow/box, position and alignment. Montserrat (4 weights) is the only font, bundled with full Maltese support, so the
  preview matches the export. Reel (9:16) and wide videos keep text inside Instagram/Facebook safe areas (G shows
  them). An end card (closing text on a black frame after the video), suggested keywords, saved looks (shareable as `.bstyle` files) and an optional corner logo
- **Export**: `.srt` (Cmd/Ctrl+S saves next to the video), styled `.ass`, an MP4 with the subtitles burned in, or a
  transparent ProRes 4444 `.mov` with just the subtitles to lay over any edit. Exports use the bundled ffmpeg (libass)
  and can be cancelled
- **Words per caption**: the *Split* tab's slider re-splits when you let go and always gives exactly that many words; set *Lines* to 2 or lower the size when long captions need more room
- **Style panel**: sits beside the caption list so nothing is covered; the whole editor is in Maltese (technical words such as SRT, ASS, MP4, MOV and Timeline stay in English)
- **Remembers**: the folder of your last export, your last tool and your last calendar view
- **Resume**: Edits autosave; dropping the same file again (or picking it from *Recent*, where each entry can be deleted) continues where you left off
- **Apple Silicon optimized**: Uses MLX Whisper for GPU acceleration on M1/M2/M3
- **Language support**: Maltese by default; configurable via `WHISPER_LANG` environment variable

### Desktop: Posts (post maker)

For posts that repeat with only a name and a photo changing:

- **Templates**: a transparent 1080×1350 overlay PNG (exported from Photoshop) plus one or two text boxes, made in the built-in template editor; stored in the app-data folder
- **Making a post**: pick a template, drop in the portrait, drag / scroll / use the slider to place it behind the overlay (hold `H` to see the photo alone), type the name — it shrinks or wraps to fit its box and Maltese letters (ħ ġ ċ ż) are capitalised correctly
- **Output**: *Esporta…* saves a 1080×1350 JPG; *Uża f'post* adds it to the Skeda composer
- 4:5 only; no batch mode yet

### Desktop: YouTube Download

Download media from a YouTube URL into a chosen folder:

- **Two formats**: MP4 (best video+audio, remuxed to mp4) or MP3 (extracted audio at 192 kbps)
- **Live progress**: Real-time download percentage and a conversion/merge indicator
- **Powered by `yt-dlp`**: Resolved from `PATH` or common install locations; `ffmpeg` used for extraction/merge
- **Input validation**: Accepts only http(s) YouTube links into an existing output folder

### Cloud: Schedule & Publish

Compose posts in the desktop app and schedule them to Facebook and Instagram:

- **Multi-platform posting**: Publish to Facebook and/or Instagram simultaneously. Platforms are defined once in `src/platforms.js` (label, icon, accepted content types and media, caption limit, preview cut-off, extra fields). **TikTok** and **Website / App** appear greyed out as "Dalwaqt" until their backend publisher exists; WordPress is no longer offered for new posts (old WordPress posts still show in the archive)
- **Per-platform checks**: the caption limit follows the strictest selected platform; scheduling stops with a clear message if a platform cannot take the chosen content type or media
- **Media rules**: up to 10 photos for a post, exactly one video for a Reel, one file for a Storja — enforced when files are added, not only when scheduling
- **Preview**: shows what Instagram displays before "aktar" (first 125 characters), a 9:16 note for Reel/Storja, and the time in Malta time
- **Publish time**: quick buttons (Wara siegħa, Illejla 20:00, Għada 09:00, Għada 18:30); a time that has already passed asks for confirmation
- **After scheduling**: a toast links to the queue, and *Erġa' uża dan il-post* puts the post back in the form
- **Keyboard**: `1` Skeda · `2` Kalendarju · `3` L-Arkivju · `4` Għodda (not while typing or with a dialog open) · `⌘K` search the archive · `⌘↵` schedule (only on Skeda)
- **Media handling**: Support for single photos, carousels (multiple images), and videos
- **Scheduled publishing**: Queue posts for specific dates/times
- **Content types**: Regular posts, reels, carousel posts with captions
- **Organization profiles**: Manage multiple committee/organization accounts
- **Automatic retry**: Transient publish errors (timeouts, rate limits) are retried within the run, and posts stuck mid-publish are picked up again on the next cron run; posts that still fail can be retried from the archive

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
- **Scheduled posts for the day**: the side panel lists the selected day's posts (time, first caption line, platforms, status). It is read-only; posts are still edited only in L-Arkivju. Uses `GET /api/history?from=&to=`
- **Requires configuration**: Google Calendar ID and a service account with write access to that calendar

### Cloud: Monthly Reports

Generate PDF or CSV reports of PR activity and social metrics, with real date-range comparisons:

- **Metrics tracked**: Total posts published, pending, failed, likes, comments, average engagement per post, posts per week
- **Trends**: Posts/likes/comments/engagement compared against a previous period, broken down by platform as well as totals
- **Calendar-aware comparisons**: A full month/quarter/year compares against the true previous calendar unit (e.g. all of January, not just "31 days before February"), not just an equal number of days back
- **Custom comparisons**: Compare the selected range against any other range you pick, instead of only the auto-computed previous period
- **Quick presets**: This month, last month, this quarter, this year, last 7 days
- **Reach & followers**: Facebook and Instagram follower counts, Facebook page impressions, and net follower change — all scoped to the exact period being reported on (via the Graph API's `since`/`until`), not a fixed rolling window
- **Top posts**: Highest-engagement posts in the period, ranked by likes + comments
- **Per-profile reports**: Filtered to whichever committee profile is selected
- **Post list**: Full list of published posts for the period
- **Export**: Download as a formatted PDF (for stakeholder sharing) or as CSV (for spreadsheet analysis)
- **Date range selection**: Report for any custom range

### Cloud: Templates & Drafts

Accelerate post composition with reusable templates:

- **Built-in templates**: Pre-written templates for common posts (condolences, announcements, etc.)
- **Custom templates**: Save your own post templates for reuse
- **Template variables**: `[BRACKETED]` placeholders (e.g. `[DATA]`, `[ISEM]`) are detected on insert and prompted for individually — `[A / B]`-style placeholders render as a choice instead of free text
- **Draft management**: Auto-save drafts locally. A draft keeps its caption, times, platforms, content type, profile **and media** (photos/videos are stored in the browser's IndexedDB, `src/media-store.js`)
- **Offline support**: If you press Schedule while offline, the post is saved as a draft (media included) to schedule when you are back online
- **Media pre-flight check**: every media URL is verified reachable right before scheduling, so a broken upload is caught immediately instead of surfacing as a failed post later

## Watermark Packs

Watermarks are **not bundled** with the app. They live in installed packs under the app-data folder
(macOS: `~/Library/Application Support/app.banditur.desktop/watermarks/<pack-id>/`), so adding or removing
a photographer never needs a rebuild and survives app updates.

Manage them from **Settings → Marki → Immaniġġja** or the stack button next to the photographer picker:
- **Importa pack…** — install/update a `.bwpack` (or `.zip`) file
- **Add many…** — build a whole pack at once: choose all the PNGs in one go (⌘A in the file dialog), check the list (names come from the file names or their folder; portrait/landscape is detected from the picture size; wrong ratios, duplicates and failures are flagged per row), pick or name the pack and press Add. Optionally saves a `.bwpack` to send to others
- **+ Marka ġdida** — add a single photographer to an existing pack (or a new pack) from PNGs; bumps the pack version
- **Esporta** — save an installed pack as a `.bwpack` to send to other members
- **Ħassar** / **✕** — delete a whole pack or one watermark

A pack is a `.bwpack` file — a plain zip laid out as:

```
Banditur.bwpack
├── manifest.json
├── jacques-xuereb/
│   ├── portrait.png
│   └── landscape.png
└── celine-debono/
    └── landscape.png
```

```json
{
  "format": "banditur-watermark-pack",
  "formatVersion": 1,
  "id": "banditur",
  "name": "Banditur",
  "version": 1,
  "watermarks": [
    { "id": "jacques-xuereb", "name": "Jacques Xuereb" },
    { "id": "celine-debono",  "name": "Celine Debono" }
  ]
}
```

Rules (enforced on import; a failing pack is rejected with nothing installed):
- `format` must be `banditur-watermark-pack`, `formatVersion` must be `1`
- Pack and watermark `id`s: lowercase `a-z`, `0-9` and single `-` (they become folder names); `name`s are free text (≤ 80 chars)
- Each watermark needs `<id>/portrait.png` and/or `<id>/landscape.png` (at least one); other files are ignored
- PNGs must have an alpha channel, portrait taller than wide, landscape wider than tall, **3:2 / 2:3** proportion (e.g. 6000×4000), ≤ 12000 px per side
- A zip whose contents sit inside one top-level folder (macOS "Compress") is accepted too
- Importing a pack whose `id` is already installed replaces it (the app asks first, showing old vs new `version`)

To build a pack from a folder of `<Name>/{portrait,landscape}.png` sub-folders (the old bundled layout):

```bash
python3 scripts/make-watermark-pack.py src-tauri/watermarks --name "Banditur" --id banditur --out watermark-packs/Banditur.bwpack
```

The overlay is stretched to each photo's exact size, which is why packs must be 3:2 / 2:3 — photos of a
different proportion (e.g. 4:3 phone shots) still get a slightly stretched watermark.

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

After Whisper transcribes a Maltese recording, Banditur uses
`carlosdanielhernandezmena/wav2vec2-large-xlsr-53-maltese-64h` to force-align
each recognised word with the audio. This improves subtitle timing locally; the
alignment model is downloaded from Hugging Face on its first use. Set
`FORCE_ALIGN=0` to retain Whisper's original timestamp estimates.

> **Release builds:** the packaged transcription sidecar leaves out PyTorch to stay small, so this
> alignment pass only runs in dev (`npm run tauri dev`). Release builds skip it and use Whisper's own
> word timings.

> The MASRI alignment model and its CTC aligner dependency are non-commercial
> licensed. This configuration must not be used in a commercial release without
> the appropriate permissions.

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
│  (Rust + Svelte 5 + Vite)       │
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

### Desktop Layer: Tauri (Rust + Svelte 5)

- **Frontend** (`src/App.svelte`, `src/views/`, `src/components/`, `src/lib/`, `src/styles/`): Svelte 5 UI with all features (preview it in a browser with sample data: `npm run dev` → `http://127.0.0.1:5173/?mock`). Calls the Vercel backend over HTTP (scheduling, history, Drive, Calendar, reports) and uploads media straight to Supabase Storage with backend-issued signed upload tokens
- **Backend** (`src-tauri/src/`, commands registered in `lib.rs`): Rust business logic
  - Image processing pipeline (EXIF, watermarking, JPEG compression)
  - RAW file parsing and JPEG extraction
  - Transcription sidecar spawning and event management
  - YouTube download via `yt-dlp` (`ytmp3.rs`)
  - Watermark pack install/export/validation (`watermark_packs.rs`, `wm_pack.rs`)
- **Python Sidecars**:
  - `sidecar/transcribe.py`: MLX Whisper wrapper (the only Python sidecar)

### Cloud Layer: Vercel Backend (Node.js)

- **Serverless functions** in `backend/api/` (utility endpoints are consolidated)
  - `schedule.js` — Create new scheduled posts
  - `history.js` — Fetch post history (paginated, filterable by status, caption search, profile and an optional `from`/`to` window on `scheduled_time`)
  - `posts/[id].js` — POST: retry a failed post; DELETE: remove a pending post, or cancel + remove an `fb_native` post already handed to Facebook's scheduler
  - `cron/process.js` — Cron job: publish due posts to FB/IG (see scheduling note below)
  - `calendar.js` — Google Calendar CRUD: range reads plus create/update/move/resize/delete for single events
  - `meta.js` — Consolidated utility endpoint: `?type=version|profiles|calendar|live-posts` (GET) and `{action:'cleanup'}` (POST); `?type=calendar` is legacy read-only compatibility
  - `drive/[...slug].js` — Google Drive proxy: `posters` (list folder) and `file/:id` (stream file)
  - `media.js` — `?action=sign-upload` issues a path-scoped Supabase signed-upload token; `?action=check` does a pre-flight reachability check on media URLs before scheduling
  - `reports/monthly.js` — PR metrics report data for an arbitrary date range, optionally filtered by
    `profile_id`. Trends compare against either an explicit `compare_from`/`compare_to` range or an
    auto-computed previous period (a full calendar month/quarter/year compares against the true previous
    one); follower/reach figures come from the Graph API scoped to the exact range being reported on.
  - `updates/[target]/[arch]/[current_version].js` — Tauri updater manifest
  - `cors.js`, `auth.js` — shared helpers (no default export, not counted as functions)

> **Scheduling note:** `backend/vercel.json` runs the cron **once daily** (`0 0 * * *`) — the Vercel Hobby ceiling — as a fallback only. Real-time publishing is driven by `.github/workflows/cron.yml`, a GitHub Actions workflow that hits `/api/cron/process` every 15 minutes with `CRON_SECRET` (requires the `VERCEL_URL` and `CRON_SECRET` repo secrets to be set). Facebook posts within 30 days are additionally handed to FB's native scheduler. If the Actions workflow is ever disabled, publishing degrades to the daily Vercel run (Vercel Cron calls with `GET`, which `cron/process.js` accepts alongside `POST`).

- **Integrations**:
  - **Supabase**: Postgres database + storage for media
  - **Facebook Graph API**: Publish posts, handle carousels and videos
  - **Instagram Graph API**: Publish via Business Account
  - **Google APIs**: Drive (read files), Calendar (read/write events)

### Transcription Sidecar
- **Python script** (`sidecar/transcribe.py`)
- Wraps MLX Whisper, then force-aligns Maltese word boundaries with the MASRI CTC model
- Runs as a subprocess; communicates via JSON over stdout
- **Preload mode**: Model loads once per session when tab opens; subsequent videos reuse the warm process
- **Direct mode**: Spawns fresh sidecar if preload unavailable

### Image Processing Pipeline

1. Load the selected watermark (`<pack-id>/<watermark-id>`) from its installed pack (portrait/landscape variants)
2. Scan input folder for supported image formats
3. For each batch of images (in filename order; decode and encode/write run in parallel across CPU cores, logs stay in order):
   - Decode JPEG/PNG/TIFF/etc. (mozjpeg for JPEG speed)
   - Read EXIF orientation and apply rotation
   - Optional **Neħħi duplikati wara xulxin**: skip the photo if its 64-bit dHash is within 5 bits of the last *kept* photo (burst shots); nothing is written and the log lists it
   - Resize if max dimension specified
   - Detect portrait vs landscape and load matching watermark
   - Scale watermark to image dimensions (cached per size)
   - Composite watermark onto image
   - Encode JPEG with mozjpeg at target quality
   - Save directly to the chosen output folder
4. Emit real-time progress and per-file logs
5. Summary report with file counts (processed, failed, duplicates skipped) and output path

### RAW Extraction Pipeline

1. Parse TIFF IFD (Image File Directory) structure
2. Recursively search for embedded JPEG preview (tag 0x0201/0x0202)
3. If TIFF parsing fails, fall back to binary scan for JPEG markers
4. Extract raw JPEG bytes (> 50 KB minimum, ≤ 100 MB ceiling)
5. Optionally resize if max dimension specified
6. Save as `<name>.jpg` in the chosen output folder

### YouTube Download Pipeline

1. User enters a YouTube URL, picks an output folder, and chooses MP4 or MP3
2. Frontend calls `yt_download(url, output_dir, format)`
3. Rust (`ytmp3.rs`) resolves `yt-dlp`/`ffmpeg`, validates the URL and folder, and spawns `yt-dlp` with a `--` argument guard
4. stdout is parsed for `[download] NN%` progress and conversion/merge markers, emitted as `yt-update` events
5. On completion the frontend offers to open the downloaded file

## Troubleshooting

### Watermarks not found
Open **Settings → Marki** and check the pack is installed (a fresh install has none — import `Banditur.bwpack`). A watermark with only one orientation logs a warning and leaves photos of the other orientation unmarked.

### RAW conversion produces no output
- Check that RAW file contains an embedded JPEG preview > 50KB
- Some newer RAW formats require fallback binary scanning (slower but supported)

### Transcription errors
- Transcription uses the ffmpeg binary from the `imageio-ffmpeg` package (bundled in release builds) and falls back to a system ffmpeg (`brew install ffmpeg`)
- Check Python environment: `venv/bin/python -c "import mlx_whisper; print(mlx_whisper.__version__)"`
- Verify the file is MP4, MOV, MP3 or WAV

### YouTube download errors
- Ensure `yt-dlp` is installed and current: `brew install yt-dlp` or `python3 -m pip install -U yt-dlp`
- YouTube now needs a JavaScript runtime: `brew install deno` (the app passes Deno/Node to yt-dlp explicitly with `--js-runtimes`, since an app started from the Dock has a short PATH). Common yt-dlp errors are shown as a Maltese hint with the original line in brackets
- Ensure `ffmpeg` is installed (used for MP3 extraction / MP4 merge): `brew install ffmpeg`
- The URL must be an http(s) YouTube link and the output folder must already exist

### Performance issues
- RAW conversion uses all CPU cores via Rayon — performance scales with core count. Watermarking runs one photo at a time so output stays in filename order
- Transcription on Apple Silicon is ~2–3× faster than Intel via MLX GPU acceleration
- Watermark scaling is cached per-size; large batches of identically-sized images are optimized

## Development

### Release & Update Flow

Banditur supports two update paths:

1. **Backend-only updates** — commit and push backend changes; Vercel deploys from Git.
2. **Desktop app updates** — build signed updater artifacts, publish them to GitHub Releases, and point Vercel updater environment variables at the artifact.

Before deploying backend code that depends on schema changes, run the matching Supabase migration first. Migrations live in `backend/supabase/migrations/` and are applied in date order:

```text
backend/supabase/migrations/20260528_release_update_foundation.sql
backend/supabase/migrations/20260612_audit_fixes.sql
backend/supabase/migrations/20260804_signed_uploads.sql
```

For a normal desktop release, use the helper script:

```bash
npm run publish:update -- 1.0.1 "Describe what changed." --commit --push --vercel
```

It bumps the version in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml`, runs the signed build (`npm run release:app`), creates or updates the
`v<version>` GitHub Release with the updater artifacts and their `.sig` files (needs the `gh` CLI),
and with `--vercel` sets the per-platform updater env vars and redeploys (needs the Vercel CLI).
Without `--vercel`, the script prints the Vercel env vars to set manually. Add `--dry-run` to
preview. It never sets `MIN_DESKTOP_VERSION` or `BACKEND_VERSION` — update those by hand when needed.

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

1. Bump the version in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
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
│   ├── main.js                   # Mounts App.svelte
│   ├── App.svelte                # Toolbar + screens, global shortcuts, theme
│   ├── views/                    # One Svelte screen per tab / Studio tool
│   ├── components/               # Toolbar, Modal, Toasts, FolderField, …
│   ├── lib/                      # App state, backend API, Tauri wrappers, dev mock
│   ├── styles/                   # tokens.css (light/dark), base.css, legacy-tools.css
│   ├── ui.js                     # Small render helpers (used by subtitles/ and postmaker/)
│   ├── platforms.js              # The list of publish targets and their rules
│   ├── media-store.js            # Draft media in IndexedDB
│   ├── subtitles/                # Traskrittura subtitle editor (model, Maltese rules, styles/ASS, preview, timeline, editor, tests)
│   ├── postmaker/                # Posts tool (template format + photo/text maths, canvas renderer, UI, tests)
│   └── strings.js                # Maltese translations (+ friendlyError for readable errors)
├── src-tauri/                    # Rust/backend
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # Tauri setup and command registration
│   │   ├── image_processor.rs    # Watermark & sort
│   │   ├── jpeg.rs               # mozjpeg encode/decode helpers
│   │   ├── raw_converter.rs      # RAW preview extraction
│   │   ├── transcription.rs      # Transcription sidecar bridge
│   │   ├── subtitle_render.rs    # Subtitle video export (MP4 / transparent MOV)
│   │   ├── post_templates.rs     # Post-maker templates (store/list/delete) and saving the finished JPG
│   │   ├── watermark_packs.rs    # Tauri commands for watermark packs
│   │   ├── wm_pack.rs            # Pack format, validation, install/export (unit-tested)
│   │   └── ytmp3.rs              # YouTube download via yt-dlp
│   ├── watermarks/               # Source for the default pack (NOT bundled)
│   ├── binaries/                 # Transcription sidecar launcher script
│   ├── tauri.conf.json           # Tauri configuration
│   └── Cargo.toml
├── sidecar/                      # Python sidecar
│   ├── transcribe.py
│   ├── subtitle_render.py        # ffmpeg/libass export (`transcribe --render`)
│   ├── maltese.py                # keep articles attached (+ test_maltese.py)
│   ├── peaks.py                  # waveform for the timeline (`transcribe --peaks`)
│   └── requirements.txt
├── venv/                         # Python virtual environment (gitignored)
├── public/fonts/                 # Bundled subtitle fonts (OFL) — scripts/build-fonts.py
├── sidecar-dist/                 # PyInstaller transcription bundle (generated, gitignored)
├── transcribe-bundle.spec        # PyInstaller spec for the sidecar
├── backend/                      # Vercel social media scheduler/API
├── scripts/                      # Release, sidecar-build and watermark-pack scripts
├── .github/workflows/cron.yml    # Triggers publishing every 15 minutes
├── RELEASE.md                    # Local ignored release notes/runbook
└── vite.config.js
```

### Key Files

- `README.md` — Canonical tracked documentation
- `src-tauri/src/lib.rs` — Tauri setup and command registration
- `src-tauri/src/image_processor.rs` — Watermarking/sorting pipeline
- `src-tauri/src/wm_pack.rs` — Watermark pack format, validation and storage
- `scripts/make-watermark-pack.py` — Builds a `.bwpack` from a folder of watermarks
- `src-tauri/src/raw_converter.rs` — RAW preview extraction
- `src-tauri/src/transcription.rs` — Transcription sidecar management
- `src-tauri/src/ytmp3.rs` — YouTube download via yt-dlp
- `sidecar/transcribe.py` — Whisper wrapper with JSON protocol
- `scripts/build-transcribe-sidecar.sh` + `transcribe-bundle.spec` — Build the release transcription sidecar
- `backend/api/cron/process.js` — Publishing cron and stale media cleanup
- `backend/supabase/schema.sql` — Current Supabase schema/policies/RPC
- `backend/supabase/migrations/` — SQL migrations to apply before dependent backend deploys
- `.gitignore` — Covers build artifacts, secrets, release artifacts, and non-README Markdown docs

### Testing

There's no app-wide test suite. The watermark-pack logic and the subtitle engine have unit tests:
```bash
cd src-tauri && cargo test --lib wm_pack
node src/subtitles/subtitles.test.mjs
node src/postmaker/model.test.mjs
python3 sidecar/test_maltese.py
```
Everything else is tested manually via:
```bash
npm run tauri dev
```

### Common Tasks

**Add a new command to the Tauri backend:**
1. Define the command in `src-tauri/src/lib.rs` as an async function with `#[tauri::command]`
2. Register it in the `invoke_handler!` macro at the bottom of `lib.rs`
3. Call it from a view via `invoke('command_name', { ...args })` from `src/lib/tauri.js`

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
| **Frontend** | Svelte 5 + Vite |
| **Build** | Vite |
| **Desktop Plugins** | shell, dialog, opener, updater |
| **Image Processing** | `image` crate, mozjpeg, kamadak-exif |
| **RAW Parsing** | Custom TIFF IFD parser (manual byte-level) |
| **Parallel Processing** | Rayon (RAW conversion) |
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
