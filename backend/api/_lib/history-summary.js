// The numbers and rows the desktop's Home/Skeda queue needs, in one request (GET /api/history?status=summary).
// `client` is a Supabase client (a fake in tests).

const ACTIVE = ['pending', 'fb_native', 'processing'];
const COLUMNS = 'id, caption, scheduled_time, status'; // all the queue views read

/** → { upcoming: next 4 active posts (soonest first), pending: count, failed: count, latestFailed: newest failed post | null } */
export async function historySummary(client, profileId = '') {
  const scoped = (q) => (profileId && profileId !== 'all' ? q.eq('profile_id', profileId) : q);
  const posts = () => client.from('scheduled_posts');
  const [upcoming, pending, failed, latest] = await Promise.all([
    scoped(posts().select(COLUMNS).in('status', ACTIVE)).order('scheduled_time', { ascending: true }).limit(4),
    scoped(posts().select('id', { count: 'exact', head: true }).eq('status', 'pending')),
    scoped(posts().select('id', { count: 'exact', head: true }).eq('status', 'failed')),
    scoped(posts().select(COLUMNS).eq('status', 'failed')).order('scheduled_time', { ascending: false }).limit(1),
  ]);
  const error = [upcoming, pending, failed, latest].find((r) => r.error)?.error;
  if (error) throw error;
  return { upcoming: upcoming.data || [], pending: pending.count ?? 0, failed: failed.count ?? 0, latestFailed: latest.data?.[0] || null };
}
