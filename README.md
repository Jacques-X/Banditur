# Banditur

An all-in-one social media management and post-production toolkit for organizations. Built with [Tauri](https://tauri.app), Rust, Svelte 5 and Vite; its cloud API runs on Vercel.

Documentation checked against the source on **2026-11-03**. This describes the local implementation, not a verification of the deployed services.

**Desktop tools** (post-production):
- **Marka & Ssortja** — Watermark photos in one ordered output folder
- **RAW → JPG** — Batch-convert RAW files (Sony ARW, Canon CR2/CR3, Nikon NEF, etc.) to JPEG
- **Traskrittura** — Transcribe videos, edit them as subtitles, style and animate them, and export SRT / ASS / MP4 / transparent MOV
- **YouTube Download** — Save a YouTube URL as MP4 (video) or MP3 (audio) with live progress
- **Posts** — Make repetitive posts (Awguri, Kondoljanzi…) from a template: portrait + overlay + a name, exported as a square, portrait or Story JPG, individually or in a reviewed batch, or sent to Skeda

**Cloud platform** (social media scheduling):
- **Schedule & Publish** — Compose and schedule posts to Facebook and Instagram (TikTok and a website/app backend are planned: placeholders in `src/platforms.js`)
- **Multi-Account** — Manage multiple organization profiles/committees
- **History & Archive** — Track all published, pending, and failed posts
- **Google Drive** — Browse and insert media from Drive folders
- **Kalendarju** — Our own calendar, kept on this computer: events with labels and repeats, plus a layer of scheduled posts that can be dragged to reschedule
- **Monthly Reports** — Generate PR performance reports (reach, likes, followers, impressions)
- **Templates** — Pre-built post templates (condolences, announcements, etc.)
- **Drafts & Offline** — Save drafts with their photos and videos, offline too; reopen them later
- **Xogħol** — To-do boards per profile (e.g. Videos, Elementi), created as needed and kept on this Mac: cards in columns, with checklist toggles, notes, a due date and a colour label

## Quick Start

### Prerequisites

- **macOS Apple Silicon** for the complete toolset, including MLX transcription. Other desktop targets are not validated by the current transcription launcher/build scripts.
- **Rust** + Cargo (Tauri backend)
- **Node.js 20.x or 22+** + npm (the locked Supabase packages require Node 20+, while Vite supports Node 20.x or 22+)
- **Python 3.10+** for development dependencies (the release build works with whichever CPython the `venv` uses, e.g. 3.13 or 3.14)
- **cmake** — `brew install cmake`
- Nothing extra for YouTube downloads: the app fetches and updates its own yt-dlp (and Deno if needed) and uses the engine's ffmpeg

### Install & Run

```bash
# Install JavaScript dependencies
npm install

# Create Python virtual environment
python3 -m venv venv
venv/bin/pip install -r sidecar/requirements.txt

# Create the local build-time configuration; fill in deployment values
cp src-tauri/banditur-config.example.json src-tauri/banditur-config.json

# Start the desktop app and development server with hot reload
npm run tauri dev
```

The local config is required by the Rust build and is gitignored. Backend access requires
`vercelUrl` and `apiKey`; media uploads also need `supabaseUrl` and the Supabase anon key
(`supabaseKey`). Never put the service-role key in the desktop config. Settings can override
these values locally. For transcription, provide `mlx-maltese-whisper-4bit/` or set
`MLX_MODEL_PATH`; the release build specifically requires the local model folder.

To inspect the UI without native processing or live services, run `npm run dev` and open
`http://127.0.0.1:5173/?mock`. This development-only preview uses sample data.

### Build and install on this Mac (the normal way)

```bash
npm run build:local             # build only what changed, install it
npm run build:local -- --dry-run   # just show what it would do
```

The app is built in four pieces (interface, app core, transcription engine, Maltese model), each with a
fingerprint, so only the pieces whose files changed are rebuilt (`scripts/lib/pieces.mjs`). The **engine** (555 MB)
and **model** (837 MB) are *not* inside the app: they are copied into
`~/Library/Application Support/app.banditur.desktop/components/` (once, and again only when they change),
and the app finds them there. The app itself is therefore small and rebuilds in a minute or two.
The interface is copied there too, and the app serves the newest installed one: a screen change is a ~3 MB copy
that shows at the next launch (or Settings → Updates → reload the interface), with no new app and no need to quit.
If a new interface fails to start, the app falls back to the previous one, then to the one inside the app.
Only a Rust change rebuilds and replaces `/Applications/Banditur.app` (`--app <path>` for another place; quit Banditur first). First run on a Mac
builds and installs everything. Settings → Updates lists the installed pieces. Options: `--force engine,core,ui,model`,
`--yes`, `--no-app`. Needs PyInstaller in the venv (see below) and no signing key.

### Build Release (signed updater, not used for local builds)

```bash
npm run tauri build
# Produces app artifacts under src-tauri/target/release/bundle/
```

Note: the app no longer bundles the engine and model, so an app built this way has no transcription until they are
in the components folder (`npm run build:local` puts them there). The engine is built by
`npm run build:transcribe` (`scripts/build-transcribe-sidecar.sh`), which needs PyInstaller in the venv:
`venv/bin/pip install pyinstaller`, plus `mlx-maltese-whisper-4bit/config.json` and `weights.safetensors`.
The sidecar build uses macOS tools (`install_name_tool`, `codesign`) and finds the MLX library for the `venv`'s Python version.

For a signed updater-capable desktop release:

```bash
npm run release:app
```

## Components

Banditur is split into two main components:

1. **Desktop App** (Tauri) — Post-production tools for content creation
2. **Cloud Backend** (Vercel) — Social media API for scheduling, publishing, and analytics

The desktop calls the Vercel API over HTTP. The backend reads/writes Supabase Postgres;
the desktop uploads media directly to Supabase Storage using backend-issued signed tokens.

## Features

### Desktop: Marka & Ssortja — Watermark

Bulk-process a folder of images (JPG, PNG, TIFF, BMP, WebP):

- **Per-photographer watermarks**: Applies `portrait.png` and `landscape.png` overlays from installed **watermark packs** (not bundled with the app — add/remove them at runtime, see below)
- **Auto-orientation**: Detects EXIF orientation and rotates before compositing
- **Single output folder**: Assigns filenames and reports results in source filename order; parallel workers can finish writing in a different order
- **Safe duplicate names**: Adds a numeric suffix instead of overwriting when two photos would produce the same JPEG filename
- **Compression controls**: Quality (60–95%) and max dimension (1080–4096 px, or Original)
- **Bounded parallel processing**: Batches of up to 8 photos (limited by core count), with duplicate decisions, output naming, progress and logs in filename order
- **Optional near-duplicate skipping**: Compares each oriented photo with the last kept photo using dHash; skips similar neighbours without changing originals
- **Watermark caching**: Avoids redundant scaling when processing many images

### Desktop: RAW → JPG — RAW Preview Extraction

Extracts the camera-generated JPEG preview from RAW files; this is not sensor-data development:

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
  Drag subtitle edges on the timeline to change timing (snaps to words), or use the keyboard (`?` shows every shortcut; the full list is in Technical reference → Subtitle editing & export). Every edit is undoable and the toast says what was
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
- **Words per caption**: the *Split* tab's slider re-splits when you let go and uses that value as a maximum. It also respects line capacity, pauses, sentence ends and speaker changes; set *Lines* to 2 or reduce text size for more room
- **Style panel**: docks beside the caption list on wider windows and overlays it on narrow windows; the whole editor is in Maltese (technical words such as SRT, ASS, MP4, MOV and Timeline stay in English)
- **Remembers**: the folder of your last export, your last tool and your last calendar view
- **Resume**: Edits autosave; dropping the same file again (or picking it from *Recent*, where each entry can be deleted) continues where you left off
- **Apple Silicon optimized**: Uses MLX Whisper for local GPU acceleration
- **Language support**: Maltese, English, Italian or automatic detection, selected for each request (the installed model determines recognition quality)
- **Passage repair**: Retranscribe a chosen source-time range, compare the text and accept it as one undoable edit; corrections outside the range remain
- **Import and review**: Import timed SRT cues; review confidence, readability, name and article warnings
- **Durable projects**: Native atomic autosave, `.banditur` import/export (references or included media), and relink missing source files. Old localStorage sessions migrate only after a successful native save

### Desktop: Posts (post maker)

For posts that repeat with only a name and a photo changing:

- **Templates**: a transparent 1080-wide square (1080), portrait (1350) or Story (1920) overlay PNG (exported from Photoshop) plus one or two text boxes, made in the built-in template editor; stored in the app-data folder
- **Making a post**: pick a template, drop in the portrait, drag / scroll / use the slider to place it behind the overlay (hold `H` to see the photo alone), type the name — it shrinks or wraps to fit its box and Maltese letters (ħ ġ ċ ż) are capitalised correctly
- **Output**: *Esporta…* saves a JPG in the selected format; *Uża f'post* adds the image and caption to Skeda
- **Production**: Per-profile brand name/colour/logo and starter templates, portable `.btemplate` packs, captions with `[ISEM]`, names/CSV plus selected photos in matching order, row previews/placement review, text-fit and resolution warnings, batch JPG or draft output, and cancellation between rows
- **Projects**: Atomic native autosave, new/resume, `.banditur` export/import with optional media; existing 4:5 templates keep their coordinates

### Desktop: YouTube Download

Download media from a YouTube URL into a chosen folder:

- **Two formats**: MP4 (best video+audio, remuxed to mp4) or MP3 (extracted audio at 192 kbps)
- **Live progress**: Real-time download percentage and a conversion/merge indicator
- **Powered by `yt-dlp`**: The app keeps its own copy (nightly, updated daily and again whenever YouTube breaks it); the engine's ffmpeg does the MP3 extraction / MP4 merge; Deno solves YouTube's JavaScript challenge
- **Input validation**: Accepts only http(s) YouTube links into an existing output folder
- **Jobs and handoffs**: Queue, cancel or retry downloads; send completed MP4s to transcription or the Reel composer. RAW and watermark jobs also queue and preserve completed files on retry; finished watermark photos can go to Skeda

### Cloud: Schedule & Publish

Compose posts in the desktop app and schedule them to Facebook and Instagram:

- **Multi-platform posting**: Publish to Facebook and/or Instagram simultaneously. Platforms are defined once in `src/platforms.js` (label, icon, accepted content types and media, caption limit, preview cut-off, extra fields). **TikTok** and **Website / App** appear greyed out as "Dalwaqt" until their backend publisher exists; WordPress is no longer offered for new posts (old WordPress posts still show in the archive)
- **Platform checks**: the caption limit follows the strictest selected platform; content-type and image/video-kind checks run before scheduling.
- **Media checks with one-click fixes**: every photo and video added in Skeda is measured (shape, size, length) and checked against Meta's limits for the chosen platforms and type. A red **!** blocks scheduling, an amber one is a warning, and the list under the media explains each one:
  - Instagram photos must be JPG, 4:5 – 1.91:1 in the feed and ≤ 8 MB (Facebook ≤ 10 MB, Facebook Stories ≤ 4 MB); a carousel photo shaped differently from the first is a warning (Instagram crops them all like the first); Stories prefer 9:16
  - photos can be fixed in place: *Ikkonverti għal JPG*, *Aqta' għal …*, *Żid margini* (padding with a blurred copy of the photo) and shrinking; *Irranġa kollox* fixes every photo
  - videos: under 3 s, Stories over 60 s, Facebook Reels over 90 s and Instagram Reels over 15 min are errors; a Reel/Story that is not 9:16, a Facebook Reel under 540×960 and Instagram video wider than 1920 px are warnings. Videos are not re-encoded by the app; codecs cannot be checked before upload
- **Media rules**: the composer allows up to 10 files for a post, exactly one video for a Reel and one file for a Story. Changing type can leave incompatible media, which scheduling validation reports.
- **Preview**: shows what Instagram displays before "aktar" (first 125 characters), a 9:16 note for Reel/Storja, and the time in Malta time
- **Publish time**: quick buttons (Wara siegħa, Illejla 20:00, Għada 09:00, Għada 18:30); a time that has already passed asks for confirmation
- **After scheduling**: a toast links to the queue, and *Erġa' uża dan il-post* puts the post back in the form
- **Keyboard**: `0` Home · `1` Skeda · `2` Kalendarju · `3` L-Arkivju · `4` Rapporti · `5` Xogħol · `⌘5`–`⌘9` Studio tools · `⌘K` archive search · `⌘,` Settings · `⌘↵` schedule (only in Skeda). Plain view-number shortcuts are disabled inside Studio tools, while typing or with a modal open; Ctrl substitutes for Cmd where supported.
- **Media handling**: Support for single photos, carousels (multiple images), and videos
- **Scheduled publishing**: Queue posts for specific dates/times
- **Content types**: Regular posts, reels, carousel posts with captions
- **Organization profiles**: Manage multiple committee/organization accounts
- **Delivery tracking**: A durable per-destination ledger retains IDs and preparation stages. Confirmed destinations are skipped on retry. Ambiguous publication responses become reviewable rather than being submitted again automatically
- **Submission recovery**: Idempotent request IDs prevent duplicate schedule rows after interrupted responses. Saved timestamps require media and form persistence to finish
- **Media retention**: Keep shared uploaded media for 1–365 days after publication, or pin it; failed/active jobs retain references. Daily maintenance collects expired/unreferenced files

### Cloud: History & Archive

Track all social media activity and performance:

- **Post history**: View all published posts with timestamps and platform info
- **Pending queue**: Monitor posts awaiting publication
- **Failed posts**: See each destination, verify known IDs and retry unfinished delivery. Unknown outcomes require checking Meta and explicit acknowledgement
- **Queued work**: Edit captions/media/time with revision checks, duplicate with media, reschedule, or cancel a verified Facebook native schedule before changing/removing it
- **Filter & search**: Filter by status (pending, published, failed) and search captions
- **Pagination**: Browse large post archives efficiently

### Cloud: Google Drive Integration

Browse and use media from shared Drive folders:

- **Folder browsing**: Navigate Drive folders to discover poster designs and media
- **Thumbnail preview**: Quick visual preview of images before inserting
- **Media insertion**: The backend streams the selected Drive file into the composer as a local File; scheduling then uploads it to Supabase Storage. Posts do not depend on a private Drive URL.
- **Requires configuration**: Drive folder ID and Google service account credentials

### Calendar (Kalendarju, local)

Events live on this computer (`src/views/kalendarju/`), one calendar per profile; there is no Google Calendar any more. Old Google events were not imported.

- **Views**: Month, week, day and list, built in-house (no calendar library)
- **Editing**: Create, edit, drag and delete events; click an empty slot to create one. An event has one time (or the whole day), like a post; there is no end time
- **Colour labels**: Per-profile labels with colour and show/hide toggles; removing a label leaves its events unlabelled
- **Repeats**: Daily, weekly, monthly or yearly with an interval and optional end date. Editing, moving or deleting a repeating event applies to the whole series
- **Post layer**: Toggle scheduled/published posts independently of events. Drag queued posts to reschedule with revision checks and revert on failure; click to edit or duplicate
- **Malta clock**: `Europe/Malta` applies regardless of computer timezone; ambiguous/missing clock-change inputs are rejected
- **Event workspaces**: Open an event's work on Home, linking projects, Studio outputs and cloud posts
- **Storage**: `localStorage` key `banditur_calendar` (up to 5000 events). Times are stored as Malta wall-clock strings. Events stay on this computer, one calendar per profile (server plans: `calendar.md`)

### Cloud: Monthly Reports

Generate PDF or CSV reports of PR activity and social metrics, with real date-range comparisons:

- **Metrics tracked**: Total posts published, pending, failed, likes, comments, average engagement per post, posts per week
- **Trends**: Posts/likes/comments/engagement compared against a previous period, broken down by platform as well as totals
- **Calendar-aware comparisons**: A full month/quarter/year compares against the true previous calendar unit (e.g. all of January, not just "31 days before February"), not just an equal number of days back
- **Custom comparisons**: Compare the selected range against any other range you pick, instead of only the auto-computed previous period
- **Quick presets**: This month, last month, this quarter, this year, last 7 days
- **Followers & impressions**: Facebook/Instagram follower totals are current counts at report time. Facebook impressions and net follower change are queried for the selected period. Unavailable metrics remain blank rather than becoming zero; impressions are not unique reach.
- **Top posts**: Highest-engagement posts in the period, ranked by likes + comments
- **Per-profile reports**: Filtered to whichever committee profile is selected, with optional category/event filters for posts
- **Coverage**: Generation time, measured-post counts and unavailable values remain explicit in the screen, PDF and CSV. Partial publications count only destinations confirmed published
- **Post list**: Full list of published posts for the period
- **Export**: PDF opens the system print dialog (choose Save as PDF); CSV is generated and downloaded by the frontend. Select which report sections to include.
- **Date range selection**: Report for any custom range

### Cloud: Xogħol (to-do boards)

Boards of things to do for each committee profile (Social → Xogħol, key `5`, also on Home with the number of open cards). **For now they are kept on this computer only**, in the app's local storage (`banditur_xoghol`): no backend or migration is needed, they work offline, and other people don't see them.

- **Boards**: none exist until someone makes one. Create as many as needed (up to 20 per profile), e.g. *Videos* or *Elementi*; switch with the tabs under the title (←/→ between tabs). The ⌄ next to the selected tab renames, moves or deletes it (deleting removes its columns and cards for everyone, after confirmation). Each person's last board is remembered per profile
- **Columns**: a new board starts with *Biex isir*, *Għaddej* and *Lest*; rename (click the title), add (up to 12 per board), move left/right, or delete an empty column (a board keeps at least one)
- **Cards**: a title plus optional checklist, notes, start and due dates (*Mill-* / *Sa meta*; the card shows the range) an optional **Budget** and **Spent so far** in euros (the card shows `€45.50 / €200`, red when over; the board header shows total Budget · Spent · Left/Over for the cards that have an amount) and one of six colour labels (Aħmar, Oranġjo, Isfar, Aħdar, Blu, Vjola). Each checklist step can also have its own dates, Budget and Spent (the calendar button on the step); step amounts are parts of the card's own amount and are not added to the totals. *Żid kompitu* at the bottom of a column adds one quickly (Enter adds another)
- **Moving**: drag a card within or between columns, or focus it and press `⌥` + arrow keys
- **Ticking**: checklist items can be ticked straight on the card; click the card to edit everything else (`⌘↵` saves)
- **Due dates** use Malta time: overdue cards are red, today amber, the next two days blue. Cards in a board's last column are treated as finished and never show as overdue
- **Another board**: the card dialog's *Board · Kolonna* list moves a card to any board of the profile
- **Gantt**: the *Board | Gantt* switch (top right, remembered) shows the same cards as bars on a calendar, grouped by column, zoomable between *Ġimgħat*, *Xhur* and *Sena* (a year or more at a glance), with today marked. Drag a bar to move it, drag its ends to change the start or due date (`←`/`→` on a focused bar moves it a day, `Shift` changes only the end); click a bar or name to open the card. A card with only a due date is a one-day bar; clicking the row of a card without dates gives it a week from that day. Each card's dated steps show as thin bars under it (the *Steps* button shows or hides them; drag them like cards), and amounts show on the rows, with a total per column. You can add from the chart: *+ Kompitu* in a column header makes a card with a week from today, and the **+** on a card's row adds a step. *PNG* / *PDF* save the board's dated cards and steps as a picture or a PDF that is always one A4 page (landscape for wide charts, portrait for tall ones, scaled to fit; always light)
- **Sharing later**: `backend/api/tasks.js` and `20261103_tasks.sql` are kept, tested and ready, but the app does not use them yet. Switching means pointing `xoghol/board.svelte.js` back at `/api/tasks`, applying the migration and deploying the backend. Budget amounts (`budget_cents`, `spent_cents`, on cards and in checklist steps) and step dates are accepted by the shared rules but the SQL migration has no columns for the card amounts yet, so add them first

### Cloud: Templates & Drafts

Accelerate post composition with reusable templates:

- **Built-in templates**: Pre-written templates for common posts (condolences, announcements, etc.)
- **Custom templates**: Save your own post templates for reuse
- **Template variables**: `[BRACKETED]` placeholders (e.g. `[DATA]`, `[ISEM]`) are detected on insert and prompted for individually — `[A / B]`-style placeholders render as a choice instead of free text
- **Draft management**: Autosave and explicit drafts keep caption, times, platforms, content type and profile locally; media is stored separately in IndexedDB (`src/media-store.js`) when storage succeeds
- **Offline support**: Pressing Schedule while offline saves a local draft for later scheduling; media retention depends on IndexedDB availability
- **Media pre-flight check**: a best-effort URL reachability check runs before scheduling. A reported broken URL blocks scheduling; if the check itself is unavailable, scheduling continues. This does not validate the full publishing requirements.

## Project documentation

All four documents are tracked in Git:
- `README.md` — features, setup, build, and the Technical reference (module maps, data flows, API, build internals).
- `AGENTS.md` — short guide for coding agents: commands, where code lives, conventions, gotchas.
- `RELEASE.md` — deployment and updater runbook.
- `DECISIONS.md` — product/architecture rationale, including superseded decisions.

## Current limitations

- Publishing requires the `20261029_production_workflows.sql` migration (Xogħol needs nothing on the server while it is local), plus a backend deployment before the new desktop is released. Live Meta endpoints, permissions, video codecs and a signed packaged app need deployment smoke tests (`npm run smoke:meta`, see RELEASE.md); local mocks do not prove external publication.
- GitHub invokes the worker every 15 minutes, with at most five posts per run and a shared time budget. Only ordinary Facebook posts more than ten minutes and less than thirty days ahead use native scheduling; other jobs may publish later than their selected minute.
- Unknown publication outcomes cannot safely be retried automatically. Check Meta before acknowledging a retry. External publication and saving its ID cannot be one atomic transaction.
- Draft media remains in IndexedDB on this installation. Native subtitle/post projects live in the app-data folder; use portable export to move them (subtitle sources can be relinked). Reference-only exports require the source files to remain accessible; included media is capped at 2 GB per asset and project JSON at 16 MB.
- Photo cancellation stops between files/batches and batch-post cancellation between rows. Interrupted jobs remain visible and require an explicit retry.
- Automatic recognition and non-Maltese accuracy depend on the installed Whisper model. Release builds still omit the optional CTC aligner. The composer's media checks cover shape, size and length and can fix photos; videos are checked but not re-encoded and codecs are not inspected. Imported SRT word timings are estimated inside the original cue boundaries.
- Reports use the latest observed engagement of scheduled posts and current followers, not historical follower snapshots. Category/event filters do not narrow page-wide insights. Metric permissions may make some values unavailable.

## Watermark Packs

Watermarks are **not bundled** with the app. They live in installed packs under the app-data folder
(macOS: `~/Library/Application Support/app.banditur.desktop/watermarks/<pack-id>/`), so adding or removing
a photographer never needs a rebuild and survives app updates.

Manage them from **Settings → Marki → Manage watermarks** or **Marka & Ssortja → Manage watermarks**:
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

### Pack internals

- An installed pack folder has the same layout as a `.bwpack` zip: `manifest.json` + `<watermark-id>/{portrait,landscape}.png`. Format spec and rules: README → "Watermark Packs"; code: `src-tauri/src/wm_pack.rs` (pure, no Tauri types, has unit tests: `cargo test --lib wm_pack`)
- **Add many…** (Marki modal → `wm-bulk-modal`; `src/wm-bulk.js` + `wm-bulk.test.mjs`): one multi-select PNG dialog; `groupWatermarks()` builds one row per photographer (`nameFromPath()` strips portrait/landscape words, falls back to the parent folder, Title-Cases `jacques-xuereb`; orientation from the picture size, loaded through the asset protocol, else from a word in the file name; ratio must be 3:2 / 2:3 within 2%). The *Add* button calls the existing `add_watermark` once per row (first row creates the pack, the rest reuse its id; each call bumps the pack version), shows per-row success/errors, and can then call `export_watermark_pack`. No Rust changes
- Import validates fully in memory (manifest, ids, PNG signature/alpha/orientation/3:2 ratio, zip-slip, size caps), then writes to a `.staging-*` folder and renames into place, so a failed import never leaves a partial pack. Folders starting with `.` are ignored by `list_packs`
- Manifest writes are atomic (temp file + rename); `add_watermark`/`remove_watermark` bump `version` so re-exported packs supersede older copies
- `src-tauri/watermarks/` is now only the source for the default `Banditur.bwpack`, built with `scripts/make-watermark-pack.py` (it is no longer in `bundle.resources`)

## Configuration

### Environment Variables

| Variable | Default | Options | Purpose |
|----------|---------|---------|---------|
| `WHISPER_LANG` | `mt` | `en`, `fr`, `es`, `mt`, etc. | Transcription language code |
| `MLX_MODEL_PATH` | — | Path or HF repo | Custom Whisper model location (overrides default) |
| `FORCE_ALIGN` | enabled when available | `0`, `false`, `no` to disable | Optional Maltese CTC timing refinement in development |

Example:
```bash
WHISPER_LANG=en npm run tauri dev
```

### Transcription Models

By default, uses a pre-trained **Maltese-optimized MLX Whisper model** located at `mlx-maltese-whisper-4bit/` in the project (installed by `npm run build:local` into the components folder, outside the app).

When the optional alignment dependencies are available in development, Banditur uses
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

### Subtitle fonts
- Montserrat is the only font family: `public/fonts/` holds SemiBold, Bold, ExtraBold and Black plus one shared licence, `OFL-Montserrat.txt`: served to the webview at `/fonts/…` (`@font-face` injected by `preview.js`) and shipped to the renderer as the Tauri resource `fonts/` (`bundle.resources`)
- The variable font is instanced to a single weight per file and renamed (e.g. "Montserrat ExtraBold") so libass and WebKit pick exactly the same face by family name
- Every font must pass `scripts/check-fonts.py` (Poppins and DM Serif Display were rejected for missing ħ / ġ / ċ)

### Secrets & Sensitive Config

The file `src-tauri/banditur-config.json` is baked into the binary at build time and is returned to the local renderer so the desktop app can call the configured backend. Keep it local and do not commit it. It is not secret in the cryptographic sense: the shared `API_KEY` in it can be extracted from the app, an accepted trade-off (see DECISIONS.md).

Updater signing files are stored outside the repo and must be backed up securely:

```text
~/.tauri/banditur-updater.key
~/.tauri/banditur-updater.key.password
```

## Technical reference

How the code fits together, for people and agents changing it. AGENTS.md has the short version (commands, where code lives, conventions, gotchas); this section has the detail.

### Frontend modules (`src/`)
- **Svelte 5 (runes) + Vite** since the 2026-10-22 UI redo ("A5 · Kwiet Toolbar"). `main.js` only mounts `App.svelte`
- `App.svelte` — toolbar + one `<section>` per screen. Home is in the main bundle; every other screen is its own chunk from the `SCREENS` table (`import()`), fetched the first time it is opened (a loading note shows, and a retry button if the import fails, e.g. a half-copied installed interface) and fetched ahead one at a time when the app is idle. A screen is mounted the first time it's opened and then kept (hidden), so running jobs, a half-written post or an open subtitle edit survive tab switches. Global keys: `0` Home, `1`–`5` Social screens (not inside Studio tools), `⌘5`–`⌘9` Studio tools, `⌘K` archive search, `⌘,` Settings; `⌘↵` lives in Skeda
- `components/` — `Toolbar` (profile menu, tabs, Studio menu, health dot, Settings), `Modal` (Esc, focus trap, focus return; `anyModalOpen()` mutes shortcuts), `Toasts`, `ConfirmDialog`, `Icon`, `FolderField`, `JobPanel`
- `lib/` — `app.svelte.js` (navigation, config, profiles, theme, toasts, `confirm()`, recent Studio jobs; `ls.list()` / `ls.object()` read saved lists and objects and return an empty one when the stored value has the wrong shape — use them for anything that is mapped or iterated at start-up), `api.js` (`api(path, { query, method, body, timeout })` → JSON, readable Maltese errors; gives up after 90 s by default; `error.status` is set only when the server answered), `tauri.js` (wrappers; outside Tauri they go to the dev mock), `health.svelte.js` (Settings → Sistema checks + toolbar dot), `queue.svelte.js` (pending/failed counts, Skeda's "Jmiss" strip, `statusOf(post)`), `photojob.svelte.js` (the shared Marka / RAW run: `log`, `progress`, `done`, `raw-done` events), `format.js` (Maltese dates), `mock.js` (dev only), `colorpicker.js` (installed in `main.js`: takes over every `<input type="color">` app-wide — WebKit only offers a fixed swatch grid — with a colour wheel, brightness slider, R/G/B and hex fields and the last 10 colours (`banditur_recent_colors`); the input still gets `input` events while picking and `change` when the popover closes, so existing listeners and `bind:value` work; Esc restores the old colour, Enter / click outside keeps the new one)
- `views/` — `Skeda` (+ `skeda/composer.svelte.js`: form state, media rules, autosave, drafts, upload → check → schedule; `keepCurrent()` / `replaceWith(load)`: the one way to put something else into the composer — asks first (always, except for actions started in Skeda), keeps the current post as a draft, and on a failed draft save shows the toast itself and leaves the composer untouched; `skeda/media-check.js`: pure per-platform media limits, `mediaIssues()` and the crop/pad maths `fitPlan()`, tested in `media-check.test.mjs`; `skeda/media-probe.svelte.js`: measures each File once into `mediaInfo` (a `SvelteMap`) and `fixPhoto()` rebuilds a photo as a fitting JPEG on a canvas; errors from `preflightProblem()` block scheduling, warnings do not), `Kalendarju` (FullCalendar, re-themed), `Arkivju`, `Rapporti` (on-screen report + PDF via print / CSV), `Xoghol` (+ `xoghol/`: `model.js` pure ordering/date helpers, `board.svelte.js` state and optimistic saves, `TaskCard`, `TaskDialog`, `GanttView` with `gantt-model.js` (scales, range, ticks, bar and drag maths) and `gantt-export.js` (canvas PNG + tiny one-image PDF writer)), `Home` (landing: Social + Studio cards + recent work), `Traskrittura`, `Posts`, `Marka` (+ `marka/` packs dialog), `Raw`, `YouTube`, `Settings`
- `styles/` — `tokens.css` (light + dark palettes on `html[data-theme]`; also maps the old token names), `base.css` (shared controls: `.btn`, `.chip`, `.seg`, `.pill`, `.input`, `.notice`…), `legacy-tools.css` (the subtitle editor + post maker CSS carried over from the old `styles.css`)
- **Preview in a browser**: `npm run dev`, open `http://127.0.0.1:5173/?mock` — every screen works with sample data (no Tauri, no backend). The mock never ships (`import.meta.env.DEV` guard)
- `ui.js` — dependency-free helpers (`escapeHtml`, `baseName`, `resultFolder` for the default `<folder>-riżultat` output); safe to import from node tests. `lib/tauri.js` re-exports `baseName`. Shared pieces elsewhere: `typeName()` (Post/Reel/Story) in `platforms.js`, `ago()`/`elapsed()` and the Malta date labels in `lib/format.js`, `components/ImageOptions.svelte` (quality + max size for Marka and RAW)
- `subtitles/` — the Traskrittura subtitle editor, kept out of `main.js`:
  - `model.js` — pure data model: cues/words, split/join/trim/roll/move-word, re-splitting, name variants, find & replace, line wrapping, readability checks (`cueIssues`), suggested keywords, timeline helpers, SRT, and the undoable `SubtitleDoc` (labelled steps; `beginLive`/`commitLive` turn a drag into one undo step)
  - `maltese.js` — keeps articles / short forms attached (`mergeTokens`, `mergeWords`) and the "Artikli" check (`articleIssue`); mirrored in `sidecar/maltese.py`, both tested against `maltese-cases.json`. A token that starts with a hyphen ("-soċjetà") always joins the word before it — real Whisper output splits every article form that way ("is -soċjetà", "taż -żurrieq", "n -nies")
  - `names.js` — capital letters for names: built-in Maltese localities, saints ("Santa Katarina") and the user's own list (localStorage `banditur_sub_names`), matched case-insensitively and fixed with the article kept lower case ("taż-żurrieq" → "taż-Żurrieq"); shown in the *Ismijiet* tab and as a pill above the caption list
  - `styles.js` — bundled fonts (+ measured libass size ratio `em`), the layered look (look / layout / animation), the 3 presets (Gold = default, Pill, Classic), format & safe areas (`layoutFor`), shared timing math (`wordSlots`, `frameState`) and the `.ass` generator
  - `preview.js` — draws the cue over the video (`cueHtml`, also used by the animated preset tiles), safe-area guides and the corner logo. During playback it measures the video's picture box only on layout changes/seeks, and when only inline styles change between frames (karaoke fill, pop scale, fades) it updates those attributes instead of rebuilding the overlay, so animated looks don't re-render the text 60×/s
  - `timeline.js` — waveform + cue blocks (scrubbing and word-highlight drags seek at most once per frame; scrubbing pauses playback and resumes it on release): drag edges to trim (each block is independent; Shift rolls a shared cut), drag the middle to move a block anywhere, also past others (`moveCueFree`: it jumps into any gap it fits, never overlaps), zoom, snapping
  - Big line / end card: `PUNCH` and `effectiveLook()` in `styles.js` (layout is computed per cue, slant is `\fax-0.2` in ASS and `skewX(-11.3deg)` in the preview); the end card is an ASS event after the video plus `endCardSeconds` in the render job (`tpad`/`apad` in `sidecar/subtitle_render.py`; the Rust command passes it through). The export prints the font libass picked (`done.fonts`).
  - `editor.js` — UI controller (slim bar, cue list, drawer, shortcuts, export menu, autosave, resume); Tauri APIs are injected so it can run in a plain browser
- `postmaker/` — the Posts tool (Studio → Posts), kept out of `main.js`:
  - `model.js` — pure and unit-tested: template format (`normalizeTemplate`, `normalizeZone`, `makeId`), Maltese-aware `applyCase`/`fileSlug`, `fitText` (biggest size from `maxSize` down to `minSize` that fits the box in ≤ `maxLines` lines; two lines are balanced) and the photo placement maths (`zoomPhotoAt`, `panPhoto`, `clampPhoto` — the photo can never leave an empty strip inside the frame; `resolutionLevel` warns when it is enlarged past 1×/1.5×)
  - `render.js` — `drawPost()` paints photo → overlay → text onto the template-sized 1080-wide canvas. The preview, the template editor and the export all use it, so they match. `loadFonts()` waits for the bundled Montserrat faces (registered by `ensureFonts()` from `subtitles/preview.js`)
  - `views/posts/PostMaker.svelte` (Svelte, since 2026-11-03) — the make screen: template chips, drag/wheel/slider/arrow-key photo placement, hold `H` to hide the overlay, name fields, export (`save_post_image`), *Uża f'post* (`sendToComposer` prop from `views/Posts.svelte`, which adds the image to Skeda). It keeps the `.pm-*` classes from `legacy-tools.css`; it exposes `show()` and `open(project)` and hands `WorkPanel` a small `maker` object (state, loadPhoto, renderBlob, reload, overlayFor, restore, setFormat, setBatch, newProject). While a batch runs (`busy`) its controls are disabled and the stage is inert. `views/posts/TemplateEditor.svelte` — pick the overlay, drag/resize the text boxes on the canvas, font/colour/alignment/case/size limits (number fields apply on Enter/blur)
  - `views/posts/WorkPanel.svelte` — "Proġetti, templates u batch": project autosave/open/export (`saveProject`, `.banditur`), branded starter template, `.btemplate` packs, per-profile brand (localStorage `banditur_brand:<profile>`), and the reviewed batch (names/CSV + photos → JPGs or Skeda drafts, cancellable). Pure helpers in `postmaker/production.js` (CSV names, pack validation, starter layout), tested in `production.test.mjs`
- The subtitle editor's markup is `views/traskrittura/editor.html` (imported `?raw`); `editor.js` finds its elements inside that root. `.pm-stage canvas` still resets `font-feature-settings` so the preview matches the export
- `strings.js` for i18n/Maltese translations; `friendlyError()` there turns HTTP codes / "Failed to fetch" into a plain Maltese sentence (original text kept in brackets)
- `platforms.js` — the single list of publish targets (`PLATFORMS`): label, short tag, `available`/`hidden`, content types, media kinds, caption limit, preview cut, extra `fields`, `idField`, icon. The composer buttons, defaults, caption limit, preview, archive pills and `platformProblem()` validation all read it. To add a platform: add an entry, set `available: true`, and add a publisher + `ALLOWED_PLATFORMS` entry in `backend/api/schedule.js`
- `media-store.js` — IndexedDB (`banditur_media`) for draft/autosave media; keys `autosave` and `draft:<id>`; storage helpers return failure, and the composer surfaces it instead of reporting a successful save
- Communicates with Rust backend via Tauri commands and event listeners

### Native layer (`src-tauri/src/`, commands registered in `lib.rs`)
- **Rust + Tauri 2**
- Core business logic:
  - `get_config()` / `restart_app()`: return baked configuration / restart after an update
  - `process_images()`: Watermark images in bounded parallel batches with ordered decisions and logs (`watermark_id` = `"<pack-id>/<watermark-id>"`)
  - Watermark packs (`watermark_packs.rs` → logic in `wm_pack.rs`): `list_watermark_packs`, `inspect_watermark_pack` (validate + report installed version, installs nothing), `import_watermark_pack`, `export_watermark_pack`, `delete_watermark_pack`, `add_watermark` (add/replace one watermark, optionally creating a pack; bumps version), `remove_watermark`
  - `convert_raw_batch()`: Extract embedded JPEG previews from RAW files
  - `yt_download()`: Download a YouTube URL as MP4/MP3 via `yt-dlp` (in `ytmp3.rs`), streaming progress as `yt-update` events
  - `preload_transcribe()`: Warm the Python transcription model on tab open
  - `process_video()`: Transcribe video file (reuses warm sidecar or spawns new)
  - `save_srt()`: Write a `.srt`, `.ass` or `.bstyle` (shared subtitle look) file to disk (other extensions are rejected)
  - `render_subtitles(video_path, ass, output_path, mode, fonts, logo, end_card_seconds)` / `cancel_render()` (`subtitle_render.rs`): export a burned-in MP4 (`mode: "burn"`) or a transparent ProRes 4444 MOV (`mode: "alpha"`) by running the transcription sidecar in `--render` mode, with the bundled fonts (`Resources/fonts`, or `public/fonts` in dev) and an optional corner logo; streams `render-update` events
  - `audio_peaks(media_path)` (`subtitle_render.rs`): waveform for the timeline when a session is reopened without re-transcribing (`transcribe --peaks`) → `{ rate: 50, peaks: [0–255] }`
  - `load_style_file(path)` (`subtitle_render.rs`): read a `.bstyle` look file (≤ 512 KB) chosen by the user
  - Post templates (`post_templates.rs`): `list_post_templates`, `get_post_template_overlay(id)` (overlay as a `data:` URL so the canvas is never tainted and `toBlob` works), `save_post_template(manifest, overlay_path?, overlay_bytes?)` (validates a decoded PNG in the selected format), `delete_post_template(id)`, `save_post_image` (raw request body + percent-encoded `path` header; only JPEG/PNG data to a `.jpg/.jpeg/.png` path)
- Parallel processing via **Rayon** for RAW conversion and watermarking; watermarking runs in batches of up to 8 photos: decode, then encode/write, are parallel (Rayon) while duplicate checks, output names, logs and progress stay sequential in filename order
- Watermark scaling cached per (width, height) to avoid redundant resizing
- Event emission: `log`, `progress`, `done`, `raw-done`, `transcribe-update`, `render-update`, `yt-update`
- CPU-heavy image/RAW work and blocking render setup use `tauri::async_runtime::spawn_blocking()`. Other commands include synchronous configuration/template/file operations and async sidecar handling; inspect the relevant module before changing concurrency.

#### Tauri plugins
- `tauri_plugin_shell` — spawn the Python transcription sidecar (note: `yt_download` spawns `yt-dlp` directly, not via this plugin)
- `tauri_plugin_dialog` — file/folder pickers
- `tauri_plugin_opener` — open output folder in Finder/Explorer
- `tauri_plugin_updater` — signed auto-updates from the Vercel manifest endpoint (desktop targets only)

#### Event emission
- Backend emits events via `app.emit("event_name", payload)`
- Payloads are structs that derive `serde::Serialize`
- Frontend listens via `listen()` from `src/lib/tauri.js`
- Common events:
  - `log(tag: String, msg: String)` — info, warn, error, ok, file tags
  - `progress` — payload `{ fraction: f64 }`, from 0 to 1
  - `done(processed: u32, failed: u32, duplicates: u32, output_dir: String, elapsed_ms: u64)` — watermark summary
  - `raw-done(converted: u32, skipped: u32, output_dir: String, elapsed_ms: u64)` — RAW conversion summary
  - `transcribe-update(serde_json::Value)` — transcription events from sidecar
  - `yt-update({type, ...})` — YouTube download progress / converting / done / error

#### Python sidecar protocol
Stdout is newline-delimited JSON. Each message must include `"type"` field:
```json
{"type": "status", "message": "Loading model..."}
{"type": "progress", "value": 45.5}
{"type": "ready"}
{"type": "done", "srt_path": "/path/to/file.srt", "all_words": [...], "timing_source": "masri_ctc"}
{"type": "error", "message": "..."}
```
- Preload mode emits `ready` to signal model is warm; Rust backend withholds it from the frontend
- Direct mode skips `ready` event entirely
- Render mode (`--render <job.json>`) emits `status`, `progress` (0–100), then `done` (`{path}`), `cancelled` or `error`, and always exits 0 after reporting
- Peaks mode (`--peaks <media>`) prints one `{"type": "peaks", "rate": 50, "peaks": [...]}` line (or `error`)
- All messages flushed with `flush=True` to ensure real-time delivery

#### File path resolution
- Input/output paths are `String` from JavaScript, converted to `PathBuf` in Rust
- Watermark packs dir: `packs_root()` in `watermark_packs.rs` → `app.path().app_data_dir().join("watermarks")` in both debug and release (created on demand)
- The transcribe sidecar is resolved via Tauri's `shell().sidecar("transcribe")` — bundled in app. For YouTube download, `yt-dlp` (and Deno if the Mac has none) live in `<app data>/tools/`, downloaded and updated by the app; ffmpeg comes from the engine
- MLX model path resolved by `mlx_model_path()` in `transcription.rs`: checks resource dir first, then walks up from `current_exe()` for dev builds

### Cloud API (`backend/` — Vercel serverless functions)

The `backend/` directory contains Node.js serverless functions deployed on Vercel. These handle all social media scheduling and publishing:

**Core API endpoints (10 handlers in the current source):**
- `api/schedule.js` — POST: Create a new scheduled post (saves to Supabase)
- `api/history.js` — GET: Fetch paginated post history (filterable by status, searchable by caption; optional `from`/`to` ISO window on `scheduled_time`, used by the Calendar's day list)
- `api/posts/[id].js` — GET a post; PATCH queued edits/rescheduling/media; POST retry/verify; DELETE cancel/remove. Mutations compare revisions and claim via status CAS before external work. Published/unknown destinations block editing; cancelling a native Facebook schedule requires remote verification. Shared media is left for retention cleanup.
- `api/cron/process.js` — GET/POST (auth: `CRON_SECRET`, not `API_KEY`): publishes due posts to FB/IG (old WordPress jobs fail with a clear message, since the WordPress publisher was removed) and hands eligible Facebook posts to Facebook's native scheduler. Triggers and cadence: see the scheduling note below. The handler accepts both `GET` and `POST`.
- `api/meta.js` — Consolidated utility endpoint:
  - `GET ?type=version` — backend/desktop version info
  - `GET ?type=profiles` — committee profile list (id + name, never exposes tokens)
  - `GET ?type=live-posts` — live FB/IG posts pulled from the Graph API
  - `POST {action:'cleanup', paths:[...]}` — remove uploaded media from Supabase Storage
- `api/drive/[...slug].js` — Google Drive proxy (catch-all route):
  - `GET /api/drive/posters[?folderId=...]` — list files in a Drive folder
  - `GET /api/drive/file/:id` — stream a single Drive file
- `api/reports/monthly.js` — GET: PR report data (`from`/`to`, optional `profile_id`,
  `compare_from`/`compare_to`). Trend comparison defaults to the immediately-preceding
  period (calendar-aware: a full month/quarter/year compares against the true previous
  one, not just "N days back") unless `compare_from`/`compare_to` are given. Page
  impressions and FB follower net change are queried for the exact `from..to`/comparison
  range via `since`/`until`. Absolute Facebook/Instagram follower totals are current counts
  fetched at report time, not historical snapshots.
- `api/media.js` — POST, dispatched by `?action=`: `sign-upload` issues a path-scoped Supabase
  signed-upload token; `check` does a pre-flight reachability check on up to 10 media URLs before
  scheduling. Consolidated into one file (CONSOLIDATE-1) rather than two under `api/media/` to keep the
  function count down.
- `api/tasks.js` — Xogħol (`createTasksHandler(client)` for tests). Tables `task_boards` → `task_columns` (`board_id`) → `tasks` (`column_id`), all with `profile_id`:
  - `GET ?profile_id=` — `{ boards, columns, tasks }` of the profile. No board is created automatically
  - `POST { type: 'board'|'column'|'task', request_id, profile_id, … }` — idempotent create (same `request_id` → same row). A board is returned as `{ ...board, columns }` with its starting columns (Biex isir, Għaddej, Lest), inserted with `request_id`s derived from the board's, so a retried create neither duplicates nor misses them. A column needs `board_id`; limits 20 boards per profile, 12 columns per board
  - `PATCH ?type=board|column|task&id=` — partial edit. A `revision` in the body must match (else `409` with `current`); moves (`column_id`/`position`) are sent without one, last move wins
  - `PATCH ?id= { op: 'check', item_id, done }` — ticks one checklist item with a compare-and-swap retry, so concurrent ticks on different items both survive
  - `DELETE ?type=board|column|task&id=` — deleting twice is fine; a column must be empty and cannot be its board's last; a board is deleted with its cards and columns (explicitly, and by `on delete cascade`)
  - A card's `column_id` may point to another board of the same profile (moving between boards)
  - Validation is in `api/_lib/task-rules.js`, also imported by the desktop (`src/views/xoghol/model.js`)
- `api/updates/[target]/[arch]/[current_version].js` — GET: Desktop auto-update check

**Shared modules** (`_lib/`, not functions): `auth.js`, `cors.js`, `delivery.js` (resumable Graph publishing; exports `GRAPH`, the one place the Graph API version is set), `post-rules.js` (validation/status), `malta-time.js` (also used by the desktop), `profiles.js` (the only reader of `COMMITTEE_PROFILES`; credentials), `google.js` (Drive client), `task-rules.js` (Xogħol validation, also used by the desktop). The function-count rule is in AGENTS.md → Gotchas.

**Authentication:**
- Application endpoints require `Authorization: Bearer ${API_KEY}`. The cron accepts only `CRON_SECRET`; the updater manifest is public. CORS preflight is handled separately.
- Facebook/Instagram credentials stored in `COMMITTEE_PROFILES` env var (JSON array of committee accounts)
- Google service account credentials in `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS` env var.

> **Scheduling note:** `backend/vercel.json` configures a **once-daily** fallback (`0 0 * * *`). The regular trigger is `.github/workflows/cron.yml`, a GitHub Actions workflow that hits `/api/cron/process` every 15 minutes with `CRON_SECRET` (requires the `VERCEL_URL` and `CRON_SECRET` repo secrets to be set). Eligible posts — ordinary Facebook posts (not Reels or Stories) more than 10 minutes and up to 30 days ahead — are handed to Facebook's native scheduler; everything else waits for a worker run. Each run handles at most 5 due posts within its time budget, so worker-published destinations may appear late. If the Actions workflow is ever disabled, publishing degrades to the daily Vercel run (Vercel Cron calls with `GET`, which `cron/process.js` accepts alongside `POST`).

**Data flow:**
1. Desktop app calls `POST /api/schedule` to schedule a new post
2. The worker (triggers and limits: scheduling note above) hands eligible Facebook posts to the native scheduler, then publishes due posts
3. For each due post:
   - Resolves credentials from `COMMITTEE_PROFILES` by profile_id
   - Calls resumable `advanceDelivery()` per destination, persisting IDs, containers and stages after every step
   - Persists `publishing` before the external commit boundary; ambiguous responses become `unknown`, never automatic resubmission
   - Polls Instagram containers/Facebook video publishing status and derives aggregate status from all destination states
4. Desktop app fetches history via `GET /api/history` to show results

### Data flows

#### Watermark & Sort
1. User picks input folder, a watermark (grouped by pack with a heading per pack in Marka; last choice remembered in `localStorage`), quality, max dimension, watermark toggle, "Neħħi duplikati wara xulxin" toggle (off by default, remembered in `localStorage` as `banditur_dedupe`)
2. UI calls `process_images()` command (`skipDuplicates` ↔ `skip_duplicates`)
3. Rust backend:
   - Resolves `watermark_id` via `wm_pack::resolve_watermark` (ids validated — no path traversal) and loads its portrait/landscape PNGs (warns per missing orientation; stops if both missing or pack not installed)
   - Scans input directory for supported formats (JPG, PNG, TIFF, BMP, WebP)
   - Spawns a blocking task and processes files in batches (≤8, one per core) in sorted filename order; results are logged in order
   - For each file:
     - Decode (mozjpeg or image crate)
     - Read EXIF orientation; apply rotation in-memory (8 orientations handled)
     - Resize if max_dim specified (Triangle filter)
     - If `skip_duplicates`: dHash (9×8 grey) of the oriented image; Hamming distance ≤ `DUP_MAX_DISTANCE` (5) to the last kept photo → `Outcome::Duplicate`, not written, counted in `DoneEvent.duplicates`
     - Detect portrait vs landscape by height > width
     - Fetch cached, pre-scaled watermark; composite onto image
     - Encode JPEG with mozjpeg at target quality
     - Save directly to the selected output folder (adds a ` (2)`-style suffix instead of overwriting when two sources map to the same JPEG name)
     - Emit `log` event with filename and result
   - Emits `progress` event (fraction done) per file
4. Frontend updates progress bar and log viewer
5. Backend emits `done` event with summary (processed count, failed count, output path, elapsed ms)
6. Frontend offers to open output folder

#### RAW Conversion
1. User picks input folder, quality, max dimension
2. UI calls `convert_raw_batch()` command
3. Rust backend:
   - Scans for RAW formats (ARW, CR2, CR3, NEF, ORF, RW2, DNG, RAF)
   - For each file (in parallel via Rayon):
     - Parses TIFF IFD (big-endian or little-endian) to find embedded JPEG
     - Validates the embedded JPEG is > 50 KB (sufficient resolution) and ≤ 100 MB (guards against corrupt/crafted length tags)
     - Extracts raw bytes without transcoding
     - If extraction fails, falls back to binary scan (`0xFF 0xD8` marker) — slower but robust
     - Optionally resizes if max_dim specified
     - Saves `<stem>.jpg` into the chosen output folder (the UI defaults it to a sibling `<input-folder>-riżultat` folder)
     - Emits `log` event per file
   - TIFF parsing is manual byte-level work with no dependency: little-endian (`II`) and big-endian (`MM`), searching the IFD chain for the preview (tag 0x0201 = offset, 0x0202 = length) and sub-IFDs via 0x014a (SubIFD) and 0x8769 (ExifIFD). The binary fallback finds the largest `0xFF 0xD8 … 0xFF 0xD9` span
   - What is extracted is the camera's **preview-quality** JPEG, not the full-resolution demosaiced image. The fallback scan is slow, can pick up spurious JPEG data in metadata and must find a JPEG over 50 KB; some newer formats (e.g. Sony A1/A7RV ARW) have unusual TIFF structures that only the fallback handles. With no resize the embedded bytes and tags are kept as they are (un-rotated)
4. Backend emits `raw-done` event with success/skipped counts, output path and elapsed ms

#### Video Transcription
1. User opens Transcription tab → Rust backend calls `preload_transcribe()`
2. Sidecar spawned in **preload mode** (no video path as argument)
   - Python script: loads MLX Whisper model, emits `{"type": "ready"}`, waits on stdin for video path
   - Rust backend stores the sidecar's stdin channel in `TxState` for one media request
3. User picks video file → UI calls `process_video(video_path)`
4. Rust backend:
   - Sends path to preloaded sidecar via its stdin channel, OR
   - If the warm sidecar's channel is closed (crashed during preload), falls back to spawning a fresh sidecar in **direct mode** (path as CLI arg)
   - Passes `MLX_MODEL_PATH` env var pointing to the local model (resolved via `mlx_model_path()` in `transcription.rs`)
5. Python sidecar:
   - Resolves `ffmpeg` via `_find_ffmpeg()` — prefers the binary shipped with `imageio-ffmpeg` (collected into the release bundle), then `PATH`, then `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`
   - Extracts audio (ffmpeg, 16kHz mono) to a temp `.wav`
   - Transcribes with MLX Whisper (per-request language; legacy default `WHISPER_LANG=mt`)
   - Force-aligns Maltese words against the extracted waveform with the optional local MASRI Wav2Vec2 CTC model when its dependencies are available; falls back to Whisper timing if that optional pass fails or can't run. Release bundles don't include the aligner, so they skip it (see Known Quirks)
   - Keeps Maltese articles / short forms attached (`sidecar/maltese.py`: "L" "-festa" → "l-festa", "f'" "Malta" → "f'Malta")
   - Computes waveform peaks from the temp WAV (`sidecar/peaks.py`, 50 per second, 0–255)
   - Emits JSON events: `status`, `progress`, `done` (with SRT path, word list, `timing_source`, `peaks`, `peaks_rate`)
   - Frontend listens to `transcribe-update` events
6. Frontend (`src/subtitles/editor.js`):
   - Waits for the video's size, then groups the words into cues (`buildCues`: max words, max pause, `cueCharBudget()` — what fits on two lines at this look and format —, sentence ends, speaker changes) and merges split articles (`mergeArticlesInCues`, unless turned off in *Split*)
   - Edits go through the undoable `SubtitleDoc`; the session (cues, look, split settings, logo, end card, waveform) autosaves as a versioned native project. Legacy `banditur_subs:<media path>`/`banditur_peaks:<media path>` records are removed only after a successful migration
   - Caption-free sections: cues only cover their words, so pauses already leave gaps; *Split* tab → "Parti mingħajr caption" + *Naddaf il-gaps* (`applyGaps`) pulls back cues stretched across pauses longer than the slider
   - Dropping a file that has a saved session shows an inline resume card ("Continue" / "Transcribe again"); the drop screen also lists recent sessions (*Recent*). Each recent has a × (first click turns it into "Delete?", a second within 3 s deletes only the saved edits and waveform via `deleteSavedSession()`; never the video) and *Clear all* (`clearSavedSessions()`, same two-step). Cmd/Ctrl+S saves `.srt` next to the source via `save_srt()`

#### Subtitle editing & export
1. Layout: the Svelte Traskrittura view hides its drop screen while the editor is open; the editor has its own slim bar (← back, file name, Split/Join, ↶ ↷, Style, ?, Export ▾). Video and one-line cue list side by side (vertical video gets a narrower column), timeline underneath, settings in a drawer (`S`, `Esc` closes). From 861 px wide the drawer is docked as a third column beside the list (`.sub-editor.drawer-open .sub-main`), so it never covers the captions; on narrower windows it overlays the list. With it open each row shows only its first warning badge. The editor UI is Maltese with English technical terms (`SUB` / `TX` in `strings.js`)
2. Shortcuts (editor visible, not typing; capture phase so they win over the global 1–4 view keys): `B` split · `J` join · `I`/`O` trim start/end to playhead · `Q`/`W` roll the cut with the previous/next cue · `1`/`2` move first/last word to the neighbouring cue · `[`/`]` nudge the selected word's highlight ∓50 ms (`{`/`}` ∓10 ms) · `K` keyword · `P` big line (per-caption style `punch`: large, slanted, upper case, mid-frame) · `U` next unsure word · `E` next hard-to-read cue · `Enter`/double-click edit · `Delete` remove · `Space` play/pause · `↑`/`↓` cue · `←`/`→` ±1 s · `+`/`−` zoom · `T` timeline · `G` safe-area guides · `S` drawer · `?` shortcut sheet · `⌘Z`/`⇧⌘Z` undo/redo (the toast names the step undone)
3. Target cue: actions apply to the cue under the playhead, else the selected one (trim: the selected one). It's marked ▸ in the list and outlined in the timeline. Buttons are disabled with the reason in their tooltip when an action can't run (`reason()` dry-runs the op on a copy of the neighbouring cues); keyboard attempts toast the reason
4. Cue rows show readability badges from `cueIssues()` (`fast` > 20 chars/s, `short` < 0.7 s, `lines` > 2 lines). Hover tools: ✎ edit, ⇤/⇥ move word, ✕ delete. The first/last word of a row can be dragged onto the neighbouring row
5. Timeline (`timeline.js`): drag an edge to trim independently, hold Shift on a touching edge to roll the shared cut, drag the middle to move; snaps to word boundaries and the playhead (Alt = no snap); `Esc` cancels a drag. ⌘/Ctrl + scroll zooms around the pointer
6. **Names**: name spellings that differ beyond letter case (diacritics stripped, `ħ`→`h`, one-edit fuzzy matches for ≥ 5 letters; ties prefer the spelling with Maltese letters). **Articles**: `findArticleIssues()` flags assimilation mismatches (`il-ċens` → `iċ-ċens`, `id-festa` → `il-festa`), short form + article (`f'il-` → `fil-`) and dangling articles, each with a one-click fix — never changed automatically. Plus find & replace
7. **Style**: presets (Gold, Pill, Classic) are animated tiles (`createTiles`, hover previews on the video); the look's layers are editable below (entry, word effect, emphasis; font, size, case, colours, outline/shadow/glow/box; position, alignment, margin, chars per line, safe area; logo). Scope "Subtitle magħżul": the preset tiles set a per-cue preset (animation layers only), and every other control in the drawer changes only the selected caption — stored as `cue.look` (partial overrides, `setCueLook`/`resetCueLook` in `model.js`; allowed keys `CUE_LOOK_KEYS` in `styles.js` — box, lines and safe area stay video-wide and are greyed out). `effectiveLook()` merges them; `buildAss()` restates font, bold, size/outline/shadow, colour and outline colour inline (`\fn \b \fs \bord \shad \1c \3c`) for such captions, and the pill layer takes its own accent. Controls show the selected caption's values, labels of overridden settings turn blue, a slider drag is one undo step, setting a value back to the video's removes the override, and the row shows "Stil għalih". *✕ Bħall-bqija tal-video* clears both the caption's own preset and its look overrides (`resetCueLook`). Picking a preset designed for shorter cues offers a one-click re-split. Looks can be saved (`banditur_sub_looks`), exported/imported as `.bstyle` JSON (`{format: 'banditur-subtitle-style', formatVersion: 1, name, look}`)
7b. **Anchor & safe area**: every caption is anchored on its vertical middle (`\an5`, `\an4` when left-aligned; the preview translates by −50 %), so making the text bigger or adding a line grows it evenly up and down and it stays at the same height. *Margin* is the distance from the frame edge to that middle line; with *Żomm 'il bogħod…* on, the margin is at least the format's safe area + 4 % of the height (fixed, not size-based). The **Safe area** toggle in the editor's bar (`G`, remembered as `banditur_sub_guides`) draws the dashed safe rectangle and, on vertical videos, a sketch of the Reels UI (side buttons, user/caption/audio, top bar, red-tinted zones) — preview only, never exported
8. Preview: `cueHtml()` uses the same `layoutFor()`/`frameState()`/`wrapLines()` as the export and each font's measured `em` ratio, with the same bundled font files, so it lines up closely with libass (checked side by side; glyph rendering differs slightly). Custom transport controls in the timeline header, so nothing covers the subtitles
9. Export menu: MP4 (burn), MOV (alpha), Save SRT, SRT/ASS as…. MP4 / MOV: the frontend builds the `.ass` (PlayRes = video size) and calls `render_subtitles`; Rust writes a temp job (`job.json` + `subs.ass`), adds `fontsDir`, spawns `transcribe --render <job.json>`, forwards stdout as `render-update` events (shown in a strip under the bar) and deletes the temp dir afterwards
10. `sidecar/subtitle_render.py`: probes the video with `ffmpeg -i`, links the bundled fonts plus any requested system family into a private `fontsdir`, and runs ffmpeg with `ass=subs.ass:fontsdir=fonts` — H.264 CRF 18 + AAC for `burn`; a transparent `color` source + `ass…:alpha=1` → ProRes 4444 (`yuva444p10le`) for `alpha`; an optional logo is overlaid with `overlay=…:shortest=1`. Progress from `-progress pipe:1`. Writing `cancel` to stdin (or stdin closing) stops ffmpeg and deletes the partial file

#### Post maker (Posts)
1. Templates live in the app-data folder as `post-templates/<id>/template.json` + `overlay.png` (like watermark packs: outside the bundle, survive updates). `template.json` = `{ version: 2, width:1080, height:1350, id, name, zones: [{ id, label, x, y, w, h, font, color, align, valign, case, minSize, maxSize, maxLines, lineHeight, shadow, sample }] }` — boxes in the selected 1080-wide frame, 1–2 zones, the first is required when exporting. Height is 1080, 1350 or 1920; old version-1 templates default to 1350
2. The user picks a template and a portrait (`createImageBitmap(file, { imageOrientation: 'from-image' })`), positions it (state `{ zoom, cx, cy }`, zoom 100–800 %), types the name(s); `drawPost()` redraws on every change
3. *Esporta…* renders an off-screen canvas to JPEG (quality 0.93), asks for a path with the save dialog and calls `save_post_image`; *Uża f'post* hands a `File` to the composer instead
4. `views/posts/WorkPanel.svelte` (with `postmaker/production.js`) adds portable `.btemplate` packs, square/portrait/Story formats, branded starters, durable projects and reviewed names/CSV batches. Story preview guides use the existing subtitle safe-area geometry and are omitted from exports.
11. Timing and splitting rules: `setWordStart()` pins word 0 to the cue start and constrains later word starts between their neighbours; timeline drags form one undo step; `[`/`]` nudge 50 ms, `{`/`}` 10 ms. The words-per-caption value is a maximum, also constrained by line wrapping, pauses, sentence ends and speaker changes; re-splitting sorts words by time, and changing size or line settings can offer a re-split when captions no longer fit
12. Remembered values: export folder, last Studio tool, calendar view, theme and profile. The last screen is not restored; start-up is always Home. UI strings live in `src/strings.js`, the Svelte views and `views/traskrittura/editor.html`; `index.html` is the app shell

#### Xogħol boards
1. `views/Xoghol.svelte` (Social → Xogħol, key `5`; Home shows the open count) loads the profile's boards through `xoghol/board.svelte.js`, which sends `/api/tasks`-shaped requests to `xoghol/local-store.js`: one JSON document in localStorage (`banditur_xoghol`), validated with the backend's `task-rules.js`, tested in `local-store.test.mjs`. To share boards later, point `api` in `board.svelte.js` back at `lib/api.js`. It shows one board at a time (`board.boardId`; tabs; last choice in `localStorage` as `banditur_xoghol_board:<profile>`, falling back to the first board) and an empty state with a name field while the profile has none. does not poll (nothing changes behind its back)
2. Changes are optimistic: the board updates at once, the request follows, the server's row replaces the local one, and a failure restores the snapshot with a toast and re-reads the board. Cards being created have a `tmp-` id and cannot be moved/opened until saved
3. Order uses fractional `position`s (`model.js` → `positionAt`/`planMove`): a move normally rewrites only the moved card; when neighbours are too close, the target column is renumbered
4. Drag uses pointer events (not HTML5 drag-and-drop, which the webview's file-drop handling interferes with): 5 px threshold, a floating copy follows the pointer, a dashed gap marks the drop place (`dropIndex` against card midpoints), the board/column auto-scroll near edges, Esc cancels. Keyboard: `Enter` opens, `⌥`+arrows move (`keyboardTarget`)
5. `xoghol/TaskDialog.svelte` edits title, label, dates, Budget/Spent, column, checklist (each step: optional dates, Budget, Spent) and notes and saves with the revision it opened with. On `409` it re-reads the board and offers "Ara l-verżjoni tagħhom" or "Issejvja tiegħi xorta"
6. Boards and columns share the title/position code (`rename(type…)`, `shift(type…)`); deleting a board removes its columns/cards locally and shows the neighbouring board. The dialog's column list covers every board ("Board · Kolonna")
7. Dates are `YYYY-MM-DD`: `start_date` (optional, must be ≤ `due_date`; `datesProblem()` in `task-rules.js` also checks a PATCH that changes only one end) and `due_date`, compared with today's Malta date (`dueInfo`, `datesInfo` for the card's range); a board's last column counts as finished (no overdue colours). Money is whole cents: `budget_cents` / `spent_cents` on a card and on a checklist step (`task-rules.js`, `eurosToCents`/`centsToInput`/`moneyText`/`moneyInfo`/`budgetTotals` in `model.js`); step amounts are never added to totals. Checklist steps may carry `start_date`/`due_date` (validated in `cleanChecklist`); `stepsOf()` in `gantt-model.js` returns the dated ones and `chartRange` includes them. The `?mock` preview uses the same local store (the browser's localStorage)
8. Gantt (`xoghol/GanttView.svelte`, mode in `banditur_xoghol_view`, zoom in `banditur_xoghol_scale`): rows are the board's columns then cards in board order (`ganttRows`); the range (`chartRange`) covers today and every dated card, padded and aligned to weeks/months, and the view compensates `scrollLeft` when it grows to the left. Bars drag with pointer capture; `dragDates` moves or resizes (≥ 1 day) and `setDates()` in `board.svelte.js` saves start+due optimistically without a revision check. The Gantt shows a sub-row per dated step (`setStepDates`, drag like a card; `showSteps` in `banditur_xoghol_steps`) and can create from the chart: `addTask(columnId, title, {start_date,due_date})` and `addStep(taskId, text, dates)`. Export draws its own canvas (`drawGantt`, dated cards and steps, with amounts) and saves through the Rust `save_post_image` command, which accepts `.pdf` when the bytes start with `%PDF-`. The PDF is always A4: `a4Fit()` picks landscape when the chart is wider than tall, scales it to fit inside 28 pt margins and centres it (`pdfWithJpeg(..., page)`); a very tall chart is shrunk onto one page

#### YouTube Download
1. User enters a YouTube URL, picks an output folder, and chooses MP4 or MP3
2. UI calls `yt_download(url, output_dir, format)`
3. Rust backend (`ytmp3.rs`):
   - Validates the format and the URL (must be an http(s) YouTube link) and that the output folder exists
   - Gets its tools (one download at a time, `TOOLS_LOCK`): its own `yt-dlp` — the standalone `yt-dlp_macos` from the **nightly** channel, fetched with `/usr/bin/curl` into `<app data>/tools/yt-dlp` on first use and `yt-dlp -U`'d when `tools/yt-dlp.checked` is over 24 h old (Homebrew/pip/PATH copy only if the download fails); `ffmpeg` from the engine (`components::engine_ffmpeg()` → `_internal/imageio_ffmpeg/binaries/ffmpeg-*` in the installed engine, the app bundle, `sidecar-dist` or the venv; system ffmpeg as fallback; no ffprobe needed); a JS runtime — Homebrew/`~/.deno` Deno, else the app's own Deno (`deno-<arch>-apple-darwin.zip`, unzipped into `tools/`), else Homebrew Node — passed with `--js-runtimes`. A system yt-dlp is asked (`--help`) whether it knows `--js-runtimes` and `--remote-components`; the latter (`ejs:github`) is added for pip installs that lack the challenge-solver scripts
   - Spawns `yt-dlp` with `--` before the URL (argument-injection guard)
   - Parses stdout for `[download] NN%` progress and conversion/merge markers
   - If the run fails with an "outdated" error (403, extraction/challenge failure, `looks_outdated()`), updates the app's yt-dlp immediately and retries once
   - Emits `yt-update` events: `{type:"preparing", message}` (fetching/updating tools), `{type:"progress", value}`, `{type:"converting"}`, `{type:"done", path, title}`, `{type:"error", message}`
4. Frontend updates the progress bar and offers to open the downloaded file

### Production workflow internals (2026-10-29)

- `backend/api/_lib/post-rules.js` owns shared pure destination validation and status aggregation; `delivery.js` owns resumable Graph stages. `malta-time.js` is shared with the frontend. Keep backend imports inside the deployed `backend/` root.
- `schedule.js` accepts `request_id` UUIDs; its unique partial index handles repeated/concurrent submissions. Old clients can omit the ID. `posts/[id].js` uses `revision` plus a status CAS shared with the worker; a trigger increments revisions on every DB update. Handler factories support isolated tests.
- `deliveries` stores each destination's `state`, ID, container/child IDs, upload stage, retry deadline and errors. A remote ID alone is not proof that a video is published. Unknown/publishing outcomes are reviewable; retries skip confirmed published/scheduled destinations. Do not reset an unknown outcome without explicit acknowledgement.
- Worker recovery releases claims older than ten minutes while preserving delivery records. Ordinary future Facebook posts can use native scheduling; Reels/Stories use their dedicated endpoints when due. Per-run shared budget is 16 seconds, at most five jobs; external network calls also have timeouts. GitHub cadence remains fifteen minutes. Daily GET maintenance refreshes engagement and collects retained media.
- Referenced active/failed/pinned media is kept. Published references expire after `media_retention_days`; unreferenced uploads get a 24-hour grace period. Cancelling or editing a post does not delete shared media immediately.
- `projects.svelte.js` serialises writes and caches metadata; `projects.rs` validates versioned JSON, writes atomically under app-data/projects, and imports/exports `.banditur` ZIPs with optional streamed media/logo. Imports get fresh IDs, restrict named entries and clean up failed extractions. JSON/text cap 16 MB; each portable asset cap 2 GB. Browser mock fallback uses localStorage only.
- The Posts work panel (`views/posts/WorkPanel.svelte`, formerly `postmaker/workflows.js`) extends the existing engine: formats, projects, per-profile branding/starters, `.btemplate` packs and batch review/export/drafts. One `drawPost()` still draws previews and output. Native pack import validates all decoded PNGs before staged installation. New project IDs prevent overwriting earlier work; reopened projects retain their original event link.
- `subtitles/import.js` parses SRT and replaces source-time passages while preserving outside edits. Passage replacement is one undo step. Editor review combines readability/confidence, articles and names; source relink preserves project identity. Recognition language is a per-request UI selection.
- `studio-jobs.svelte.js` persists a common activity index. Photo jobs have one serial lane (its saves are throttled to once a second while a job runs, with a final save when it ends and on `pagehide`), download jobs another. Correlated native IDs plus completed-file lists support cancellation/retry without replaying successful files. Restarted running/queued jobs become interrupted and need operator action. `photo_jobs.rs` guards exclusivity and cancellation; a reviewed duplicate skip list freezes choices.
- Home shows failed/overdue/interrupted/unfinished work and active jobs. Event workspaces link native projects, Studio outputs and scheduled posts through `event_id`; category/event filters scope report posts. `engagement_checked_at`/error and measured-post coverage distinguish unavailable metrics from zero.
- New native commands: `list_projects`, `save_project`, `delete_project`, `export_project`, `import_project`, `read_work_text`, `save_work_text`, `list_media_files`, `inspect_photos`, `cancel_photo_job`, `cancel_download`, `import_post_templates`. Existing photo/download commands accept optional job IDs; photo commands accept retry include lists; `process_images` also accepts reviewed skip/keep lists.
- Composer autosave awaits IndexedDB before form metadata. Interrupted submissions retain their request/body/media; repeated edits first read back committed fields. Archive duplication reuses uploaded media, and Studio handoffs preserve an existing composer as a draft.

### Known quirks

- **Transcription**: model loading is synchronous inside the Python process, but `preload_transcribe()` spawns it asynchronously and the UI does not wait for it. Opening Traskrittura (`views/Traskrittura.svelte`) calls `invoke('preload_transcribe')` so the first video starts faster. `TxState` holds a `Mutex<Option<tokio::sync::mpsc::Sender<String>>>` for the warm sidecar; `process_video()` consumes it, so if two requests arrive together the second spawns a fresh sidecar. The warm sidecar accepts a JSON request with path/language/start/end, or a legacy plain path.
- Language is selected per request (`mt`/`en`/`it`/`auto`), defaulting to `WHISPER_LANG`. A passage is sliced before recognition and its word times are offset back to source time; the Maltese CTC pass is used only for Maltese requests. `masri_alignment_enabled()` checks that both `torch` and `ctc_forced_aligner` import, so a bundle without them keeps Whisper's timings instead of failing.
- MLX Whisper (Apple Silicon GPU) is much faster than standard Whisper but needs the custom `mlx-maltese-whisper-4bit` model. The first alignment run is slower while its model downloads.
- **YouTube**: the MP4 format string is `bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b`, remuxed to mp4. The output filename is `%(title)s.%(ext)s`; `yt-dlp` sanitises path separators in titles.
- **Parallel work**: RAW conversion uses Rayon (`files.par_iter()` in `raw_converter.rs`), so its logs arrive in completion order; atomic counters track progress. Watermarking uses batches capped at 8 / core count: parallel decode, sequential duplicate and name decisions, parallel resize/composite/encode/write, then logs and progress in filename order. Physical file write completion need not follow that order.

### Build internals

#### Dev build
```bash
npm run tauri dev
```
The `transcribe` sidecar wrapper walks up from `target/debug/` to find the project root and invokes `sidecar/transcribe.py` directly via the venv Python. This gives full Metal GPU acceleration.

#### Release build

The transcribe sidecar uses a **release bundle plus dev fallback** to preserve Metal GPU acceleration in release builds:

**Tier 1 — Release (PyInstaller `--onedir` bundle):**
- `--onedir` keeps all `.so` files at fixed paths inside `Contents/Resources/` instead of extracting to `/tmp`, which is required for MLX to initialise the Metal backend
- The bundle is built into `sidecar-dist/transcribe-bundle/` (gitignored) and `npm run build:local` copies it to `<app data>/components/engine/<n>/` (no longer a Tauri resource; see "Local pieces")
- The wrapper script at `src-tauri/binaries/transcribe-aarch64-apple-darwin` execs `$BANDITUR_ENGINE_DIR/transcribe-bundle` when the app sets it (components folder), else the Resources bundle (older builds)

**Tier 2 — Dev fallback:**
- If the Resources bundle is not present (dev context), the wrapper walks up from `pwd` to find the project root and runs `sidecar/transcribe.py` via the venv Python

**Full release build:**
```bash
npm run tauri build
```

`tauri.conf.json`'s `beforeBuildCommand` is just `npm run build`; the engine is built by `npm run build:transcribe` (or `npm run build:desktop` = both) and, through `build:local`, only when its fingerprint changed. The script:
- needs `venv/` with `pyinstaller` installed, and the model at `mlx-maltese-whisper-4bit/`
- runs PyInstaller with `transcribe-bundle.spec` (onedir `COLLECT`; collects `mlx_whisper`, `mlx`, `imageio_ffmpeg` and the `subtitle_render`, `maltese` and `peaks` modules; **excludes `torch`, `scipy` and `hf_xet`** to keep the bundle small)
- fixes the MLX rpaths and ad-hoc re-signs the MLX libraries
- fails if the bundle is missing `mlx.metallib` or the bundled ffmpeg, or contains `torch`/`scipy`/`hf_xet`

`bundle.resources` in `tauri.conf.json` now holds only the fonts; the engine and model are installed separately (below). To rebuild only the sidecar: `npm run build:transcribe`. For signed updater builds and publishing (dormant while the app is built locally), see RELEASE.md.

##### Local pieces (`npm run build:local`)
Four pieces, each fingerprinted (`scripts/lib/pieces.mjs`: SHA-256 over its input files; the model by name+size): **interface** (`src`, `index.html`, `vite.config.js`, `package-lock.json`, `public` minus fonts, the three `backend/api/_lib` files the desktop imports; test files ignored), **core** (`src-tauri/src`, Cargo files, `tauri.conf.json`, capabilities, icons, `banditur-config.json`, the launcher script, fonts; plus the interface while `UI_LOADER` is `false`), **engine** (`sidecar/`, `transcribe-bundle.spec`, the build script, the venv's Python version), **model**. `.build-cache/manifest.json` (gitignored) remembers what was last built; `makePlan()` decides build/install per piece and `scripts/build-local.mjs` (`runBuild`, tested with fake steps in `build-local.test.mjs`) carries it out. The engine and model are copied (APFS clone, falling back to a copy) to `<components>/{engine,model}/<n>.partial`, checked against the source by `treeHash`, renamed, then `installed.json` is written last; the previous version is kept, older ones removed (`scripts/lib/components.mjs`). The core is built with `tauri build --bundles app --config src-tauri/tauri.local.json` (no DMG, no updater artifacts, no signing key) and replaces `/Applications/Banditur.app` unless the app is running. Rust: `src-tauri/src/components.rs` reads `installed.json` and resolves the engine (`BANDITUR_ENGINE_DIR`) and model (`MLX_MODEL_PATH`) for every sidecar launch (`sidecar_command()`: transcription, render, peaks) — components folder, then the app bundle, then the checkout (dev); with none it fails with a Maltese message pointing to `npm run build:local`. `components_status` feeds Settings → Updates. **Interface loader** (`src-tauri/src/ui_loader.rs`, `UI_LOADER = true`): `lib.rs` wraps the embedded assets with `LayeredAssets`; if `installed.json` names a usable `<components>/ui/<n>/` (has `index.html` and a `ui.json` whose `needsCoreApi` <= `CORE_API`) it is served instead, alone, same origin. `choose()` picks it; the version being tried is stored in `ui-state.json` and cleared by the `interface_ready` command (called from `App.svelte` once mounted); a version still marked trying at the next launch is added to `bad` and the next older one is used, then the embedded one. `reload_interface` re-selects and reloads (Settings → Updates). `build-local` builds `dist`, refuses inline scripts (CSP), and installs with `ui.json`. Bump `CORE_API` by hand when a Rust command changes shape. Only a Rust/config change needs a new app.

**Generated files:** `src-tauri/gen/schemas/` is regenerated by every Tauri build and is not
tracked; only the macOS/Windows icons in `src-tauri/icons/` are kept (the mobile sets were unused).

**Note:** The auto-updater signing warning (`TAURI_SIGNING_PRIVATE_KEY not set`) is expected unless you're publishing an update. The app itself builds and runs fine without it.

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
- The first download needs internet to fetch yt-dlp (and Deno). If tools seem broken, quit the app and delete `~/Library/Application Support/app.banditur.desktop/tools/`; they are fetched again
- "YouTube biddel xi ħaġa…" means even the newest yt-dlp can't handle today's YouTube; the app re-checks for a fix each day and on each failure, so try again later
- Common yt-dlp errors are shown as a Maltese hint with the original line in brackets
- The URL must be an http(s) YouTube link and the output folder must already exist

### Performance issues
- RAW conversion uses Rayon across files. Watermarking uses bounded parallel batches while preserving filename-order decisions and logs.
- Transcription uses MLX on Apple Silicon. Intel transcription support and comparative speed claims have not been validated by the current build scripts.
- Watermark scaling is cached per-size; large batches of identically-sized images are optimized

## Development

### Release & Update Flow

Banditur supports two update paths (the local operational runbook is RELEASE.md):

1. **Backend-only updates** — commit and push backend changes; Vercel deploys from Git.
2. **Desktop app updates** — build signed updater artifacts, publish them to GitHub Releases, and point Vercel updater environment variables at the artifact.

Before deploying backend code that depends on schema changes, run the matching Supabase migration first. Migrations live in `backend/supabase/migrations/` and are applied in date order:

```text
backend/supabase/migrations/20260528_release_update_foundation.sql
backend/supabase/migrations/20260612_audit_fixes.sql
backend/supabase/migrations/20260804_signed_uploads.sql
backend/supabase/migrations/20261029_production_workflows.sql
backend/supabase/migrations/20261103_tasks.sql
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
│   ├── ui.js                     # Dependency-free helpers: escapeHtml, baseName, resultFolder
│   ├── platforms.js              # The list of publish targets and their rules
│   ├── media-store.js            # Draft media in IndexedDB
│   ├── subtitles/                # Traskrittura subtitle editor (model, Maltese rules, styles/ASS, preview, timeline, editor, tests)
│   ├── postmaker/                # Posts tool logic: template format + photo/text maths, canvas renderer, pack/CSV helpers, tests
│   │                             #   (its screens are views/posts/: PostMaker, TemplateEditor, WorkPanel)
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
│   │   ├── projects.rs           # Durable subtitle/post projects, .banditur import/export, work-file helpers
│   │   ├── photo_jobs.rs         # Photo job exclusivity, cancellation and photo inspection
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
├── public/fonts/                 # Bundled Montserrat weights + one OFL-Montserrat.txt — scripts/build-fonts.py
├── sidecar-dist/                 # PyInstaller transcription bundle (generated, gitignored)
├── transcribe-bundle.spec        # PyInstaller spec for the sidecar
├── backend/                      # Vercel social media scheduler/API
├── scripts/                      # Release, sidecar-build and watermark-pack scripts
├── .github/workflows/            # cron.yml (publishing every 15 minutes), test.yml (CI)
├── AGENTS.md  RELEASE.md  DECISIONS.md   # project documents (see Project documentation)
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
- `.gitignore` — Covers build artifacts, secrets and release artifacts

### Testing

Run checks from the repository root:
```bash
npm test                    # every *.test.mjs under src/, backend/tests/ and scripts/ (found by glob)
npm run test:py             # the two sidecar tests
npm run build
npm run check               # the three above
cargo test --manifest-path src-tauri/Cargo.toml --lib
```
`npm test` includes delivery/worker/API tests with isolated in-memory database and Graph
fixtures, timezone/report/import/passage tests and the subtitle, post-maker and
watermark suites; each case is reported. A new `something.test.mjs` is picked up
automatically if it uses `node:test`. GitHub Actions (`.github/workflows/test.yml`) runs
`npm test`, `npm run build` and `npm run test:py` on every push; the Rust tests are a
macOS job started by hand. Native tests cover project validation/atomic writes, templates, watermark
packs and duplicate fingerprints. Python passage tests run without loading the MLX model.
For a Rust-only check without bundled model/sidecar resources:
```bash
TAURI_CONFIG='{"bundle":{"active":false,"resources":null,"externalBin":null}}' cargo test --manifest-path src-tauri/Cargo.toml --lib
```
This still needs the local build config. Use `npm run dev` with `?mock` for sample UI checks;
use `npm run tauri dev` and the RELEASE.md smoke tests for native and live integrations.

### Common Tasks

**Add a new command to the Tauri backend:**
1. Define the command in the relevant `src-tauri/src/` feature module with `#[tauri::command]`; use async/blocking dispatch where the operation needs it
2. Register it in the `invoke_handler!` macro at the bottom of `lib.rs`
3. Call it from a view via `invoke('command_name', { ...args })` from `src/lib/tauri.js`

**Change transcription language:** choose Maltese, English, Italian or Auto in Traskrittura before starting the request. Legacy direct sidecar calls can still use `WHISPER_LANG`.

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
| **Parallel Processing** | Rayon (RAW conversion and bounded watermark batches) |
| **Transcription** | MLX Whisper (Apple Silicon GPU) via Python sidecar |
| **YouTube Download** | `yt-dlp` + `ffmpeg` (resolved at runtime) |

### Cloud (Vercel Backend)
| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20+ serverless functions (set the deployed runtime to match dependency requirements) |
| **Database** | Supabase (Postgres) |
| **Storage** | Supabase Storage |
| **API Integrations** | Facebook Graph API v25.0, Instagram Graph API, Google APIs (Drive read) |
| **Report Export** | Frontend CSV; PDF through the system print dialog |
| **Authentication** | Service account (Google) + API key (internal) |
| **Deployment** | Vercel Serverless Functions |
| **Updates** | Tauri updater + GitHub Releases + Vercel update manifest endpoint |

### Dependencies

#### Rust (Tauri Backend)
| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2.x | Desktop app framework, IPC, event emission |
| `tauri-plugin-shell` | 2.x | Subprocess spawning (transcription sidecar) |
| `tauri-plugin-dialog` | 2.x | File/folder picker dialogs |
| `tauri-plugin-opener` | 2.x | Open folders in Finder/Explorer |
| `tauri-plugin-updater` | 2.x | Signed auto-updates (desktop targets only) |
| `image` | 0.25 | Image format detection, pixel manipulation |
| `mozjpeg` | 0.10 | JPEG encoding/decoding with quality control |
| `kamadak-exif` | 0.6 | EXIF metadata parsing (orientation tag) |
| `rayon` | 1 | Data parallelism for RAW conversion and the watermark batches |
| `url` | 2 | Real URL parsing for the YouTube host allowlist |
| `zip` | 4.x | Reading/writing `.bwpack` watermark packs (same major as `tauri-plugin-updater` uses) |
| `serde_json` | 1 | JSON serialization for events |
| `tokio` | 1 | Async channels and process spawning (`sync`, `macros`, `process` features) |

#### Python (sidecar — `sidecar/requirements.txt`)
| Package | Purpose |
|---------|---------|
| `mlx-whisper>=0.4.0` | Whisper inference on Apple Silicon (MLX/Metal GPU backend) |
| `imageio-ffmpeg>=0.6.0` | Ships an ffmpeg binary; the sidecar prefers it so installed apps don't need a system ffmpeg |
| `numpy>=1.24,<2.6` | Numeric dependency for audio analysis (capped for Numba 0.67, which mlx-whisper imports) |
| `ctc-forced-aligner` (pinned Git commit) | Local CTC forced alignment of Maltese word timestamps. Pulls in `torch`; dev only — excluded from the release bundle |
| `pyinstaller` (install separately) | Builds the transcription sidecar bundle for release; not in `requirements.txt` |
| `pyannote.audio` (optional, not installed by default) | Speaker diarization; requires HuggingFace token |

#### JavaScript/Frontend
| Package | Purpose |
|---------|---------|
| `vite` | Dev server and production bundler |
| `@tauri-apps/api` | Tauri command and event bindings |
| `@tauri-apps/plugin-dialog`, `-opener`, `-updater` | JS bindings for the Tauri plugins |
| `@supabase/supabase-js` | Direct uploads to Supabase Storage using backend-issued signed upload tokens |

### Database Schema
- `scheduled_posts` — Queue of posts pending publication
- `task_boards`, `task_columns`, `tasks` — Xogħol boards, their columns and cards (per profile, with revisions)
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
