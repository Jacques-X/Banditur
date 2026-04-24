import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE,
);

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`)
    return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.query;

  // Only allow deleting posts that haven't started processing
  const { data: post, error: fetchErr } = await sb
    .from('scheduled_posts')
    .select('id, status, media')
    .eq('id', id)
    .single();

  if (fetchErr || !post) return res.status(404).json({ error: 'Not found' });
  if (post.status !== 'pending')
    return res.status(409).json({ error: `Cannot delete a post with status '${post.status}'` });

  // Delete Supabase Storage objects for this post
  const paths = (post.media || []).map(m => m.path).filter(Boolean);
  if (paths.length) {
    await sb.storage.from('media').remove(paths);
  }

  const { error: delErr } = await sb.from('scheduled_posts').delete().eq('id', id);
  if (delErr) return res.status(500).json({ error: delErr.message });

  return res.status(204).end();
}
