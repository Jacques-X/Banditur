import { createClient } from '@supabase/supabase-js';
import { requireCronAuth } from '../auth.js';
import { getCredentials } from '../_lib/profiles.js';
import { advanceDelivery } from '../_lib/delivery.js';
import { deliverySummary } from '../_lib/post-rules.js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);
const GR = 'https://graph.facebook.com/v25.0';

async function refreshEngagement() {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: posts, error } = await sb
    .from('scheduled_posts')
    .select('id,fb_post_id,ig_post_id,profile_id,deliveries')
    .in('status', ['published', 'failed', 'pending', 'fb_native'])
    .gte('published_at', weekAgo)
    .or('fb_post_id.not.is.null,ig_post_id.not.is.null');
  if (error) throw error;
  await Promise.allSettled(
    (posts || []).map(async (post) => {
      try {
        const { fbToken } = getCredentials(post.profile_id);
        let likes = 0,
          comments = 0,
          measured = 0;
        for (const platform of ['fb', 'ig']) {
          const id = post[platform + '_post_id'];
          if (
            !id ||
            (Object.keys(post.deliveries || {}).length && post.deliveries[platform]?.state !== 'published')
          )
            continue;
          const fields =
            platform === 'fb' ? 'likes.summary(true),comments.summary(true)' : 'like_count,comments_count';
          const response = await fetch(`${GR}/${id}?fields=${fields}&access_token=${fbToken}`, {
            signal: AbortSignal.timeout(8000),
          });
          const j = await response.json();
          const l = platform === 'fb' ? j.likes?.summary?.total_count : j.like_count;
          const c = platform === 'fb' ? j.comments?.summary?.total_count : j.comments_count;
          if (j.error || !Number.isFinite(l) || !Number.isFinite(c))
            throw new Error(j.error?.message || 'Engagement unavailable');
          likes += l;
          comments += c;
          measured++;
        }
        if (measured)
          await sb
            .from('scheduled_posts')
            .update({
              likes_count: likes,
              comments_count: comments,
              engagement_checked_at: new Date().toISOString(),
              engagement_error: null,
            })
            .eq('id', post.id);
      } catch (e) {
        await sb.from('scheduled_posts').update({ engagement_error: e.message }).eq('id', post.id);
      }
    }),
  );
}

export async function cleanupOrphanMedia(client = sb) {
  const cutoffMs = Date.now() - 86400000,
    referenced = new Set(),
    now = Date.now();
  // Never collect from an incomplete reference set: Supabase caps each page.
  for (let offset = 0; ; offset += 1000) {
    const { data: posts, error } = await client
      .from('scheduled_posts')
      .select('media,status,published_at,media_retention_days,media_pinned')
      .not('media', 'is', null)
      .order('id')
      .range(offset, offset + 999);
    if (error || !posts) throw new Error('Failed to read media references; cleanup skipped');
    for (const post of posts) {
      const keep =
        post.media_pinned ||
        post.status !== 'published' ||
        !post.published_at ||
        Date.parse(post.published_at) + (post.media_retention_days || 30) * 86400000 > now;
      if (keep) for (const media of post.media || []) if (media?.path) referenced.add(media.path);
    }
    if (posts.length < 1000) break;
  }
  const bucket = client.storage.from('media');
  const stale = [];
  let offset = 0;

  while (true) {
    const { data: files, error } = await bucket.list('uploads', {
      limit: 1000,
      offset,
      sortBy: { column: 'created_at', order: 'asc' },
    });
    if (error || !files?.length) break;

    for (const file of files) {
      const path = `uploads/${file.name}`;
      const ts = new Date(file.created_at || file.updated_at || 0).getTime();
      if (!referenced.has(path) && ts && ts < cutoffMs) stale.push(path);
    }

    if (files.length < 1000) break;
    offset += files.length;
  }

  for (let i = 0; i < stale.length; i += 100) {
    await bucket.remove(stale.slice(i, i + 100));
  }

  if (stale.length) {
    console.log(JSON.stringify({ event: 'orphan_media_cleanup', removed: stale.length }));
  }
}

