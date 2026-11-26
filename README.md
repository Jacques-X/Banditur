# Banditur

An all-in-one social media management and post-production toolkit for organizations. Built with [Tauri](https://tauri.app), Rust, Svelte 5 and Vite; its cloud API runs on Vercel.

Documentation checked against the source on **2026-11-03**. This describes the local implementation, not a verification of the deployed services.

**Desktop tools** (post-production):
- **Ritratti** — One tool for a folder of photos: RAW files (Sony ARW, Canon CR2/CR3, Nikon NEF, etc.) become JPGs, and the photographer's watermark, size, quality and duplicate skipping happen in the same run, into one ordered output folder
- **Video** — one Studio tab with two screens. **Traskrittura**: transcribe videos, edit them as subtitles, style and animate them, and export SRT / ASS / MP4 / transparent MOV. **Murtali**: drop a fireworks video, the app finds each display from the sound alone and cuts the dead time away, then exports one full 16:9 video or a 9:16 Reel from 6–7 picked displays
- **YouTube Download** — Save a YouTube URL as MP4 (video) or MP3 (audio) with live progress
- **Posts** — Make repetitive posts (Awguri, Kondoljanzi…) from a template: portrait + overlay + a name, exported as a square, portrait or Story JPG, individually or in a reviewed batch, or sent to Skeda

**Cloud platform** (social media scheduling):
- **Schedule & Publish** — Compose and schedule posts to Facebook and Instagram (TikTok and a website/app backend are planned: placeholders in `src/platforms.js`)
- **Multi-Account** — Manage multiple organization profiles/committees
- **History & Archive** — Track all published, pending, and failed posts
- **Google Drive** — Browse and insert media from Drive folders
- **Kalendarju** — Our own calendar, kept on this computer or shared with the committee: events with labels and repeats, plus a layer of scheduled posts that can be dragged to reschedule
- **Monthly Reports** — Generate PR performance reports (reach, likes, followers, impressions)
- **Templates** — Pre-built post templates (condolences, announcements, etc.)
- **Drafts & Offline** — Save drafts with their photos and videos, offline too; reopen them later
- **Anywhere** — ⌘K (or the search button in the top bar) finds screens, actions, events, projects and queued posts, and searches captions; files dropped on a screen without its own drop target go to the right tool (video → Traskrittura (Murtali is opened from Video → Murtali), RAW → RAW → JPG, photos → a new post, a folder → Marka; `lib/drop-route.js`); a macOS notification when a long job ends while Banditur is in the background
- **Xogħol** — To-do boards per profile (e.g. Videos, Elementi), created as needed, kept on this Mac or shared with the committee: cards in columns, with checklist toggles, notes, a due date and a colour label

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
that shows at the next launch (or Settings → Components → reload the interface), with no new app and no need to quit.
If a new interface fails to start, the app falls back to the previous one, then to the one inside the app.
Only a Rust change rebuilds and replaces `/Applications/Banditur.app` (`--app <path>` for another place; quit Banditur first). First run on a Mac
builds and installs everything. Settings → Components lists the installed pieces. Options: `--force engine,core,ui,model`,
`--yes`, `--no-app`. Needs PyInstaller in the venv (see below) and no signing key.

### Build a release app by hand (rarely needed)

```bash
npm run tauri build
# Produces app artifacts under src-tauri/target/release/bundle/
```

Note: the app no longer bundles the engine and model, so an app built this way has no transcription until they are
in the components folder (`npm run build:local` puts them there). The engine is built by
`npm run build:transcribe` (`scripts/build-transcribe-sidecar.sh`), which needs PyInstaller in the venv:
`venv/bin/pip install pyinstaller`, plus `mlx-maltese-whisper-4bit/config.json` and `weights.safetensors`.
The sidecar build uses macOS tools (`install_name_tool`, `codesign`) and finds the MLX library for the `venv`'s Python version.
There is no signed updater any more: the shared Mac updates itself from GitHub (next section).

### Updates on the shared Mac

One Mac (the shared one) has the toolchain and a clone of the repository. Banditur there checks GitHub for new commits
and offers an **Update** button (Settings → Components → Aġġornamenti; a dot on the Settings button in the toolbar
shows when something waits). The check runs at launch and every 3 hours, and "Iċċekkja issa" does it on demand.

**Which code**: the clone follows the **upstream of its checked-out branch** (`@{u}`); there is no branch setting.
Clone with `-b stable` (recommended: push to `stable` when something is ready) or `main`.

**What Update does** (never destructive: `git pull --ff-only` only, no reset, stash, merge or push). It refuses when
tracked files have local changes, when the branch has diverged from its upstream, when a tool or Arkivju upload is
running, or when another update is running. After the pull, `build:local` says what changed:

- *Interface, engine or model only*: the build runs in the background while the app keeps running; then the new
  interface is loaded. No quit.
- *App core changed* (Rust, `tauri.conf.json`, capabilities…): the app asks, quits, a detached helper builds, replaces
  `/Applications/Banditur.app` and reopens it. This can take up to 15 minutes; nothing should be pressed meanwhile.

If the build fails, the old app is still in place (`build:local` replaces it only after a successful build) and is
reopened; the error and the last log lines show in Settings and as a toast. The full log is
`.build-cache/update.log` in the clone. Before building, `npm install` runs when `package-lock.json` changed and
`venv/bin/pip install -r sidecar/requirements.txt` when `sidecar/requirements.txt` changed since the last successful
update (`.build-cache/deps.json`).

After a successful update the build output that is no longer needed is removed: `build/`, `sidecar-dist/`,
`src-tauri/target/debug/` and `src-tauri/target/release/bundle/` (`CLEAN_PATHS` in `scripts/lib/update.mjs`).
`src-tauri/target/release/` (Rust's compiled dependencies, ~2 GB) and `dist/` are kept, so the next app change is not a
full compile. `build:local` does not rebuild an unchanged engine or app just because its build output is gone, as long
as it is installed.

**One-time setup on the shared Mac**

1. Do the "new Mac" steps from the clone the team will keep (`git clone -b stable <repo> Banditur`, then Install & Run
   above, the venv, `banditur-config.json`).
2. Private repository: create a fine-grained, read-only GitHub token (Repository permissions → Contents: Read). Store it
   once: `git config --global credential.helper osxkeychain`, then run `git fetch` in the clone in Terminal and enter
   your GitHub username and the token as the password. The app never prompts: git runs with `GIT_TERMINAL_PROMPT=0`, so a
   missing credential shows a message pointing here.
3. Run `npm run build:local` once. It writes `<components>/source.json` (the clone's path), which is how the app finds
   the clone; until then Settings says updates are not set up.
4. `node` must be found by a login shell (Homebrew, or set in `~/.zprofile`): the app runs the scripts through
   `/bin/zsh -lc`, because an app opened from Finder has a minimal `PATH`. A node set up only in `~/.zshrc` is not seen.

## Components

Banditur is split## Components

Banditur is split into two main components:

1. **Desktop App** (Tauri) — Post-production tools for content creation
2. **Cloud Backend** (Vercel) — Social media API for scheduling, publishing, and analytics

The desktop calls the Vercel API over HTTP. The backend reads/writes Supabase Postgres;
the desktop uploads media directly to Supabase Storage using backend-issued signed tokens.

## Features

### Desktop: Ritratti — RAW → JPG, watermark, size, duplicates

One screen (`views/Ritratti.svelte`; Studio, `⌘7`) for what used to be two tools (Marka & Ssortja and RAW → JPG).
Pick or drop a folder; the screen counts its RAW and image files (`list_media_files`) and `views/ritratti/plan.js`
decides what runs on the photo lane:

- **JPG / PNG / … folder** → one step (`process_images`): watermark, size, quality, duplicates, blurry photos; these are decided during the run and every skipped photo is named, with its reason, in the log
- **RAW folder, no watermark and no duplicate skipping** → `convert_raw_batch` straight into the output folder
- **RAW folder with a watermark, duplicate or blur skipping** → one `process_images` step (`source: 'raw'`) that reads each RAW file's
  embedded JPEG straight from memory — no intermediate folder. Tick *Żomm ukoll JPGs sħaħ tar-RAW*
  for the old two-step way: `convert_raw_batch` into `<folder>-jpg` (full size, quality 95, kept), then `process_images` from there
  (`next` steps on a photo-lane task)
- **Both kinds in the folder** (cameras that save RAW + JPG) → *Uża r-RAW* / *Uża l-JPGs* chooses

The watermark step (`process_images`) handles images (JPG, PNG, TIFF, BMP, WebP):

- **Per-photographer watermarks**: Applies `portrait.png` and `landscape.png` overlays from installed **watermark packs** (not bundled with the app — add/remove them at runtime, see below)
- **Auto-orientation**: Detects EXIF orientation and rotates before compositing
- **Single output folder**: Assigns filenames and reports results in source filename order; parallel workers can finish writing in a different order
- **Safe duplicate names**: Adds a numeric suffix instead of overwriting when two photos would produce the same JPEG filename
- **Compression controls**: Quality (60–95%) and max dimension (1080–4096 px, or Original)
- **Fast pipeline** (2026-11-23): (1) a *look* pass fingerprints/scores every photo from a 1/8–1/4-scale JPEG decode (about 1/20 the cost of a full decode) and makes all duplicate/blur decisions before anything is decoded in full; (2) only kept photos are decoded, and only as large as the export needs (JPEG DCT scaling, `decode_image_scaled`; full size when Max size is *Original*); (3) up to 8 worker threads take photos in source order with no batch barriers, while the log, progress and output names still follow filename order; (4) `.banditur-ritratti.json` in the output folder remembers source (size + modified time), settings (watermark files, quality, size) and output, so running the same folder again only makes the new or changed photos (*↺ diġà lest* in the log). RAW → JPG (`convert_raw_batch`) also decodes only as large as needed when it has to resize
- **Optional near-duplicate skipping**: Compares each oriented photo with **every photo kept so far** (folder-wide, not just the previous one) using dHash on the full-size decode, before any resize; skips look-alikes without changing originals
- **Optional auto-brightness** (*Auto-brightness*): after resizing and before the watermark, a photo whose median brightness is below 90 (0–255) gets one gamma curve on all channels aimed at a neutral median of 112 — full strength at median ≤ 60, fading to nothing at 90, never stronger than gamma 0.5 so a night scene stays a night scene. Whites stay white, colour balance is kept, photos that are not dark are untouched. it is part of the *already made* settings key
- **Optional out-of-focus skipping** (*Aqbeż ritratti mċajpra*, three levels): `sharpness()` shrinks to ≤1000 px, softens slightly, takes the Laplacian and averages the variance of the sharpest eighth of an 8×8 grid (so a soft background does not count against a portrait). Limits per level are in `ritratti/plan.js` (`BLUR_LEVELS`: 10 / 25 / 50) and are starting points — the log names every skipped photo with its score. A blurry photo is never the reference for the duplicate check
- **Watermark caching**: Avoids redundant scaling when processing many images

The RAW step (`convert_raw_batch`) extracts the camera-generated JPEG preview from RAW files; this is not sensor-data development:

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
- **Model kept loaded**: the engine loads the model when the tab opens and keeps it between videos (stopped after 10 idle minutes); *Ikkanċella* stops a transcription
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
- **Menus**: the top bar has the language, *Proġett* (open, Import SRT, Save project, with or without media) and, once a video is open, *Għodda* (check before export, re-transcribe a passage, use the last MP4 in Skeda)
- **Passage repair**: Retranscribe a chosen source-time range, compare the text and accept it as one undoable edit; corrections outside the range remain
- **Import and review**: Import timed SRT cues; review confidence, readability, name and article warnings
- **Durable projects**: Native atomic autosave, `.banditur` import/export (references or included media), and relink missing source files. Old localStorage sessions migrate only after a successful native save

### Desktop: Murtali — fireworks → one video and a Reel

Video → **Murtali** (the second tab above the screen; `⌘5` opens the one used last). Traskrittura is unchanged.
- **Open**: drop or pick an `.mp4` / `.mov` / `.m4v`, or reopen a *Riċenti* project. Only the **sound** is analysed (no video decoding, so an hour of 4K takes seconds): bangs and crackle are impulsive, band music, bells and crowd are not; shell bursts are bass-heavy, voices are not. A quiet clip with no audio track is refused ("Dan il-video m'għandux ħoss").
- **Review**: each display becomes an item. *Sensittività* and *Distanza* (qrib / medju / il-bogħod) re-segment instantly; the sound reaches the camera 1–3 s after the burst is seen, so items start 1.5 / 3 / 4.5 s before the first bang and end 1 s after the last. Timeline: waveform, sound-activity line, items over dimmed dead time; drag an edge to trim, `B` split, `J` join, `Delete` drop, `I` / `O` mark a new item, `Space`, `←` `→`, `+` `−` zoom, `⌘Z` / `⇧⌘Z`. Edited and hand-made items are never overwritten when detection runs again. *Ara kollox* plays the kept items back to back.
- **Exports** (always the clip's own sound, 0.3 s audio crossfade at every cut, loudness normalised to −14 LUFS; no music, no length limit): **Video sħiħ 16:9** (every kept item in time order; 1920×1080, or 3840×2160 for a 4K source unless *1080p* is ticked; other shapes are fitted over a blurred copy of themselves) and **Reel 9:16** (1080×1920 from the items ticked *Għar-Reel*, in the order of the Reel strip). The Reel counter guides toward 6–7 (amber outside, never blocking); *Agħżel l-aqwa 7* pre-ticks the 7 loudest. Each Reel item has a full-height 9:16 window, centred at first; drag it over the preview or the thumbnail to aim it (*mhux immirat* marks the ones you have not), *L-istess għal kollha* copies one position to the rest. After an export: *Iftaħ* or *Uża fi Skeda*.
- **LUT** (camera log → normal colour): *LUT…* in the bar picks a 3D `.cube` file; it applies to the whole project — the preview (live, WebGL2), the thumbnails and both exports — with a strength slider (0–100 %) and *Oriġinali* to compare (preview only). A new project starts with the last LUT chosen; ✕ removes it. If the preview can't draw it on this Mac a note says so and the exports still use it.
- Projects (`kind: "fireworks"`) autosave into the native project store with the measured curves, so reopening never re-analyses unless the file changed (size + modification time).

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
- **Jobs and handoffs**: Queue, cancel, retry or remove downloads. There is no history: the list holds only downloads still running, queued or failed (only those are remembered across launches); the last finished one stays above it with *Iftaħ il-file*, *Traskrivi* and *Uża fi Skeda* (MP4 → Reel) until closed. RAW and watermark jobs also queue and preserve completed files on retry; finished watermark photos can go to Skeda

### Desktop: Cards → Arkivju (SD-card upload)
Plug in a camera card (a `DCIM`, `PRIVATE`, `CONTENTS` or `MP_ROOT` folder) and Home offers to upload it to the committee
archive on the Shared Drive.
1. **Scan.** Every photo, RAW and video on the card, with its capture time (EXIF, else the file time).
2. **Review.** Files are grouped into events by gaps in time (default 2 hours; 30 min – 6 h). Per group: event name
   (suggested from Kalendarju when the date and time fit), date, **Fotografu** (when it holds photos/RAW) and
   **Vidjografu** (when it holds videos) — both always required, even for one person. Merge, split at a quiet gap, or leave
   a group out. A wrong camera clock is fixed with *Arloġġ tal-kamera* (hours/minutes). Names already on Drive for that
   event, and recent ones, are suggested so a person is never spelled two ways.
3. **Upload.** `Arkivju/<year>/<date> <event>/Ritratti/<Fotografu>/` and `…/Footage/<Vidjografu>/`, created as needed.
   Up to three files at a time straight from the Mac to Drive in 8 MB chunks (the speed limit is shared between them); the backend opens their sessions and verifies them in batches (`sessions` / `finishMany`, up to 25 per request; an older backend without them gets per-file calls). Progress, pause, speed limit on Home. The queue is
   saved (debounced while running), so quitting the app, pulling the card or losing the connection only pauses it.
4. **No duplicates, several Macs.** Every file is tagged on Drive with a fingerprint (name + size + the camera's capture
   time — never a corrected one). Before uploading the app asks Drive what is already there (any Mac, any time); a file
   added by hand with the same name and size in the target folder counts too; two Macs uploading the same file at once end
   with one copy. Same name but a different file gets ` (2)`.
5. **Verified.** After the last byte Drive's size and md5 are compared. Nothing is ever deleted from the card; Home says
   *Tista’ tifformattja l-card* only when every file is on Drive (or was already), and offers *Neħħi l-card* (eject).
6. Optional **local copy** of everything to a folder of your choice, in the same folder layout, running as its own lane beside the uploads. A Kalendarju event page
   shows how many ritratti/footage are archived for it (matched by date + event name).

Backend setup: the service account needs **Content manager** on the Shared Drive and the full `drive` scope (the older
read-only client is unchanged). Set `ARCHIVE_FOLDER_ID` to the archive's root folder id (falls back to `DRIVE_FOLDER_ID`).
Endpoints: `POST /api/drive/archive/{folder|ls|check|session|sessions|finish|finishMany|count}` (inside the existing drive function — no new
Vercel function). The backend never carries file bytes: it only creates folders, opens the resumable upload session and
verifies. Native side: `src-tauri/src/archive.rs` (`archive_volumes`, `archive_scan`, `archive_put`, `archive_copy`,
`archive_cancel`, `archive_eject`; a cancel is a generation counter, so it stops every transfer running now but not one that starts later). Code: `lib/archive.svelte.js`, `lib/archive-job.js`, `views/archive/Review.svelte`,
`components/ArchivePanel.svelte`, rules in `backend/api/_lib/archive-rules.js`.

### Cloud: Schedule & Publish

Compose posts in the desktop app and schedule them to Facebook and Instagram:

- **Multi-platform posting**: Publish to Facebook and/or Instagram simultaneously. Platforms are defined once in `src/platforms.js` (label, icon, accepted content types and media, caption limit, preview cut-off, extra fields). **TikTok** and **Website / App** are listed there but not shown in the composer until their backend publisher exists (`available: true`); WordPress is no longer offered for new posts (old WordPress posts still show in the archive)
- **Platform checks**: the caption limit follows the strictest selected platform; content-type and image/video-kind checks run before scheduling.
- **Media checks with one-click fixes**: every photo and video added in Skeda is measured (shape, size, length) and checked against Meta's limits for the chosen platforms and type. A red **!** blocks scheduling, an amber one is a warning, and the list under the media explains each one:
  - Instagram photos must be JPG, 4:5 – 1.91:1 in the feed and ≤ 8 MB (Facebook ≤ 10 MB, Facebook Stories ≤ 4 MB); a carousel photo shaped differently from the first is a warning (Instagram crops them all like the first); Stories prefer 9:16
  - photos can be fixed in place: *Ikkonverti għal JPG*, *Crop għal …*, *Żid padding* (a blurred copy of the photo) and shrinking; *Irranġa kollox* fixes every photo
  - videos: under 3 s, Stories over 60 s, Facebook Reels over 90 s and Instagram Reels over 15 min are errors; a Reel/Story that is not 9:16, a Facebook Reel under 540×960 and Instagram video wider than 1920 px are warnings. Videos are not re-encoded by the app; codecs cannot be checked before upload
- **Media rules**: the composer allows up to 10 files for a post, exactly one video for a Reel and one file for a Story. Changing type can leave incompatible media, which scheduling validation reports.
- **Preview**: shows what Instagram displays before "aktar" (first 125 characters), a 9:16 note for Reel/Storja, and the time in Malta time
- **Publish time**: quick buttons (Wara siegħa, Illejla 20:00, Għada 09:00, Għada 18:30); a time that has already passed asks for confirmation
- **After scheduling**: a toast links to the queue, and *Erġa' uża dan il-post* puts the post back in the form
- **Skeda's three parts**: the top bar has one *Skeda* tab; inside it *Post ġdid* (the composer), *L-Arkivju* and *Rapporti* (`components/SkedaTabs.svelte`, the failed count on L-Arkivju). The top-bar tab and key `1` return to the part used last
- **Keyboard**: `0` Home · `1` Skeda · `2` Kalendarju · `3` Xogħol · `⌘5`–`⌘8` Studio tools (Video (Traskrittura, Murtali), Posts, Ritratti, YouTube) · `⌘K` go anywhere · `⌘,` Settings · `⌘↵` schedule (only in Skeda). Plain view-number shortcuts are disabled inside Studio tools, while typing or with a modal open; Ctrl substitutes for Cmd where supported.
- **Media handling**: Support for single photos, carousels (multiple images), and videos
- **Scheduled publishing**: Queue posts for specific dates/times
- **Content types**: Regular posts, reels, carousel posts with captions
- **Organization profiles**: Manage multiple committee/organization accounts
- **Delivery tracking**: A durable per-destination ledger retains IDs and preparation stages. Confirmed destinations are skipped on retry. Ambiguous publication responses become reviewable rather than being submitted again automatically
- **Submission recovery**: Idempotent request IDs prevent duplicate schedule rows after interrupted responses. Saved timestamps require media and form persistence to finish
- **Media retention**: Under *Aktar għażliet* (with Kategorija and Avveniment; folded away, with a one-line summary when something isn't the default). Keep shared uploaded media for 1–365 days after publication, or pin it; failed/active jobs retain references. Daily maintenance collects expired/unreferenced files

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

### Calendar (Kalendarju)

Events live on this computer (`src/views/kalendarju/`) unless shared (Settings → Sharing: `/api/events`, polled every minute), one calendar per profile; there is no Google Calendar any more. Old Google events were not imported.

- **Views**: Month, week, day and list, built in-house (no calendar library)
- **Editing**: Create, edit, drag and delete events; click an empty slot to create one. An event has one time (or the whole day), like a post; there is no end time
- **Colour labels**: Labels with colour and show/hide toggles; removing a label leaves its events unlabelled. Deleting an event or a label happens at once with *Undo* in the toast (shared calendar: asks first)
- **Repeats**: Daily, weekly, monthly or yearly with an interval and optional end date. Editing, moving or deleting a repeating event applies to the whole series
- **Post layer**: Toggle scheduled/published posts independently of events. Drag queued posts to reschedule with revision checks and revert on failure; click to edit or duplicate
- **Malta clock**: `Europe/Malta` applies regardless of computer timezone; ambiguous/missing clock-change inputs are rejected
- **Event page**: clicking an event opens its page in the side panel: when and where, poster, linked posts (`/api/history?event_id=`), subtitle and post projects, Studio outputs, *Post ġdid* (with the poster) and *Editja*. *Aħdem fuq dan l-avveniment* makes it the active event, so new posts and Studio work link to it (Home shows a one-line reminder). Home, ⌘K and Rapporti open an event's page through `cal.focus`
- **Poster**: link a Google Drive file to an event. Name posters with the event's date as `DD:MM:YY` (`15:11:26 Festa.jpg`; `.`, `-`, `_`, `/` or a space also work, and a 4-digit year). Matching files are suggested (`GET /api/drive/find?date=`, inside the Drive root, rules in `_lib/poster-date.js`), or pick one with the Drive browser. The event keeps the file's id and name only. *Skeda post* for that day (or from the event) downloads the poster into the new post (`addDriveFile` in `composer.svelte.js`)
- **Storage**: `localStorage` key `banditur_calendar` (up to 5000 events), or the backend's `calendar_events` / `calendar_settings` when shared. Times are stored as Malta wall-clock strings. Validation is shared with the server (`backend/api/_lib/event-rules.js`)

### Cloud: Monthly Reports

Generate PDF or CSV reports of PR activity and social metrics, with real date-range comparisons:

- **Metrics tracked**: Total posts published, pending, failed, likes, comments, average engagement per post, posts per week
- **Trends**: Posts/likes/comments/engagement compared against a previous period, broken down by platform as well as totals
- **Calendar-aware comparisons**: A full month/quarter/year compares against the true previous calendar unit (e.g. all of January, not just "31 days before February"), not just an equal number of days back
- **Custom comparisons**: Under *Filtri* (with the category and event filters; the button shows how many are on). Compare the selected range against any other range you pick, instead of only the auto-computed previous period
- **Quick presets**: This month, last month, this quarter, this year, last 7 days
- **Followers & impressions**: Facebook/Instagram follower totals are current counts at report time. Facebook impressions and net follower change are queried for the selected period. Unavailable metrics remain blank rather than becoming zero; impressions are not unique reach.
- **Top posts**: Highest-engagement posts in the period, ranked by likes + comments
- **Per-profile reports**: Filtered to whichever committee profile is selected, with optional category/event filters for posts
- **Coverage**: Generation time, measured-post counts and unavailable values remain explicit in the screen, PDF and CSV. Partial publications count only destinations confirmed published
- **Post list**: Full list of published posts for the period
- **Export**: PDF opens the system print dialog (choose Save as PDF); CSV is generated and downloaded by the frontend. Select which report sections to include.
- **Date range selection**: Report for any custom range

### Cloud: Xogħol (to-do boards)

Boards of things to do for each committee profile (Social → Xogħol, key `5`). **By default they are kept on this computer only** (see *Sharing* below to share them), in the app's local storage (`banditur_xoghol`): no backend or migration is needed, they work offline, and other people don't see them.

- **Boards**: none exist until someone makes one. Create as many as needed (up to 20 per profile), e.g. *Videos* or *Elementi*; switch with the tabs under the title (←/→ between tabs). The ⌄ next to the selected tab renames, moves or deletes it (deleting removes its columns and cards for everyone, after confirmation). Each person's last board is remembered per profile
- **Columns**: a new board starts with *Biex isir*, *Għaddej* and *Lest*; rename (click the title), add (up to 12 per board), move left/right, or delete an empty column (a board keeps at least one)
- **Cards**: a title plus optional checklist, notes, start and due dates (*Mill-* / *Sa meta*; the card shows the range) an optional **Budget** and **Spent so far** in euros (the card shows `€45.50 / €200`, red when over; the board header shows total Budget · Spent · Left/Over for the cards that have an amount) and one of six colour labels (Aħmar, Oranġjo, Isfar, Aħdar, Blu, Vjola). Each checklist step can also have its own dates, Budget and Spent (the calendar button on the step); step amounts are parts of the card's own amount and are not added to the totals. *Żid kompitu* at the bottom of a column adds one quickly (Enter adds another)
- **Moving**: drag a card within or between columns, or focus it and press `⌥` + arrow keys
- **Ticking**: checklist items can be ticked straight on the card; click the card to edit everything else (`⌘↵` saves)
- **Due dates** use Malta time: overdue cards are red, today amber, the next two days blue. Cards in a board's last column are treated as finished and never show as overdue
- **Another board**: the card dialog's *Board · Kolonna* list moves a card to any board of the profile
- **Gantt**: the *Board | Gantt* switch (top right, remembered) shows the same cards as bars on a calendar, grouped by column, zoomable between *Ġimgħat*, *Xhur* and *Sena* (a year or more at a glance), with today marked. Drag a bar to move it, drag its ends to change the start or due date (`←`/`→` on a focused bar moves it a day, `Shift` changes only the end); click a bar or name to open the card. A card with only a due date is a one-day bar; clicking the row of a card without dates gives it a week from that day. Each card's dated steps show as thin bars under it (the *Steps* button shows or hides them; drag them like cards), and amounts show on the rows, with a total per column. You can add from the chart: *+ Kompitu* in a column header makes a card with a week from today, and the **+** on a card's row adds a step. *PNG* / *PDF* save the board's dated cards and steps as a picture or a PDF that is always one A4 page (landscape for wide charts, portrait for tall ones, scaled to fit; always light)
- **Sharing**: Settings → Sharing → *Aqsam mal-kumitat* moves Xogħol to the backend (`/api/tasks`, after migrations `20261103_tasks.sql` and `20261122_sharing.sql`), polled every 30 s; it can first copy this Mac's boards up (ids kept). Deleting then asks first, since it cannot be undone for everyone. *Erġa' lura għal dan il-Mac* switches back to the local copy, which sharing never changes

### Cloud: Templates & Drafts

Accelerate post composition with reusable templates:

- **Built-in templates**: Pre-written templates for common posts (condolences, announcements, etc.)
- **Custom templates**: Save your own post templates for reuse
- **Template variables**: `[BRACKETED]` placeholders (e.g. `[DATA]`, `[ISEM]`) are detected on insert and prompted for individually — `[A / B]`-style placeholders render as a choice instead of free text
- **Draft management**: The *Drafts* menu in Skeda saves a draft, opens the list and starts again. Autosave and explicit drafts keep caption, times, platforms, content type and profile locally; media is stored separately in IndexedDB (`src/media-store.js`) when storage succeeds
- **Offline support**: Pressing Schedule while offline saves a local draft for later scheduling; media retention depends on IndexedDB availability
- **Media pre-flight check**: a best-effort URL reachability check runs before scheduling. A reported broken URL blocks scheduling; if the check itself is unavailable, scheduling continues. This does not validate the full publishing requirements.

## Project documentation

All four documents are tracked in Git:
- `README.md` — features, setup, build, and the Technical reference (module maps, data flows, API, build internals).
- `AGENTS.md` — short guide for coding agents: commands, where code lives, conventions, gotchas.
- `RELEASE.md` — deployment runbook and how a new version reaches the shared Mac.
- `DECISIONS.md` — product/architecture rationale, including superseded decisions.

## Current limitations

- Publishing requires the `20261029_production_workflows.sql` migration (Xogħol needs nothing on the server while it is local), plus a backend deployment before the new desktop is released. Live Meta endpoints, permissions, video codecs and a signed packaged app need deployment smoke tests (`npm run smoke:meta`, see RELEASE.md); local mocks do not prove external publication.
- GitHub invokes the worker every 15 minutes, with at most five posts per run and a shared time budget. Only ordinary Facebook posts more than ten minutes and less than thirty days ahead use native scheduling; other jobs may publish later than their selected minute.
- Unknown publication outcomes cannot safely be retried automatically. Check Meta before acknowledging a retry. External publication and saving its ID cannot be one atomic transaction.
- Draft media remains in IndexedDB on this installation. Native subtitle/post projects live in the app-data folder; use portable export to move them (subtitle sources can be relinked). Reference-only exports require the source files to remain accessible; included media is capped at 2 GB per asset and project JSON at 16 MB.
- Photo cancellation stops between files/batches and batch-post cancellation between rows. Interrupted jobs remain visible and require an explicit retry.
- Automatic recognition and non-Maltese accuracy depend on the installed Whisper model. Release builds still omit the optional CTC aligner. The composer's media checks cover shape, size and length and can fix photos; videos are checked but not re-encoded and codecs are not inspected. Imported SRT word timings are estimated inside the original cue boundaries.
- Murtali finds fireworks by sound only: a quiet ground show (fountains, no crackle) can be missed and loud band music right next to the camera can be picked up; add or delete items by hand. A Reel above 90 s is flagged for Facebook (and 15 min for Instagram); the 50 MB per-file limit in Skeda is checked after the export (a long 1080×1920 Reel at the export's quality can exceed it). One clip per project in the screen (the data model already holds several `sources`). Detection defaults are a first guess, not yet tuned on real festa videos (DECISIONS.md).
- Reports use the latest observed engagement of scheduled posts and current followers, not historical follower snapshots. Category/event filters do not narrow page-wide insights. Metric permissions may make some values unavailable.

## Watermark Packs

Watermarks are **not bundled** with the app. They live in installed packs under the app-data folder
(macOS: `~/Library/Application Support/app.banditur.desktop/watermarks/<pack-id>/`), so adding or removing
a photographer never needs a rebuild and survives app updates.

Manage them from **Settings → Watermarks → Manage watermarks** or **Ritratti → Manage watermarks**:
- **Import pack (.bwpack)** — install/update a `.bwpack` (or `.zip`) file
- **Add many…** — build a whole pack at once: choose all the PNGs in one go (⌘A in the file dialog), check the list (names come from the file names or their folder; portrait/landscape is detected from the picture size; wrong ratios, duplicates and failures are flagged per row), pick or name the pack and press Add. Optionally saves a `.bwpack` to send to others
- **+ Marka ġdida** — add a single photographer to an existing pack (or a new pack) from PNGs; bumps the pack version
- **Export** — save an installed pack as a `.bwpack` to send to other members
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

## Technical reference

How the code fits together, for people and agents changing it. AGENTS.md has the short version (commands, where code lives, conventions, gotchas); this section has the detail.

### Frontend modules (`src/`)
- **Svelte 5 (runes) + Vite** since the 2026-10-22 UI redo ("A5 · Kwiet Toolbar"). `main.js` only mounts `App.svelte`
- `App.svelte` — toolbar + one `<section>` per screen. Home is in the main bundle; every other screen is its own chunk from the `SCREENS` table (`import()`), fetched the first time it is opened (a loading note shows, and a retry button if the import fails, e.g. a half-copied installed interface) and fetched ahead one at a time when the app is idle. A screen is mounted the first time it's opened and then kept (hidden), so running jobs, a half-written post or an open subtitle edit survive tab switches. Global keys: `0` Home, `1`–`5` Social screens (not inside Studio tools), `⌘5`–`⌘9` Studio tools, `⌘K` archive search, `⌘,` Settings; `⌘↵` lives in Skeda
- `components/` — `Toolbar` (profile menu; one tab per screen — Home, the five Social screens, the five Studio tools — one style for every tab, chosen by measuring what fits: icon + label, label only, or icon only; health dot; Settings), `MenuButton` (small action menus), `Modal` (Esc, focus trap, focus return; `anyModalOpen()` mutes shortcuts), `Toasts`, `ConfirmDialog`, `Icon`, `FolderField`, `JobPanel`
- `lib/` — `app.svelte.js` (navigation, config, profiles, theme, toasts, `confirm()`; `ls.list()` / `ls.object()` read saved lists and objects and return an empty one when the stored value has the wrong shape — use them for anything that is mapped or iterated at start-up), `api.js` (`api(path, { query, method, body, timeout })` → JSON, readable Maltese errors; gives up after 90 s by default; `error.status` is set only when the server answered), `tauri.js` (wrappers; outside Tauri they go to the dev mock), `health.svelte.js` (Settings → Sistema checks + toolbar dot), `queue.svelte.js` (pending/failed counts, Skeda's "Jmiss" strip, `statusOf(post)`), `photojob.svelte.js` (the shared Marka / RAW run: `log`, `progress`, `done`, `raw-done` events), `format.js` (Maltese dates), `mock.js` (dev only), `colorpicker.js` (installed in `main.js`: takes over every `<input type="color">` app-wide — WebKit only offers a fixed swatch grid — with a colour wheel, brightness slider, R/G/B and hex fields and the last 10 colours (`banditur_recent_colors`); the input still gets `input` events while picking and `change` when the popover closes, so existing listeners and `bind:value` work; Esc restores the old colour, Enter / click outside keeps the new one)
- `views/` — `Skeda` (+ `skeda/composer.svelte.js`: form state, media rules, autosave, drafts, upload → check → schedule; `keepCurrent()` / `replaceWith(load)`: the one way to put something else into the composer — asks first (always, except for actions started in Skeda), keeps the current post as a draft, and on a failed draft save shows the toast itself and leaves the composer untouched; `skeda/media-check.js`: pure per-platform media limits, `mediaIssues()` and the crop/pad maths `fitPlan()`, tested in `media-check.test.mjs`; `skeda/media-probe.svelte.js`: measures each File once into `mediaInfo` (a `SvelteMap`) and `fixPhoto()` rebuilds a photo as a fitting JPEG on a canvas; errors from `preflightProblem()` block scheduling, warnings do not), `Kalendarju` (FullCalendar, re-themed), `Arkivju`, `Rapporti` (on-screen report + PDF via print / CSV), `Xoghol` (+ `xoghol/`: `model.js` pure ordering/date helpers, `board.svelte.js` state and optimistic saves, `TaskCard`, `TaskDialog`, `GanttView` with `gantt-model.js` (scales, range, ticks, bar and drag maths) and `gantt-export.js` (canvas PNG + tiny one-image PDF writer)), `Home` (first-run checklist, *Issa*, the active event, *Jmiss*), `Traskrittura`, `Murtali` (+ `murtali/`: `segments.js` sound curves → items (`activity`, `findSegments`, `redetect`, distance presets), `items.js` pure undoable edits of `{ items, reel }`, `history.js` undo/redo stacks (a drag = one step), `reel.js` best-7, the 9:16 `cropWindow` (same maths as `crop_window()` in `fireworks_render.py`), export jobs, length checks, `timeline.js` pixel/zoom/hit-test maths, `lut.js` `.cube` parsing / sampling / 3D-texture packing, `Timeline` / `ItemsGrid` / `ReelStrip` / `CropWindow` / `LutPreview` components, all with `*.test.mjs`; `lib/video-parts.js` resolves which Video part a tool id opens), `Posts`, `Ritratti` (+ `ritratti/plan.js`; watermark packs in `marka/`), `YouTube`, `Settings`
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
  - `preload_transcribe()`: Start the transcription worker (loads the model) if it is not running
  - `process_video(requestId?)`: Send one request to the worker (restarted once if it died); returns the request id
  - `cancel_transcribe()`: Stop the worker and emit `cancelled` for the request in flight
  - `save_srt()`: Write a `.srt`, `.ass` or `.bstyle` (shared subtitle look) file to disk (other extensions are rejected)
  - `render_subtitles(video_path, ass, output_path, mode, fonts, logo, end_card_seconds)` / `cancel_render()` (`subtitle_render.rs`): export a burned-in MP4 (`mode: "burn"`) or a transparent ProRes 4444 MOV (`mode: "alpha"`) by running the transcription sidecar in `--render` mode, with the bundled fonts (`Resources/fonts`, or `public/fonts` in dev) and an optional corner logo; streams `render-update` events
  - Murtali (`fireworks.rs`): `analyse_fireworks(path, requestId)` (audio only), `fireworks_thumbs(path, times, requestId)` (JPEGs cached under the app cache dir, keyed by path + file fingerprint + times), `render_fireworks(job, requestId)` (`job` = `{ kind: "full" | "reel", output (.mp4), size?, items: [{ path, start, end, crop? }] }`; the output must not be a source), `cancel_fireworks()`, `fireworks_fingerprint(path)` → `{ size, mtimeMs }`, `read_lut(path)` → the `.cube` text (≤ 64 MB) for the preview. `render_fireworks` and `fireworks_thumbs` take an optional `lut: { path (.cube), strength 0–1 }` (dropped at strength 0; the thumbnail cache key includes the LUT file's fingerprint and strength). Analysis and render share one child ("Diġà qed nipproċessa…"); thumbnails run unattached. An engine without the modes answers with a file-not-found error naming `--fireworks`, shown as "Aġġorna l-engine (Settings → Components)"
  - `audio_peaks(media_path)` (`subtitle_render.rs`): waveform for the timeline when a session is reopened without re-transcribing (`transcribe --peaks`) → `{ rate: 50, peaks: [0–255] }`
  - `load_style_file(path)` (`subtitle_render.rs`): read a `.bstyle` look file (≤ 512 KB) chosen by the user
  - Post templates (`post_templates.rs`): `list_post_templates`, `get_post_template_overlay(id)` (overlay as a `data:` URL so the canvas is never tainted and `toBlob` works), `save_post_template(manifest, overlay_path?, overlay_bytes?)` (validates a decoded PNG in the selected format), `delete_post_template(id)`, `save_post_image` (raw request body + percent-encoded `path` header; only JPEG/PNG data to a `.jpg/.jpeg/.png` path)
- Parallel processing via **Rayon** for RAW conversion and watermarking; watermarking runs in batches of up to 8 photos: decode, then encode/write, are parallel (Rayon) while duplicate checks, output names, logs and progress stay sequential in filename order
- Watermark scaling cached per (width, height) to avoid redundant resizing
- Event emission: `log`, `progress`, `done`, `raw-done`, `transcribe-update`, `render-update`, `fireworks-update`, `yt-update`
- CPU-heavy image/RAW work and blocking render setup use `tauri::async_runtime::spawn_blocking()`. Other commands include synchronous configuration/template/file operations and async sidecar handling; inspect the relevant module before changing concurrency.

#### Tauri plugins
- `tauri_plugin_shell` — spawn the Python transcription sidecar (note: `yt_download` spawns `yt-dlp` directly, not via this plugin)
- `tauri_plugin_dialog` — file/folder pickers
- `tauri_plugin_opener` — open output folder in Finder/Explorer

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
  - `fireworks-update({type, id, ...})` — Murtali analysis / thumbnails / export; `id` is the request id the UI passed in
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
- Serve mode (no arguments) loads the model, emits `ready` (withheld from the frontend), then handles one JSON request per stdin line (`{"id","op":"transcribe","path","language","start","end"}`; `{"op":"shutdown"}` or closing stdin ends it). Every event of a request carries its `id`; a failing request emits `error` and the loop goes on (`sidecar/test_serve.py`)
- Direct mode (a JSON request as the argument) handles one request and exits; it skips `ready`
- Render mode (`--render <job.json>`) emits `status`, `progress` (0–100), then `done` (`{path}`), `cancelled` or `error`, and always exits 0 after reporting
- Murtali modes (one-shot, no model; the final events carry the same fields the screen reads): `--fireworks <job.json>` (`{path}` → `done { duration, fps, width, height, rate: 10, rms, transient, low, peaks, peaks_rate: 50 }`, or `error`), `--fireworks-thumbs <job.json>` (`{path, times, dir}` → `done { files }`), `--fireworks-render <job.json>` (see Fireworks below → `done { path }`). Stdin `cancel` or EOF stops ffmpeg, like `--render`
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
- `api/history.js` — GET: Fetch paginated post history (filterable by status, searchable by caption; optional `from`/`to` ISO window on `scheduled_time`, used by the Calendar's day list; `status=summary` returns `{ upcoming (next 4 active), pending, failed, latestFailed }` in one request for Home/Skeda — `_lib/history-summary.js`; the desktop falls back to the two older calls against a backend without it)
- `api/posts/[id].js` — GET a post; PATCH queued edits/rescheduling/media; POST retry/verify; DELETE cancel/remove. Mutations compare revisions and claim via status CAS before external work. Published/unknown destinations block editing; cancelling a native Facebook schedule requires remote verification. Shared media is left for retention cleanup.
- `api/cron/process.js` — GET/POST (auth: `CRON_SECRET`, not `API_KEY`): publishes due posts to FB/IG (old WordPress jobs fail with a clear message, since the WordPress publisher was removed) and hands eligible Facebook posts to Facebook's native scheduler. Triggers and cadence: see the scheduling note below. The handler accepts both `GET` and `POST`.
- `api/meta.js` — Consolidated utility endpoint:
  - `GET ?type=version` — `backend_version` and `minimum_desktop_version` (from `BACKEND_VERSION` / `MIN_DESKTOP_VERSION`)
  - `GET ?type=profiles` — committee profile list (id + name, never exposes tokens)
  - `GET ?type=live-posts` — live FB/IG posts pulled from the Graph API
  - `POST {action:'cleanup', paths:[...]}` — remove uploaded media from Supabase Storage
- `api/drive/[...slug].js` — Google Drive proxy (catch-all route):
  - `GET /api/drive/posters[?folderId=...]` — list files in a Drive folder
  - `GET /api/drive/find?date=YYYY-MM-DD` — files under the Drive root whose name contains that date (the calendar's poster suggestions; the name must hold the date as DD:MM:YY)
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
- `api/events.js` — Kalendarju when shared (`createEventsHandler(client)`): `GET ?profile_id=` → `{ events, labels }`; `POST` (idempotent by `request_id` or a client `id`); `POST ?type=import` (a Mac's events, ids kept, existing ones skipped, labels merged); `PATCH ?id=` with `revision` (409 + `current`); `DELETE ?id=`; `PUT ?type=labels`. Tables `calendar_events` (wall-clock `start_wall`/`end_wall`, `tz`) and `calendar_settings` (one row, the labels). Migration `20261122_sharing.sql`
- `api/tasks.js` — Xogħol (`createTasksHandler(client)` for tests). Tables `task_boards` → `task_columns` (`board_id`) → `tasks` (`column_id`), all with `profile_id`:
  - `GET ?profile_id=` — `{ boards, columns, tasks }` of the profile. No board is created automatically
  - `POST { type: 'board'|'column'|'task', request_id, profile_id, … }` — idempotent create (same `request_id` → same row). A board is returned as `{ ...board, columns }` with its starting columns (Biex isir, Għaddej, Lest), inserted with `request_id`s derived from the board's, so a retried create neither duplicates nor misses them. A column needs `board_id`; limits 20 boards per profile, 12 columns per board
  - `PATCH ?type=board|column|task&id=` — partial edit. A `revision` in the body must match (else `409` with `current`); moves (`column_id`/`position`) are sent without one, last move wins
  - `POST ?type=import { profile_id, boards, columns, tasks }` — a Mac's boards copied up when sharing is switched on; ids kept, existing rows skipped, invalid ones reported in `bad`
  - `PATCH ?id= { op: 'check', item_id, done }` — ticks one checklist item with a compare-and-swap retry, so concurrent ticks on different items both survive
  - `DELETE ?type=board|column|task&id=` — deleting twice is fine; a column must be empty and cannot be its board's last; a board is deleted with its cards and columns (explicitly, and by `on delete cascade`)
  - A card's `column_id` may point to another board of the same profile (moving between boards)
  - Validation is in `api/_lib/task-rules.js`, also imported by the desktop (`src/views/xoghol/model.js`)

**Shared modules** (`_lib/`, not functions): `auth.js`, `cors.js`, `delivery.js` (resumable Graph publishing; exports `GRAPH`, the one place the Graph API version is set), `post-rules.js` (validation/status), `malta-time.js` (also used by the desktop), `profiles.js` (the only reader of `COMMITTEE_PROFILES`; credentials), `google.js` (Drive client), `poster-date.js` (poster file names), `task-rules.js` (Xogħol validation, also used by the desktop). The function-count rule is in AGENTS.md → Gotchas.

**Authentication:**
- Application endpoints require `Authorization: Bearer ${API_KEY}`. The cron accepts only `CRON_SECRET`; CORS preflight is handled separately.
- Facebook/Instagram credentials stored in `COMMITTEE_PROFILES` env var (JSON array of committee accounts)
- Google service account credentials in `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS` env var.
- `ARCHIVE_FOLDER_ID` — root folder of the SD-card archive on the Shared Drive (defaults to `DRIVE_FOLDER_ID`); the service account needs Content manager there.

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
1. User picks input folder, a watermark (grouped by pack with a heading per pack in Ritratti; last choice remembered in `localStorage`), quality, max dimension, watermark toggle, "Neħħi duplikati wara xulxin" toggle (off by default, remembered in `localStorage` as `banditur_dedupe`)
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
   - Fujifilm RAF is read first by its header (`FUJIFILMCCD-RAW `, big-endian JPEG offset at byte 84 and length at 88, bounds-checked; `raf_jpeg_span()`), so no IFD walk or whole-file read. Canon CR3 (an ISO-BMFF container) has no fast path and still goes through the whole-file scan
   - TIFF parsing is manual byte-level work with no dependency: little-endian (`II`) and big-endian (`MM`), searching the IFD chain for the preview (tag 0x0201 = offset, 0x0202 = length) and sub-IFDs via 0x014a (SubIFD) and 0x8769 (ExifIFD). The binary fallback finds the largest `0xFF 0xD8 … 0xFF 0xD9` span
   - What is extracted is the camera's **preview-quality** JPEG, not the full-resolution demosaiced image. The fallback scan is slow, can pick up spurious JPEG data in metadata and must find a JPEG over 50 KB; some newer formats (e.g. Sony A1/A7RV ARW) have unusual TIFF structures that only the fallback handles. With no resize the embedded bytes and tags are kept as they are (un-rotated)
4. Backend emits `raw-done` event with success/skipped counts, output path and elapsed ms

#### Video Transcription
1. User opens Transcription tab → `preload_transcribe()` starts the worker (`transcription.rs`) if none is running
2. The engine runs in **serve mode**: loads MLX Whisper once, emits `{"type": "ready"}`, then reads requests from stdin and stays loaded between videos (10 idle minutes → stopped)
3. User picks a file → the UI makes a request id and calls `process_video(video_path, requestId)`; Traskrittura keeps one `transcribe-update` listener and ignores events of any other id
4. Rust backend:
   - Writes the request as one JSON line to the worker; if that fails (the worker died) it starts a new one and tries once more
   - Forwards only events of the request in flight (an older engine without ids gets the id added); `done`/`error` free the worker; if the process ends mid-request the UI gets an `error`. `cancel_transcribe()` kills the worker
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

#### Fireworks (Murtali)
1. Drop / pick a video → `analyse_fireworks`. `sidecar/fireworks.py` decodes only the audio (16 kHz mono, one ffmpeg pass, streamed) and measures per 0.1 s: `rms` (loudness), `transient` (onset strength, spectral flux, relative to the clip's 99th percentile) and `low` (share of energy below 150 Hz), all 0–255, plus 50 Hz waveform peaks. The UI adds `fireworks_fingerprint` and saves everything (curves included) in the project.
2. `views/murtali/segments.js` decides: `activity()` (mostly `transient`, weighted up by `low`, minus a rolling low-percentile baseline) → `findSegments()` (hysteresis from the sensitivity slider, gaps under 2.5 s merged, items under 1 s dropped, then asymmetric padding by *Distanza*) → `redetect()` (keeps `auto: false` items, replaces the rest, keeps ids / crop / keep flag of a matching old item so a Reel selection survives a slider move).
3. Thumbnails: `fireworks_thumbs` at `peakAt` minus the distance delay (the brightest burst is seen before the loudest bang is heard), with the project's LUT applied the same way as the export.
3b. LUT preview: `read_lut` → `views/murtali/lut.js` `parseCube()` (3D only, `DOMAIN_MIN/MAX`, red fastest) → `LutPreview.svelte`, a WebGL2 canvas over the `<video>`: the frame as a 2D texture, the LUT as an RGBA8 3D texture (hardware trilinear), `mix(original, graded, strength)`, redrawn per decoded frame (`requestVideoFrameCallback`). The `<video>` loads with `crossorigin="anonymous"` so its frames can be read; if it fails to load that way it is reloaded without, and the preview turns itself off with a note (exports unaffected).
4. Export: `reel.js` `exportJob()` → `render_fireworks` → `sidecar/fireworks_render.py`: one `-ss start -t dur+0.3 -i` input per item; video: the LUT first when set (`sidecar/lut.py`: the `.cube` is copied to the work folder as `lut.cube` so no path is escaped in the graph; `lut3d` tetrahedral, or below 100 % `format=gbrp16le,split` → `lut3d` → `blend=all_opacity=s` over the original), then `fps` + (`full`: scale, or blurred-background fit for non-16:9; `reel`: `crop=w:h:x:0` + scale to 1080×1920, portrait sources scaled/padded) → trim to the item → `concat`; audio `aresample/aformat` → padded to exact length → `acrossfade=0.3` chain → `loudnorm=I=-14:TP=-1.5` → libx264 CRF 18 + AAC 192k, `+faststart`. More than 30 items render in chunks of 30 (no loudnorm), are joined by stream copy, and one last pass normalises the sound (the audio crossfade is missing at each chunk joint).

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
1. `views/Xoghol.svelte` (Social → Xogħol, key `5`) loads the profile's boards through `xoghol/board.svelte.js`, which sends `/api/tasks`-shaped requests to `xoghol/local-store.js`: one JSON document in localStorage (`banditur_xoghol`), validated with the backend's `task-rules.js`, tested in `local-store.test.mjs`. To share boards later, point `api` in `board.svelte.js` back at `lib/api.js`. It shows one board at a time (`board.boardId`; tabs; last choice in `localStorage` as `banditur_xoghol_board:<profile>`, falling back to the first board) and an empty state with a name field while the profile has none. does not poll (nothing changes behind its back)
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
- Background polling (queue counts every 60 s, shared Xogħol 30 s, shared Kalendarju 60 s) uses `lib/visible.js` `everyVisible()`: nothing runs while the window is hidden, and one catch-up run happens when it is shown again.
- `studio-jobs.svelte.js` persists a common activity index. Photo jobs have one serial lane (its saves are throttled to once a second while a job runs, with a final save when it ends and on `pagehide`), download jobs another. Correlated native IDs plus completed-file lists support cancellation/retry without replaying successful files. Restarted running/queued jobs become interrupted and need operator action. `photo_jobs.rs` guards exclusivity and cancellation.
- Home shows failed/overdue/interrupted/unfinished work and active jobs (*Issa*, only when there is something), the open event's work, and *Jmiss*: queued posts and calendar events for the next 14 days (always shown; empty state when there are none). There is no recent-work history. Event workspaces link native projects, Studio outputs and scheduled posts through `event_id`; category/event filters scope report posts. `engagement_checked_at`/error and measured-post coverage distinguish unavailable metrics from zero.
- New native commands: `list_projects`, `save_project`, `delete_project`, `export_project`, `import_project`, `read_work_text`, `save_work_text`, `list_media_files`, `cancel_photo_job`, `cancel_download`, `import_post_templates`. Existing photo/download commands accept optional job IDs; photo commands accept retry include lists.
- Composer autosave awaits IndexedDB before form metadata. Interrupted submissions retain their request/body/media; repeated edits first read back committed fields. Archive duplication reuses uploaded media, and Studio handoffs preserve an existing composer as a draft.

### Known quirks

- **Transcription**: one long-lived worker per app (`TxState`: the child, the request id in flight, last use). Only one request at a time: a second `process_video()` while one runs is refused with a Maltese message. The worker accepts a JSON request or a legacy plain path.
- Language is selected per request (`mt`/`en`/`it`/`auto`), defaulting to `WHISPER_LANG`. A passage is extracted directly by ffmpeg (`-ss`/`-t`, so the whole video is not decoded) before recognition and its word times are offset back to source time; the Maltese CTC pass is used only for Maltese requests. `masri_alignment_enabled()` checks that both `torch` and `ctc_forced_aligner` import, so a bundle without them keeps Whisper's timings instead of failing.
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
- runs PyInstaller with `transcribe-bundle.spec` (onedir `COLLECT`; collects `mlx_whisper`, `mlx`, `imageio_ffmpeg` and the `subtitle_render`, `maltese` and `peaks` modules; **excludes `torch`, `torchaudio`, `scipy`, `hf_xet`, `transformers`, `tokenizers`, `nltk`, `ctc_forced_aligner` and `pyannote`** to keep the bundle small)
- fixes the MLX rpaths and ad-hoc re-signs the MLX libraries
- fails if the bundle is missing `mlx.metallib` or the bundled ffmpeg, or contains any of those excluded packages

`bundle.resources` in `tauri.conf.json` now holds only the fonts; the engine and model are installed separately (below). To rebuild only the sidecar: `npm run build:transcribe`. Shipping a version: RELEASE.md.

##### Local pieces (`npm run build:local`)
Four pieces, each fingerprinted (`scripts/lib/pieces.mjs`: SHA-256 over its input files; the model by name+size): **interface** (`src`, `index.html`, `vite.config.js`, `package-lock.json`, `public` minus fonts, the three `backend/api/_lib` files the desktop imports; test files ignored), **core** (`src-tauri/src`, Cargo files, `tauri.conf.json`, capabilities, icons, `banditur-config.json`, the launcher script, fonts; plus the interface while `UI_LOADER` is `false`), **engine** (`sidecar/`, `transcribe-bundle.spec`, the build script, the venv's Python version), **model**. `.build-cache/manifest.json` (gitignored) remembers what was last built; `makePlan()` decides build/install per piece and `scripts/build-local.mjs` (`runBuild`, tested with fake steps in `build-local.test.mjs`) carries it out. The engine and model are copied (APFS clone, falling back to a copy) to `<components>/{engine,model}/<n>.partial`, checked against the source by `treeHash`, renamed, then `installed.json` is written last; the previous version is kept, older ones removed (`scripts/lib/components.mjs`). The core is built with `tauri build --bundles app --config src-tauri/tauri.local.json` (no DMG, no signing key) and replaces `/Applications/Banditur.app` unless the app is running. Rust: `src-tauri/src/components.rs` reads `installed.json` and resolves the engine (`BANDITUR_ENGINE_DIR`) and model (`MLX_MODEL_PATH`) for every sidecar launch (`sidecar_command()`: transcription, render, peaks) — components folder, then the app bundle, then the checkout (dev); with none it fails with a Maltese message pointing to `npm run build:local`. `components_status` feeds Settings → Components. **Interface loader** (`src-tauri/src/ui_loader.rs`, `UI_LOADER = true`): `lib.rs` wraps the embedded assets with `LayeredAssets`; if `installed.json` names a usable `<components>/ui/<n>/` (has `index.html` and a `ui.json` whose `needsCoreApi` <= `CORE_API`) it is served instead, alone, same origin. `choose()` picks it; the version being tried is stored in `ui-state.json` and cleared by the `interface_ready` command (called from `App.svelte` once mounted); a version still marked trying at the next launch is added to `bad` and the next older one is used, then the embedded one. `reload_interface` re-selects and reloads (Settings → Components, and after a background update). `build-local` builds `dist`, refuses inline scripts (CSP), and installs with `ui.json`. Bump `CORE_API` by hand when a Rust command changes shape (it is 4: the `update_*` commands). Only a Rust/config change needs a new app.

##### In-app updates (`source_update.rs`, `scripts/update.mjs`)
`build-local` writes `<components>/source.json` (`{ root, recordedAt }`, `writeSource()`, on every real run) and prints `{ work, core, ui, engine, model }` for `--dry-run --json` (log to stderr). Rust (`src-tauri/src/source_update.rs`; pure parsers and tests beside it): `update_status` (`git fetch` with a 60 s limit, branch, `@{u}`, behind/ahead, up to 20 waiting commits, dirty = tracked changes, `pending` = the dry run still reports work, `building` = live pid in `.build-cache/update.lock`, `lastResult`), `update_pull` (refuses when dirty/diverged/locked, `git pull --ff-only`, returns the plan), `update_run_background` (detached `update.mjs --no-app`; `update://done` carries `update-result.json` when it ends), `update_and_restart` (detached `update.mjs --wait-pid <pid> --relaunch <app>`, then `app.exit(0)`), `update_clear_result`. Every git call sets `GIT_TERMINAL_PROMPT=0` and uses `/usr/bin/git`; node scripts run through `/bin/zsh -lc 'cd "$BANDITUR_ROOT" && exec node "$@"'` with the root in the environment. `scripts/update.mjs` (pure parts in `scripts/lib/update.mjs`, steps injectable, tested): lock, log, wait for the pid, PATH, dependencies (`deps.json` hashes), `build-local --yes`, `update-result.json` (`{ ok, at, head, error?, logTail? }`), reopen the app, release the lock. Interface: `lib/updates.svelte.js` (state, 3-hourly check via `everyVisible`, `startUpdate()`), pure helpers in `lib/updates.js`, the card in `views/Settings.svelte`, the dot in `components/Toolbar.svelte`, texts in `strings.js` (`UPD`).

**Generated files:** `src-tauri/gen/schemas/` is regenerated by every Tauri build and is not
tracked; only the macOS/Windows icons in `src-tauri/icons/` are kept (the mobile sets were unused).

## Troubleshooting

### Watermarks not found
Open **Settings → Watermarks** and check the pack is installed (a fresh install has none — import `Banditur.bwpack`). A watermark with only one orientation logs a warning and leaves photos of the other orientation unmarked.

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

Banditur has two update paths (the local operational runbook is RELEASE.md):

1. **Backend** — commit and push backend changes; Vercel deploys from Git.
2. **Desktop** — push to the branch the shared Mac follows; the app there updates itself (see "Updates on the shared Mac" above). There is no signed updater, no release artifact and no update manifest.

Before deploying backend code that depends on schema changes, run the matching Supabase migration first. Migrations live in `backend/supabase/migrations/` and are applied in date order:

```text
backend/supabase/migrations/20260528_release_update_foundation.sql
backend/supabase/migrations/20260612_audit_fixes.sql
backend/supabase/migrations/20260804_signed_uploads.sql
backend/supabase/migrations/20261029_production_workflows.sql
backend/supabase/migrations/20261103_tasks.sql
```

`MIN_DESKTOP_VERSION` and `BACKEND_VERSION` (Vercel env vars, read by `GET /api/meta?type=version`) are set by hand when needed.

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
│   ├── views/murtali/            # Murtali logic and components (segments, items, history, reel, timeline + tests)
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
│   │   ├── fireworks.rs          # Murtali analysis, thumbnails and export (sidecar bridge)
│   │   ├── post_templates.rs     # Post-maker templates (store/list/delete) and saving the finished JPG
│   │   ├── projects.rs           # Durable subtitle/post projects, .banditur import/export, work-file helpers
│   │   ├── photo_jobs.rs         # Photo job exclusivity, cancellation and photo inspection
│   │   ├── watermark_packs.rs    # Tauri commands for watermark packs
│   │   ├── wm_pack.rs            # Pack format, validation, install/export (unit-tested)
│   │   ├── source_update.rs      # In-app updates from GitHub (git status/pull, update.mjs launcher)
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
├── scripts/                      # build-local, update (in-app updates), sidecar-build, fonts and watermark-pack scripts
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
- `src-tauri/src/source_update.rs` + `scripts/update.mjs` — In-app updates from GitHub
- `sidecar/transcribe.py` — Whisper wrapper with JSON protocol
- `sidecar/fireworks.py` + `fireworks_render.py` + `lut.py` — Murtali sound analysis, export and `.cube` LUTs (`--fireworks*` modes)
- `scripts/build-transcribe-sidecar.sh` + `transcribe-bundle.spec` — Build the release transcription sidecar
- `backend/api/cron/process.js` — Publishing cron and stale media cleanup
- `backend/supabase/schema.sql` — Current Supabase schema/policies/RPC
- `backend/supabase/migrations/` — SQL migrations to apply before dependent backend deploys
- `.gitignore` — Covers build artifacts, secrets and release artifacts

### Testing

Run checks from the repository root:
```bash
npm test                    # every *.test.mjs under src/, backend/tests/ and scripts/ (found by glob)
npm run test:py             # the sidecar tests (Maltese rules, passages, serve mode, Murtali)
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
| **Desktop Plugins** | shell, dialog, opener, notification |
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
| **Updates** | The shared Mac pulls the repository from GitHub and runs `build:local` (`scripts/update.mjs`) |

### Dependencies

#### Rust (Tauri Backend)
| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2.x | Desktop app framework, IPC, event emission |
| `tauri-plugin-shell` | 2.x | Subprocess spawning (transcription sidecar) |
| `tauri-plugin-dialog` | 2.x | File/folder picker dialogs |
| `tauri-plugin-opener` | 2.x | Open folders in Finder/Explorer |
| `image` | 0.25 | Image format detection, pixel manipulation |
| `mozjpeg` | 0.10 | JPEG encoding/decoding with quality control |
| `kamadak-exif` | 0.6 | EXIF metadata parsing (orientation tag) |
| `rayon` | 1 | Data parallelism for RAW conversion and the watermark batches |
| `url` | 2 | Real URL parsing for the YouTube host allowlist |
| `zip` | 4.x | Reading/writing `.bwpack` watermark packs  |
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
| `@tauri-apps/plugin-dialog`, `-opener`, `-notification` | JS bindings for the Tauri plugins |
| `@supabase/supabase-js` | Dev dependency only: the backend handlers import it and the backend tests resolve it from the root `node_modules`. The desktop no longer ships it — `composer.svelte.js` uploads with a plain `fetch` PUT to Supabase Storage's signed-upload URL (multipart, as storage-js sends it) using the backend-issued token |

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
