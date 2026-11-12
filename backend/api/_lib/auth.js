import { timingSafeEqual } from 'crypto';

/**
 * H2: Timing-safe bearer token comparison.
 * Pads both buffers to the same length so the comparison always takes constant
 * time, then also checks the lengths match to reject prefix attacks.
 */
export function bearerMatches(header, secret) {
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  const a   = Buffer.from(header   ?? '');
  const b   = Buffer.from(expected);
  const len = Math.max(a.length, b.length);
  const pa  = Buffer.alloc(len); a.copy(pa);
  const pb  = Buffer.alloc(len); b.copy(pb);
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

/**
 * REFACTOR-1: shared auth gate for every handler.
 *
 * Every route was independently re-implementing
 * `if (!bearerMatches(...)) return res.status(401)...`, and had drifted into
 * two different response shapes (`.json({error:'Unauthorized'})` on some
 * routes, bare `.end()` on others) and two different orderings relative to
 * the method check. Centralising it here means new routes can't reintroduce
 * that drift, and a client can rely on every 401 having the same JSON body.
 *
 * Returns `true` (and has already written the 401 response) if the request
 * is unauthorized — callers should `if (requireAuth(req, res)) return;`.
 */
export function requireAuth(req, res) {
  const header = req.headers.authorization || '';
  if (!bearerMatches(header, process.env.API_KEY)) {
    res.status(401).json({ error: 'Unauthorized' });
    return true;
  }
  return false;
}

/** Same as requireAuth, but against CRON_SECRET instead of API_KEY — used
 * only by /api/cron/process, which must not accept the shared client API key. */
export function requireCronAuth(req, res) {
  const header = req.headers.authorization || '';
  if (!bearerMatches(header, process.env.CRON_SECRET)) {
    res.status(401).json({ error: 'Unauthorized' });
    return true;
  }
  return false;
}
