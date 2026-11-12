# Decisions

A short log of the non-obvious product and architecture decisions behind Banditur —
the *why* that the README, AGENTS.md, and RELEASE.md don't capture. Add an entry
when a choice would otherwise be re-litigated later.

Reviewed against the source on **2026-11-03**. Dated entries preserve history; superseded
choices are marked below. Current implementation details belong in AGENTS.md and README.md.

---

## Product

### Who it's for
Banditur is built for **Maltese band/festa committees** (każini u għaqdiet) — volunteer
teams managing event photography and social media. This drives several choices: the
UI and feature names are **Maltese-first** (*Marka & Ssortja*, *Skeda*, *Traskrittura*, *Xogħol*),
multi-profile support maps to multiple committees, and transcription targets Maltese.

### Maltese-first UI
Feature and status strings are Maltese (`src/strings.js`). The audience is local
volunteers, not an international user base, so Maltese is the primary language rather
than an i18n afterthought. Captions still pass non-Latin Maltese characters (ħ, ġ, ċ)
through unchanged when bolding for Facebook/Instagram.

---

## Architecture

### Single API key baked into the desktop binary
**Decision:** application API endpoints authenticate against one shared `API_KEY`, compiled
into the app via `include_str!` of `banditur-config.json`, with optional local Settings overrides.
The cron uses `CRON_SECRET` instead; updater manifests are public.
**Why:** the app is distributed only to a **small, trusted group** of committee members,
so a shared key is an accepted trade-off for simplicity over per-user auth.
**Trade-off / known risk:** the key is extractable from the distributed binary (it is not
secret on the client). This is acceptable at the current trust level and distribution size.
**Revisit if:** distribution widens beyond the trusted group — at which point move to
per-user identity (e.g. Supabase Auth) and key rotation. `CRON_SECRET` is already kept
separate from `API_KEY` so the cron path isn't exposed by the client key.

### Cron every 15 minutes via GitHub Actions, with Facebook native scheduling
**Decision:** `.github/workflows/cron.yml` (GitHub Actions) POSTs to `/api/cron/process` every
15 minutes with `CRON_SECRET`. Ordinary Facebook posts (not Reels or Stories) more than 10 minutes and up to 30 days ahead are handed to Facebook's native
scheduler for publication at the requested time. `backend/vercel.json` keeps a once-daily Vercel
cron as a fallback.
**Why:** the Vercel **Hobby plan** only allows daily crons, and GitHub Actions scheduled
workflows are free. This replaced the interim plan of pinging the endpoint from a
local/self-hosted server.
**Trade-off:** Instagram posts, Reels, Stories and near-term Facebook posts can publish up to ~15 minutes late (GitHub can delay
scheduled runs further under load), and each run publishes at most 5 due posts. The repo is public,
so GitHub disables its scheduled workflows after 60 days without repository activity — a quiet
spell with no commits would silently stop the 15-minute trigger.
Facebook jobs already handed to its native scheduler can still publish there; new or not-yet-handed-off jobs and Stories still depend on a cron run. The Vercel fallback calls with `GET`, which the
handler accepts alongside `POST`.
**Revisit when:** worker-published posts need minute-level precision, or more than 5 posts
are regularly due in the same 15 minutes — then move to Vercel Pro crons or a dedicated scheduler.

### Local-time scheduling
**Decision:** scheduled times are entered in the user's local (Malta) time and converted to
an absolute UTC ISO instant on the client before being sent to the backend.
**Why:** committees think in local event time. Sending an absolute instant avoids the UTC
backend misreading a bare wall-clock string. (This corrected an earlier bug where naive
`datetime-local` values were treated as UTC.)

### Google Calendar stays separate from scheduled posts
**Decision:** the Calendar tab reads and writes Google Calendar only; scheduled posts remain
in Supabase-backed Skeda/Arkivju views and are never overlaid onto the calendar.
**Why:** committee events and publication jobs look similar on a timeline but have different
ownership, failure modes, and audit trails. Keeping them separate avoids accidental edits to
posts while planning events.
**Update 2026-10-16:** the Calendar side panel now also lists the selected day's scheduled posts, read-only
(no drag, no edit, no overlay on the grid), so planners can see what is going out without risking an edit.
**Superseded (current implementation):** Kalendarju now has a separate, toggleable post layer
(`banditur_cal_posts`): scheduled/published posts appear on the grid with their own colour, queued
posts can be dragged to reschedule (revision-checked, reverted on failure) and clicked to edit or
duplicate. Google events and posts remain separate data — posts are never written to Google Calendar.
**Original trade-off:** users do not see posts and events in one combined calendar. Calendar labels are
stored as Google private event metadata (`banditurLabel`), while label colours and visibility
remain local UI preferences.

