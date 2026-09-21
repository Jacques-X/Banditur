import { createClient } from '@supabase/supabase-js';
import { cors }          from '../cors.js';
import { requireAuth }   from '../auth.js';
import { getCredentials } from '../_lib/profiles.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

const GV = 'v25.0';
const GR = `https://graph.facebook.com/${GV}`;

const MS_DAY  = 24 * 60 * 60 * 1000;
// M5: Bare-date regex — rejects anything that isn't YYYY-MM-DD.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const iso = d => d.toISOString().slice(0, 10);

// ── Page insights over an explicit date range ────────────────────────────────
// FEAT-2: previously this always asked Meta for a rolling trailing-28-day
// window (period=days_28) no matter what date range the report actually
// covered, so "reach" in a report for March silently included weeks of
// February. Graph API's insights edge accepts since/until directly, so we
// now ask for the exact range being reported on — for both the current
// period and whatever period it's being compared against — and sum the
// daily buckets ourselves instead of relying on Meta's own rolling window.
//
// Each metric is fetched independently rather than in one Promise.all:
// page-level metrics get deprecated/restricted by Meta on a rolling basis
// and not every Page has every metric enabled, so one metric failing (e.g.
// page_fan_adds no longer available for this Page) shouldn't null out
// followers/impressions too.
async function fetchDailyMetricSum(pageId, tok, metric, since, until) {
  try {
    const url = `${GR}/${pageId}/insights?metric=${metric}&period=day&since=${since}&until=${until}&access_token=${tok}`;
    const j = await fetch(url).then(r => r.json());
    const values = j?.data?.[0]?.values;
    if (!Array.isArray(values)) return null;
    return values.reduce((sum, v) => sum + (typeof v.value === 'number' ? v.value : 0), 0);
  } catch (err) {
    console.error(JSON.stringify({ event: 'insights_metric_error', metric, message: err.message }));
    return null;
  }
}

// BUG-4 (kept from the original fix): resolves credentials the same
// profile-aware way as the rest of the app, falling back to the default env
// vars only when no profile_id is given.
async function fetchPageInsights(profileId, from, to) {
  let tok, pageId, igId;
  if (profileId && profileId !== 'all') {
    try {
      ({ fbToken: tok, fbPageId: pageId, igUserId: igId } = getCredentials(profileId));
    } catch (err) {
      console.error(JSON.stringify({ event: 'insights_profile_error', message: err.message }));
      return null;
    }
  } else {
    tok    = process.env.FB_ACCESS_TOKEN;
    pageId = process.env.FB_PAGE_ID;
    igId   = process.env.IG_USER_ID;
  }
  if (!tok || !pageId) return null;

  // Meta treats `until` as exclusive for some metrics — pad it a day so the
  // report's last calendar day is fully included in the daily buckets.
  const untilPadded = new Date(`${to}T00:00:00Z`);
  untilPadded.setUTCDate(untilPadded.getUTCDate() + 1);
  const untilStr = iso(untilPadded);

  const [fbPage, igPage, fbImpressions, fanAdds, fanRemoves] = await Promise.all([
    fetch(`${GR}/${pageId}?fields=followers_count&access_token=${tok}`).then(r => r.json()).catch(() => null),
    igId
      ? fetch(`${GR}/${igId}?fields=followers_count&access_token=${tok}`).then(r => r.json()).catch(() => null)
      : Promise.resolve(null),
    fetchDailyMetricSum(pageId, tok, 'page_impressions', from, untilStr),
    fetchDailyMetricSum(pageId, tok, 'page_fan_adds', from, untilStr),
    fetchDailyMetricSum(pageId, tok, 'page_fan_removes', from, untilStr),
  ]);

  // Net follower change *within this exact period* — this is what makes a
  // real "followers this period vs last period" trend possible, as opposed
  // to the absolute current count (fb_followers/ig_followers below), which
  // is always "right now" regardless of which period is being reported on.
  const fb_follower_change = (fanAdds !== null || fanRemoves !== null)
    ? (fanAdds ?? 0) - (fanRemoves ?? 0)
    : null;

  return {
    fb_followers:       fbPage?.followers_count ?? null,
    ig_followers:       igPage?.followers_count ?? null,
    fb_impressions:      fbImpressions,
    fb_follower_change,
  };
}

// FEAT-1 (analytics trends): fetch + aggregate one date range, shared by the
// current period and whichever period it's being compared against.
// M5: Select explicit columns — avoids returning error_message strings that
// can embed Graph API error details (access tokens, rate-limit info, etc.).
async function summarizeRange(from, to, profileId) {
  let q = sb
    .from('scheduled_posts')
    .select('id, caption, platforms, content_type, scheduled_time, status, profile_id, published_at, likes_count, comments_count')
    .gte('scheduled_time', from)
    .lte('scheduled_time', `${to}T23:59:59Z`)
    .order('scheduled_time', { ascending: false });
  if (profileId && profileId !== 'all') q = q.eq('profile_id', profileId);

  const { data: posts, error } = await q;
  if (error) throw error;

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

  // FEAT-2: normalize by period length and post volume — otherwise a 31-day
  // month with 10 posts and a 28-day month with 3 posts get compared on raw
  // totals alone, which flatters or unfairly penalizes whichever period is
  // longer or busier.
  const days          = Math.max(1, Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / MS_DAY) + 1);
  const avg_per_post   = published.length ? Math.round(((total_likes + total_comments) / published.length) * 10) / 10 : 0;
  const posts_per_week = Math.round((published.length / (days / 7)) * 10) / 10;

  return {
    summary: {
      total_published: published.length,
      total_pending:   posts.filter(p => p.status === 'pending').length,
      total_failed:    posts.filter(p => p.status === 'failed').length,
      by_platform,
      by_profile,
      posts_per_week,
    },
    engagement: { total_likes, total_comments, avg_per_post },
    published,
  };
}

