import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

const GV = 'v25.0';
const GR = `https://graph.facebook.com/${GV}`;

// ── Sub-committee profile resolver ───────────────────────────────────────────

function getCredentials(profileId) {
  let profiles = [];
  try { profiles = JSON.parse(process.env.COMMITTEE_PROFILES || '[]'); } catch {}
  const p = profiles.find(x => x.id === profileId) ?? profiles[0];
  if (p) {
    return { fbPageId: p.fb_page_id, fbToken: p.fb_access_token, igUserId: p.ig_user_id };
  }
  return {
    fbPageId: process.env.FB_PAGE_ID,
    fbToken:  process.env.FB_ACCESS_TOKEN,
    igUserId: process.env.IG_USER_ID,
  };
}

// ── IG container polling ──────────────────────────────────────────────────────
// Instagram processes video asynchronously; we must poll before publishing.

async function waitForIgContainer(containerId, tok, maxMs = 90_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    const r = await fetch(`${GR}/${containerId}?fields=status_code,status&access_token=${tok}`);
    const j = await r.json();
    if (j.status_code === 'FINISHED') return;
    if (j.status_code === 'ERROR') throw new Error(`IG container error: ${j.status}`);
  }
  throw new Error('IG container timed out after 90s');
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

  // Single image
  if (media.length === 1 && media[0].type?.startsWith('image/')) {
    const cr = await fetch(`${GR}/${igUserId}/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: media[0].url, caption: post.caption, access_token: tok }),
    });
    const { id, error } = await cr.json();
    if (error) throw new Error(error.message);
    return igPublish(id, igUserId, tok);
  }

  // Single video → IG treats all videos as Reels on the feed
  if (media.length === 1 && media[0].type?.startsWith('video/')) {
    return igReel(post, creds);
  }

  // Carousel (images only)
  const childIds = await Promise.all(media.map(async m => {
    const r = await fetch(`${GR}/${igUserId}/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: m.url, is_carousel_item: true, access_token: tok }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
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

// ── Cron handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization || '';
  if (
    auth !== `Bearer ${process.env.CRON_SECRET}` &&
    auth !== `Bearer ${process.env.API_KEY}`
  ) return res.status(401).end();

  const now   = new Date();
  const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // ── Step 1: Hand off upcoming FB posts to Facebook's native scheduler ────────
  // Find pending posts that are in the future but within FB's 30-day window.
  const { data: upcoming } = await sb
    .from('scheduled_posts')
    .select('*')
    .eq('status', 'pending')
    .gt('scheduled_time',  now.toISOString())
    .lte('scheduled_time', in30d.toISOString());

  for (const post of (upcoming ?? []).filter(p => p.platforms?.includes('fb') && p.content_type !== 'story')) {
    const { error: lockErr } = await sb
      .from('scheduled_posts')
      .update({ status: 'processing' })
      .eq('id', post.id)
      .eq('status', 'pending');
    if (lockErr) continue;

    const creds = getCredentials(post.profile_id);
    try {
      const fbPostId = await fbNativeSchedule(post, creds);
      await sb.from('scheduled_posts').update({
        status: 'fb_native',
        ...(fbPostId ? { fb_post_id: fbPostId } : {}),
      }).eq('id', post.id);
    } catch (err) {
      await sb.from('scheduled_posts').update({
        status:        'failed',
        error_message: `fb_native: ${err.message}`,
      }).eq('id', post.id);
    }
  }

  // ── Step 2: Publish posts that are now due ────────────────────────────────────
  // Includes both plain-pending and fb_native (FB already handled; run IG + WP).
  const { data: posts, error: fetchErr } = await sb
    .from('scheduled_posts')
    .select('*')
    .in('status', ['pending', 'fb_native'])
    .lte('scheduled_time', now.toISOString())
    .order('scheduled_time')
    .limit(50);

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const results = [];

  for (const post of posts ?? []) {
    const originalStatus = post.status;

    const { error: lockErr } = await sb
      .from('scheduled_posts')
      .update({ status: 'processing' })
      .eq('id', post.id)
      .eq('status', originalStatus);
    if (lockErr) continue;

    const creds      = getCredentials(post.profile_id);
    const isFbNative = originalStatus === 'fb_native';
    const errors     = [];
    let fbPostId     = isFbNative ? post.fb_post_id : null;
    let igPostId     = null;

    for (const platform of post.platforms) {
      try {
        // FB already scheduled natively — skip to avoid double-posting
        if (platform === 'fb' && !isFbNative) fbPostId = await publishFacebook(post, creds);
        if (platform === 'ig') igPostId = await publishInstagram(post, creds);
        if (platform === 'wp') await publishWordPress(post);
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
    }).eq('id', post.id);

    if (succeeded) {
      const paths = (post.media || []).map(m => m.path).filter(Boolean);
      if (paths.length) await sb.storage.from('media').remove(paths);
    }

    results.push({ id: post.id, succeeded, errors, fb_native: isFbNative });
  }

  refreshEngagement().catch(() => {});

  return res.status(200).json({ processed: results.length, results });
}
