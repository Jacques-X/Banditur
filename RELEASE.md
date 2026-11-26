# Banditur Release Flow

Checked against the local release scripts and configuration on **2026-11-03**; the desktop section was rewritten when the signed updater was removed. This runbook
does not certify that production credentials, migrations or scheduled triggers are configured.

## One-time setup

There is no signing key any more: the signed Tauri updater was removed (DECISIONS.md → "Signed updater removed; the
shared Mac builds from GitHub"). The old `~/.tauri/banditur-updater.key` files are no longer needed; keep or delete
them. The one-time setup that remains is the shared Mac's (clone, GitHub token, first `npm run build:local`): README →
"Updates on the shared Mac".

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
- `vercel` must be authenticated and linked to the backend project to deploy the backend by hand
  (Vercel also deploys from Git).

## Database

Apply the SQL migrations in date order before deploying code that depends on them:

1. `20260528_release_update_foundation.sql`
2. `20260612_audit_fixes.sql`
3. `20260804_signed_uploads.sql`
4. `20261029_production_workflows.sql`
5. `20261103_tasks.sql` (Xogħol: `task_boards`, `task_columns`, `tasks`)
6. `20261122_sharing.sql` (Xogħol budgets; Kalendarju: `calendar_events`, `calendar_settings`)

5 and 6 are needed only before anyone switches on Settings → Sharing; until then Xogħol and
Kalendarju stay on each Mac. Deploy the backend (it adds `api/events.js`; 10 of 12 functions today)
before switching sharing on: a missing table answers 503 with the migration to apply.

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

There is no release artifact. The desktop is built on the shared Mac, from the repository, by the app itself
(README → "Updates on the shared Mac").

### Shipping a new version

1. Run the checks (`npm run check`, and `cargo test --manifest-path src-tauri/Cargo.toml --lib` when `src-tauri/` changed).
2. Push to the branch the shared Mac's clone follows (`stable` is recommended; the clone follows the upstream of
   whatever branch it has checked out). Deploy the backend first when the change needs it (migrations, then Vercel).
3. On the shared Mac, Banditur shows a dot on the Settings button within 3 hours, or at once with Settings →
   Components → Aġġornamenti → Iċċekkja issa. Pressing **Aġġorna** pulls (fast-forward only) and builds. A change to
   screens, the engine or the model needs no quit; a change to the app core quits, rebuilds and reopens (up to
   15 minutes; nothing should be pressed meanwhile).
4. If it fails, the old app stays and reopens; read the error in Settings or `.build-cache/update.log` in the clone.
   Local edits to tracked files in the clone block updates until they are committed or discarded.

The desktop's version (`package.json`, `tauri.conf.json`, `Cargo.toml`) is bumped by hand when wanted; nothing reads it
except the Settings page and `MIN_DESKTOP_VERSION` (set by hand in Vercel, with `BACKEND_VERSION`; both are reported by
`/api/meta?type=version`).

The `UPDATE_*` Vercel variables (`UPDATE_VERSION`, `UPDATE_URL*`, `UPDATE_SIGNATURE*`, `UPDATE_NOTES`, `UPDATE_PUB_DATE`)
are no longer read and can be removed (`vercel env rm <NAME> production`), then redeploy.

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
- On the shared Mac, test an update both ways: push a screen-only commit and press Aġġorna (no quit); push a Rust
  commit (quit, rebuild, reopen); break the build on purpose (the old app reopens and Settings shows the error).
- Open Xogħol: create a board, add/tick/move a card, quit and reopen the app, and check it is all still there.
  Switch to Gantt, drag and resize a bar and a step bar, add a card and a step from the chart, give a card a Budget and check the totals, and save a PNG and a PDF (open both; the PDF must be one A4 page).
- After `npm run build:local` with a changed core: CORE_API is now 2 (transcription worker, `cancel_transcribe`), so an interface built after 2026-11-22 needs the matching core; `build:local` builds both together. Transcribe two videos in a row (the second starts without loading the model) and try *Ikkanċella*.
- After `npm run build:local`: Settings → Components lists the engine and model versions; open Traskrittura and transcribe a short clip.
- Confirm the GitHub publishing workflow is enabled and inspect its latest result. A successful
  trigger alone does not prove individual destinations published; inspect queue errors and
  actual posts. Do not trigger a production publish as a documentation-only check.
- Open the installed build, resume a subtitle session, check a sample export's font/timing,
  and verify watermark/template data survives the update. The release sidecar excludes the
  optional CTC aligner, so installed word timings use Whisper rather than the dev MASRI pass.


## Production workflow rollout (2026-10-29)

1. Run `npm test`, `npm run build`, Rust library tests and the two Python test files listed in README.md. Build the real sidecar and the app (`npm run build:local`) with the existing local model/config; the Rust resource override only checks source and must not be used for release packaging.
2. Pause the publishing trigger during migration/deployment, record pending/native jobs and back up the database. Apply `20261029_production_workflows.sql` once. It adds request idempotency, revision trigger, delivery ledger, event/category, retention and engagement freshness fields. The backfill retains known IDs and marks old uncertain jobs for review; inspect those against Meta before acknowledging a retry. `schema.sql` includes the same migration for a fresh database.
3. Deploy the backend before distributing the new desktop, then restore the regular trigger. Older schedule clients without `request_id` remain accepted, but need the new desktop for recovery guarantees. Check that a repeated UUID returns the same row and stale revisions return 409.
4. On a test profile, exercise a Facebook text/image post, a photo carousel, Instagram JPEG/video, and the dedicated Reel/Story routes. Confirm actual destination visibility/IDs, native scheduled cancellation, rescheduling, container processing and a mixed success/failure retry. A timeout during the publish boundary must stay unknown until reviewed, without a second automatic POST. Do not use a public committee profile for smoke-test posts without explicit authorization.
5. Check active/past-due jobs in Home/Calendar/Archive and health after a simulated network failure. Test Malta summer/winter date boundaries. Verify missing report metrics display unavailable, freshness/coverage export to PDF/CSV, and category/event filters leave page-wide insights clearly labelled.
6. Native smoke test: edit/reopen/relink a subtitle project; export/import with references and included media; import SRT; retranscribe a passage in each requested language; accept/undo while outside corrections remain. Model availability and recognition accuracy need real audio.
7. Test square/portrait/Story previews against exported JPGs, a long-name batch/CSV, edited placement, cancellation, draft handoff, branding per profile and valid/invalid template-pack import. Run photo preview in both orientations, keep a proposed duplicate, cancel/retry a batch, and confirm originals/completed outputs remain intact. Queue/cancel/retry downloads and use the completed-media handoffs.
8. Test a full installed build, including model/sidecar/fonts and native file access. Release only after these live/native checks pass. No production migration or deployment is performed by the local implementation work itself.

Retention defaults to 30 days after publication (configurable 1–365 days or pinned). Active,
failed and pinned references survive daily cleanup. Deleting/editing a post leaves shared
assets for garbage collection with a 24-hour orphan grace period. Confirm bucket contents
and retention policy during rollout before relying on automatic cleanup.
