// The publishing queue as other screens need it: counts for the toolbar badge
// and the next few posts for Skeda's "Jmiss" strip.

import { app, configured } from './app.svelte.js';
import { api } from './api.js';
import { isMock } from './tauri.js';
import { reportHealth } from './health.svelte.js';
import { STATUS_LABELS } from '../strings.js';

export const queue = $state({ upcoming: [], latestFailed: null, loading: false, error: '' });

const canCall = () => configured() || isMock();

export async function refreshCounts() {
  if (!canCall()) return;
  queue.loading = true;
  const profileId=app.profileId;
  try {
    const now = new Date();
    const [next, failed] = await Promise.all([
      api('/api/history', { query: { status: 'active', limit: 20, profile_id: profileId, ascending:true } }),
      api('/api/history', { query: { status: 'failed', limit: 1, profile_id: app.profileId } }),
    ]);
    if(profileId!==app.profileId) return;
    reportHealth('queue','');
    app.pending = next.pending ?? 0;
    app.failed = failed.total ?? 0;
    queue.upcoming = (next.posts || [])
      .filter(p => p.status !== 'published' && p.status !== 'failed')
      .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time))
      .slice(0, 4);
    queue.latestFailed = failed.posts?.[0] || null;
    queue.error = '';
  } catch (e) {
    queue.error = e.message;
    reportHealth('queue',e.message);
  } finally {
    queue.loading = false;
  }
}

/** { label, tone } for a post's status, in Maltese. */
export function statusOf(post) {
  if (post.status === 'fb_native') return { label: 'On Meta', tone: 'meta', long: 'Scheduled on Meta' };
  if (post.status === 'pending') return { label: 'Pending', tone: '', long: 'Jistenna l-pubblikazzjoni' };
  if (post.status === 'processing') return { label: 'Publishing', tone: 'meta', long: STATUS_LABELS.processing };
  if (post.status === 'published') return { label: 'Published', tone: 'ok', long: STATUS_LABELS.published };
  if (post.status === 'failed') return { label: 'Failed', tone: 'danger', long: STATUS_LABELS.failed };
  return { label: STATUS_LABELS[post.status] || post.status, tone: '' };
}
