import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

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

// ── Platform publishers ───────────────────────────────────────────────────────

async function publishFacebook(post, creds) {
  const { fbPageId: pageId, fbToken: tok } = creds;
  const base  = `https://graph.facebook.com/v21.0/${pageId}`;
  const media = post.media || [];

  if (media.length === 0) {
    const r = await fetch(`${base}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: post.caption, access_token: tok }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.id ?? null;
  }

  if (media[0].type?.startsWith('video/')) {
    const r = await fetch(`${base}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: post.caption, file_url: media[0].url, access_token: tok }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.id ?? null;
  }

  if (media.length === 1) {
    const r = await fetch(`${base}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: post.caption, url: media[0].url, access_token: tok }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.post_id ?? j.id ?? null;
  }

  // Carousel
  const ids = await Promise.all(media.map(async m => {
    const r = await fetch(`${base}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: m.url, published: false, access_token: tok }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return { media_fbid: j.id };
  }));

  const r = await fetch(`${base}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: post.caption, attached_media: ids, access_token: tok }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.id ?? null;
}

async function publishInstagram(post, creds) {
  const { fbToken: tok, igUserId } = creds;
  const base  = `https://graph.facebook.com/v21.0/${igUserId}`;
  const media = post.media || [];

  if (media.length === 0) return null;

  if (media[0].type?.startsWith('video/')) {
    const cr = await fetch(`${base}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'REELS', video_url: media[0].url, caption: post.caption, access_token: tok }),
    });
    const { id, error } = await cr.json();
    if (error) throw new Error(error.message);
    const pub = await fetch(`${base}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: id, access_token: tok }),
    });
    const pj = await pub.json();
    if (pj.error) throw new Error(pj.error.message);
    return pj.id ?? null;
  }

  if (media.length === 1) {
    const cr = await fetch(`${base}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: media[0].url, caption: post.caption, access_token: tok }),
    });
    const { id, error } = await cr.json();
    if (error) throw new Error(error.message);
    const pub = await fetch(`${base}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: id, access_token: tok }),
    });
    const pj = await pub.json();
    if (pj.error) throw new Error(pj.error.message);
    return pj.id ?? null;
  }

  const childIds = await Promise.all(media.map(async m => {
    const r = await fetch(`${base}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: m.url, is_carousel_item: true, access_token: tok }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.id;
  }));

  const cr = await fetch(`${base}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'CAROUSEL', children: childIds.join(','), caption: post.caption, access_token: tok }),
  });
  const { id, error } = await cr.json();
  if (error) throw new Error(error.message);
  const pub = await fetch(`${base}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: id, access_token: tok }),
  });
  const pj = await pub.json();
  if (pj.error) throw new Error(pj.error.message);
  return pj.id ?? null;
}

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
        'Authorization': `Basic ${creds}`,
        'Content-Type':  `image/${ext}`,
        'Content-Disposition': `attachment; filename="upload.${ext}"`,
      },
      body: imgBuf,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`WP media: ${j.message}`);
    mediaIds.push(j.id);
  }

  const body = {
    title:   post.caption.split('\n')[0].slice(0, 100),
    content: post.caption,
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

// ── Analytics batch refresh ───────────────────────────────────────────────────

async function refreshEngagement() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: posts } = await sb
    .from('scheduled_posts')
    .select('id, fb_post_id, ig_post_id, profile_id')
    .eq('status', 'published')
    .gte('published_at', weekAgo)
    .or('fb_post_id.not.is.null,ig_post_id.not.is.null');

  for (const post of posts ?? []) {
    const { fbToken } = getCredentials(post.profile_id);
    let likes = 0, comments = 0;
    try {
      if (post.fb_post_id) {
        const r = await fetch(
          `https://graph.facebook.com/v21.0/${post.fb_post_id}?fields=likes.summary(true),comments.summary(true)&access_token=${fbToken}`
        );
        const j = await r.json();
        likes    += j.likes?.summary?.total_count    ?? 0;
        comments += j.comments?.summary?.total_count ?? 0;
      }
      if (post.ig_post_id) {
        const r = await fetch(
          `https://graph.facebook.com/v21.0/${post.ig_post_id}?fields=like_count,comments_count&access_token=${fbToken}`
        );
        const j = await r.json();
        likes    += j.like_count     ?? 0;
        comments += j.comments_count ?? 0;
      }
      await sb.from('scheduled_posts')
        .update({ likes_count: likes, comments_count: comments })
        .eq('id', post.id);
    } catch {} // analytics are best-effort
  }
}

// ── Cron handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization || '';
  if (
    auth !== `Bearer ${process.env.CRON_SECRET}` &&
    auth !== `Bearer ${process.env.API_KEY}`
  ) return res.status(401).end();

  const now = new Date().toISOString();

  const { data: posts, error: fetchErr } = await sb
    .from('scheduled_posts')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_time', now)
    .order('scheduled_time')
    .limit(3);

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const results = [];

  for (const post of posts ?? []) {
    const { error: lockErr } = await sb
      .from('scheduled_posts')
      .update({ status: 'processing' })
      .eq('id', post.id)
      .eq('status', 'pending');
    if (lockErr) continue;

    const creds  = getCredentials(post.profile_id);
    const errors = [];
    let fbPostId = null, igPostId = null;

    for (const platform of post.platforms) {
      try {
        if (platform === 'fb') fbPostId = await publishFacebook(post, creds);
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

    results.push({ id: post.id, succeeded, errors });
  }

  // Best-effort analytics refresh (fire and forget — don't block response)
  refreshEngagement().catch(() => {});

  return res.status(200).json({ processed: results.length, results });
}
