import { createClient } from '@supabase/supabase-js';
import { bearerMatches } from '../auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

const GV = 'v25.0';
const GR = `https://graph.facebook.com/${GV}`;

// ── Sub-committee profile resolver ───────────────────────────────────────────

function getCredentials(profileId) {
  let profiles = [];
  try { profiles = JSON.parse(process.env.COMMITTEE_PROFILES || '[]'); } catch {}
  // H3: Never fall back to profiles[0] — an unknown profile_id would silently
  // publish to the wrong committee's account. Throw instead so the post fails
  // with a clear error and can be corrected by an operator.
  const p = profiles.find(x => x.id === profileId);
  if (p) {
    return { fbPageId: p.fb_page_id, fbToken: p.fb_access_token, igUserId: p.ig_user_id };
  }
  throw new Error(`Unknown profile_id '${profileId}' — add it to COMMITTEE_PROFILES`);
}

// ── Transient error retry with exponential back-off ──────────────────────────

function isTransientError(err) {
  const m = (err.message ?? '').toLowerCase();
  return m.includes('timeout') || m.includes('rate limit') || m.includes('fetch failed')
      || m.includes('econnreset') || m.includes('429') || m.includes('503')
      || m.includes('network') || m.includes('socket');
}

async function publishWithRetry(fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === attempts - 1 || !isTransientError(err)) throw err;
      await new Promise(r => setTimeout(r, (1 << i) * 1000)); // 1s, 2s, 4s
    }
  }
}

// ── IG container polling ──────────────────────────────────────────────────────
// Instagram processes video asynchronously; we must poll before publishing.

// C2: Timeout reduced from 90 s to 20 s. A single IG reel was enough to blow
// Vercel Hobby's 60 s cap; combined with C1's stale-row recovery the post will
// be retried on the next cron tick rather than getting permanently stuck.
async function waitForIgContainer(containerId, tok, maxMs = 20_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const r = await fetch(`${GR}/${containerId}?fields=status_code,status&access_token=${tok}`);
    const j = await r.json();
    if (j.status_code === 'FINISHED') return;
    if (j.status_code === 'ERROR') throw new Error(`IG container error: ${j.status}`);
  }
  throw new Error('IG container timed out — will retry on next cron tick');
}

async function igPublish(containerId, igUserId, tok) {
  const r = await fetch(`${GR}/${igUserId}/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ creation_id: containerId, access_token: tok }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.id ?? null;
}

// ── Facebook publishers ───────────────────────────────────────────────────────

async function fbUploadCarouselChildren(base, media, tok) {
  return Promise.all(media.map(async m => {
    const r = await fetch(`${base}/photos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: m.url, published: false, access_token: tok }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return { media_fbid: j.id };
  }));
}

async function fbPost(post, creds) {
  const { fbPageId: pageId, fbToken: tok } = creds;
  const base  = `${GR}/${pageId}`;
  const media = post.media || [];

  if (media.length === 0) {
    const r = await fetch(`${base}/feed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: post.caption, access_token: tok }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.id ?? null;
  }

  if (media[0].type?.startsWith('video/')) {
    const r = await fetch(`${base}/videos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: post.caption, file_url: media[0].url, access_token: tok }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.id ?? null;
  }

  if (media.length === 1) {
    const r = await fetch(`${base}/photos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: post.caption, url: media[0].url, access_token: tok }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.post_id ?? j.id ?? null;
  }

  // Carousel
  const ids = await fbUploadCarouselChildren(base, media, tok);
  const r = await fetch(`${base}/feed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: post.caption, attached_media: ids, access_token: tok }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.id ?? null;
}

async function fbReel(post, creds) {
  // P2-10: this posts to /videos, which publishes a normal Page video, NOT a
  // true Reel. Real FB Reels use the resumable /video_reels (start→upload→finish)
  // flow. Left as-is to avoid breaking the working pipeline; revisit with live
  // FB testing if Reels must appear in the Reels surface.
  const { fbPageId: pageId, fbToken: tok } = creds;
  const media = post.media || [];
  if (!media.length) throw new Error('Reel requires a video');
  const r = await fetch(`${GR}/${pageId}/videos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_url:     media[0].url,
      description:  post.caption || '',
      access_token: tok,
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.id ?? null;
}

async function fbStory(post, creds) {
  const { fbPageId: pageId, fbToken: tok } = creds;
  const media = post.media || [];
  if (!media.length) throw new Error('Story requires media');

  if (media[0].type?.startsWith('video/')) {
    // Video stories require a resumable upload; fall back to video post
    return fbReel(post, creds);
  }

  const r = await fetch(`${GR}/${pageId}/photo_stories`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: media[0].url, access_token: tok }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.post_id ?? j.id ?? null;
}

// ── Instagram publishers ──────────────────────────────────────────────────────

async function igPost(post, creds) {
  const { fbToken: tok, igUserId } = creds;
  const media = post.media || [];
  if (!media.length) return null;

  // Single image — M2: poll container before publishing (not just for reels)
  if (media.length === 1 && media[0].type?.startsWith('image/')) {
    const cr = await fetch(`${GR}/${igUserId}/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: media[0].url, caption: post.caption, access_token: tok }),
    });
    const { id, error } = await cr.json();
    if (error) throw new Error(error.message);
    await waitForIgContainer(id, tok);
    return igPublish(id, igUserId, tok);
  }

  // Single video → IG treats all videos as Reels on the feed
  if (media.length === 1 && media[0].type?.startsWith('video/')) {
    return igReel(post, creds);
  }

  // Carousel (images only) — M2: poll carousel container before publishing.
  // P2-12: also poll each child container; a child that isn't FINISHED yet makes
  // the parent CAROUSEL container fail intermittently with large images.
  const childIds = await Promise.all(media.map(async m => {
    const r = await fetch(`${GR}/${igUserId}/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: m.url, is_carousel_item: true, access_token: tok }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    await waitForIgContainer(j.id, tok);
    return j.id;
  }));
  const cr = await fetch(`${GR}/${igUserId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'CAROUSEL', children: childIds.join(','),
      caption: post.caption, access_token: tok,
    }),
  });
  const { id, error } = await cr.json();
  if (error) throw new Error(error.message);
  await waitForIgContainer(id, tok);
  return igPublish(id, igUserId, tok);
}

