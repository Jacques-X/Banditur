import { postProblem } from '../backend/api/_lib/post-rules.js';
// platforms.js — the one list of places a post can go.
//
// Everything platform-specific in the app reads from here: the buttons in the
// composer, what each platform accepts, caption limits, the preview and the
// archive pills. To add a platform, add one entry below (and its publisher in
// the backend); nothing else in the UI needs to change.
//
//   id            short code sent to /api/schedule (and stored with the post)
//   label / short full name, and the small tag used in the archive
//   available     false = shown greyed out as "coming soon"; can't be selected
//   hidden        true  = not shown at all (kept only so old posts still display)
//   defaultOn     selected by default on a new post
//   contentTypes  which of post / reel / story it can publish
//   mediaKinds    media it accepts: 'image' and/or 'video'
//   captionLimit  max characters in the caption
//   previewCut    characters visible before "more" (for the preview)
//   fields        extra inputs it needs (e.g. 'expiry')
//   idField       column of scheduled_posts that holds its published post id
//   icon          inline SVG for the button

export const PLATFORMS = [
  {
    id: 'fb', label: 'Facebook', short: 'FB', available: true, defaultOn: true,
    contentTypes: ['post', 'reel', 'story'], mediaKinds: ['image', 'video'],
    captionLimit: 2200, idField: 'fb_post_id',
    icon: "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M12 2C6.48 2 2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95 0-5.52-4.48-10-10-10z\"/></svg>",
  },
  {
    id: 'ig', label: 'Instagram', short: 'IG', available: true, defaultOn: true,
    contentTypes: ['post', 'reel', 'story'], mediaKinds: ['image', 'video'],
    captionLimit: 2200, previewCut: 125, idField: 'ig_post_id',
    icon: "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><rect x=\"2\" y=\"2\" width=\"20\" height=\"20\" rx=\"5\"/><path d=\"M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01\"/></svg>",
  },
  {
    // Placeholder: not wired up yet. Needs a backend publisher before `available` can be true.
    id: 'tt', label: 'TikTok', short: 'TT', available: false,
    contentTypes: ['reel'], mediaKinds: ['video'],
    captionLimit: 2200, idField: 'tt_post_id',
    icon: "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5\"/><path d=\"M14 3c.4 2.4 2 4 4.5 4.2\"/></svg>",
  },
  {
    // Placeholder for the organisation's own website / app backend.
    id: 'web', label: 'Website / App', short: 'WEB', available: false,
    contentTypes: ['post'], mediaKinds: ['image', 'video'],
    captionLimit: 2200, idField: 'web_post_id',
    icon: "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"12\" rx=\"2\"/><path d=\"M8 20h8M12 16v4\"/></svg>",
  },
  {
    // Old WordPress posts still appear in the archive; it is no longer offered for new ones.
    id: 'wp', label: 'WordPress', short: 'WP', available: false, hidden: true,
    contentTypes: ['post'], mediaKinds: ['image', 'video'],
    captionLimit: 2200, fields: ['expiry'], idField: 'wp_post_id',
    icon: "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20\"/></svg>",
  },
];

export const platformById = id => PLATFORMS.find(p => p.id === id);
export const visiblePlatforms = () => PLATFORMS.filter(p => !p.hidden);
export const defaultPlatformIds = () => PLATFORMS.filter(p => p.available && p.defaultOn).map(p => p.id);
export const platformIdFields = () => Object.fromEntries(PLATFORMS.map(p => [p.id, p.idField]));

const TYPE_LABEL = { post: 'post', reel: 'Reel', story: 'Story' };

/** Characters allowed in the caption: the strictest limit among the chosen platforms. */
export function captionLimitFor(ids, fallback = 2200) {
  const limits = ids.map(id => platformById(id)?.captionLimit).filter(Boolean);
  return limits.length ? Math.min(...limits) : fallback;
}

/** First thing that stops this post going to these platforms, in Maltese ('' if fine). */
export function platformProblem(ids, contentType, files) {
  const problem=postProblem({platforms:ids,content_type:contentType,caption:'preview',media:files});
  if(problem) return problem;
  for (const id of ids) {
    const p = platformById(id);
    if (!p) continue;
    if (!p.contentTypes.includes(contentType)) {
      return `${p.label} ma jippubblikax ${TYPE_LABEL[contentType] || contentType}. Neħħih jew biddel it-tip.`;
    }
    const bad = files.find(f => {
      const kind = f.type.startsWith('video/') ? 'video' : 'image';
      return !p.mediaKinds.includes(kind);
    });
    if (bad) {
      return `${p.label} jaċċetta ${p.mediaKinds.map(k => (k === 'video' ? 'video' : 'ritratti')).join(' u ')} biss.`;
    }
  }
  return '';
}