### Report date-range trends query the Graph API directly, no snapshot table
**Decision:** `reports/monthly.js` computes follower/reach trends by calling Meta's Graph API
insights edge with `since`/`until` set to the exact period being reported (and the exact
comparison period), summing the daily buckets — rather than running a new daily cron job that
snapshots page insights into our own Supabase table.
**Why:** Graph API already retains enough insights history (`page_impressions`, `page_fan_adds`,
`page_fan_removes`) to answer "what happened in this specific date range" directly. A
self-maintained snapshot table would duplicate data Meta already serves, add a new cron job and
migration to operate, and — worse — would only start producing real historical trends from the
day it was deployed onward, with nothing for reports covering earlier periods.
**Trade-off:** page-level insights metrics are periodically deprecated or restricted by Meta on
a per-Page basis outside our control, so `fetchPageInsights` fetches each metric independently
and degrades gracefully (returns `null` for that one figure) rather than failing the whole
report if e.g. `page_fan_adds` stops being available. Absolute follower counts (`fb_followers`/
`ig_followers`) are still always "right now", since Graph API doesn't expose historical
snapshots of those — only the derived net change (`fb_follower_change`) is period-scoped.
**Revisit when:** Meta deprecates one of the metrics this relies on for good, or reports
routinely need a per-day (not just per-period) breakdown that summing daily buckets on every
request can't cheaply provide.

### Watermarks are runtime-installed packs, not bundled
**Decision:** photographer watermarks are distributed as `.bwpack` files (a zip with a
versioned `manifest.json` + `<id>/{portrait,landscape}.png`) and installed into the app-data
folder at runtime, instead of being baked into the app via `bundle.resources`.
**Why:** adding or changing a photographer used to require a new signed build and update for
everyone. Packs can be imported, exported, edited (add/remove one watermark) and deleted from
Settings, and they survive app updates. The format is strict (fixed file names, validated ids,
alpha PNGs, 3:2/2:3, format version) so a hand-made or broken pack is rejected with a clear
message instead of confusing the processor. A pack holds many photographers; the existing set
ships as one pack (`Banditur.bwpack`).
**Trade-off:** a fresh install has no watermarks until someone imports the pack, and packs have
to be passed around as files.
**Revisit when:** packs change often enough that members fall out of sync — then host packs in
Supabase Storage and let the app install/update them from the server.

### Original vanilla frontend + Tauri (frontend superseded by Svelte 5)
**Decision:** the frontend is plain HTML/CSS/JS (`src/main.js`); the shell is Tauri (Rust).
**Why:** **simplicity and longevity** — no framework/build churn, a small surface that's easy
to maintain solo, and Tauri's small native binaries plus Rust for fast image/RAW work.
**Superseded 2026-10-22:** the UI now uses Svelte 5 runes and Vite; `src/main.js` mounts
`App.svelte`. The subtitle editor/post maker retain vanilla modules, and the shell remains Tauri.

### RAW conversion extracts the embedded JPEG preview
**Decision:** RAW files are converted by pulling the embedded full-size JPEG preview out of
the container (TIFF IFD parse, with a binary-scan fallback), not by demosaicing the sensor data.
**Why:** committees want fast, good-enough JPEGs for posting, not raw-developer fidelity.
Extraction is dramatically faster and avoids a heavy RAW-processing dependency.
**Trade-off:** output quality is bounded by the camera's embedded preview; no exposure/white-
balance development.

### On-device Maltese transcription (MLX Whisper)
**Decision:** transcription uses a local, 4-bit Maltese-tuned Whisper model via Apple's MLX
(`mlx-maltese-whisper-4bit`), bundled into the app.
**Why:** Maltese accuracy plus GPU-accelerated speed on Apple Silicon, with no per-use API
cost and no audio leaving the machine. Falls back to a generic MLX model if the local one
is missing.

### Subtitle export runs in the transcription sidecar, styled as ASS
**Decision:** Traskrittura's styles and animations are written as an `.ass` file in the frontend
(`src/subtitles/styles.js`) and burned in / rendered transparent by ffmpeg's libass filter, run from
the existing transcription sidecar (`transcribe --render`). The in-app preview reuses the same timing
math rather than rendering frames with libass.
**Why:** the sidecar already ships a libass-enabled ffmpeg (imageio-ffmpeg), so this adds no new
binary or dependency. ASS covers every preset (karaoke `\kf`, per-word colour/alpha, `\t` scaling,
`\move`, `\fad`) and is also a useful export on its own (VLC, Aegisub, DaVinci). Live sync with an
editing app was deliberately left out for now.
**Trade-off:** the preview uses WebKit fonts, so it's close to the export but not pixel-identical.
Bundled Montserrat files are passed through a private libass fonts directory and fontconfig;
exports report the selected font. System-font-only discovery is superseded by the bundled-font approach.
**Revisit when:** users need pixel-exact previews (render preview frames with libass) or an
editing-app integration.

