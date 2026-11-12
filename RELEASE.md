# Banditur Release Flow

Checked against the local release scripts and configuration on **2026-11-03**. This runbook
does not certify that production credentials, migrations or scheduled triggers are configured.

## One-time setup

The Tauri updater public key is stored in `src-tauri/tauri.conf.json`.
The private key and password are stored outside the repo:

- `~/.tauri/banditur-updater.key`
- `~/.tauri/banditur-updater.key.password`

Back these up securely. Losing access to the signing key (or the password protecting it) prevents signing future
updates for the public key installed apps trust. The build helper accepts path overrides
`TAURI_SIGNING_PRIVATE_KEY_PATH` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD_PATH`; an explicit
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` takes precedence over the password file.

## Build prerequisites

- Use Node.js 20.x or 22+ for the checked-in dependency locks. Install frontend dependencies
  with `npm install` and backend dependencies with
  `npm --prefix backend install` when preparing a backend deployment.
- Rust/Cargo and cmake are required for the desktop build. The packaged transcription flow
  currently targets macOS Apple Silicon and uses `install_name_tool` and `codesign`.
- Provide `src-tauri/banditur-config.json` (copy the example and fill deployment values).
  It is compiled into the binary and must not contain the Supabase service-role key.
- Provide `venv/` with `sidecar/requirements.txt` and PyInstaller installed, and
  `mlx-maltese-whisper-4bit/config.json` plus `weights.safetensors`.
- The sidecar build finds the MLX extension (`core.cpython-*-darwin.so`) for whichever CPython the
  `venv` uses, and stops if it finds none or more than one.
- `gh` must be authenticated for GitHub release publication; `vercel` must be authenticated
  and linked to the backend project for `--vercel`. Inspect changes/staging before using the
  release helper: it commits/pushes before building and does not undo those steps on failure.

## Database

Apply the SQL migrations in date order before deploying code that depends on them:

1. `20260528_release_update_foundation.sql`
2. `20260612_audit_fixes.sql`
3. `20260804_signed_uploads.sql`
4. `20261029_production_workflows.sql`
5. `20261103_tasks.sql` (Xogħol: `task_boards`, `task_columns`, `tasks`) — optional for now: Xogħol is kept on each Mac and doesn't use these tables yet

They live in `backend/supabase/migrations/`; `backend/supabase/schema.sql` describes the
schema. Confirm migrations have been applied to the intended Supabase project, including
the `claim_scheduled_post` RPC and signed-upload storage policies.

## Backend

Deploy from `backend/`:

```bash
cd backend
vercel --prod
```

Production configuration used by the source:

| Variable | Purpose |
| --- | --- |
| `API_KEY` | Shared desktop/API bearer token |
| `CRON_SECRET` | Separate cron bearer token; also used by the GitHub trigger |
| `SUPABASE_URL`, `SUPABASE_SERVICE` | Backend database/storage access |
| `COMMITTEE_PROFILES` | JSON array with `id`, `name`, `fb_page_id`, `fb_access_token`, `ig_user_id` |
| `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS` | Google service-account JSON |
| `DRIVE_FOLDER_ID` | Allowed root for Drive browsing/downloads |
| `BACKEND_VERSION`, `MIN_DESKTOP_VERSION` | Version/compatibility information |

Publish credential lookup requires an exact `COMMITTEE_PROFILES` ID; it does not silently
fall back to another committee. Keep tokens/service credentials on the backend. The desktop
uses its backend URL/key and Supabase URL/anon key, then requests signed media uploads.

Drive browsing needs the service account in `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`. Share the Drive root
with the same service account for browsing. Redeploy after changing credentials/environment
variables; sharing-permission changes take place in Google and do not change the source.

Scheduled publishing is triggered by `.github/workflows/cron.yml` (every 15 minutes). It needs
the `VERCEL_URL` and `CRON_SECRET` repository secrets in GitHub, and `CRON_SECRET` must match
the Vercel env var of the same name. `VERCEL_URL` must be the full deployed base URL, since
the workflow appends `/api/cron/process`. `backend/vercel.json` also declares a daily
`0 0 * * *` fallback; its GET request uses the same cron authentication.

