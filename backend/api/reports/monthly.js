import { createClient } from '@supabase/supabase-js';
import { cors } from '../cors.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

async function fetchPageInsights() {
  const tok    = process.env.FB_ACCESS_TOKEN;
  const pageId = process.env.FB_PAGE_ID;
  const igId   = process.env.IG_USER_ID;
  if (!tok || !pageId) return null;

  try {
    const [fbPage, fbIns, igPage] = await Promise.all([
      fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=followers_count&access_token=${tok}`).then(r => r.json()),
      fetch(`https://graph.facebook.com/v21.0/${pageId}/insights?metric=page_impressions&period=days_28&access_token=${tok}`).then(r => r.json()),
      igId
        ? fetch(`https://graph.facebook.com/v21.0/${igId}?fields=followers_count&access_token=${tok}`).then(r => r.json())
        : Promise.resolve(null),
    ]);

    const fbImpressions = fbIns?.data?.[0]?.values?.slice(-1)[0]?.value ?? null;

    return {
      fb_followers:   fbPage?.followers_count  ?? null,
      ig_followers:   igPage?.followers_count  ?? null,
      fb_impressions: fbImpressions,
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`) return res.status(401).end();

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });

  const { data: posts, error } = await sb
    .from('scheduled_posts')
    .select('*')
    .gte('scheduled_time', from)
    .lte('scheduled_time', to + 'T23:59:59Z')
    .order('scheduled_time', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const published = posts.filter(p => p.status === 'published');

  const by_platform = {};
  const by_profile  = {};
  let total_likes = 0, total_comments = 0;

  for (const p of published) {
    for (const plat of (p.platforms || [])) {
      by_platform[plat] = (by_platform[plat] || 0) + 1;
    }
    const prof = p.profile_id || 'main';
    by_profile[prof] = (by_profile[prof] || 0) + 1;
    total_likes    += p.likes_count    || 0;
    total_comments += p.comments_count || 0;
  }

  const [page_insights] = await Promise.all([fetchPageInsights()]);

  return res.status(200).json({
    summary: {
      total_published: published.length,
      total_pending:   posts.filter(p => p.status === 'pending').length,
      total_failed:    posts.filter(p => p.status === 'failed').length,
      by_platform,
      by_profile,
    },
    engagement: { total_likes, total_comments },
    page_insights,
    posts: published,
  });
}