### Subtitle fonts are bundled, and the preview copies libass's sizing
**Original decision:** ship several open-licence fonts (checked for ħ ġ ċ ż) with the app and use the same files
for the preview (`@font-face`) and the export (libass `fontsdir`). The preview sizes each font with
its measured libass ratio (`unitsPerEm / (usWinAscent + usWinDescent)`).
**Why:** with system fonts the presets looked generic, and the preview could only approximate the
export. Many popular display fonts (Poppins, DM Serif Display) lack Maltese letters, so every font is
checked by script before it's included.
**Current scope (2026-10-14 onward):** Montserrat only, in SemiBold, Bold, ExtraBold and Black.
The bundled-font approach remains; the original nine-font selection is superseded. Font changes
use `scripts/build-fonts.py` and `scripts/check-fonts.py`.

### Release builds skip the MASRI timing pass
**Decision:** the release sidecar leaves out PyTorch and `ctc_forced_aligner`; the alignment pass
checks they're importable and otherwise keeps Whisper's timings.
**Why:** PyTorch would add well over a gigabyte to an app that's already ~1 GB.
**Trade-off:** word timings (and so karaoke/pop animations) are less precise in installed apps
than in dev.
**Revisit when:** timing precision matters more than download size — then add torch and the
aligner back to `transcribe-bundle.spec` and drop its torch exclusion/check.

### YouTube download shells out to `yt-dlp` directly
**Decision:** `ytmp3.rs` spawns `yt-dlp` itself rather than going through the Tauri shell allowlist.
Since 2026-11-11 it is the app's own copy in `<app data>/tools/`, not the host's (see that entry).
**Why:** Inputs are validated (YouTube http(s) URL + existing output dir, `--` argument guard) to
compensate for skipping the allowlist.

---

## Non-goals (for now)
- No live end-to-end tests. `npm test` covers the API handlers, delivery worker and Xogħol against
  in-memory fakes, plus the subtitle/post-maker/watermark/Xogħol models; Rust and Python tests cover
  packs, templates, projects, duplicates and Maltese rules. Native and live external flows (Meta,
  Google, Supabase, MLX) still need manual testing.
- No Windows/Linux focus — built and tested on macOS (Apple Silicon) first.
- No public/multi-tenant SaaS — single trusted distribution, not open signup.

## 2026-10-13 — Reel captions are sized up per format

Caption size is a percentage of the frame's shorter side. On a 9:16 reel that
read small once watched full-screen on a phone (checked on a real export), so
`layoutFor()` multiplies it by `FORMAT_SCALE` (reel 1.3, square 1.1, wide 1).
Line length still comes from what fits across the frame, so cues re-split to
fewer words where needed. Preset values are maintained in `src/subtitles/styles.js`; the later three-preset decision
defines the current scope.

## 2026-10-14 — Three presets, one font family

Decision (user): keep Gold (from an example reel; default), Pill and Classic (standard, no animation) and
discard the other presets; Montserrat is the only font. Rationale: a small, consistent set that matches the
association's real reels. Customisation is unchanged — presets are only starting points. Fonts removed from
`public/fonts/`; saved looks with other fonts fall back to Montserrat Bold. Montserrat is wider than the reel's
font, so Gold is 5.2% of the shorter side (measured against the example: same text width).

## 2026-10-14 — Watermark packs are built in bulk (dialog language later superseded)
The watermark PNGs already exist; the tedious part was adding photographers one by one. *Add many…* builds a pack from a multi-select of PNGs (names from file names, orientation from picture size) using the existing `add_watermark` command, so no Rust change was needed. The new dialog was originally in English like the editor; the later Maltese UI decision supersedes that language choice.

## 2026-10-14 — Traskrittura UI in plain English *(superseded 2026-10-16: now Maltese, see below)*
Decision (user): the editor uses English, with no unusual Maltese words (captions, split, join, style, names, export).
Everything else keeps its existing Maltese. The strings live in `SUB` / `TX` in `src/strings.js`; the three presets
are Gold, Pill and Classic.

## 2026-10-14 — Exact word-count proposal (superseded); editable word timing
Decision (user): the words-per-caption slider ignores the character budget, so it always gives that many words
(long captions wrap, or get flagged "too long"). A word's highlight can be retimed on the timeline or with `[` / `]`;
the first word of a caption is pinned to the caption start.
**Current implementation:** the word count is a maximum, additionally constrained by line
capacity, pauses, sentence boundaries and speaker changes (`buildCues()` and `resplit()`).

## 2026-10-14 — Style panel docked, toasts at the bottom
The style drawer docks beside the caption list from 861 px wide (it overlays below that), and toasts everywhere
appear bottom-centre, so neither covers captions or header buttons.

