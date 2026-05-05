import { createClient } from '@supabase/supabase-js';
import { cors } from './cors.js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE,
);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`)
    return res.status(401).json({ error: 'Unauthorized' });

  const page   = Math.max(1, parseInt(req.query.page  || '1'));
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit || '50')));
  const offset = (page - 1) * limit;
  const status = req.query.status || 'all';
  const search = (req.query.search || '').trim();

  let query = sb
    .from('scheduled_posts')
    .select(
      'id, caption, platforms, content_type, media, scheduled_time, status, error_message, published_at, profile_id',
      { count: 'exact' }
    );

  if (status !== 'all') query = query.eq('status', status);
  if (search)           query = query.ilike('caption', `%${search}%`);

  const { data, count, error } = await query
    .order('scheduled_time', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return res.status(500).json({ error: error.message });

  const { count: pendingCount } = await sb
    .from('scheduled_posts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  return res.status(200).json({ posts: data, total: count ?? 0, pending: pendingCount ?? 0 });
}
