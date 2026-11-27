# Decisions

A short log of the non-obvious product and architecture decisions behind Banditur —
the *why* that the README, AGENTS.md, and RELEASE.md don't capture. Add an entry
when a choice would otherwise be re-litigated later.

Reviewed against the source on **2026-11-26**. Dated entries are in date order and preserve history; a superseded
choice says so in its heading *(superseded …)*, so the current decision is the latest entry on a subject. Current implementation details belong in AGENTS.md and README.md.

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
The cron uses `CRON_SECRET` instead. (The update manifest was public too; it is gone, see "Signed updater removed".)
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
**Superseded 2026-11-12:** Google Calendar was removed; see "Own local calendar" below. The post-layer rule (posts are never stored as events) still holds.
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
- **Shared clock and validation**: Pure rules are imported by composer/API. Malta wall times are explicit and invalid/ambiguous DST times rejected. The calendar stores Malta wall-clock strings, so it needs no timezone library.
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
unit-tested (choice, fallback, path safety) but the first real `build:local` plus a screen change must be checked. Kept but dormant at the time: `publish-update.mjs`, `/api/updates`, the
Settings update check (its release build has no engine/model) — **superseded 2026-11-24**: all three were removed, see "Signed updater removed". Trade-offs: the first `build:local`
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

## 2026-11-12 — Streamlining: one rule for replacing the composer, screens on demand

- **Replacing the composer.** Seven places used to keep the current post as a draft before loading
  another, with different rules about asking and about a failed save. There is now one function
  (`replaceWith` / `keepCurrent` in `composer.svelte.js`). Rule: ask whenever the action did not start
  in Skeda (calendar, archive, Home, Studio hand-offs); always keep the old post as a draft; if that
  draft cannot be saved, say so and change nothing. The per-row drafts of a Posts batch are not
  replacements and still save directly.
- **Photo lane saves.** The lane used to rewrite two saved lists, with every finished path, on every
  photo. It now saves at most once a second while running, on every state change and on `pagehide`.
- **Screens on demand.** Only Home is in the main bundle; the other eleven screens are separate
  chunks, fetched when first opened and ahead of time when idle. Mounted screens still stay mounted.

### Own local calendar replaces Google Calendar
**Decision (2026-11-12):** Kalendarju is built in-house (`src/views/kalendarju/`) and keeps events per profile in `localStorage` (`banditur_calendar`). FullCalendar, Luxon, `api/calendar.js` and the Google Calendar client are gone, freeing a Vercel function slot (10 of 12). Events stay local for now; a server is a later step (notes in `calendar.md`).
**Why:** the committee is moving away from Google Calendar and wants to own its calendar.
**Trade-offs:** event times are Malta wall-clock strings (`YYYY-MM-DDTHH:mm`, all-day end exclusive), so layout needs no DST maths, but they are not instants. Recurrence is series-only (no single-occurrence edits or exceptions). Old Google events were not imported. Events exist on one Mac only and are not shared between committee members.

## 2026-11-22 — Decluttered screens, same look; English for technical terms

Decision (user): "declutter the UX, keep the UI", then "use English when needed for terms such as
portrait/landscape". The look (tokens, components, layouts) is unchanged; screens show less by default.
Nothing was removed as a feature: each item moved behind a menu, a disclosure or the toolbar.
- **Home** keeps only what needs you: the greeting, one *Issa* list (failed/overdue posts, stuck or running
  Studio jobs, unfinished projects), shown only when it has something in it; the event's work only when an
  event is open (from Kalendarju), with *Agħlaq*; and *Jmiss*, always shown: queued posts and calendar events
  for the next 14 days, each opening the archive or the calendar on that day. The ten Social/Studio tiles are
  gone (the toolbar and the number keys already do that), and with them Home's Xogħol open-card count.
- **No history** (user, same day): Home's *Xogħol riċenti* list and its store (`banditur_jobs`, `logJob`) are
  removed, and the old key is deleted at start-up. YouTube lists only downloads still running, queued or failed
  (each can be retried or removed); the last finished one stays with its actions until closed, and only
  unfinished ones are remembered across launches.