## 2026-10-14 — Big line, end card, shared Tools layout, export font report
Decision (user: "implement all but the preview one"): the following subtitle-export and layout features were implemented.
- **Big line**: a per-caption style (`punch`) — upper case, ~1.9× size, slanted, mid-frame. Layout is computed per caption.
- **End card**: closing text on a black frame after the video; the video and audio are extended by the exporter.
- **Tools layout**: the three form tabs share one width, status card and footer alignment.
- **Export font report**: the export prints which font file libass actually used (`Font: MontserratBlack-Regular`), turns
  red if it isn't Montserrat, and gives ffmpeg a private fontconfig. Confirmed on a real export on the Mac (Montserrat).
- Historical open issue: the **preview** font in the built app. Current preview code registers
  the bundled Montserrat faces; preview/export parity still needs checking in installed builds.

## 2026-10-16 — Maltese everywhere, English for technical words
Decision (user): the whole app, including Traskrittura, is Maltese. Technical words stay English (SRT, ASS, MP4, MOV,
ProRes, Reel, Post, Template, Settings, API Key, Timeline, Play/Pause, Zoom). Replaces the 2026-10-14 "plain English
editor" decision. Strings are in `SUB` / `TX` (`src/strings.js`), the style options in `src/subtitles/styles.js`
and the static editor labels in `src/views/traskrittura/editor.html`; current screens also contain Svelte labels.

## 2026-10-16 — Platforms are one list; TikTok and Website / App are placeholders
Decision (user): the posting page will eventually publish to Facebook, Instagram, TikTok and the organisation's own
website/app backend. The website is **not** WordPress. All platform rules now live in `src/platforms.js`; TikTok and
Website / App are shown greyed out ("Dalwaqt") and cannot be selected. WordPress is hidden from the composer but kept in
the list so old posts still display. The backend is unchanged: `schedule.js` must accept `tt` / `web`, and a publisher must
exist, before `available` is set to true.

## 2026-10-16 — Drafts keep their media (IndexedDB)
Drafts and the autosave used to store only text, so an offline "draft" lost its photos. Files now go to IndexedDB
(`src/media-store.js`); localStorage keeps the text and the count. If IndexedDB is unavailable the draft still saves,
without media, and the user is told when a draft's media cannot be loaded.

## 2026-10-16 — Keyboard and safety defaults (navigation superseded 2026-10-22)
- `⌘↵` schedules only from Skeda; number keys `1`–`4` follow the new nav order (Skeda, Kalendarju, L-Arkivju, Għodda).
- A publish time in the past asks for confirmation; closing the window during a running job asks first.
- Errors stay on screen until closed; raw HTTP/network errors are shown as a Maltese sentence with the original in brackets.
- The UX pass targeted legible text and stronger secondary contrast; this historical target is
  not a current app-wide accessibility certification.

## 2026-10-18 — Optional removal of near-duplicate neighbours in Watermark
- A "duplicate" means a burst-style near-identical neighbour, not a byte-identical file. Detection is a 64-bit dHash on the oriented image, before resize/watermark.
- Each photo is compared with the last **kept** one (not the previous file), so a slow drift across a sequence cannot chain-delete photos. Threshold: Hamming distance ≤ 5 of 64 — deliberately strict, since keeping an extra photo is cheaper than losing a different one.
- Duplicates are skipped, never written to the output folder and listed in the log; originals are never touched. The toggle is off by default and remembered.

## 2026-10-18 — Maximized window and legacy large-screen layout (dimensions superseded)
- `tauri.conf.json` sets `"maximized": true` (not exclusive fullscreen, so the menu bar and Dock stay reachable). The 920×780 size is kept as the restore size; minimum stays 700×580.
- From 1500px wide, the composer, tool panels and Calendar widen with the window instead of staying in a fixed column (block at the end of `styles.css`). Checked at 700, 1024, 1440, 1920 and 2560px: no horizontal scroll.

## 2026-10-18 — Mark & Sort runs in parallel batches
- Was one photo at a time. Now batches of up to 8 (capped by core count): decode in parallel → sequential decisions (duplicates, output names via `reserve_path`) → resize/watermark/encode/write in parallel → ordered logging. Output names, log order and the duplicate rule are unchanged.
- The batch cap bounds memory (a decoded 24 MP photo is ~70 MB). Not done: JPEG DCT-scaled decoding for big downsizes (more code, riskier).