function lastDayOfMonthUTC(year, month) {
  // month is 0-based; day 0 of the next month rolls back to the last day
  // of this one.
  return new Date(Date.UTC(year, month + 1, 0));
}

function isFullMonth(fromD, toD) {
  if (fromD.getUTCDate() !== 1) return false;
  return toD.getTime() === lastDayOfMonthUTC(fromD.getUTCFullYear(), fromD.getUTCMonth()).getTime();
}

function isFullQuarter(fromD, toD) {
  if (fromD.getUTCDate() !== 1 || fromD.getUTCMonth() % 3 !== 0) return false;
  return toD.getTime() === lastDayOfMonthUTC(fromD.getUTCFullYear(), fromD.getUTCMonth() + 2).getTime();
}

function isFullYear(fromD, toD) {
  if (fromD.getUTCMonth() !== 0 || fromD.getUTCDate() !== 1) return false;
  return toD.getTime() === lastDayOfMonthUTC(fromD.getUTCFullYear(), 11).getTime();
}

// FEAT-1/FEAT-2: the comparison period to use when the caller didn't pick an
// explicit one. Originally this always meant "N days immediately before",
// which is wrong for anything but arbitrary custom ranges — picking a full
// February (28 days) landed the comparison on Jan 4-31 instead of the full
// Jan 1-31 a committee member would actually expect "vs last month" to mean.
// Now a range that exactly matches a calendar month, quarter, or year
// compares against the true previous calendar unit; anything else (a custom
// week, an odd date span) still falls back to "the same number of days
// immediately before it".
function previousPeriod(from, to) {
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD   = new Date(`${to}T00:00:00Z`);

  if (isFullYear(fromD, toD)) {
    const y = fromD.getUTCFullYear() - 1;
    return { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(lastDayOfMonthUTC(y, 11)) };
  }
  if (isFullQuarter(fromD, toD)) {
    let y = fromD.getUTCFullYear();
    let m = fromD.getUTCMonth() - 3;
    if (m < 0) { m += 12; y -= 1; }
    return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(lastDayOfMonthUTC(y, m + 2)) };
  }
  if (isFullMonth(fromD, toD)) {
    let y = fromD.getUTCFullYear();
    let m = fromD.getUTCMonth() - 1;
    if (m < 0) { m = 11; y -= 1; }
    return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(lastDayOfMonthUTC(y, m)) };
  }

  const days     = Math.max(1, Math.round((toD - fromD) / MS_DAY) + 1);
  const prevTo   = new Date(fromD.getTime() - MS_DAY);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * MS_DAY);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (requireAuth(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { from, to, profile_id, compare_from, compare_to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  // M5: Validate bare-date format before string-concatenating into a timestamp.
  if (!DATE_RE.test(from) || !DATE_RE.test(to))
    return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
  // FEAT-2: a reversed range used to silently produce a nonsense report
  // instead of an error.
  if (from > to) return res.status(400).json({ error: 'from must not be after to' });

  // FEAT-2: an explicit comparison range from the report panel's "custom
  // compare" picker overrides the auto-computed previous period below.
  let compareRange = null;
  if (compare_from || compare_to) {
    if (!compare_from || !compare_to || !DATE_RE.test(compare_from) || !DATE_RE.test(compare_to))
      return res.status(400).json({ error: 'compare_from and compare_to must both be YYYY-MM-DD' });
    if (compare_from > compare_to)
      return res.status(400).json({ error: 'compare_from must not be after compare_to' });
    compareRange = { from: compare_from, to: compare_to };
  }

  let current, previous, page_insights, previous_page_insights;
  try {
    const prev = compareRange || previousPeriod(from, to);
    // FEAT-1: previous-period comparison is best-effort — if it fails for any
    // reason, still return the current period's report rather than failing
    // the whole request over a "nice to have" trend line.
    [current, previous, page_insights, previous_page_insights] = await Promise.all([
      summarizeRange(from, to, profile_id),
      summarizeRange(prev.from, prev.to, profile_id).catch(err => {
        console.error(JSON.stringify({ event: 'report_previous_period_error', message: err.message }));
        return null;
      }),
      fetchPageInsights(profile_id, from, to),
      fetchPageInsights(profile_id, prev.from, prev.to),
    ]);
    if (previous) previous.range = prev;
  } catch (err) {
    console.error(JSON.stringify({ event: 'report_query_error', message: err.message }));
    return res.status(500).json({ error: 'Failed to fetch report data' });
  }

  return res.status(200).json({
    summary: current.summary,
    engagement: current.engagement,
    page_insights,
    posts: current.published,
    // FEAT-1/FEAT-2: trend comparison against either the caller's explicit
    // compare_from/compare_to range, or the auto-computed previous period.
    // page_insights is now included here too (FEAT-2), scoped to the same
    // comparison range, so follower/reach trends are real period-over-period
    // deltas instead of "current snapshot" duplicated on both sides.
    previous: previous ? {
      summary: previous.summary,
      engagement: previous.engagement,
      range: previous.range,
      page_insights: previous_page_insights,
    } : null,
  });
}
