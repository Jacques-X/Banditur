import { createClient } from '@supabase/supabase-js';
import { cors } from '../cors.js';
import { requireAuth } from '../auth.js';
import { getCredentials } from '../_lib/profiles.js';
import { graph, verifyDelivery } from '../_lib/delivery.js';
import { validateMedia } from '../schedule.js';
import { postProblem, deliverySummary } from '../_lib/post-rules.js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

export function createPostHandler(client = sb) {
  const sb = client;
  return async function handler(req, res) {
    if (cors(req, res) || requireAuth(req, res)) return;
    const { id } = req.query;
    const { data: post } = await sb.from('scheduled_posts').select('*').eq('id', id).maybeSingle();
    if (!post) return res.status(404).json({ error: 'Il-post ma nstabx.' });
    if (req.method === 'GET') return res.status(200).json(post);
    if (!['PATCH', 'POST', 'DELETE'].includes(req.method))
      return res.status(405).json({ error: 'Method not allowed' });
    if (Number(req.body?.revision ?? post.revision) !== post.revision)
      return res.status(409).json({ error: 'Il-post inbidel. Erġa’ għabbi l-aħħar verżjoni.' });
    if (post.status === 'processing')
      return res.status(409).json({ error: 'Il-post qed jiġi ppubblikat. Stenna r-riżultat.' });
    const deliveries = structuredClone(post.deliveries || {});
    if (req.method === 'PATCH') {
      if (Object.values(deliveries).some((r) => ['published', 'unknown', 'publishing'].includes(r.state)))
        return res
          .status(409)
          .json({ error: 'Destinazzjoni diġà ppubblikata jew mhux ivverifikata. Agħmel kopja ġdida.' });
      const body = req.body;
      const next = {
        caption: body.caption ?? post.caption,
        platforms: body.platforms ?? post.platforms,
        media: body.media ?? post.media,
        content_type: body.content_type ?? post.content_type,
      };
      const problem = postProblem(next) || validateMedia(next.media);
      if (problem) return res.status(400).json({ error: problem });
      if (!Number.isFinite(Date.parse(body.scheduledTime || post.scheduled_time)))
        return res.status(400).json({ error: 'Ħin mhux validu.' });
    }
    // Compare-and-swap is shared with the worker's claim. Never mutate a post
    // remotely after an unchecked local edit.
    const { data: locked, error: lockError } = await sb
      .from('scheduled_posts')
      .update({ status: 'processing', claimed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('revision', post.revision)
      .eq('status', post.status)
      .select('id');
    if (lockError || !locked?.length)
      return res.status(409).json({ error: 'Il-post inbidel. Erġa’ għabbi l-lista.' });
    try {
      if (req.method === 'POST') {
        const platform = req.body.platform;
        if (req.body.action === 'verify') {
          if (!post.platforms.includes(platform)) throw new Error('Platform mhux valida.');
          deliveries[platform] = await verifyDelivery(
            platform,
            deliveries[platform] || {},
            getCredentials(post.profile_id),
          );
        } else {
          for (const p of post.platforms) {
            const r = deliveries[p] || { state: 'pending' };
            if (r.state === 'published' || r.state === 'scheduled') continue;
            if (['unknown', 'publishing'].includes(r.state) && req.body.acknowledge_unknown !== true)
              throw new Error('Iċċekkja Meta u kkonferma li l-post ma telax qabel terġa’ tipprova.');
            deliveries[p] = { state: 'pending' };
          }
        }
        const status = deliverySummary(post.platforms, deliveries);
        const { error } = await sb
          .from('scheduled_posts')
          .update({
            deliveries,
            status,
            error_message: null,
            claimed_at: null,
            published_at: Object.values(deliveries).some((d) => d.state === 'published')
              ? post.published_at || new Date().toISOString()
              : null,
          })
          .eq('id', id);
        if (error) throw error;
      } else {
        if (Object.values(deliveries).some((r) => ['published', 'unknown', 'publishing'].includes(r.state)))
          throw new Error('Ivverifika d-destinazzjonijiet qabel tibdel jew tħassar il-post.');
        if (deliveries.fb?.state === 'scheduled' || post.status === 'fb_native') {
          const remoteId = deliveries.fb?.id || post.fb_post_id;
          if (!remoteId) throw new Error('Ma nstabx l-identifikatur tal-post fuq Meta.');
          const creds = getCredentials(post.profile_id);
          const info = await verifyDelivery('fb', { ...deliveries.fb, id: remoteId }, creds);
          if (info.state !== 'scheduled') throw new Error('Il-post jista’ jkun diġà tela’. Iċċekkja Meta.');
          deliveries.fb = {
            ...deliveries.fb,
            id: remoteId,
            state: 'unknown',
            error: 'Il-kanċellazzjoni għadha mhix ikkonfermata.',
          };
          const { error: saveError } = await sb
            .from('scheduled_posts')
            .update({ deliveries })
            .eq('id', id)
            .eq('status', 'processing');
          if (saveError) throw saveError;
          await graph(remoteId, creds.fbToken, undefined, 'DELETE');
          deliveries.fb = { state: 'pending' };
        }
        if (req.method === 'DELETE') {
          const { error } = await sb.from('scheduled_posts').delete().eq('id', id).eq('status', 'processing');
          if (error) throw error;
          // Shared media is collected only after retention, not on post deletion.
        } else {
          const b = req.body;
          const patch = {
            media: b.media ?? post.media,
            caption: b.caption ?? post.caption,
            platforms: b.platforms ?? post.platforms,
            content_type: b.content_type ?? post.content_type,
            scheduled_time: b.scheduledTime || post.scheduled_time,
            event_id: b.event_id ?? post.event_id,
            category: String(b.category ?? post.category).slice(0, 80),
            media_retention_days: Math.max(
              1,
              Math.min(365, Number(b.media_retention_days) || post.media_retention_days),
            ),
            media_pinned: b.media_pinned ?? post.media_pinned,
            status: 'pending',
            deliveries: {},
            fb_post_id: null,
            ig_post_id: null,
            wp_post_id: null,
            error_message: null,
            claimed_at: null,
          };
          const { error } = await sb
            .from('scheduled_posts')
            .update(patch)
            .eq('id', id)
            .eq('status', 'processing');
          if (error) throw error;
        }
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      await sb
        .from('scheduled_posts')
        .update({ status: 'failed', claimed_at: null, error_message: e.message, deliveries })
        .eq('id', id)
        .eq('status', 'processing');
      return res.status(409).json({ error: e.message });
    }
  };
}
export default createPostHandler();