- **Skeda**: Kategorija, Avveniment and media retention sit under *Aktar għażliet* with a one-line summary
  when something isn't the default. *Save draft*, the drafts list and *Ibda mill-ġdid* are one *Drafts* menu.
  Platforms that cannot be used yet (TikTok, Website / App) are not shown at all.
- **Traskrittura**: the eight top-bar buttons became two menus, *Proġett* and *Għodda*.
- **Rapporti**: category, event and custom comparison are behind *Filtri*; the coverage line stays visible.
- **Settings**: *Profiles* (the toolbar switches profiles) and *Traskrittura* (its one button is in
  Traskrittura's recent list) were removed; *Updates* is now *Components*, without the update check (the signed
  updater is dormant and its build has no engine or model; since removed, 2026-11-24).
- One shared `components/MenuButton.svelte`, styled like the toolbar menus.
- **Terms**: portrait, landscape, square, crop, padding, resolution, width/height, compression, alignment,
  line height, file/media (not *medjum*), model and engine (not *mudell*, *magna*), audio, Import/Export on
  buttons. Ordinary words (size, colour, box, column) stay Maltese. Applies to the Rust and sidecar messages
  and the backend's two media errors too, so the backend needs a deploy for those to change.

## 2026-11-22 — Top bar: every screen one click away

Decision (user: "make the top bar more usable"). The bar used two menus (*Social · …* and *Studio · …*), so
every switch took two clicks and the screens weren't visible. Now each screen is its own tab in the same
segmented control: Home, then Skeda, Kalendarju, L-Arkivju, Rapporti, Xogħol, then the five Studio tools
(Marka & Ssortja and RAW → JPG shortened to *Marka* and *RAW*). To fit, every tab uses the same style, picked by measuring
the bar (it depends on the profile name too): icon + label, else label only, else icon only. *(Same day: the first
version used fixed widths and mixed words for Social with icons for Studio; that looked inconsistent and could
overlap a long profile name.)* Every tab keeps a tooltip with its name and shortcut (Studio tools also their
description) and an accessible name. The bar is a three-column grid, so the centre tabs can no longer overlap
the profile or the health indicator. The failed-posts badge sits on L-Arkivju. Shortcuts are unchanged.

## 2026-11-22 — UX round: events in Kalendarju, ⌘K, drops, undo, notifications, honest timing, sharing

Decision (user: "8 kalendarju, do the rest" of a ten-point UX list).
- **Event page in Kalendarju** (`kalendarju/EventPage.svelte`), not on Home: an event's details, poster, posts,
  projects and Studio outputs in the side panel, with *Post ġdid* and *Editja*. Opening a page does not change
  anything global; *Aħdem fuq dan l-avveniment* (the old "event workspace") is an explicit switch, and Home shows a
  one-line reminder while one is active. Home, ⌘K and Rapporti open a page through `cal.focus`.
- **⌘K finds everything** (`CommandPalette.svelte`, matching in `lib/palette.js`): screens, actions, Settings
  sections, events, projects, queued posts, and a caption search in L-Arkivju as the last row. Maltese letters
  match their plain forms (*xoghol* finds *Xogħol*). Replaces "⌘K = archive search"; a search button in the top bar
  makes it findable.
- **Drops go where they belong** (`lib/drop-route.js`) on screens without a drop target of their own. A folder is
  recognised by having no extension (the webview cannot ask the disk); a folder named like a file is the price.
- **Undo instead of "Are you sure?"** for local data (events, labels, cards, columns, boards): `lib/undo.js` puts the
  saved value back, but only if nothing else changed it since. Shared data still asks first: it cannot be put back
  for everyone. Deletes on the server (posts) and on disk (packs, templates) keep their confirmations.
