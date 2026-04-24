import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE,
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`)
    return res.status(401).json({ error: 'Unauthorized' });

  const { data, error } = await sb
    .from('scheduled_posts')
    .select('id, caption, platforms, scheduled_time, status, error_message, published_at, profile_id')
    .order('scheduled_time', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json(data);
}
