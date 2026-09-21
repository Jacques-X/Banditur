// POST /api/media/check — pre-flight reachability check for media URLs.
//
// FEAT-2: run before a post is actually scheduled, so a dead media link
// (most commonly: a draft or a failed-post retry referencing an upload that
// the 24h orphan-media cleanup in cron/process.js already removed, since it
// was never attached to a scheduled_posts row) gets caught immediately in
// the UI instead of surfacing hours or days later as a cron publish failure.
//
// Done server-side rather than from the renderer so it isn't at the mercy of
// the target's CORS policy — a HEAD request from the desktop webview could
// be blocked by CORS even when the resource is perfectly reachable, which
// would make the check produce false positives. Restricted to URLs on the
// configured Supabase project, same as schedule.js's validateMedia — this
// must not become an arbitrary URL-fetching proxy.

import { cors }        from '../cors.js';
import { requireAuth } from '../auth.js';

const CHECK_TIMEOUT_MS = 5000;
const MAX_URLS = 10; // matches the media-per-post cap enforced in schedule.js

async function checkOne(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    // Some storage backends don't implement HEAD cleanly (405/501) — fall
    // back to a ranged GET so a real 404/410 still gets reported accurately
    // instead of a false "reachable".
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: controller.signal });
    }
    return res.ok || res.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, MAX_URLS) : [];
  if (!urls.length) return res.status(200).json({ results: [] });

  if (!process.env.SUPABASE_URL) return res.status(500).json({ error: 'server misconfiguration: SUPABASE_URL not set' });
  const supabaseOrigin = new URL(process.env.SUPABASE_URL).origin;

  const results = await Promise.all(urls.map(async raw => {
    if (typeof raw !== 'string') return { url: raw, ok: false, reason: 'invalid' };
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return { url: raw, ok: false, reason: 'invalid' };
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== supabaseOrigin) {
      // Not one of ours — don't fetch it, just say we can't vouch for it
      // rather than silently reporting success or turning this endpoint
      // into an open fetch proxy.
      return { url: raw, ok: false, reason: 'unsupported_origin' };
    }
    const ok = await checkOne(raw);
    return { url: raw, ok, reason: ok ? null : 'unreachable' };
  }));

  return res.status(200).json({ results });
}
