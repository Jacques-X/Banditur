import { createClient } from '@supabase/supabase-js';
import { cors } from '../cors.js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE,
);

export default async function handler(req, res) {
  if (cors(req, res)) return;

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`)
    return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.query;

  // ── POST /api/posts/:id  →  retry a failed post ───────────────────────────
  if (req.method === 'POST') {
    const { data: post, error: fetchErr } = await sb
      .from('scheduled_posts')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchErr || !post) return res.status(404).json({ error: 'Not found' });
    if (post.status !== 'failed')
      return res.status(409).json({ error: `Cannot retry a post with status '${post.status}'` });

    const { error } = await sb
      .from('scheduled_posts')
      .update({ status: 'pending', error_message: null })
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE /api/posts/:id  →  delete a pending post ──────────────────────
  if (req.method === 'DELETE') {
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

  return res.status(405).json({ error: 'Method not allowed' });
}
