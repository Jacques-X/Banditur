# Efficiency plan (temporary — delete once done)

Implementation plan for the efficiency audit of 24 Nov 2026. Work through the items in order; each one is
independent. Read AGENTS.md first and follow its conventions (docs in sync, tests for pure logic, DECISIONS entry
for trade-offs). Do **not** commit; leave changes in the working tree for review.

## Environment notes (important)

- You work on the user's Mac folder through a Linux shell (`$HOME/mnt/Banditur`). Edit files in place
  (python read-modify-write or careful `sed`), never by re-typing a whole file from earlier tool output.
- Available here: `node` 22 and `python3`. **Not** available: `cargo`/`rustc`, the macOS `venv`, a working
  `vite build` (node_modules holds macOS esbuild binaries). So:
  - Run `node --test "src/**/*.test.mjs" "backend/tests/*.test.mjs" "scripts/**/*.test.mjs"` after JS changes.
  - Run `cd sidecar && python3 test_passage.py && python3 test_maltese.py && python3 test_serve.py` after Python changes.
  - Rust cannot be compiled here. Write Rust conservatively, re-read every edited function in full, check types,
    borrows and imports by eye, and keep/adjust the existing `#[cfg(test)]` tests so they still match.
  - At the end, list for the user exactly what they must run on the Mac: `cargo test --manifest-path src-tauri/Cargo.toml --lib`,
    `npm run check`, `npm run build:transcribe` (then compare `du -sh sidecar-dist`, was 559 MB), and a backend deploy.
- Deleting files is not permitted in this folder by default; if a step needs a file removed, say so in the summary.

---

## 1. Trim the transcription engine bundle (~60 MB)

Files: `transcribe-bundle.spec`, `scripts/build-transcribe-sidecar.sh`.

- In `transcribe-bundle.spec` add to `excludes`: `'transformers'`, `'tokenizers'`, `'torchaudio'`, `'nltk'`,
  `'ctc_forced_aligner'`, `'pyannote'`. Keep the existing ones. Do NOT exclude `huggingface_hub`, `safetensors`,
  `numba`, `llvmlite`, `tiktoken`, `numpy`, `mlx*`, `imageio_ffmpeg` (mlx-whisper needs them).
- `transcribe.py` already degrades without them: `masri_alignment_enabled()` uses `find_spec`, diarization catches
  `ImportError`. Re-read both to confirm nothing imports these at module level.
- In `build-transcribe-sidecar.sh`, extend the "excluded heavyweight package" check to also fail when any of
  `_internal/transformers`, `_internal/torchaudio`, `_internal/nltk`, `_internal/ctc_forced_aligner`,
  `_internal/tokenizers` exists.
- Docs: AGENTS.md gotcha "Release engine bundles exclude `torch`, `scipy`, `hf_xet`…" → list the new excludes.
  Update the matching README build-internals text (grep README for `hf_xet`).

## 2. Seek straight to a passage instead of decoding the whole video

File: `sidecar/transcribe.py`, test `sidecar/test_passage.py`.

- Add a pure helper:
  ```python
  def audio_args(ffmpeg, media_path, out_wav, start=0.0, end=None) -> list:
      if start < 0 or (end is not None and end <= start):
          raise ValueError("Passaġġ mhux validu.")
      args = [ffmpeg, "-y"]
      if start:
          args += ["-ss", f"{start:.3f}"]          # before -i: fast input seek
      args += ["-i", media_path]
      if end is not None:
          args += ["-t", f"{end - start:.3f}"]    # a duration, unambiguous with input seeking
      return args + ["-ar", "16000", "-ac", "1", "-vn", out_wav]
  ```
- `extract_audio(media_path, out_wav, start=0.0, end=None)` builds its command with `audio_args(_find_ffmpeg(), …)`;
  keep its existing error handling.
- In `run_pipeline`: call `extract_audio(media_path, tmp_wav, start, end)` and delete the
  `if start or end is not None: slice_audio(...)` lines. Validate before creating the temp file is fine either way.
  Keep `word['start'] += start` (timestamps of the extracted WAV start at 0).