Each run handles at most 5 due posts within its budget. Eligible ordinary Facebook posts more than ten minutes and up to 30 days
ahead are handed off to native scheduling; Reels, Stories and other destinations still depend on
the worker cadence. Do not promise exact-minute publication for worker-published jobs.

## Desktop App

> **Local-only builds (current).** The app is built and installed on one Mac with `npm run build:local`
> (see README → "Build and install on this Mac"); the engine and model live in
> `~/Library/Application Support/app.banditur.desktop/components/`, not inside the app. The signed
> updater flow below still exists but builds an app **without** the engine and model, so it is not
> usable for distribution until they are bundled again or downloaded.

### Normal path (signed updater release, dormant)

```bash
npm run publish:update -- <version> "Release notes" --commit --push --vercel
```

`scripts/publish-update.mjs`:

1. Bumps the version in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml` (`--commit` / `--push` commit and push the bump). The helper also
   stages `src-tauri/Cargo.lock` if it has changes; check its package version after the build.
2. Clears `src-tauri/target/release/bundle` and runs the signed build (`npm run release:app` →
   `scripts/build-updater-release.sh`, which reads the key and password from `~/.tauri/` and
   runs `npm run tauri build`). That also rebuilds the transcription sidecar, so the venv needs
   `pyinstaller`.
3. Creates or updates the GitHub Release `v<version>` with each updater artifact and its `.sig`
   (requires the `gh` CLI).
4. With `--vercel`: removes the generic `UPDATE_URL` / `UPDATE_SIGNATURE`, sets `UPDATE_VERSION`,
   `UPDATE_NOTES`, `UPDATE_PUB_DATE` and the per-platform `UPDATE_URL_<TARGET>_<ARCH>` /
   `UPDATE_SIGNATURE_<TARGET>_<ARCH>` (e.g. `UPDATE_URL_DARWIN_AARCH64`), then redeploys the
   backend (requires the Vercel CLI). Without `--vercel` it prints the values to set by hand.

Add `--dry-run` to see what would happen without changing anything.

### Manual path

First update the desktop version consistently in `package.json`, `package-lock.json`,
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`; review any resulting Cargo.lock change.
Build signed updater artifacts only:

```bash
npm run release:app
```

On macOS this produces `src-tauri/target/release/bundle/macos/Banditur.app.tar.gz` and its
`.sig`. Upload both to a GitHub Release, then set the updater env vars below in Vercel and
redeploy.

### Updater env vars

The updater endpoint is public (no `API_KEY` required). It reads each `UPDATE_*` value from its platform-specific name first
(`UPDATE_URL_DARWIN_AARCH64`) and falls back to the generic name (`UPDATE_URL`). Keep artifact
URLs and signatures platform-specific so a Windows build is never pointed at a macOS artifact.

- `UPDATE_VERSION`
- `UPDATE_URL_<TARGET>_<ARCH>` (fallback: `UPDATE_URL`)
- `UPDATE_SIGNATURE_<TARGET>_<ARCH>` (fallback: `UPDATE_SIGNATURE`)
- `UPDATE_NOTES`
- `UPDATE_PUB_DATE`

Set by hand when needed — the script never touches these:

- `MIN_DESKTOP_VERSION` — desktop builds older than this are told they need to update
- `BACKEND_VERSION` — reported by `/api/meta?type=version`

If no update is live yet, or the updater shows a metadata error (e.g. an invalid `pub_date`),
remove the `UPDATE_*` vars from Vercel and redeploy (the full command list is in README.md →
Release & Update Flow).

## Verification after a release

- Run the Meta smoke test on a test profile — it never publishes:

  ```bash
  COMMITTEE_PROFILES='[…same JSON as Vercel…]' SMOKE_IMAGE_URL=https://…/test.jpg \
    SMOKE_VIDEO_URL=https://…/test-9x16.mp4 npm run smoke:meta -- --profile <test-profile-id>
  ```

  It reads the Page and Instagram account, uploads an unpublished Facebook photo and text post
  and deletes them, and creates Instagram image/Reel containers without publishing them
  (they expire after 24 hours). Any ✗ line names the Graph error. Run it after changing the
  Graph API version (`GRAPH` in `backend/api/_lib/delivery.js`) or a page token.

