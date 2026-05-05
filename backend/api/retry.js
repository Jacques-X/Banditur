import { createClient } from '@supabase/supabase-js';
import { cors } from './cors.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`) return res.status(401).end();

  const { post_id } = req.body;
  if (!post_id) return res.status(400).json({ error: 'post_id required' });

  const { data: post, error: fetchErr } = await sb
    .from('scheduled_posts')
    .select('id, status')
    .eq('id', post_id)
    .single();

  if (fetchErr || !post) return res.status(404).json({ error: 'Not found' });
  if (post.status !== 'failed')
    return res.status(409).json({ error: `Cannot retry a post with status '${post.status}'` });

  const { error } = await sb
    .from('scheduled_posts')
    .update({ status: 'pending', error_message: null })
    .eq('id', post_id);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true });
}