- **Notifications** when a long job ends while the app is in the background (`notify()` in `lib/tauri.js`:
  `tauri-plugin-notification` and its npm package pinned to **2.3.3** — newer ones need Tauri / `@tauri-apps/api`
  2.11+, which would have upgraded the whole Tauri stack and fails `tauri build`'s version check against 2.10 — plus one dock bounce). Nothing when Banditur is in front.
- **Honest publish time** (`skeda/publish-window.js`): only ordinary Facebook posts at least 25 minutes ahead are
  shown on the minute (handed to Facebook's scheduler at a worker run >10 min before; runs are 15 min apart);
  everything else shows "20:00–20:15", or per platform when mixed.
- **First-run checklist** on Home (*Ibda hawn*): backend, profile, watermark pack, engine and model; ticks itself off;
  *Aħbi* hides it for good.
- **Rapporti's event filter** is a list of the calendar's events instead of a free-text id.
- **Transcription worker** (update.md step 8): the sidecar's serve mode keeps the model loaded and takes one request
  per line; every event carries the request id; Rust forwards only the request in flight, restarts a dead worker
  once, stops it after ten idle minutes, and `cancel_transcribe` kills it. `CORE_API` → 2. The other fixes listed
  under step 8 (shared line reader for render, render temp folder, unique YouTube job id, two-strike interface
  check) were not part of this.
- **Sharing Xogħol and Kalendarju** (Settings → Sharing, off by default, per kind). The existing `api/tasks.js` gained
  an import; a new `api/events.js` (function 11 of 12) mirrors the local calendar store, with validation shared
  through `backend/api/_lib/event-rules.js`. Turning sharing on checks the server first (a missing migration is
  named), then offers to copy the Mac's data up **keeping ids**, because posts and projects point at event ids.
  The local copy is never changed by sharing, so switching back shows it as it was. Changes show at once and are
  saved in the background; a failed save reloads the server's list. Polling: Xogħol 30 s, Kalendarju 60 s, only
  while the screen is open. Supersedes "Xogħol kept on the Mac for now" (2026-11-06) and the local-only part of
  "Own local calendar" (2026-11-12) — both remain the default.

## 2026-11-22 — Fewer tabs: Ritratti, and Skeda with its archive and reports

Decision (user, from a list of groupings: "1, 2 and 4, not 3"). The top bar goes from eleven tabs to eight:
Home · Skeda · Kalendarju · Xogħol | Traskrittura · Posts · Ritratti · YouTube.
- **Ritratti = Marka & Ssortja + RAW → JPG.** RAW → JPG was nearly always the step before the watermark (it had a
  "send to Marka" button), and both used the same photo lane and options. One screen now looks at the folder and
  `ritratti/plan.js` decides the steps; RAW with a watermark or duplicate skipping is converted to `<folder>-jpg` first
  (full size, quality 95, **kept**, so the plain JPGs are not lost) and the watermark step runs from there. A folder
  with both RAW and JPG asks which to use instead of guessing. No native change: the two Rust commands are unchanged,
  and photo-lane tasks gained `next` steps. Saved "last tool" values `marka` / `raw` open Ritratti.
- **Skeda holds L-Arkivju and Rapporti** as tabs (*Post ġdid · L-Arkivju · Rapporti*) under one top-bar tab; they look
  at the same posts. The three screens stay separate components with their own view ids, so every link and
  `go('arkivju')` still works; the top-bar tab and key `1` return to the part used last. Their page titles went (the
  tabs say it). Number keys are now `1` Skeda, `2` Kalendarju, `3` Xogħol; Studio `⌘5`–`⌘8`.
- Not done: YouTube into Traskrittura (user: no).


## 2026-11-23 — Cards → Arkivju
- **Everything goes to a person folder.** `Ritratti/<Fotografu>` and `Footage/<Vidjografu>`, required even for one
  person (user: "always ask for name"). No camera → photographer linking (user: no).
- **Drive decides what is a duplicate**, because several Macs upload. Fingerprint = name + size + capture time, stored in
  `appProperties` (hashed to fit 124 bytes) and checked in batches before upload; hand-added files match on name + size
  in the target folder; a post-upload check bins the newer copy if two Macs raced; same-name different file is renamed
  ` (2)`. The fingerprint uses the camera's own time even after a clock fix, so a fix cannot create duplicates.
- **Bytes never pass through Vercel.** The backend opens the resumable session (needs the `drive` write scope and
  Content manager on the Shared Drive); Rust uploads in 8 MB chunks with retry, resume (`bytes */size` query) and md5.
  Put into the existing drive function (Hobby limit: 12 functions).
- **Never delete from the card.** "Safe to format" is only said when every file is verified on Drive.
- Added Rust crates: `ureq` 2, `md-5`, `chrono` (clock feature). `Cargo.lock` gains them on the next build.

## 2026-11-23 — Ritratti: folder-wide duplicates and out-of-focus skipping
- **Duplicates compare against every kept photo**, not only the previous one (`nearest_kept`), so a repeat shot far from its twin is caught. Threshold unchanged (5/64 bits, deliberately low). A photo is compared with *kept* photos only, so chains cannot drift.
- **Both checks run on the full-size decode, before the output resize** (their own small copies), so "Max size" does not affect them and skipped photos are never resized or encoded.
- **Blur = best-tiles Laplacian variance**, not whole-frame, so shallow-depth portraits are not rejected. The three limits are untested starting values (only synthetic images were available) — tune `BLUR_LEVELS` after trying real folders; the preview exists for that.
- A reviewed preview freezes both lists (`skipFiles`, `blurryFiles`) like it already did for duplicates. (superseded 2026-11-24: preview removed)

## 2026-11-23 — Ritratti pipeline speed
- **Decide first, decode later.** Duplicate and blur decisions come from a cheap shrunk decode (1/8–1/4 scale), so skipped photos never pay for a full decode, resize or encode. The same `look()` is used by Preview so what you review is what runs. Measured on a synthetic 24 MP JPEG (dev build): decode + resize 1323 → 387 ms with DCT scaling; the look pass 59 ms.
- **No batch barriers.** Worker threads pull photos in source order; results are reported in order, so logs and output names are unchanged. Workers are capped at 8 (memory: each holds one decoded photo).
- **RAW goes straight through `process_images`** (embedded preview from memory), dropping the intermediate `-jpg` folder write/read and the extra decode. Trade-off: the full-size JPGs are no longer kept unless *Żomm ukoll JPGs sħaħ tar-RAW* is ticked (default off). Preview works for RAW this way.
- **Re-runs skip finished work** through `.banditur-ritratti.json` (source size + mtime, settings incl. watermark file stamps, output name + size). Any change re-makes that photo. Decisions (duplicate/blur) are still taken from the look pass first, so results stay consistent.
- Not changed: JPEG encoding already runs with optimize-coding off (fast); watermark scaling is cached.

## 2026-11-24 — Ritratti: auto-brightness
- **Median, not mean, brightness**, so a stage with bright lights on a dark scene still reads as dark. One gamma curve on R, G and B (no per-channel levels, so no colour casts); applied after the resize (cheap) and before the watermark (the logo is not lifted).
- **Smooth and capped**: no effect from median 90 up, full from 60 down, gamma never below 0.5 — two similar photos either side of a cut-off look alike, and fireworks or a night procession are lifted toward readable, not turned into daytime. Target median 112 ("neutral", deliberately below mid-grey).
- It is off by default, remembered, and part of the *already made* key (turning it on re-makes photos). Limits are starting values like the blur ones; tune `BRIGHT_*` in `image_processor.rs` after trying real folders.

## 2026-11-24 — Ritratti preview removed
- **The preview/review modal (`inspect_photos`, the keep/skip/blurry lists) is gone.** It cost a separate full pass over the folder and was rarely worth it; duplicates and out-of-focus photos are decided live during the run, and the run's log names every skipped photo and why. Supersedes the "reviewed preview freezes both lists" line of the 2026-11-23 duplicate/blur entry, and the "Preview works for RAW" remark in the pipeline-speed entry.
- `CORE_API` is 3 (`process_images` lost `keep_files`/`skip_files`/`blurry_files`, `inspect_photos` was removed). A retry still strips those keys from old persisted tasks.

## 2026-11-24 — Arkivju uploads 3 at a time, sessions/finish batched
- **Three files at once** (`PARALLEL` in `archive-job.js`): one file at a time left a fast connection idle during the round trips (session, finish) of each file. The speed limit is divided by three so the total stays at the user's number.
- **`sessions` / `finishMany`** do those round trips for a group in one request (cap 25; sequential on the server so folder creation cannot race; one bad item becomes `{ error }`, not a failed batch). Same router, no new Vercel function. A 404 (older backend) falls back to per-file calls.
- **Cancel is a generation counter** (`CANCEL_GEN`), because with several transfers a "reset on start" flag would let a transfer that starts after a pause clear the cancel of the others.
- The local backup copy is its own lane instead of running before each upload. Job saves while running are debounced (~2 s); state changes and new sessions still save at once.
- A file that fails verification (`!ok`) is now marked failed with its message instead of stopping the job as "offline".

## 2026-11-24 — Efficiency pass (bundle, passages, uploads, polling, export)
- **Engine bundle** also excludes `transformers`, `tokenizers`, `torchaudio`, `nltk`, `ctc_forced_aligner`, `pyannote` (all imported lazily; alignment and diarization already degrade without them). The build script fails if any is present.
- **A passage is cut by ffmpeg** (`-ss` before `-i`, `-t` after) instead of decoding the whole video and slicing the WAV.
- **Home counts in one request** (`GET /api/history?status=summary`), and background timers (`lib/visible.js`) rest while the window is hidden. Arkivju card polling (native, cheap) and the calendar clock are left alone.
- **Photo export in RGB**, watermark blended only over the rows where it has visible pixels (same formula and look as before). RAF previews are read from the header's JPEG offset; CR3 stays on the whole-file scan.
- **Desktop no longer bundles `@supabase/supabase-js`**: the signed-URL upload is one `fetch`. The package stays a root *dev* dependency because backend tests import the handlers that use it.

## 2026-11-24 — Signed updater removed; the shared Mac builds from GitHub
- **Decision (user):** the dormant signed Tauri updater is gone (`tauri-plugin-updater`, `@tauri-apps/plugin-updater`, `capabilities/desktop.json`, `createUpdaterArtifacts`, `release:app`, `publish:update`, `scripts/publish-update.mjs`, `scripts/build-updater-release.sh`, `/api/updates`, and `latest_desktop_version` / `updates_configured` in `/api/meta`). The signing key is no longer needed and the `UPDATE_*` Vercel variables can be deleted. The older entries about the updater are marked superseded above.
- **Why:** the engine, model and interface live outside the app (2026-11-07), so the Tauri updater only ever covered the app core, and its build had no engine or model. One shared Mac already has the toolchain; letting it pull the repository and run `build:local` is simpler than signing, hosting and publishing releases, and it updates all four pieces the same way.
- **How:** Settings → Aġġornamenti (`source_update.rs`, `scripts/update.mjs`, `lib/updates.svelte.js`). Interface/engine/model-only updates build in the background and reload the interface; a core change quits the app, a detached helper builds, installs and reopens it. Fast-forward only, never destructive: tracked local changes or a diverged branch refuse the update. A failed build leaves the old app, which is reopened with the error shown. `CORE_API` is 4.
- **Trade-offs:** it needs the toolchain, a clone and a GitHub credential on that Mac (README → "Updates on the shared Mac"), and a core update takes up to 15 minutes with the app closed. Other Macs have no update path: they are built by hand with `build:local`.

## 2026-11-24 — Updates follow the clone's upstream branch, not a setting *(`stable` recommendation superseded 2026-11-26: the shared Mac follows `main`)*
- The clone follows `@{u}` of its checked-out branch (`git rev-list HEAD..@{u}`, `git pull --ff-only`). There is no "update channel" setting: to follow `stable` instead of `main`, check out the other branch in the clone (or clone with `-b`).
- **Why:** a setting would be a second place that can disagree with what the clone has checked out, and a pull of a branch other than the checked-out one cannot be fast-forward-only without switching branches (which could discard work). The recommended `-b stable` gives the committee a deliberate "ready to ship" step by pushing to `stable`.
- The clone is found through `<components>/source.json`, written by every real `build:local`, so nothing is configured by hand; with no `source.json` the app says updates are not set up.

## 2026-11-24 — The in-app update cleans build output, but keeps Rust's release cache
- **Decision (user):** after a successful in-app update, `scripts/update.mjs` removes `build/`, `sidecar-dist/`, `src-tauri/target/debug/` and `src-tauri/target/release/bundle/` (`CLEAN_PATHS`). Nothing is removed after a failed build, and a removal error does not fail the update.
- **Kept on purpose:** `src-tauri/target/release/` (~2 GB of compiled dependencies; without it every app-core update is a full compile of tens of minutes) and `dist/` (a core rebuild embeds it as the fallback interface).
- **Needed for it:** `makePlan` no longer rebuilds an engine or app whose fingerprint is unchanged and which is installed, just because `sidecar-dist/` or the built `.app` is missing. Without that, cleaning `sidecar-dist/` would rebuild the engine (10+ min) on every update.

## 2026-11-26 — The update stashes local edits and always runs npm install
- **Decision (user):** the update flow is the one used by hand on the shared Mac: `git stash` → `git pull` → `git stash pop` → `npm install` → `npm run build:local`. Supersedes "tracked local changes refuse the update" above and "npm install only when `package-lock.json` changed".
- **How:** `source_update.rs` stashes only when `git status --porcelain --untracked-files=no` is not empty, and only tracked files (no `-u`), so ignored folders — the model, `venv/`, `node_modules/`, the config — are never moved (they were never at risk from `git pull` either). The pull stays `--ff-only`; a diverged branch is still refused. If the pull fails the stash is popped straight back. If the pop clashes, git keeps the stash; the files are reset to the pulled code so it can build, and Settings says the edits are in `git stash`. `pip install` still runs only when `sidecar/requirements.txt` changed.
- **Trade-off:** `npm install` on every update adds some seconds even when nothing changed; a clashing local edit is set aside rather than blocking the update, so it has to be re-applied by hand from the stash.

## 2026-11-26 — The shared Mac follows `main`; releases are tagged
- **Decision (user):** no `stable` branch. The shared Mac's clone is on `main`, so every push to `main` is offered as an update. Each release bumps the version (MINOR for features, PATCH for fixes), is tagged `vX.Y.Z` and published as a GitHub release (RELEASE.md → Version numbers). A tag already on GitHub is never moved; the next number is released instead.
- **Trade-off:** there is no separate "ready to ship" step: push to `main` only what should reach the committee's Mac.

## 2026-11-26 — Murtali: fireworks cut from the sound, one Video tab
- **Detection started from the sound only** (superseded the same day by the light check below). One ffmpeg audio decode is seconds even for an hour of 4K, needs no video decoding and no new dependency (numpy + ffmpeg). Bangs and crackle are impulsive (spectral flux) and bass-heavy; band music, bells and crowd are loud but sustained. **Trade-off:** a quiet ground show (fountains, no crackle) can be missed and loud band music beside the camera can be picked up; the fix is manual (add / delete items on the timeline), not more heuristics.
- **Python measures, JavaScript decides.** The sidecar returns three 0.1 s curves; thresholds, merging, padding and the sensitivity slider run in `segments.js`, so a setting re-segments instantly and the curves are cached in the project (no re-analysis unless size + mtime changed). Manual items (`auto: false`) are never overwritten.
- **Asymmetric padding, set by "Distanza".** Sound arrives 1–3 s after the burst is seen and the shell's climb is quiet, so items start 1.5 / 3 / 4.5 s before the first bang and end 1 s after the last. The thumbnail uses the same delay.
- **One Video tab with two screens** (Traskrittura | Murtali) like Skeda's three, instead of another toolbar button. `app.tool` keeps naming the open screen, so every existing `openTool('traskrittura')` (drops, YouTube *Traskrivi*, handoffs) is untouched; only the toolbar button and ⌘5 know the group (`lib/video-parts.js`).
- **Re-encode, never stream copy** for both exports: cuts land between keyframes, 16:9 / 9:16 need scaling or cropping, and a 0.3 s audio crossfade hides a chopped bang. Always the clip's own sound, loudness-normalised to −14 LUFS so bangs do not clip on phones (**user decision:** no music, no length limit). `aresample` after `loudnorm` fails in ffmpeg 4.4, so the format is pinned with `aformat`. More than 30 items render in chunks (no crossfade at the chunk joints).
- **Reel framing: a centred full-height 9:16 window per item that the user drags** (**user decision**). The video is not analysed, so the app cannot know where the fireworks are; a static window per item has no jitter. *mhux immirat* is a reminder, not a block.
- **Reel length is advisory** (**user decision**): the counter shows `n / 6–7` and never blocks. The amber warnings (count outside 6–7, *mhux immirat* text, Facebook/Instagram length, 50 MB) were removed at the user's request; Skeda still checks the file when it is used there.
- **LUT: one per project, applied before crop/scale** (**user decision:** camera log → normal, whole project, live preview, strength slider). The export uses ffmpeg's `lut3d` (tetrahedral) on the source pixels, then blends at the chosen strength in 16-bit RGB; the preview is a WebGL2 shader with the LUT as an 8-bit 3D texture (trilinear), so the preview can differ very slightly from the export — the export is the reference. The `.cube` is copied to a plain temp name before ffmpeg sees it, because user paths (spaces, Maltese letters, quotes) can't be escaped safely inside a filter graph. New projects start with the last LUT chosen (same camera, same log); the LUT is not part of undo.
- **Picking for the Reel is a key on the timeline** (**user decision**, replaces the items grid): `R` toggles the item under the playhead (else the selected one), `H` hides it from the full video (and takes it out of the Reel). The grid of cards was cumbersome; the timeline already shows every item, its Reel number and dims hidden ones. Thumbnails are now made only for Reel items (the strip).
- **Detection defaults are a first guess** (sensitivity 0.5 → hysteresis on 0.35 / off 0.175, merge gap 2.5 s, minimum 1 s, post-roll 1 s, baseline = 20th percentile over ±60 s). They still have to be tuned on real festa videos (a night aerial show from far, one from close, a long ground show, a daytime petard clip with a band nearby); record the values here when done.

## 2026-11-26 — Murtali: a sound only counts with a light peak
- **Problem (user):** in windy places the sound alone gave many false positives (wind on the microphone is loud and impulsive).
- **Decision (user):** detect from sound **and** light. The sidecar makes a second ffmpeg pass over the picture at 10 frames/s, 32×18 grey (`area` scaling), and measures how much it **brightened** since the previous frame (mean positive change, 0–255 relative to the clip's 99th percentile, with a floor so a clip with almost no flashes does not stretch its own noise). It is one more 0.1 s curve (`light`) next to `rms` / `transient` / `low`.
- **Rule (`segments.js` → `withLight`):** the sound score at a moment is multiplied by `clamp(maxLight / need, 0, 1)`, where `maxLight` is the brightest baseline-corrected light in the window from (distance lead-in + 1 s) before it to 0.5 s after it, and `need` falls from 0.45 to 0.12 as sensitivity rises. The window follows *Distanza* because the light comes first and the sound arrives 1.5–4.5 s later. Hysteresis, merging and padding are unchanged and run on the gated score.
- **Why brightening, not brightness:** a lit stage, a moon or a town's glow is bright all the time; a burst is a sudden rise. Falls are ignored, so a flash is one event, not two.
- **Trade-offs:** the video is now decoded once (small scale, so quick, but not the seconds the audio alone took); a very distant burst may brighten the 32×18 picture too little (raise sensitivity or untick *Dawl*); daytime shows have no light peak, so the tick turns the check off (saved per project). Unreadable video, or a project saved before this change (no `curves.light`), falls back to sound only; opening an old project re-analyses it once, keeping manual items.
- **Not tuned on real footage yet:** `LIGHT_FLOOR` 0.6, the thresholds 0.45 / 0.12 and the 1 s slack are first guesses (see the defaults entry above).

## 2026-11-27 — Folder → Drive upload; Drive refusals fail the file, not the job
- **Decision (user):** besides the card prompt, Home has *Tella’ folder…*: any folder's files (every type, subfolders kept) go into a Drive folder chosen by browsing the archive Shared Drive, optionally inside a new folder. It reuses the card upload jobs (parallel, resumable, verified, duplicates skipped by fingerprint) and needs no backend change: `ls`, `sessions` and `finishMany` already take any path of 1–6 folders below the archive root.
- **Kept simple on purpose:** no review or event grouping (that is what the card flow is for), no local backup copy, no "safe to format". Files deeper than 6 folders below the archive root are left out and the job says so, rather than flattening them silently.
- **Only inside the archive Shared Drive:** the backend's service account writes there and nowhere else; letting the app pick any Drive location would need user OAuth.
- **Drive refusals:** previously any archive_put error without an HTTP status (including "Drive wieġeb 403." and "Drive ma kkonfermax…") counted as "no connection", so the job paused and retried every minute for ever. Now those get a status (`putError()`), the file is marked failed and the rest go on; *Kompli* retries the failed ones. Transport errors still pause the job as offline.
