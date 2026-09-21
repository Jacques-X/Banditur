-- ── Signed uploads 2026-08-04 ─────────────────────────────────────────────────
-- SEC-3: "media_uploads_insert" let the anon/authenticated Supabase role
-- INSERT directly into the public-read media bucket, completely bypassing
-- this app's own API_KEY check. Anyone holding the Supabase anon key (which
-- is routinely extractable from any client that embeds it) could upload and
-- publicly host arbitrary files — up to the 50 MB / image-video allowlist —
-- with no backend authorization involved at all.
--
-- Uploads now go through POST /api/media/sign-upload (requires the app's
-- API_KEY) which mints a Supabase signed-upload token scoped to one specific
-- path via createSignedUploadUrl. Signed-upload tokens authorize the upload
-- directly and don't depend on a storage.objects INSERT policy, so no
-- replacement anon/authenticated policy is needed.

drop policy if exists "media_uploads_insert" on storage.objects;