- Remove `slice_audio`.
- Rewrite `test_passage.py` against `audio_args`: (a) `start=1, end=2.5` gives `-ss 1.000` before `-i` and
  `-t 1.500` after it; (b) no start/end gives neither flag; (c) `start=2, end=1` and `start=-1` raise `ValueError`.
- README: grep for "passage"/"Passaġġ" and update any wording that says the whole audio is extracted then sliced.

## 3. Remove the Ritratti preview entirely

The live duplicate/blur checks during the run stay; only the preview modal and its review lists go.

Frontend
- `src/views/Ritratti.svelte`: remove `preview`, `previewBusy`, `keepFiles` state; `inspect()`; the
  "Preview, duplikati u mċajpra…" button (and its `{#if}` wrapper); the whole `{#if preview}<Modal…>` block; the
  `skipFiles`/`blurryFiles` lines in `run()`; the now-unused CSS (`.bh`, `.preview-grid*`, `.duplicate-row*`); and any
  now-unused imports (`Modal`, `fileSrc`, `BLUR_LEVELS` if only used by inspect — check each). In `setInput` drop
  `preview = null; keepFiles = [];`.
- `src/views/ritratti/plan.js`: drop `keepFiles`, `skipFiles`, `blurryFiles` from the doc comment and remove the
  `reviewed` object; `process(o.input, { source: 'jpg' })` / `{ source: 'raw' }`.
- `src/views/ritratti/plan.test.mjs`: update the expectations (no `keepFiles`/`skipFiles`/`blurryFiles` in args);
  rename/adjust the "reviewed list is passed on" test.
- `src/lib/photojob.svelte.js` retry: change `{ skipDuplicates: false, minSharpness: null, blurryFiles: null }` to
  `{ skipDuplicates: false, minSharpness: null }`, and strip `keepFiles`, `skipFiles`, `blurryFiles` from
  `task.args` when building the retry (old persisted tasks may still carry them).
- `src/lib/mock.js`: remove the `inspect_photos` case.

Rust (`src-tauri/src/image_processor.rs`, `lib.rs`, `components.rs`)
- Delete `inspect_photos` and its registration in `lib.rs`.
- `process_images` / `run_processing`: remove params `keep_files`, `skip_files`, `blurry_files`. Then
  `live_dupes = skip_duplicates`, `live_blur = min_sharpness`; remove the `blurry_files`, `skip_files` and
  `keep_files` branches in the decision loop.
- Bump `CORE_API` in `components.rs` to 3 with a comment "3: inspect_photos removed; process_images lost the review
  lists". First read `ui_loader.rs` `choose()` to confirm a bump is the right way to keep an older installed interface
  from calling a missing command.