## 2026-10-18 — YouTube download: runtime hand-off and readable errors
- yt-dlp needs a JS runtime for YouTube and only finds Deno on the PATH. `ytmp3.rs` now looks for Deno/Node in the usual places and passes `--js-runtimes` when this yt-dlp supports it (checked via `--help`, so older versions don't break on an unknown flag).
- Errors go through `explain_ytdlp_error`: a Maltese sentence saying what to do (update yt-dlp, install Deno, check the internet, video unavailable) plus the original line. Not tested against live YouTube (no access from the build machine).
- Spotify download: deliberately not built (DRM-protected streams).

## 2026-10-19 — Post maker: native canvas and data templates (format/batch limits superseded)

Navigation moved from Għodda to Studio in the 2026-10-22 UI rewrite. The 2026-10-29 workflow implementation supersedes the 4:5-only/no-batch limits below while retaining the canvas and data-template design.
Decision (user): a tool for repetitive posts (Awguri, Kondoljanzi): a different portrait each time, fixed wording in the overlay, only the name changes; 4:5 only; no batch mode; the template is authored inside the app from a Photoshop overlay PNG; lives in Għodda; the result can go straight into Skeda.
- **Native 2D canvas, no Fabric/Konva** — the whole job is a movable photo, auto-fitted text and one export, which is a few hundred lines; it keeps the "no framework, no new dependency" rule. One `drawPost()` serves the preview, the editor and the export.
- **Templates are folders in the app-data directory** (`post-templates/<id>/template.json` + `overlay.png`), like watermark packs: adding or fixing one needs no signed build and survives updates. The overlay must be exactly 1080×1350 (checked in Rust), so there is no scaling logic and a text box means the same thing everywhere.
- **The overlay reaches the canvas as a `data:` URL** (`get_post_template_overlay`): an `asset://` image would taint the canvas and block `toBlob`; the asset protocol is also outside the CSP's `connect-src`.
- **`save_post_image` takes the raw bytes in the request body** (path in a percent-encoded header) instead of a JSON array of numbers, and refuses anything that is not JPEG/PNG data going to a `.jpg/.jpeg/.png` path — the command is reachable from the webview, so it must not become a general write primitive (same reasoning as `save_srt`).
- **Fonts**: only the bundled Montserrat weights (already checked for ħ ġ ċ ż), so the template editor cannot pick a font that lacks Maltese letters.
- **The preview canvas resets `font-feature-settings`**: the app sets `ss01/ss03` on `<body>` and a canvas in the page inherits it, which swapped E and Z for Montserrat alternates in the preview only (the export canvas is off-screen and was unaffected). Found in a browser test; the CSS rule must stay.
- **Not built (yet)**: sharing templates as a pack file, batch mode (a list of names → many images), other aspect ratios, a real crop/safe-area overlay for Stories.

## 2026-10-22 — Svelte toolbar UI (current implementation)

The UI was replaced by Svelte 5 views and shared components, while keeping Tauri and the
existing subtitle/post-maker engines. Home is always the initial screen. Social contains
Skeda, Kalendarju, L-Arkivju and Rapporti (keys 1–4; Xogħol was added as key 5 on 2026-11-03);
Studio tools use Cmd/Ctrl+5–9.
Settings is a page, and screen instances remain mounted after first use to preserve work.
Current window configuration is 1280×780, minimum 960×580, maximized at startup. This
supersedes the earlier 920×780 / 700×580 dimensions and legacy `styles.css` layout claims.

## 2026-10-29 — Four maintained project documents

At the user's request, project documentation is limited to README.md (overview), AGENTS.md
(technical guide), RELEASE.md (operations) and DECISIONS.md (rationale). Historical review,
remediation and feature-plan documents were removed. Describe current limitations honestly
in the maintained docs, without treating suggestions as implemented features. Generated
third-party documentation/licences stay with their dependencies.


## 2026-10-29 — Production workflows within the existing architecture

The user approved implementing the full feature plan while preserving the current code's
style and reasoning. Keep Svelte views/runes, shared controls/tokens, Maltese UI, Tauri file
operations, the injected subtitle editor and one canvas post renderer. New workflow modules
extend those engines; they do not replace them with a separate application framework.

- **Publication evidence per destination**: Aggregate success must follow confirmed IDs/status, including video processing. Persist preparation state and the publish boundary. A network timeout can mean success, so ambiguous outcomes require review rather than blind retry. Request UUIDs deduplicate scheduling and revisions protect edits against workers/other clients.
- **Shared clock and validation**: Pure rules are imported by composer/API. Malta wall times are explicit and invalid/ambiguous DST times rejected. FullCalendar uses its official Luxon adapter for the named timezone.
- **Local durable work**: Versioned JSON in app-data with atomic replace avoids browser quota for subtitle/design projects; the browser mock retains a localStorage fallback. Portable ZIPs optionally stream media and get new IDs on import. Existing browser subtitle sessions migrate only after a successful native write. Draft media remains IndexedDB-backed with visible failures.
- **Controlled batch work**: Single native photo lane and single download lane preserve predictable events/resources. Completed-file lists support retry; cancellation honours existing files and stops at natural boundaries. Duplicate preview decisions freeze a skip list, so keeping a candidate cannot silently skip a different photo later.
- **Template production**: Supported 1080-wide formats are square/portrait/Story, preserving old 4:5 defaults. Templates remain data, packs validate before installation, branding is profile-scoped, and names/CSV map to photos in explicit order. Review and output share the same renderer. This supersedes the 2026-10-19 restrictions.
- **Targeted subtitle repair**: Slice audio before inference and offset back to source time; replacement is one undoable edit preserving outside corrections. SRT keeps cue boundaries while estimating word timings. The installed model determines language quality.
- **Retention and reporting honesty**: Shared media survives edits/deletion and remains referenced by active/failed jobs; retention/pinning and daily collection govern disposal. Reports expose latest observed engagement, current followers and measured coverage. Unavailable data is not fabricated as zero.

The source/test implementation is separate from rollout. Schema migration, real external
API smoke tests, the rebuilt MLX sidecar and a signed installed-app check remain release
steps; editing these files does not deploy them.


## 2026-11-03 — Xogħol: shared to-do boards on the backend

Decision (user): a card-based, movable to-do list under Social, named **Xogħol**, shared with the
committee, per profile, columns (Kanban), cards with checklist toggles, notes, a due date
and a fixed set of colour labels (no custom labels), and nothing added to Home.

- **Stored in Supabase through one new handler (`api/tasks.js`)**, not in the app-data folder, because
  the board is shared. The service-role key stays on the backend like every other table; RLS allows
  only the service role. This brings the function count to 11 of the Hobby plan's 12.
- **Polling every 30 seconds instead of live updates.** Supabase Realtime would need client-side
  access rules for the shared desktop key, which is extractable (see "Single API key baked into the
  desktop binary"). Polling is enough for a committee to-do list.
- **Conflicts are handled per kind of change.** Dialog edits carry a revision and are refused when
  someone else changed the card (the user can see theirs or save anyway). Moves and checklist ticks
  carry no revision: a move is last-writer-wins and a tick is applied server-side to one item with a
  compare-and-swap retry, so two people working on the same card at once don't block each other.
- **Fractional positions** so a move rewrites one row; a column is renumbered only when there is no room.
- **Pointer-event drag**, no library: the webview's window-level file drop interferes with HTML5
  drag-and-drop, and the subtitle timeline already drags this way. Alt+arrows give a keyboard path.
- **No offline editing**: a change that cannot be saved is rolled back with a message, unlike Skeda
  drafts. Revisit if committees need to plan offline.
- **The last column means "done"** for due-date colouring, since columns can be renamed.
- **Several boards per profile, all made by the users (update, same day).** Decision (user): "one
  videos, one elements etc. — nothing permanent, the user adds as needed". So no board exists until
  someone creates one; a new board starts with Biex isir / Għaddej / Lest, which are ordinary,
  editable columns. Boards live in `task_boards`; all boards of a profile load in one request, so
  switching tabs is instant and polling stays one call. A card can move to another board from its
  dialog. The migration was changed in place, since it had not been deployed.

## 2026-11-03 — Codebase streamlining

At the user's request, repeated helpers were merged and dead code removed without changing behaviour:
one Graph API base (`GRAPH` in `_lib/delivery.js`), one reader of `COMMITTEE_PROFILES`, one Google
client module, one folder-listing helper in Rust (`files_with_ext`), one transcription sidecar
command, one pack-info builder, and shared frontend helpers (dates, "ago", content-type names, the
`-riżultat` folder, file base names, the image quality/size controls). The legacy string-HTML
renderers in `src/ui.js` and other unused exports were deleted. Build output that was tracked by
mistake (`__pycache__`, `src-tauri/gen/schemas/`) is now ignored, the unused iOS/Android icon sets
were removed, and the four identical Montserrat licences became one file.
Small one-line helpers that are private to a module (e.g. `clamp`) were left where they are: sharing
them would add imports without removing real duplication.

## 2026-11-03 — Media checked and photos fixed before scheduling

Decision (user): catch what Meta would refuse in the composer instead of after publishing.
Files are measured in the browser (`createImageBitmap`, a `<video>` element), so no upload or
native call is needed. Photo fixes run on a canvas and always produce a JPEG within the strictest
chosen platform's limits; padding uses a blurred copy of the photo rather than black bars. Videos
get errors/warnings only: re-encoding would need a new native ffmpeg command, deferred until it
can be tested on the Mac. The limits live in one file (`media-check.js`) because Meta changes
them; they were taken from Meta's publishing docs and two scheduling vendors' guides on 2026-11-03.
Errors block scheduling; shape preferences (9:16 Stories/Reels, carousel shapes) only warn.

## 2026-11-03 — Moving the vanilla modules to Svelte, in stages

Decision (user): move the post maker and the subtitle editor from hand-built DOM modules to Svelte
gradually, without visible change. Stage 1 (done): the post maker's make screen and template editor
are Svelte components (`views/posts/`); the old `postmaker/index.js` is gone. The model, the one
`drawPost()` renderer and `workflows.js` are unchanged; the new screen keeps the classes and ids the
projects/batch panel relies on, and was checked pixel-for-pixel against the old one in `?mock`.
Stage 2 (done): the projects/batch panel is `views/posts/WorkPanel.svelte`, with its pure parts
in `postmaker/production.js`; `workflows.js` is gone. The panel no longer reaches into the screen's
DOM: it calls a small `maker` interface, and a `busy` flag locks the screen during a batch. This
also fixed an old bug where, after reviewing a batch, Zoom/Reset/Export stayed disabled until the
next change. Next: stage 3, the subtitle editor.

## 2026-11-03 — Smoother subtitle playback

Reported (user): playback in Traskrittura glitched sometimes. Measured in the preview: animated looks
(karaoke, pop, slide) rebuilt the whole caption overlay every frame, and the picture box was re-measured
every frame. Now only changed inline styles are updated between frames (karaoke: full rebuilds went from
~58/s to only when the caption changes), with identical markup and pixels at sampled frames. Two real
bugs were fixed: the 0.65 s preview after nudging a word (`[`/`]`) could pause playback the user had
started (pressing Space during it, or nudging while playing), and scrubbing the timeline while playing
seeked on every pointer move. Scrubbing now pauses, seeks at most once per frame and resumes on release.
Not addressed: anything in the video decoding itself (WebKit / the asset protocol) — if stutter remains
with a plain look, check the source file (very high bitrate or HEVC 10-bit) first.

## 2026-11-06 — Xogħol kept on the Mac for now

Decision (user): keep Xogħol fully local for now, after it failed because the backend and migration had
not been deployed. Boards live in the app's localStorage (`banditur_xoghol`), handled by
`views/xoghol/local-store.js`, which answers the same requests as `backend/api/tasks.js` and validates
with the same `task-rules.js`. Nothing needs deploying; boards are per computer and not shared. The
backend endpoint, migration and tests are kept for when sharing is wanted. Home now shows Xogħol with
its open-card count (the earlier "nothing on Home" choice was about overdue reminders).
Trade-off: localStorage belongs to this app install; deleting the app's data loses the boards.

## 2026-11-06 — Xogħol Gantt view

Decision (user): add a Gantt chart to Xogħol as another view of the same cards (not a separate
tool), with bars dragged to move/resize, a weeks-to-months scale, and PNG and PDF export. Cards gained
an optional `start_date` (≤ `due_date`, checked in `task-rules.js`, the local store, the backend and the
migration); a due-only card is a one-day bar. Export is drawn on a canvas rather than screenshotting the
DOM (no extra dependency, always light and print-friendly) and the PDF is a hand-written one-page file
embedding that picture as a JPEG — enough for sharing/printing; text in it is not selectable.
`save_post_image` now also accepts `.pdf` with PDF bytes. No dependencies (task links), critical path
or day/hour scale — not asked for.
Later the same day (user): a third, wider zoom, *Sena* (3 px/day, a year or more), and every zoom
now stretches its range to fill the window.

## 2026-11-07 — Local modular builds (`npm run build:local`)

Decision (user): the app is only ever built locally, so there is no update server. Instead of shipping
one 1.4 GB app, it is built in four fingerprinted pieces (interface, app core, engine, model) and only
the changed ones are rebuilt and installed. The engine (555 MB) and model (837 MB) left the app bundle
and live in `<app data>/components/{engine,model}/<n>/` with `installed.json` written last; the app
finds them there (falling back to the bundle and the checkout for dev). `build:local` replaces the
signing/DMG/publish flow for day-to-day work (no updater artifacts, no key). The engine's launcher
script takes `BANDITUR_ENGINE_DIR`, so the existing sidecar mechanism and permissions are unchanged.
Interface loader (phase 3, 2026-11-07): the app wraps Tauri's own asset store (`Context::set_assets`) and
serves `<components>/ui/<n>/` when one is usable, so the origin stays `tauri://localhost` (no custom scheme:
localStorage, IPC permissions, asset protocol and CSP are unchanged). Each installed interface has a
`ui.json` with `needsCoreApi`; a version that never calls `interface_ready` is marked bad in `ui-state.json`
and the next launch uses the older one, then the embedded one. Written without a real window to test in:
unit-tested (choice, fallback, path safety) but the first real `build:local` plus a screen change must be checked. Kept but dormant: `publish-update.mjs`, `/api/updates`, the
Settings update check (its release build has no engine/model). Trade-offs: the first `build:local`
on a Mac is as slow as before; transcription needs the components folder to exist.


## 2026-11-11 — Xogħol: budgets, step timelines, adding from the Gantt, A4 PDF

Decision (user): cards get a Budget and a Spent amount (euros, stored as whole cents), shown on the card, in the
board header, and in the Gantt (per row and per column). Checklist steps get optional dates, Budget and Spent;
dated steps appear as a thin "timeline within the timeline" under their card in the Gantt. Step amounts are
treated as parts of the card's own amount and are not added to totals (adding both would count money twice);
the dialog shows the steps' sum against the card's budget instead. Cards and steps can be created from the Gantt
(*+ Kompitu* per column, **+** per card). New UI words for technical terms are in English (Budget, Spent, Left,
Over, Steps); the rest stays Maltese. The exported PDF is always one A4 page (landscape or portrait by the chart's
shape, scaled to fit), replacing the earlier "page the size of the chart". Not done: multi-page PDFs for very tall
charts, a currency setting (euros only), budgets on the shared backend (no SQL columns yet).

## 2026-11-11 — YouTube download: the app manages its own yt-dlp, ffmpeg and Deno

Problem (user): downloads stopped working again. The old approach relied on Homebrew's yt-dlp, ffmpeg and
Deno, and a stale `brew` copy is the usual reason YouTube downloads break. The error hint also put
"unable to download video data: HTTP Error 403" under "check the internet" (the network check ran first).
Decision: the app downloads the standalone `yt-dlp_macos` (nightly channel — the one yt-dlp recommends
when YouTube changes) to `<app data>/tools/yt-dlp` with the system curl, runs `yt-dlp -U` once a day, and
on an "outdated" failure updates at once and retries once. ffmpeg is **kept** (no real alternative for
MP3 and for merging YouTube's separate video/audio streams; avoiding it would mean M4A-only audio or
360p single-file video) but now comes from the engine's imageio-ffmpeg instead of Homebrew — checked that
yt-dlp accepts the `ffmpeg-macos-…` file name and works without ffprobe. Deno: a Homebrew one if present,
else downloaded once into `tools/`. Homebrew yt-dlp/ffmpeg/Node remain fallbacks. The UI shows a
"preparing" line while tools download. Unit-tested (error hints, ffmpeg lookup, update timing); not run
against live YouTube from the build machine — check one MP4 and one MP3 on the Mac.
Trade-offs: first download needs ~80 MB of tools; nightly yt-dlp can very occasionally regress (the
daily update usually fixes it); downloading executables at runtime means the app trusts GitHub releases
of yt-dlp and Deno over HTTPS.

## 2026-11-12 — Stability pass: saved data, request limits, new submissions

Context: an audit for stability and tidiness. Checked with `npm test` and a Svelte compile of every
view; the Rust core and a full `npm run build` were **not** run (the audit machine had no Rust
toolchain and no macOS Rollup binary) — run `npm run build` and the Rust tests on the Mac.

Decisions:
- **Saved lists are read defensively.** `ls.list()` / `ls.object()` replace `ls.json(...).map(...)`
  where a module runs at start-up (Studio jobs, photo tasks, downloads, drafts, caption templates,
  recent jobs, local config). One damaged localStorage value used to be able to stop the whole
  interface from loading. The remembered YouTube list is capped at 50.
- **Backend calls end.** `api()` aborts after 90 s (`timeout` option) and reports an unreadable
  (non-JSON) answer in Maltese. A timed-out request has no `status`, so the composer treats it as
  "may have arrived" and keeps the pending submission, as it already did for a dropped connection.
- **A re-used post or an opened draft is a new submission.** They used to keep the earlier
  `request_id` (and "Erġa' uża dan il-post" also the earlier pending body), so scheduling again was
  answered by the backend's idempotency check with the first post and nothing new was created. Only a
  draft holding an interrupted submission keeps its identity.
- **`auth.js` and `cors.js` live in `backend/api/_lib/`.** In `api/` they counted as two more
  functions: 13 with `tasks.js`, over the Hobby limit of 12.
Trade-off: 90 s is longer than any function here should run; it is a floor against hanging, not a
performance target.

## 2026-11-12 — Documents tracked; AGENTS.md short, README holds the detail

The four maintained documents (see 2026-10-29) stay four, but their division changed and
all of them are now tracked in Git. `.gitignore` used to exclude every Markdown file except
README.md, so AGENTS.md, DECISIONS.md and RELEASE.md had no history and no backup; they were
checked for keys, tokens and real profile IDs first (none).

AGENTS.md had grown to 78 KB, repeated much of README.md and was read in full by every agent
session. It is now about 10 KB: commands, the architecture diagram, where each kind of code lives,
conventions, gotchas. The walkthroughs it used to hold (module maps, native commands, cloud API,
data flows, build internals, dependency tables, production-workflow internals) moved to
README.md → Technical reference; README's older, thinner "Architecture Overview" was dropped in
their favour. Rule kept: a fact lives in one place and the other documents link to it.
Statements dropped rather than moved were wrong: the model and engine are no longer bundled
into the app, and 20261103 (Xogħol tables) is optional, not required.
Trade-off: README.md is now about 100 KB. Humans use the feature sections and the table of
headings; the Technical reference is for whoever changes the code.