export const config = { maxDuration: 30 };
export function createWorkerHandler(client = sb) {
  const sb = client;
  return async function handler(req, res) {
    if (requireCronAuth(req, res)) return;
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    const now = new Date(),
      deadline = Date.now() + 16000;
    // The ledger survives stale row recovery. A saved publishing boundary becomes
    // unknown in advanceDelivery; it is never automatically submitted twice.
    await sb
      .from('scheduled_posts')
      .update({ status: 'pending', claimed_at: null })
      .eq('status', 'processing')
      .lt('claimed_at', new Date(Date.now() - 10 * 60000).toISOString());
    const { data: rows, error } = await sb
      .from('scheduled_posts')
      .select('*')
      .in('status', ['pending', 'fb_native'])
      .or(`status.eq.pending,and(status.eq.fb_native,scheduled_time.lte.${now.toISOString()})`)
      .lte('scheduled_time', new Date(Date.now() + 30 * 86400000).toISOString())
      .order('scheduled_time')
      .limit(30);
    if (error) return res.status(500).json({ error: 'Failed to read publishing queue' });
    const results = [];
    for (const row of rows || []) {
      if (Date.now() > deadline || results.length >= 5) break;
      const due = Date.parse(row.scheduled_time) <= now.getTime();
      if (
        !due &&
        (!row.platforms.includes('fb') ||
          row.content_type !== 'post' ||
          Date.parse(row.scheduled_time) < Date.now() + 10 * 60000)
      )
        continue;
      const { data } = await sb.rpc('claim_scheduled_post', { p_id: row.id, p_expected_status: row.status });
      if (!data?.length) continue;
      const post = data[0],
        deliveries = { ...post.deliveries };
      async function save(platform, record) {
        deliveries[platform] = record;
        const patch = {
          deliveries,
          ...(record.id
            ? { [{ fb: 'fb_post_id', ig: 'ig_post_id', wp: 'wp_post_id' }[platform]]: record.id }
            : {}),
        };
        const { error } = await sb
          .from('scheduled_posts')
          .update(patch)
          .eq('id', post.id)
          .eq('status', 'processing');
        if (error) throw new Error('Ma setax jinżamm l-istat tal-pubblikazzjoni.');
      }
      try {
        const creds = getCredentials(post.profile_id);
        for (const platform of post.platforms) {
          if (Date.now() > deadline || (!due && platform !== 'fb')) break;
          let record = deliveries[platform] || { state: 'pending' };
          if (record.state === 'published' || record.state === 'failed' || record.state === 'unknown')
            continue;
          try {
            for (let step = 0; step < 16 && Date.now() < deadline; step++) {
              const before = JSON.stringify(record);
              record = await advanceDelivery(platform, post, creds, record, (r) => save(platform, r));
              await save(platform, record);
              if (
                record.state !== 'preparing' ||
                JSON.stringify(record) === before ||
                record.retry_after > Date.now()
              )
                break;
            }
          } catch (e) {
            record = e.delivery || {
              ...record,
              state: e.retryable ? 'preparing' : 'failed',
              error: e.message,
              ...(e.retryable ? { retry_after: Date.now() + 60000 } : {}),
            };
          }
          await save(platform, record);
        }
        const status = deliverySummary(post.platforms, deliveries);
        const error_message =
          Object.entries(deliveries)
            .filter(([, r]) => r.error)
            .map(([p, r]) => `${p}: ${r.error}`)
            .join(' | ') || null;
        const { error } = await sb
          .from('scheduled_posts')
          .update({
            status,
            deliveries,
            error_message,
            claimed_at: null,
            published_at: Object.values(deliveries).some((d) => d.state === 'published')
              ? post.published_at || new Date().toISOString()
              : null,
          })
          .eq('id', post.id)
          .eq('status', 'processing');
        if (error) throw error;
        results.push({ id: post.id, status });
      } catch (e) {
        await sb
          .from('scheduled_posts')
          .update({ status: 'failed', deliveries, claimed_at: null, error_message: e.message })
          .eq('id', post.id)
          .eq('status', 'processing');
        results.push({ id: post.id, status: 'failed' });
      }
    }
    // Keep publishing inside the budget; maintenance has its own daily invocation.
    if (req.method === 'GET') {
      try {
        await refreshEngagement();
        await cleanupOrphanMedia();
      } catch (e) {
        console.error(JSON.stringify({ event: 'maintenance_failed', message: e.message }));
      }
    }
    return res.status(200).json({ results, checked_at: new Date().toISOString() });
  };
}
export default createWorkerHandler();