- Confirm the backend version endpoint and the intended profile list are readable with the
  desktop API key. A green health dot checks selected endpoints/configuration, not a full
  publish or upload.
- Inspect updater metadata for the intended target/architecture: version, matching artifact
  URL/signature and a valid ISO `pub_date`. Missing updater configuration currently returns
  HTTP 200 with the current version and an empty `platforms` object; it is not a new release.
- Open Xogħol: create a board, add/tick/move a card, quit and reopen the app, and check it is all still there.
  Switch to Gantt, drag and resize a bar and a step bar, add a card and a step from the chart, give a card a Budget and check the totals, and save a PNG and a PDF (open both; the PDF must be one A4 page).
- After `npm run build:local`: Settings → Updates lists the engine and model versions; open Traskrittura and transcribe a short clip.
- Confirm the GitHub publishing workflow is enabled and inspect its latest result. A successful
  trigger alone does not prove individual destinations published; inspect queue errors and
  actual posts. Do not trigger a production publish as a documentation-only check.
- Open the installed build, resume a subtitle session, check a sample export's font/timing,
  and verify watermark/template data survives the update. The release sidecar excludes the
  optional CTC aligner, so installed word timings use Whisper rather than the dev MASRI pass.

The app's configured updater URL is:

`https://banditur.vercel.app/api/updates/{{target}}/{{arch}}/{{current_version}}`


## Production workflow rollout (2026-10-29)

1. Run `npm test`, `npm run build`, Rust library tests and the two Python test files listed in README.md. Build the real sidecar and signed app with the existing local model/config; the Rust resource override only checks source and must not be used for release packaging.
2. Pause the publishing trigger during migration/deployment, record pending/native jobs and back up the database. Apply `20261029_production_workflows.sql` once. It adds request idempotency, revision trigger, delivery ledger, event/category, retention and engagement freshness fields. The backfill retains known IDs and marks old uncertain jobs for review; inspect those against Meta before acknowledging a retry. `schema.sql` includes the same migration for a fresh database.
3. Deploy the backend before distributing the new desktop, then restore the regular trigger. Older schedule clients without `request_id` remain accepted, but need the new desktop for recovery guarantees. Check that a repeated UUID returns the same row and stale revisions return 409.
4. On a test profile, exercise a Facebook text/image post, a photo carousel, Instagram JPEG/video, and the dedicated Reel/Story routes. Confirm actual destination visibility/IDs, native scheduled cancellation, rescheduling, container processing and a mixed success/failure retry. A timeout during the publish boundary must stay unknown until reviewed, without a second automatic POST. Do not use a public committee profile for smoke-test posts without explicit authorization.
5. Check active/past-due jobs in Home/Calendar/Archive and health after a simulated network failure. Test Malta summer/winter date boundaries. Verify missing report metrics display unavailable, freshness/coverage export to PDF/CSV, and category/event filters leave page-wide insights clearly labelled.
6. Native smoke test: edit/reopen/relink a subtitle project; export/import with references and included media; import SRT; retranscribe a passage in each requested language; accept/undo while outside corrections remain. Model availability and recognition accuracy need real audio.
7. Test square/portrait/Story previews against exported JPGs, a long-name batch/CSV, edited placement, cancellation, draft handoff, branding per profile and valid/invalid template-pack import. Run photo preview in both orientations, keep a proposed duplicate, cancel/retry a batch, and confirm originals/completed outputs remain intact. Queue/cancel/retry downloads and use the completed-media handoffs.
8. Test a full signed installed build, including model/sidecar/fonts and native file access. Release only after these live/native checks pass. No production migration, deployment or updater release is performed by the local implementation work itself.

Retention defaults to 30 days after publication (configurable 1–365 days or pinned). Active,
failed and pinned references survive daily cleanup. Deleting/editing a post leaves shared
assets for garbage collection with a 24-hour orphan grace period. Confirm bucket contents
and retention policy during rollout before relying on automatic cleanup.
