import { createClient } from '@supabase/supabase-js';
import { cors }          from '../cors.js';
import { requireAuth }   from '../auth.js';
import { getCredentials } from '../_lib/profiles.js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE,
);

const GV = 'v25.0';
const GR = `https://graph.facebook.com/${GV}`;

// BUG-2: previously there was no way to stop a post once it had been handed
// off to Facebook's native scheduler (status 'fb_native') — DELETE only
// worked on 'pending' rows. Facebook allows deleting a page post that's still
// unpublished (published: false, scheduled_publish_time in the future) via a
// normal DELETE /{post-id} call with the page token, so we can cancel it the
// same way the cron job created it.
async function cancelFbNative(post) {
  if (!post.fb_post_id) return; // never actually got scheduled on FB's side
  const { fbToken } = getCredentials(post.profile_id);
  const r = await fetch(`${GR}/${post.fb_post_id}?access_token=${fbToken}`, { method: 'DELETE' });
  const j = await r.json().catch(() => ({}));
  if (j.error) {
    // "already published" / "not found" are fine to treat as already-gone;
    // anything else should block the delete so the operator knows FB still
    // has a live scheduled post they need to handle manually.
    const code = j.error.code;
    const alreadyGone = code === 100 || code === 803 || /does not exist|cannot be found/i.test(j.error.message || '');
    if (!alreadyGone) throw new Error(`Facebook: ${j.error.message}`);
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (requireAuth(req, res)) return;

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

    if (error) {
      console.error(JSON.stringify({ event: 'retry_update_error', message: error.message }));
      return res.status(500).json({ error: 'Failed to reset post status' });
    }
    return res.status(200).json({ ok: true });
  }

  // ── DELETE /api/posts/:id  →  delete/cancel a pending or fb_native post ──
  if (req.method === 'DELETE') {
    const { data: post, error: fetchErr } = await sb
      .from('scheduled_posts')
      .select('id, status, media, fb_post_id, profile_id')
      .eq('id', id)
      .single();

    if (fetchErr || !post) return res.status(404).json({ error: 'Not found' });
    if (post.status !== 'pending' && post.status !== 'fb_native')
      return res.status(409).json({ error: `Cannot delete a post with status '${post.status}'` });

    // BUG-2: a natively-scheduled post needs to be cancelled on Facebook's side
    // first — otherwise it still fires even though our own row is gone.
    if (post.status === 'fb_native') {
      try {
        await cancelFbNative(post);
      } catch (err) {
        console.error(JSON.stringify({ event: 'fb_native_cancel_error', message: err.message }));
        return res.status(502).json({
          error: `Couldn't cancel the post on Facebook: ${err.message}. It has not been deleted here — check Meta Business Suite before retrying.`,
        });
      }
    }

    // Delete Supabase Storage objects for this post
    const paths = (post.media || []).map(m => m.path).filter(Boolean);
    if (paths.length) {
      await sb.storage.from('media').remove(paths);
    }

    const { error: delErr } = await sb.from('scheduled_posts').delete().eq('id', id);
    if (delErr) {
      console.error(JSON.stringify({ event: 'delete_error', message: delErr.message }));
      return res.status(500).json({ error: 'Failed to delete post' });
    }
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
