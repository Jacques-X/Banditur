// POST /api/media/sign-upload — issue a short-lived, path-scoped Supabase
// storage upload token.
//
// SEC-3: replaces the previous pattern of the desktop app uploading directly
// to Supabase Storage with the org's anon key under a permissive
// anon/authenticated INSERT RLS policy (see
// backend/supabase/migrations/20260804_signed_uploads.sql). That policy let
// anyone holding the anon key — which is routinely extractable from any
// client that embeds it — upload and publicly host files with no involvement
// from this backend's own API_KEY check at all.
//
// Now the desktop app must authenticate with the app's API_KEY to get a
// signed-upload token, and that token only authorizes writing to the exact
// path generated here (uploads/<uuid>.<ext>), for a short window.

import { createClient } from '@supabase/supabase-js';
import { randomUUID }   from 'crypto';
import { cors }         from '../cors.js';
import { requireAuth }  from '../auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

// Mirrors the bucket's allowed_mime_types in schema.sql — keep these in sync.
const ALLOWED_EXT = {
  'image/jpeg':     'jpg',
  'image/png':      'png',
  'image/webp':     'webp',
  'image/gif':      'gif',
  'video/mp4':      'mp4',
  'video/quicktime':'mov',
  'video/webm':     'webm',
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { contentType } = req.body || {};
  const ext = ALLOWED_EXT[contentType];
  if (!ext) return res.status(400).json({ error: 'Unsupported or missing contentType' });

  const path = `uploads/${randomUUID()}.${ext}`;

  const { data, error } = await sb.storage.from('media').createSignedUploadUrl(path);
  if (error) {
    console.error(JSON.stringify({ event: 'sign_upload_error', message: error.message }));
    return res.status(500).json({ error: 'Failed to create upload URL' });
  }

  const { data: pub } = sb.storage.from('media').getPublicUrl(path);

  return res.status(200).json({
    path,
    token: data.token,
    publicUrl: pub.publicUrl,
  });
}
