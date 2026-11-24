# Banditur — streamlining plan

Written 2026-11-12 after the stability audit (see DECISIONS.md, same date). Nine pieces of
work, in the order they should be done. Each is its own commit (or small series) and leaves the
app working. Delete this file when the last one is in; the decisions belong in DECISIONS.md.

## Status (2026-11-12, evening)

Done and committed (no `npm run build`, no Rust and no `?mock` click-through could run in that session: Linux shell, macOS `node_modules`; Svelte files were compiled, `npm test` passes 196):
- **0** — committed in five groups; `_to_delete_xfer/`, `_to_delete_xfer3/`, `.xfer2/` deleted.
- **1** — tests by glob, `test:py`, `check`, `.github/workflows/test.yml`; docs updated.
- **3** — all four documents tracked; AGENTS.md ~10 KB; detail moved to README → Technical reference; DECISIONS entry. (The shortcut list for step 9's check is now README → Technical reference → Subtitle editing & export.)
- **4** — `keepCurrent()` / `replaceWith()` in `composer.svelte.js`, six call sites. Needs the `?mock` check below.
- **5.1** — photo lane saves at most once a second.
- **6** — screens as chunks (`SCREENS` table in `App.svelte`). Needs `npm run build`, one `build:local` and a launch.
- **7** — `tauri.debug-app.json`, `?type=calendar` (confirm no old desktop build uses it before deploying the backend) and `yt-dlp` in requirements removed.

Done 2026-11-22: **8** (serve mode, worker, cancel, idle stop; not the four smaller fixes listed in it).

Not done: **2** (needs `npm install` of prettier/svelte-check on the Mac, and a formatting-only commit), **5.2–5.5** (job store: fixtures need real localStorage values from the Mac; photo run), the conditional rows of **7** (WordPress needs the SQL count, bundled engine needs the app-age check, stdin path goes with 8, the `banditur_subs:` sweep), the four smaller fixes in **8**, **9**.

**Checks after every step:** `npm test`, `npm run build`,
`cargo test --manifest-path src-tauri/Cargo.toml --lib`, `python3 sidecar/test_maltese.py`,
`python3 sidecar/test_passage.py`, then a click-through of the touched screens at
`http://127.0.0.1:5173/?mock`. Steps marked **Mac** also need a real run in the built app.

**Sizes:** S = an hour or two, M = a day, L = several days.

| # | Work | Size | Risk | Needs the Mac |
|---|------|------|------|---------------|
| 0 | Commit the current state | S | none | no |
| 1 | Tests by glob + CI | S | low | no |
| 2 | Formatter and checker | S | low (large diff) | no |
| 3 | Track the documents, shorten AGENTS.md | M | low | no |
| 4 | One "replace the current post" function | S | low | no |
| 5 | One job store | M | medium | photo run |
| 6 | Screens loaded on demand | S | low | build:local once |
| 7 | Prune legacy paths | M | medium | yes |
| 8 | Persistent transcription sidecar + shared Rust helper | L | high | yes |
| 9 | Subtitle editor to Svelte | L | high | yes |

---

## 0. Commit the current state

There are about 67 changed or new files uncommitted (Xogħol Gantt, build:local, the interface
loader, the 2026-11-12 audit fixes). Everything below produces large diffs; they must not be
mixed with this.

1. Run the checks above on the Mac (the audit could not run `npm run build` or the Rust tests).
2. Commit in logical groups: Xogħol/Gantt, local builds + interface loader, YouTube tools,
   audit fixes, backend `_lib` move.
3. Delete `_to_delete_xfer/`, `_to_delete_xfer3/`, `.xfer2/` (now ignored, but still on disk).

## 1. Tests by glob + CI

**Why:** `npm test` is one hand-kept list of 12 files plus three scripts; a new test file is
silently not run. Nothing runs the tests on push.

1. `package.json` → `"test": "node --test \"src/**/*.test.mjs\" \"backend/tests/*.test.mjs\" \"scripts/**/*.test.mjs\""`
   (Node 22 expands the globs itself).
2. Convert the three script-style suites to `node:test` so each case is reported:
   `src/subtitles/subtitles.test.mjs`, `src/postmaker/model.test.mjs`, `src/wm-bulk.test.mjs`.
   Keep the assertions; wrap each block in `test('…', () => { … })`. The Maltese cases stay
   driven by `maltese-cases.json`.
3. Add `"test:py"` (the two sidecar tests) and `"check"` (= test + test:py + build).
4. `.github/workflows/test.yml`: on push and pull request; Ubuntu, Node 22, `npm ci`,
   `npm test`, `npm run build`, Python tests. Add the Rust tests as a separate macOS job run
   by hand (`workflow_dispatch`) — it needs cmake and a copy of
   `banditur-config.example.json` as `banditur-config.json`, and macOS minutes are costly on
   a private repository.
5. Update the test section of AGENTS.md and README.md.

**Done when:** the test count is at least today's 102 + the converted cases, and adding an
empty `x.test.mjs` under `src/` makes `npm test` pick it up.

## 2. Formatter and checker

**Why:** about half of the frontend is dense one-liners (`Traskrittura.svelte`,
`YouTube.svelte`, `Home.svelte`, `Kalendarju.svelte`), the rest is formatted. A checker would
have caught the wrong-shape saved data fixed by hand in the audit.

1. Add `prettier` + `prettier-plugin-svelte`. Settings taken from the files that are already
   formatted (`composer.svelte.js`): single quotes, semicolons, trailing commas, width 110.
   `.prettierignore`: `dist`, `sidecar-dist`, `venv`, `src-tauri/target`, `src-tauri/gen`,
   `*.json` under `src/subtitles`.
2. One commit that only formats (`src`, `backend`, `scripts`). Record its hash in
   `.git-blame-ignore-revs`. Run the full checks before and after: the test results must be
   identical.
3. Add `svelte-check` with a `jsconfig.json` (`checkJs: false` to start). Fix what it reports;
   turn on `checkJs` per folder later, starting with `src/lib`.
4. Scripts: `"format"`, `"lint": "prettier --check . && svelte-check"`; add `lint` to CI.
5. Rust: `cargo fmt` once (`photo_jobs.rs`, the top of `ytmp3.rs` and one line in
   `transcription.rs` are unformatted), same rule — a commit of its own.

**Risk:** only the size of the diff. Do it right after step 0 and before any other branch of work.

## 3. Track the documents, shorten AGENTS.md

**Why:** `.gitignore` excludes every Markdown file except README, so AGENTS.md (78 KB),
DECISIONS.md (39 KB) and RELEASE.md have no history and no backup. AGENTS.md repeats much of
README and is read in full by every agent session.

1. Search the three files for secrets (keys, tokens, the Supabase service key, real profile
   IDs). Remove any before tracking.
2. Remove `*.md` and `!/README.md` from `.gitignore`; commit the three files.
3. Keep the "four maintained documents" decision. Re-divide the content:
   - **AGENTS.md** (target under 15 KB): commands, the architecture diagram, where each kind
     of code lives, conventions, the gotchas list, the "current limits" list.
   - **README.md**: the feature and data-flow walkthroughs (move the ones that exist only in
     AGENTS.md; delete the duplicates).
   - **RELEASE.md**, **DECISIONS.md**: unchanged.
4. Add a DECISIONS.md entry for the new division and for tracking the files.

**Done when:** nothing is described in two places, and every statement removed from AGENTS.md
is either in README or was wrong.

## 4. One "replace the current post" function

**Why:** "if the composer has content, keep it as a draft, then load something else" is written
out in seven places with different failure handling.

| Place | Asks first | Handles a failed draft save |
|-------|-----------|-----------------------------|
| `lib/handoff.svelte.js` `sendPaths` | yes | toast |
| `skeda/composer.svelte.js` `openQueued` | yes | **no** (rejection escapes) |
| `views/Kalendarju.svelte` (~263) | no | toast |
| `views/Posts.svelte` (~20) | check | check |
| `views/Home.svelte` `createEventPost` | no | inline error |
| `views/posts/WorkPanel.svelte` (~261) | no | check |
| `views/posts/WorkPanel.svelte` (~275) | — | saves one draft per batch row: leave as is |

1. In `composer.svelte.js` add:
   - `hasContent()` — caption, media or remote media present.
   - `keepCurrent({ ask })` → `true` to go on, `false` to stay. Asks when `ask` is set, saves
     the draft, and on failure shows the toast itself and returns `false`.
   - `replaceWith(load, { ask = true })` — `keepCurrent`, then `reset()`, `load(post)`,
     `changed()`; returns whether it happened.
2. Rewrite the six call sites on top of these. `openQueued` keeps its `applyState` path but
   starts with `keepCurrent({ ask: true })`.
3. Decide one rule for asking: ask when the user did not start the action from Skeda
   (calendar, archive, Home, Studio hand-offs); never lose content silently.

**Check (?mock):** with a half-written post, try each entry point; cancel and accept; fill
localStorage to force a failed draft save and confirm nothing is lost and one toast appears.

## 5. One job store

**Why:** four saved lists describe overlapping things, each with its own "interrupted after a
restart" rule:

| Key | Owner | Holds |
|-----|-------|-------|
| `banditur_jobs` | ~~`app.svelte.js` `logJob`~~ | **removed 2026-11-22** (Home no longer shows history; the key is deleted at start-up) |
| `banditur_studio_jobs` | `studio-jobs.svelte.js` | activity index |
| `banditur_photo_tasks` | `photojob.svelte.js` | photo lane, with every finished path |
| `banditur_downloads` | `YouTube.svelte` | download lane |

The photo lane rewrites two of them on **every photo** (`persistTasks` on each `photo-file`
event), including the growing path lists.

1. **First, the cheap win:** in `photojob.svelte.js` save at most once a second while a job
   runs and once when it ends. No format change. Ship this alone.
2. New `lib/jobs-model.js` (pure, tested): record shape
   `{ id, lane, kind, name, state, at, eventId, path, error, progress, args, completed, failed }`;
   `upsert`, `cap`, `interruptRunning` (on load), `nextQueued(lane)`, and `migrate(old)` that
   reads the four old keys into the new list.
3. New `lib/jobs.svelte.js`: the reactive list (`banditur_jobs_v2`), throttled saving with a
   flush on `pagehide`, and `createLane(name, run)` — the serial pump that `photojob` and
   `YouTube.svelte` each implement today.
4. Move the owners one at a time, each a commit: photo lane → downloads → transcription and
   export entries → Home and `JobPanel` read from the store → delete `logJob`, `jobs`,
   `studioJobs`.
5. Migration runs once; keep the old keys for one release, then remove them.

**Tests:** model tests for migration from real saved samples (copy the four values from the
Mac's localStorage into fixtures), interrupted-on-restart, retry not replaying finished files.
**Mac:** a photo run of 500+ files: cancel, retry, quit mid-run and reopen.

## 6. Screens loaded on demand

**Why:** `App.svelte` imports all twelve screens at start, including FullCalendar and the
subtitle editor, and repeats one near-identical line per screen.

1. A table in `App.svelte`: `{ key, load: () => import('./views/Skeda.svelte') }` for each
   screen. `Home` stays a normal import (it is the first screen).
2. Keep today's behaviour: a screen is created the first time it is opened and then stays
   mounted, hidden. Store the loaded component per key; render with one `{#each}`.
3. While a screen's code loads, show the existing loading placeholder; on a failed import show
   a retry notice (an installed interface could be half-copied).
4. After the first paint, preload the others when idle so later switches are instant.
5. `build:local` already refuses inline scripts; confirm the extra chunks are copied into
   `<components>/ui/<n>/` and served by the interface loader.

**Check:** `npm run build` lists separate chunks for the calendar and the editor; every screen
opens in `?mock`; shortcuts `0`–`5`, `⌘5`–`⌘9`, `⌘K`, `⌘,` still work on a screen not yet
loaded. **Mac:** one `build:local` and a launch.

## 7. Prune legacy paths

One commit per item, each with its condition checked first.

| Path | Where | Remove when |
|------|-------|-------------|
| `tauri.debug-app.json` | `src-tauri/`, AGENTS.md | now (`tauri.local.json` replaces it) |
| Legacy calendar read `?type=calendar` | `backend/api/meta.js` | now — nothing in `src/` calls it; confirm no old desktop build is still in use |
| WordPress as an accepted platform | `schedule.js` `ALLOWED_PLATFORMS`, `post-rules.js`, `delivery.js`, `platforms.js` | after `select count(*) from scheduled_posts where 'wp' = any(platforms) and status in ('pending','processing')` returns 0. Keep the `wp_post_id` column and the archive label for old rows |
| Engine and model inside the app bundle | launcher script, `components.rs` (`Source::Bundled`, resource-dir lookups) | when no installed app predates build:local (2026-11-07) |
| Plain-path request on sidecar stdin | `sidecar/transcribe.py` | with step 8 |
| `banditur_subs:` / `banditur_peaks:` migration | `subtitles/editor.js` | add a one-time sweep that migrates every remaining key at start-up; remove the code one release later |
| `yt-dlp` in `sidecar/requirements.txt` | requirements | now (the app manages its own copy) |

Bump `CORE_API` if a Rust command changes shape. Update AGENTS.md and README.md with each removal.

## 8. Persistent transcription sidecar + shared Rust helper

**Why:** each sidecar handles one video and exits, so the model is loaded again for every
file. Two Rust modules hand-roll the same "read lines, forward as events" loop, and the audit
found four faults in that area.

**Protocol (sidecar `serve` mode, replaces preload mode):**
- start → load model → `{"type":"ready"}` → read one JSON request per line from stdin
- request `{"id","op":"transcribe","path","language","start","end"}`; `{"op":"shutdown"}`
- every event carries the request's `id`; one request at a time; stdin closing = exit
- `--render` and `--peaks` stay separate short-lived processes (no model; render's
  cancel-by-stdin stays simple)

**Python (`sidecar/transcribe.py`):**
1. Split `main()` into `serve()` and the existing one-shot modes. `run_pipeline` gains an
   `id` and must never call `sys.exit`; errors become an `error` event and the loop continues.
2. Free per-request memory between jobs (temp WAV, aligner tensors, the MLX buffer cache —
   check the current MLX call for this).
3. `sidecar/test_serve.py`: the loop with a fake pipeline — two requests in a row, a failing
   request followed by a good one, shutdown, stdin closed.

**Rust:**
1. New `sidecar.rs`: `spawn_lines(cmd, on_json, on_exit)` — the buffered line reader used by
   transcription and render. Unit-test the line splitter (split chunks, trailing partial line).
2. `transcription.rs`: `TxState` becomes a worker handle `{ child, current: Option<id> }`.
   `process_video` ensures a live worker, writes the request, and **reports a failed write**
   (restart the worker once, then emit `error`). On exit: `error` for the request in flight,
   state cleared. `preload_transcribe` only ensures the worker. New `cancel_transcribe`
   (kills the worker). Stop the worker after 10 idle minutes to give the memory back.
3. `subtitle_render.rs`: remove the temp folder when the spawn fails; take the "already
   exporting" lock once, across check and set.
4. `ytmp3.rs`: a unique default job ID.
5. `ui_loader.rs`: do not mark a version bad on a first failure to report ready; require two
   in a row (counter in `ui-state.json`), with a test.
6. `CORE_API` → 2 (`process_video` takes a request ID; new cancel command).

**Frontend (`views/Traskrittura.svelte`):** one `transcribe-update` listener for the life of
the screen instead of one per run; ignore events whose `id` is not the current request; a
Cancel button; `ui.json` `needsCoreApi: 2`.

**Mac checks:** two videos back to back (the second starts without a model load); a passage
re-transcription; kill the sidecar mid-job (clean error, next job works); cancel; ten idle
minutes then a new job; `tauri dev` and an installed build; memory after five videos.

**Order inside the step:** Rust helper and the four fixes first (no protocol change, shippable),
then the serve mode.

## 9. Subtitle editor to Svelte

**Why:** `subtitles/editor.js` is one 1,531-line factory (`createSubtitleEditor`, about 55
inner functions) driving `views/traskrittura/editor.html` (299 lines) and most of
`styles/legacy-tools.css` (762 lines). DECISIONS.md (2026-11-03) already plans the move in
stages. `model.js`, `styles.js`, `maltese.js`, `names.js` are pure and stay as they are.

Keep `createSubtitleEditor`'s public surface (`load`, `clear`, `importCues`, `review`,
`selection`, `getProject`, `lastExportPath`) working until the last stage, so each stage ships.

1. **Sessions out.** Move `loadSavedSession`, `deleteSavedSession`, `clearSavedSessions`,
   `listRecentSessions` and the autosave/migration code to `subtitles/sessions.js`, with tests.
2. **State.** `subtitles/editor.svelte.js`: a reactive wrapper around `SubtitleDoc` (a version
   counter bumped on every committed step), plus selection, target cue, drawer tab, export
   progress. Per-frame values (playhead, karaoke fill) stay **outside** reactive state.
3. **Leaf components first**, each replacing its block of `editor.html`: export menu and
   progress strip → shortcut sheet → drawer tabs (Stil, Split, Ismijiet, find & replace) →
   cue list (rows, badges, inline edit, word drag) → top bar.
4. **Timeline and preview stay imperative** (`timeline.js`, `preview.js` are tuned for
   playback); mount them from Svelte with an action and pass the doc in.
5. **Shortcuts** as one table (key, condition, action, label) that also feeds the `?` sheet.
   Keep the capture-phase listener so they still win over the global number keys.
6. Delete `editor.html`; move the `.sub-*` rules into the components and drop them from
   `legacy-tools.css`. Then the same for the `.pm-*` rules of the post maker, and delete the file.

**Checks at every stage:** the subtitle tests; in `?mock`, every shortcut in the list in
README.md (Technical reference → Subtitle editing & export); undo/redo across a drag; reopen a saved session. **Mac:** playback smoothness with
an animated preset on a long video, an MP4 and a MOV export, and a preview-vs-export comparison.

---

## What can be done without the Mac

Steps 1–6 can be written and tested in a session like the audit's (Node tests and a Svelte
compile; no Vite build, no Rust). Steps 7–9 need the checks listed under **Mac** before they
are trusted.
