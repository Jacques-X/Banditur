import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE,
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`)
    return res.status(401).json({ error: 'Unauthorized' });

  const { caption, platforms, scheduledTime, media = [], expiryTime, profile_id, content_type = 'post' } = req.body;

  if (!platforms?.length)    return res.status(400).json({ error: 'platforms required' });
  if (!scheduledTime)        return res.status(400).json({ error: 'scheduledTime required' });
  if (content_type !== 'post' && !media?.length)
    return res.status(400).json({ error: `${content_type} requires at least one media item` });

  const { data, error } = await sb.from('scheduled_posts').insert({
    caption:        (caption || '').trim(),
    platforms,
    media,
    content_type,
    scheduled_time: scheduledTime,
    expiry_time:    expiryTime || null,
    profile_id:     profile_id || 'main',
  }).select('id').single();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(201).json({ id: data.id });
}
