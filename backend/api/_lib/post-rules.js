// Shared by the composer and the API. No runtime or credentials here.
export function postProblem({ platforms = [], content_type = 'post', caption = '', media = [] }) {
  if (
    !Array.isArray(platforms) ||
    !platforms.length ||
    platforms.some((p) => !['fb', 'ig', 'wp'].includes(p))
  )
    return 'Agħżel platform disponibbli.';
  if (!['post', 'reel', 'story'].includes(content_type)) return 'Tip ta’ post mhux validu.';
  if (typeof caption !== 'string' || caption.length > 2200)
    return 'Il-caption jista’ jkollha sa 2,200 karattru.';
  if (!Array.isArray(media) || media.length > 10) return 'Post jista’ jkollu sa 10 media.';
  if (media.some((m) => !m || typeof m !== 'object' || typeof m.type !== 'string'))
    return 'Medjum mhux validu.';
  if (content_type === 'post' && !caption.trim() && !media.length) return 'Żid caption jew media.';
  if ((platforms.includes('ig') || content_type !== 'post') && !media.length)
    return 'Instagram, Reel u Story jeħtieġu ritratt jew video.';
  if (content_type === 'reel' && (media.length !== 1 || !media[0].type?.startsWith('video/')))
    return 'Reel jeħtieġ video wieħed.';
  if (content_type === 'story' && media.length !== 1) return 'Story teħtieġ medjum wieħed.';
  if (
    content_type === 'post' &&
    platforms.includes('fb') &&
    media.length > 1 &&
    media.some((m) => m.type?.startsWith('video/'))
  )
    return 'Għal Facebook agħżel video wieħed jew carousel ta’ ritratti.';
  for (const m of media) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'].includes(m.type))
      return 'Uża JPG, PNG, WebP, MP4 jew MOV; ikkonverti formati oħra l-ewwel.';
    if (m.size > 50 * 1024 * 1024) return 'Kull file jista’ jkun sa 50 MB.';
    if (platforms.includes('ig') && m.type.startsWith('image/') && m.type !== 'image/jpeg')
      return 'Instagram jeħtieġ JPG. Ikkonverti r-ritratt minn Marka & Ssortja jew Posts.';
  }
  return '';
}

export const destinationFields = { fb: 'fb_post_id', ig: 'ig_post_id', wp: 'wp_post_id' };
export function deliverySummary(platforms, deliveries) {
  if (!platforms.length) return 'failed';
  const states = platforms.map((p) => deliveries[p]?.state || 'pending');
  if (states.every((s) => s === 'published')) return 'published';
  if (states.some((s) => s === 'failed' || s === 'unknown')) return 'failed';
  return states.includes('scheduled') ? 'fb_native' : 'pending';
}

// Used when the response to an edit was interrupted: a committed change can
// be recognised without issuing a second mutation against a stale revision.
export function matchesSubmission(post, body) {
  return (
    post.caption === body.caption &&
    post.content_type === body.content_type &&
    Date.parse(post.scheduled_time) === Date.parse(body.scheduledTime) &&
    JSON.stringify(post.platforms) === JSON.stringify(body.platforms) &&
    JSON.stringify((post.media || []).map((m) => m.url)) ===
      JSON.stringify((body.media || []).map((m) => m.url)) &&
    (post.event_id || '') === (body.event_id || '') &&
    (post.category || '') === (body.category || '') &&
    post.media_retention_days === body.media_retention_days &&
    !!post.media_pinned === !!body.media_pinned
  );
}
