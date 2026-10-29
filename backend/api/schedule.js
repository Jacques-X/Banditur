import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { cors } from './cors.js';
import { postProblem } from './_lib/post-rules.js';
import { requireAuth } from './auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

const ALLOWED_PLATFORMS = new Set(['fb', 'ig', 'wp']);
const ALLOWED_CONTENT_TYPES = new Set(['post', 'reel', 'story']);

function knownProfileIds() {
  try {
    const profiles = JSON.parse(process.env.COMMITTEE_PROFILES || '[]');
    return new Set(profiles.map((p) => p.id).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function validateMedia(media) {
  if (!Array.isArray(media)) return 'media must be an array';
  if (media.length > 10) return 'media cannot contain more than 10 items';

  // SEC-2: fail closed. If SUPABASE_URL is misconfigured/unset we must reject
  // every media item rather than silently accepting any https URL (SSRF risk —
  // these URLs get handed straight to the Meta Graph API as image_url/file_url).
  if (!process.env.SUPABASE_URL) return 'server misconfiguration: SUPABASE_URL not set';
  const supabaseOrigin = new URL(process.env.SUPABASE_URL).origin;

  for (const item of media) {
    if (!item || typeof item !== 'object') return 'media items must be objects';
    if (typeof item.url !== 'string' || typeof item.path !== 'string' || typeof item.type !== 'string')
      return 'media items require url, path, and type';
    if (!item.type.startsWith('image/') && !item.type.startsWith('video/'))
      return 'media type must be image or video';
    if (!item.path.startsWith('uploads/') || item.path.includes('..')) return 'media path is invalid';
    try {
      const url = new URL(item.url);
      if (url.protocol !== 'https:') return 'media url must be https';
      if (url.origin !== supabaseOrigin) return 'media url must belong to the configured Supabase project';
      // SEC-2: item.url and item.path are supplied independently by the
      // client — make sure they actually refer to the same storage object,
      // otherwise a caller could publish from one object while the
      // path used for lifecycle/cleanup tracking points at another.
      const expectedSuffix = `/storage/v1/object/public/media/${item.path}`;
      if (!url.pathname.endsWith(expectedSuffix)) return 'media url does not match media path';
    } catch {
      return 'media url is invalid';
    }
  }

  return null;
}

export function createScheduleHandler(client = sb) {
  const sb = client;
  return async function handler(req, res) {
    if (cors(req, res)) return;
    if (requireAuth(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const {
      request_id: requestedId,
      event_id,
      category,
      media_retention_days,
      media_pinned,
      caption,
      platforms,
      scheduledTime,
      media = [],
      expiryTime,
      profile_id,
      content_type = 'post',
    } = req.body;

    const request_id = requestedId || randomUUID();
    const problem = postProblem({ caption, platforms, content_type, media });
    if (problem) return res.status(400).json({ error: problem });
    if (!request_id || !/^[a-zA-Z0-9-]{16,80}$/.test(request_id))
      return res.status(400).json({ error: 'request_id required' });
    const { data: existing } = await sb
      .from('scheduled_posts')
      .select('id')
      .eq('request_id', request_id)
      .maybeSingle();
    if (existing) return res.status(200).json(existing);
    if (!Array.isArray(platforms) || !platforms.length)
      return res.status(400).json({ error: 'platforms required' });
    if (platforms.some((p) => !ALLOWED_PLATFORMS.has(p)))
      return res.status(400).json({ error: 'invalid platform' });
    if (!ALLOWED_CONTENT_TYPES.has(content_type))
      return res.status(400).json({ error: 'invalid content_type' });
    if (!scheduledTime || Number.isNaN(new Date(scheduledTime).getTime()))
      return res.status(400).json({ error: 'scheduledTime required' });
    if (expiryTime && Number.isNaN(new Date(expiryTime).getTime()))
      return res.status(400).json({ error: 'expiryTime invalid' });
    const mediaError = validateMedia(media);
    if (mediaError) return res.status(400).json({ error: mediaError });
    if (content_type !== 'post' && !media?.length)
      return res.status(400).json({ error: `${content_type} requires at least one media item` });
    if (content_type === 'reel' && (media.length !== 1 || !media[0].type.startsWith('video/')))
      return res.status(400).json({ error: 'reel requires exactly one video' });

    const profileId = profile_id || 'main';
    const profileIds = knownProfileIds();
    if (profileIds.size && !profileIds.has(profileId))
      return res.status(400).json({ error: 'invalid profile_id' });

    const { data, error } = await sb
      .from('scheduled_posts')
      .insert({
        request_id,
        event_id: String(event_id || '').slice(0, 256) || null,
        category: String(category || '').slice(0, 80),
        media_retention_days: Math.max(1, Math.min(365, Number(media_retention_days) || 30)),
        media_pinned: media_pinned === true,
        caption: (caption || '').trim(),
        platforms,
        media,
        content_type,
        scheduled_time: scheduledTime,
        expiry_time: expiryTime || null,
        profile_id: profileId,
      })
      .select('id')
      .single();

    if (error?.code === '23505') {
      const { data: same } = await sb
        .from('scheduled_posts')
        .select('id')
        .eq('request_id', request_id)
        .single();
      if (same) return res.status(200).json(same);
    }
    if (error) {
      console.error(JSON.stringify({ event: 'schedule_insert_error', message: error.message }));
      return res.status(500).json({ error: 'Failed to schedule post' });
    }

    return res.status(201).json({ id: data.id });
  };
}
export default createScheduleHandler();
