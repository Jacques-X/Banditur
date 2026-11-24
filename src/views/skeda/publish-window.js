// When a scheduled post will really go out. Ordinary Facebook posts far enough ahead are handed
// to Facebook's own scheduler and appear on the minute. Everything else (Instagram, Reels, Stories,
// Facebook posts due soon) is published by our worker, which GitHub runs every 15 minutes, so it
// can appear up to that much later. Pure, so it can be tested.

export const WORKER_EVERY_MIN = 15;
const MIN = 60000;
// The worker hands a post to Facebook only when it is still >10 min ahead at a run, and runs come
// every 15 min: so only a post at least 25 min ahead is sure to be handed over in time.
const NATIVE_MIN_LEAD = (10 + WORKER_EVERY_MIN) * MIN;
const NATIVE_MAX_LEAD = 30 * 24 * 60 * MIN;

/**
 * { at: ms, now: ms, platforms: ['fb','ig',…], contentType } →
 * { exact: platforms that appear on the minute, late: platforms that may be up to 15 min late, until: ms }
 */
export function publishWindow({ at, now = Date.now(), platforms = [], contentType = 'post' }) {
  const lead = at - now;
  const fbNative = contentType === 'post' && lead >= NATIVE_MIN_LEAD && lead <= NATIVE_MAX_LEAD;
  const exact = platforms.filter((p) => p === 'fb' && fbNative);
  const late = platforms.filter((p) => !exact.includes(p));
  return { exact, late, until: at + WORKER_EVERY_MIN * MIN };
}
