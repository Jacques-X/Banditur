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
