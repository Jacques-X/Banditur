import { createClient } from '@supabase/supabase-js';
import { cors }          from './cors.js';
import { bearerMatches } from './auth.js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE,
);

const ALLOWED_PLATFORMS = new Set(['fb', 'ig', 'wp']);
const ALLOWED_CONTENT_TYPES = new Set(['post', 'reel', 'story']);

function knownProfileIds() {
  try {
    const profiles = JSON.parse(process.env.COMMITTEE_PROFILES || '[]');
    return new Set(profiles.map(p => p.id).filter(Boolean));
  } catch {
    return new Set();
  }
}

function validateMedia(media) {
  if (!Array.isArray(media)) return 'media must be an array';
  if (media.length > 10) return 'media cannot contain more than 10 items';

  const supabaseOrigin = process.env.SUPABASE_URL
    ? new URL(process.env.SUPABASE_URL).origin
    : null;

  for (const item of media) {
    if (!item || typeof item !== 'object') return 'media items must be objects';
    if (typeof item.url !== 'string' || typeof item.path !== 'string' || typeof item.type !== 'string')
      return 'media items require url, path, and type';
    if (!item.type.startsWith('image/') && !item.type.startsWith('video/'))
      return 'media type must be image or video';
    if (!item.path.startsWith('uploads/') || item.path.includes('..'))
      return 'media path is invalid';
    try {
      const url = new URL(item.url);
      if (url.protocol !== 'https:') return 'media url must be https';
      if (supabaseOrigin && url.origin !== supabaseOrigin)
        return 'media url must belong to the configured Supabase project';
    } catch {
      return 'media url is invalid';
    }
  }

  return null;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  if (!bearerMatches(auth, process.env.API_KEY))
    return res.status(401).json({ error: 'Unauthorized' });

  const { caption, platforms, scheduledTime, media = [], expiryTime, profile_id, content_type = 'post' } = req.body;

  if (!Array.isArray(platforms) || !platforms.length)
    return res.status(400).json({ error: 'platforms required' });
  if (platforms.some(p => !ALLOWED_PLATFORMS.has(p)))
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

  const { data, error } = await sb.from('scheduled_posts').insert({
    caption:        (caption || '').trim(),
    platforms,
    media,
    content_type,
    scheduled_time: scheduledTime,
    expiry_time:    expiryTime || null,
    profile_id:     profileId,
  }).select('id').single();

  if (error) {
    console.error(JSON.stringify({ event: 'schedule_insert_error', message: error.message }));
    return res.status(500).json({ error: 'Failed to schedule post' });
  }

  return res.status(201).json({ id: data.id });
}