async function igReel(post, creds) {
  const { fbToken: tok, igUserId } = creds;
  const media = post.media || [];
  if (!media.length) throw new Error('Reel requires a video');
  const cr = await fetch(`${GR}/${igUserId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS', video_url: media[0].url,
      caption: post.caption || '', access_token: tok,
    }),
  });
  const { id, error } = await cr.json();
  if (error) throw new Error(error.message);
  await waitForIgContainer(id, tok);
  return igPublish(id, igUserId, tok);
}

async function igStory(post, creds) {
  const { fbToken: tok, igUserId } = creds;
  const media = post.media || [];
  if (!media.length) throw new Error('Story requires media');

  const isVideo = media[0].type?.startsWith('video/');
  const body = isVideo
    ? { media_type: 'STORIES', video_url:  media[0].url, access_token: tok }
    : { media_type: 'STORIES', image_url:  media[0].url, access_token: tok };

  const cr = await fetch(`${GR}/${igUserId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const { id, error } = await cr.json();
  if (error) throw new Error(error.message);
  if (isVideo) await waitForIgContainer(id, tok);
  return igPublish(id, igUserId, tok);
}

// ── WordPress publisher ───────────────────────────────────────────────────────

async function publishWordPress(post) {
  const wpUrl = process.env.WP_URL;
  const creds = Buffer.from(`${process.env.WP_USER}:${process.env.WP_APP_PASSWORD}`).toString('base64');
  const media = post.media || [];

  const mediaIds = [];
  for (const m of media) {
    if (!m.type?.startsWith('image/')) continue;
    const imgBuf = await (await fetch(m.url)).arrayBuffer();
    const ext    = (m.url.split('.').pop().split('?')[0] || 'jpg').toLowerCase();
    const r = await fetch(`${wpUrl}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        'Authorization':     `Basic ${creds}`,
        'Content-Type':      `image/${ext}`,
        'Content-Disposition': `attachment; filename="upload.${ext}"`,
      },
      body: imgBuf,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`WP media: ${j.message}`);
    mediaIds.push(j.id);
  }

  const body = {
    title:   (post.caption || '').split('\n')[0].slice(0, 100),
    content: post.caption || '',
    status:  'publish',
    ...(mediaIds.length ? { featured_media: mediaIds[0] } : {}),
    ...(post.expiry_time ? { meta: { _expiration_date: post.expiry_time } } : {}),
  };

  const r = await fetch(`${wpUrl}/wp-json/wp/v2/posts`, {
    method:  'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`WP post: ${j.message}`);
  return j.id ? String(j.id) : null;
}

async function claimPost(id, expectedStatus) {
  const { data, error } = await sb
    .rpc('claim_scheduled_post', {
      p_id: id,
      p_expected_status: expectedStatus,
    });

  if (error || !data?.length) return null;
  return data[0];
}

// ── Facebook native scheduler ─────────────────────────────────────────────────
// Hands a future post to Facebook's built-in scheduler (max 30 days ahead).
// Stories cannot be natively scheduled (ephemeral), so callers must skip them.

async function fbNativeSchedule(post, creds) {
  const { fbPageId: pageId, fbToken: tok } = creds;
  const base        = `${GR}/${pageId}`;
  const media       = post.media || [];
  const scheduledTs = Math.floor(new Date(post.scheduled_time).getTime() / 1000);

  if (post.content_type === 'reel' || media[0]?.type?.startsWith('video/')) {
    const r = await fetch(`${base}/videos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_url:               media[0]?.url,
        description:            post.caption || '',
        published:              false,
        scheduled_publish_time: scheduledTs,
        access_token:           tok,
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.id ?? null;
  }

  if (media.length === 0) {
    const r = await fetch(`${base}/feed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:                post.caption,
        published:              false,
        scheduled_publish_time: scheduledTs,
        access_token:           tok,
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.id ?? null;
  }

  if (media.length === 1) {
    const r = await fetch(`${base}/photos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caption:                post.caption,
        url:                    media[0].url,
        published:              false,
        scheduled_publish_time: scheduledTs,
        access_token:           tok,
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.post_id ?? j.id ?? null;
  }

  // Carousel — upload children unpublished, then schedule the album
  const ids = await fbUploadCarouselChildren(base, media, tok);
  const r = await fetch(`${base}/feed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message:                post.caption,
      attached_media:         ids,
      published:              false,
      scheduled_publish_time: scheduledTs,
      access_token:           tok,
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.id ?? null;
}

// ── Publisher router ──────────────────────────────────────────────────────────

async function publishFacebook(post, creds) {
  switch (post.content_type) {
    case 'reel':  return fbReel(post, creds);
    case 'story': return fbStory(post, creds);
    default:      return fbPost(post, creds);
  }
}

async function publishInstagram(post, creds) {
  switch (post.content_type) {
    case 'reel':  return igReel(post, creds);
    case 'story': return igStory(post, creds);
    default:      return igPost(post, creds);
  }
}

// ── Analytics batch refresh ───────────────────────────────────────────────────

async function refreshEngagement() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: posts } = await sb
    .from('scheduled_posts')
    .select('id, fb_post_id, ig_post_id, profile_id')
    .eq('status', 'published')
    .gte('published_at', weekAgo)
    .or('fb_post_id.not.is.null,ig_post_id.not.is.null');

  await Promise.allSettled((posts ?? []).map(async post => {
    const { fbToken } = getCredentials(post.profile_id);
    let likes = 0, comments = 0;
    if (post.fb_post_id) {
      const r = await fetch(
        `${GR}/${post.fb_post_id}?fields=likes.summary(true),comments.summary(true)&access_token=${fbToken}`
      );
      const j = await r.json();
      likes    += j.likes?.summary?.total_count    ?? 0;
      comments += j.comments?.summary?.total_count ?? 0;
    }
    if (post.ig_post_id) {
      const r = await fetch(
        `${GR}/${post.ig_post_id}?fields=like_count,comments_count&access_token=${fbToken}`
      );
      const j = await r.json();
      likes    += j.like_count     ?? 0;
      comments += j.comments_count ?? 0;
    }
    await sb.from('scheduled_posts')
      .update({ likes_count: likes, comments_count: comments })
      .eq('id', post.id);
  }));
}

async function cleanupOrphanMedia() {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const referenced = new Set();

  const { data: posts } = await sb
    .from('scheduled_posts')
    .select('media')
    .not('media', 'is', null);

  for (const post of posts ?? []) {
    for (const media of post.media ?? []) {
      if (media?.path) referenced.add(media.path);
    }
  }

  const bucket = sb.storage.from('media');
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

// ── Cron handler ──────────────────────────────────────────────────────────────
// C2: maxDuration tells Vercel the function needs up to 30 s (Hobby cap is 60 s).
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization || '';
  // H2: Cron accepts CRON_SECRET only — not the shared API_KEY.
  if (!bearerMatches(auth, process.env.CRON_SECRET)) return res.status(401).end();

  const now   = new Date();
  const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // ── Step 0: C1 — recover rows that got stuck in 'processing' ─────────────────
  // A function crash or Vercel timeout leaves rows in 'processing' indefinitely.
  // Reset any row claimed more than 10 minutes ago back to 'pending' so it can
  // be retried. Idempotency is mostly covered: fb_post_id/ig_post_id are persisted
  // and the publish loop skips already-populated IDs.
  await sb
    .from('scheduled_posts')
    .update({ status: 'pending', claimed_at: null })
    .eq('status', 'processing')
    .lt('claimed_at', new Date(now.getTime() - 10 * 60 * 1000).toISOString());

  // ── Step 1: Hand off upcoming FB posts to Facebook's native scheduler ────────
  // Find pending posts that are in the future but within FB's 30-day window.
  const { data: upcoming } = await sb
    .from('scheduled_posts')
    .select('*')
    .eq('status', 'pending')
    .gt('scheduled_time',  now.toISOString())
    .lte('scheduled_time', in30d.toISOString());

  for (const post of (upcoming ?? []).filter(p => p.platforms?.includes('fb') && p.content_type !== 'story')) {
    const claimedPost = await claimPost(post.id, 'pending');
    if (!claimedPost) continue;

    const creds = getCredentials(claimedPost.profile_id);
    try {
      const fbPostId = claimedPost.fb_post_id || await fbNativeSchedule(claimedPost, creds);
      await sb.from('scheduled_posts').update({
        status: 'fb_native',
        ...(fbPostId ? { fb_post_id: fbPostId } : {}),
      }).eq('id', claimedPost.id);
    } catch (err) {
      await sb.from('scheduled_posts').update({
        status:        'failed',
        error_message: `fb_native: ${err.message}`,
      }).eq('id', claimedPost.id);
    }
  }

  // ── Step 2: Publish posts that are now due ────────────────────────────────────
  // Includes both plain-pending and fb_native (FB already handled; run IG + WP).
  // C2: Process at most 5 posts per invocation to stay well within Vercel's
  // execution time limit. Remaining posts are picked up on the next cron tick.
  const { data: posts, error: fetchErr } = await sb
    .from('scheduled_posts')
    .select('*')
    .in('status', ['pending', 'fb_native'])
    .lte('scheduled_time', now.toISOString())
    .order('scheduled_time')
    .limit(5);

  if (fetchErr) {
    console.error(JSON.stringify({ event: 'cron_fetch_error', message: fetchErr.message }));
    return res.status(500).json({ error: 'Failed to fetch due posts' });
  }

  const results = [];

  // P1-4: stop claiming new posts once we're within ~12 s of the maxDuration
  // budget. A single IG container poll can take 20 s, so without this a batch of
  // IG posts can blow past Vercel's limit and get killed mid-update. Remaining
  // posts are picked up on the next cron tick (stuck rows are recovered in Step 0).
  const BUDGET_MS = 30_000 - 12_000;
  const cronStart = Date.now();

  for (const row of posts ?? []) {
    if (Date.now() - cronStart > BUDGET_MS) break;
    const originalStatus = row.status;

    const claimedPost = await claimPost(row.id, originalStatus);
    if (!claimedPost) continue;
    const post = claimedPost;

    const creds      = getCredentials(post.profile_id);
    const isFbNative = originalStatus === 'fb_native';
    const errors     = [];
    let fbPostId     = post.fb_post_id ?? null;
    let igPostId     = post.ig_post_id ?? null;
    let wpPostId     = post.wp_post_id ?? null;
    const t0         = Date.now();

    for (const platform of post.platforms) {
      try {
        // FB already scheduled natively — skip to avoid double-posting
        if (platform === 'fb' && fbPostId) continue;
        if (platform === 'ig' && igPostId) continue;
        if (platform === 'wp' && wpPostId) continue;
        if (platform === 'fb' && !isFbNative)
          fbPostId = await publishWithRetry(() => publishFacebook(post, creds));
        if (platform === 'ig')
          igPostId = await publishWithRetry(() => publishInstagram(post, creds));
        if (platform === 'wp')
          wpPostId = await publishWithRetry(() => publishWordPress(post));
      } catch (err) {
        errors.push(`${platform}: ${err.message}`);
      }
    }

    const succeeded = errors.length === 0;

    await sb.from('scheduled_posts').update({
      status:        succeeded ? 'published' : 'failed',
      error_message: succeeded ? null        : errors.join(' | '),
      published_at:  succeeded ? new Date().toISOString() : null,
      ...(fbPostId ? { fb_post_id: fbPostId } : {}),
      ...(igPostId ? { ig_post_id: igPostId } : {}),
      ...(wpPostId ? { wp_post_id: wpPostId } : {}),
    }).eq('id', post.id);

    if (succeeded) {
      const paths = (post.media || []).map(m => m.path).filter(Boolean);
      if (paths.length) await sb.storage.from('media').remove(paths);
    }

    console.log(JSON.stringify({
      event: 'post_processed', post_id: post.id,
      platforms: post.platforms, succeeded, duration_ms: Date.now() - t0,
      ...(succeeded ? {} : { errors }),
    }));

    results.push({ id: post.id, succeeded, errors, fb_native: isFbNative });
  }

  // M1: Await both tasks before responding. Vercel freezes the lambda after the
  // response is sent, so fire-and-forget work silently never completes.
  await Promise.allSettled([refreshEngagement(), cleanupOrphanMedia()]);

  return res.status(200).json({ processed: results.length, results });
}