- Docs: README lines ~118–136 mention *Preview u duplikati…* / *Preview* — rewrite to say duplicates and blurry photos
  are decided during the run and listed in the log. DECISIONS.md: add an entry "Ritratti preview removed" (why: rarely
  worth a separate pass; the run's log names every skipped photo and its reason).

## 4. Faster Arkivju uploads

Files: `src/lib/archive.svelte.js`, `src-tauri/src/archive.rs`, `backend/api/_lib/archive.js`,
`backend/api/drive/[...slug].js`, `backend/tests/archive.test.mjs`, `src/lib/archive-job.js` if helpful.

4a. Rust cancel must work with several transfers at once.
- `CANCEL: AtomicBool` is reset to false at the start of every `put_blocking` / `archive_copy`, so a transfer that
  starts after a pause would clear it. Replace with `static CANCEL_GEN: AtomicU64`. `archive_cancel` does
  `fetch_add(1)`. `archive_put` / `archive_copy` read the generation **in the command, before `spawn_blocking`**, pass
  it down, and treat `CANCEL_GEN.load() != gen` as cancelled wherever `CANCEL.load()` is checked today. Remove the
  `store(false)` resets. Keep the existing test passing (adjust if it touches CANCEL).

4b. Backend batch operations (no new Vercel function — same router).
- In `createArchive`, add:
  - `sessions({ items })` → `{ results }`: `items` is an array of the `session()` argument; process **sequentially**
    (folder creation must not race), return one result per item in order; an item that throws an `ArchiveError`
    becomes `{ error: message }` instead of failing the batch. Cap at 25 items (400 otherwise).
  - `finishMany({ items })` → `{ results }`: same pattern over `finish()`, cap 25.
- Add `'sessions'`, `'finishMany'` to `ARCHIVE_ACTIONS` in `drive/[...slug].js`; update its header comment.
- Tests in `backend/tests/archive.test.mjs` with the existing fakes: order preserved, one failing item does not sink the
  others, cap enforced.

4c. Desktop job runner.
- Upload lane: up to **3 files at once** per job (constant `PARALLEL = 3`). Before uploading a group, fetch sessions
  for the items without a `sessionUrl` in one `call('/api/drive/archive/sessions', { items })` (chunks of ≤25);
  `exists` → `skipped`; `error` → item `failed` with that message. After a group's puts, verify with one
  `finishMany` call. Keep the per-item fallbacks (`session-expired` → clear `sessionUrl` and retry that item once,
  `!ok` → clear `sessionUrl` and mark failed with the existing message).
- If the new endpoints answer 404 (older backend), fall back to the existing per-item `session` / `finish` calls.
- Bandwidth limit: pass `limitKbps: Math.ceil(limit / PARALLEL)` so the total stays at the user's limit.
- Stop conditions keep today's meaning: on `cancelled` / card gone / offline, let the in-flight puts settle, then
  stop the job with the same state and message as now.
- Backup copy: run it as its own lane in parallel with uploads (one `archive_copy` call per file, or batches),
  not before each upload. A copy failure still disables backup for the job with the existing toast; `cancelled` stops it.
- `arch.now`: show the names in flight joined with " · ".
- Put whatever is pure (grouping items into batches, mapping results back) in `archive-job.js` with tests in its
  existing test file.

4d. Saving (also low-impact item L3): replace per-item `saveJobs()` calls inside the loop with `saveJobsSoon()`
(debounced, ~2 s trailing, one timer). Keep immediate `saveJobs()` on job state changes (queued/running/paused/
interrupted/done/failed/removed) and right after a new `sessionUrl` is stored (so a quit can resume the session).

- Docs: README Arkivju section ("one file at a time") and the header comment in `archive.svelte.js`;
  DECISIONS entry "Arkivju uploads 3 at a time, sessions/finish batched".

## 5. Lighter background polling

5a. One call for the Home counts.
- `backend/api/history.js`: add `status=summary`. Return
  `{ upcoming: <4 rows, status in pending/fb_native/processing, ascending scheduled_time>, pending: <count>, failed: <count of status failed>, latestFailed: <newest failed row or null> }`
  using `head: true` counts and only the columns the Home queue uses (check `queue.svelte.js` and the Home view for
  which fields are read). Respect `profile_id` like the other modes. Extract the query-building into a small factory
  if needed so it can be tested; add a test if the repo already has a pattern for history (otherwise a pure helper test).
- `src/lib/queue.svelte.js` `refreshCounts`: one `api('/api/history', { query: { status: 'summary', profile_id } })`.
  If the response has no `upcoming` (old backend), fall back to the current two calls but with `limit: 4` for the first.
  Keep the same `app.pending`, `app.failed`, `queue.upcoming`, `queue.latestFailed` results.

5b. Pause timers while the window is hidden.
- Add to `src/lib/` (e.g. `visible.js`): `everyVisible(fn, ms)` → stop function. It runs `fn` every `ms` only while
  `document.visibilityState === 'visible'`, and runs it once immediately when the page becomes visible again if a tick
  was skipped. Write a small `*.test.mjs` with a fake document/timers if practical.
- Use it for: `App.svelte` `refreshCounts` (60 s), `Xoghol.svelte` (30 s), `Kalendarju.svelte` (60 s).
  Leave `archive.svelte.js` card polling (3 s, native, cheap) and `TimeGrid.svelte` clock alone.

## 6. Cheaper photo export (`finish_one`)

File: `src-tauri/src/image_processor.rs`.

- Work in RGB throughout: `let mut base = img.into_rgb8();` (after the resize).
- `median_luma` and `auto_brighten` take `&RgbImage` / `&mut RgbImage` (update the tests that build `RgbaImage`:
  use `Rgb([v, v, v])`; the "alpha stays 255" assertion goes).
- Watermark: cache per output size a `ScaledMark { img: RgbaImage, rows: (u32, u32) }` where `rows` is the first and
  one-past-last row containing any pixel with alpha > 0 (compute once when the scaled mark is created). Replace
  `imageops::overlay` with a `blend_rows(&mut RgbImage, &ScaledMark)` that only walks those rows, iterating raw
  slices (`as_raw()` / `as_mut()` with `chunks_exact(4)` / `chunks_exact_mut(3)`), skipping alpha 0, copying alpha 255,
  and otherwise `dst = (src*a + dst*(255-a) + 127) / 255` per channel. Cache type becomes
  `RwLock<HashMap<(u32,u32), Arc<ScaledMark>>>`; adjust `run_processing`'s cache declarations.
- Encode `encode_jpeg_moz(&base, quality)` directly (no RGBA→RGB conversion).
- Add tests: blending a fully transparent mark leaves the image unchanged; an opaque pixel replaces; a 50% pixel lands
  within ±1 of the average; `rows` of a mark that is transparent except row 7 is `(7, 8)`; an all-transparent mark
  gives an empty range and is a no-op.
- AGENTS.md gotcha "Watermark compositing uses `imageops::overlay`…" → describe the new blend (same visual result).

## 7. Low-impact items

L1. **Faster RAF previews; no double count.** In `raw_converter.rs`:
- Before the whole-file fallback in `extract_arw_jpeg_bytes`, add a Fujifilm fast path: if the first 16 bytes are
  `FUJIFILMCCD-RAW `, read big-endian u32 JPEG offset at byte 84 and length at byte 88, bound-check with the existing
  `MIN/MAX_EMBEDDED_JPEG_BYTES`, seek/read, require `FF D8`, return. Otherwise fall through unchanged.
  (CR3 stays on the fallback — note that in README limitations; parsing ISO-BMFF is out of scope.)
- Lines ~150–151: `crate::photo_jobs::file(&app, path, false);` is called twice on a save error — remove one.
- Unit test for the RAF header parse with a synthetic buffer (factor the header parse into a pure fn over `&[u8]`).

L2. **Sets instead of lists.** In `run_processing` (and `run_raw_conversion`) turn `include_files` into a
`HashSet<String>` once before `retain`. (keep/skip/blurry lists are gone after item 3.)

L3. Done in 4d.

L4. **Timeline waveform.** `src/subtitles/timeline.js` `drawWave`: read the three CSS colours into a cached object,
refreshed on theme change (a `MutationObserver` on `document.documentElement` `data-theme`, plus
`matchMedia('(prefers-color-scheme: dark)')` change), instead of `getComputedStyle` per draw. Make the `scroll`
listener schedule at most one `drawWave` per animation frame. Disconnect the observer in the timeline's destroy path.

L5. **Drop `@supabase/supabase-js` from the desktop.** `src/views/skeda/composer.svelte.js` `upload()`: replace
`createClient(...).storage.from('media').uploadToSignedUrl(path, token, file, { contentType })` with a `fetch` PUT to
`${supabaseUrl}/storage/v1/object/upload/sign/media/${encodeURI(path)}?token=${encodeURIComponent(token)}` with
headers `apikey: supabaseKey`, `Authorization: Bearer ${supabaseKey}`, `Content-Type: file.type`,
`x-upsert: 'false'`, body `file`. On non-OK, read the JSON/text error and throw `Upload: <message>` as today.
Before removing, read `node_modules/@supabase/storage-js` `uploadToSignedUrl` to confirm URL shape and headers; match
it. Then remove `@supabase/supabase-js` from the **root** `package.json` dependencies only if nothing else in `src/`
imports it (grep). Do not touch `backend/package.json`. Tell the user to run `npm install` to refresh the lockfile
(don't hand-edit `package-lock.json`).

## Finish

- Run the node and python test commands above; fix failures.
- `grep -rn "inspect_photos\|keepFiles\|skipFiles\|blurryFiles\|slice_audio" src src-tauri/src sidecar` must be empty
  (apart from intentional retry stripping).
- Re-read every Rust function you changed end to end.
- Summarise for the user: what changed per item, what could not be verified here, and the Mac-side commands to run
  (cargo tests, `npm install`, `npm run check`, `npm run build:transcribe` + size check, backend deploy for items 4b/5a).
