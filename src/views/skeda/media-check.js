// Media pre-flight: what Facebook / Instagram will refuse (errors) or handle
// badly (warnings) for each photo or video, from its measured size, shape and
// length — before anything is uploaded. Pure; tested in media-check.test.mjs.
//
// Limits follow Meta's publishing rules for the API (checked 2026-11-03):
// Instagram photos are JPEG only, up to 8 MB, 4:5 … 1.91:1 in the feed;
// IG Reels 3 s … 15 min, IG Stories up to 60 s; Facebook photos up to 10 MB
// (Stories 4 MB); Facebook Reels 3 … 90 s, 9:16, at least 540 × 960.
// A file that has not been measured yet produces no issues.

const MB = 1024 * 1024;
export const RATIO = { r45: 4 / 5, r11: 1, wide: 1.91, story: 9 / 16 };

/** "4:5", "9:16", "16:9", "1:1" … or "1.33:1" for anything else. */
export function ratioText(w, h) {
  const r = w / h;
  const known = [[1, 1, '1:1'], [4, 5, '4:5'], [9, 16, '9:16'], [16, 9, '16:9'], [3, 2, '3:2'], [2, 3, '2:3'], [4, 3, '4:3'], [3, 4, '3:4'], [1.91, 1, '1.91:1']];
  for (const [a, b, t] of known) if (Math.abs(r - a / b) < 0.01) return t;
  return r >= 1 ? `${r.toFixed(2)}:1` : `1:${(1 / r).toFixed(2)}`;
}

const seconds = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);

/** Output limits for a fixed photo, from the strictest chosen platform. */
export function photoTarget(platforms, contentType) {
  const ig = platforms.includes('ig');
  const fbStory = platforms.includes('fb') && contentType === 'story';
  return {
    maxWidth: ig ? 1440 : 2048,
    maxHeight: ig ? 3600 : 2048,
    maxBytes: fbStory ? 4 * MB : ig ? 8 * MB : 10 * MB,
  };
}

/**
 * Issues for one file. `info` = { type, size, width, height, duration? }.
 * `first` = info of the first file (Instagram crops a carousel to it).
 * Returns [{ level: 'error' | 'warn', text, fixes: [{ label, op, ratio? }] }].
 */
export function mediaIssues(info, { platforms = [], contentType = 'post', first = null, count = 1 } = {}) {
  if (!info || !info.width || !info.height) return [];
  const out = [];
  const ig = platforms.includes('ig');
  const fb = platforms.includes('fb');
  const r = info.width / info.height;
  const shape = ratioText(info.width, info.height);
  const add = (level, text, fixes = []) => out.push({ level, text, fixes });
  const target = photoTarget(platforms, contentType);

  if (info.type.startsWith('image/')) {
    if (ig && info.type !== 'image/jpeg')
      add('error', 'Instagram jaċċetta JPG biss.', [{ label: 'Ikkonverti għal JPG', op: 'jpeg' }]);
    if (info.size > target.maxBytes)
      add('error', `Kbir wisq (${(info.size / MB).toFixed(1)} MB; massimu ${target.maxBytes / MB} MB).`, [{ label: 'Ċekken', op: 'jpeg' }]);
    if (ig && contentType === 'post') {
      if (r < RATIO.r45 - 0.005)
        add('error', `Għoli wisq għal Instagram (${shape}; jeħtieġ bejn 4:5 u 1.91:1).`, [
          { label: 'Aqta’ għal 4:5', op: 'crop', ratio: RATIO.r45 },
          { label: 'Żid margini (4:5)', op: 'pad', ratio: RATIO.r45 },
        ]);
      else if (r > RATIO.wide + 0.005)
        add('error', `Wiesa’ wisq għal Instagram (${shape}; jeħtieġ bejn 4:5 u 1.91:1).`, [
          { label: 'Aqta’ għal 1.91:1', op: 'crop', ratio: RATIO.wide },
          { label: 'Żid margini (1:1)', op: 'pad', ratio: RATIO.r11 },
        ]);
      else if (count > 1 && first && first !== info) {
        const fr = first.width / first.height;
        if (Math.abs(r - fr) / fr > 0.02)
          add('warn', `Instagram jaqta’ l-carousel kollu bħall-ewwel ritratt (${ratioText(first.width, first.height)}); dan huwa ${shape}.`, [
            { label: `Aqta’ għal ${ratioText(first.width, first.height)}`, op: 'crop', ratio: fr },
          ]);
      }
      if (info.width < 320) add('warn', 'Inqas minn 320 px wiesa’: Instagram ikabbru u jidher imċajpar.');
    }
    if (contentType === 'story' && Math.abs(r - RATIO.story) > 0.03)
      add('warn', `Story tidher l-aħjar 9:16; dan huwa ${shape} u jinqata’ jew jidher b’faxex.`, [
        { label: 'Żid margini (9:16)', op: 'pad', ratio: RATIO.story },
        { label: 'Aqta’ għal 9:16', op: 'crop', ratio: RATIO.story },
      ]);
    return out;
  }

  // Videos: checked, not fixed here (re-encoding needs the native ffmpeg step).
  const d = info.duration;
  if (Number.isFinite(d)) {
    if (d < 3) add('error', `Qasir wisq (${seconds(d)}); Meta jeħtieġ mill-inqas 3 s.`);
    if (contentType === 'story' && d > 60) add('error', `Story video sa 60 s (dan huwa ${seconds(d)}).`);
    if (contentType === 'reel' && fb && d > 90) add('error', `Facebook Reel sa 90 s (dan huwa ${seconds(d)}). Neħħi Facebook jew qassru.`);
    if (contentType === 'reel' && ig && d > 15 * 60) add('error', `Instagram Reel sa 15-il minuta (dan huwa ${seconds(d)}).`);
  }
  if (contentType === 'reel' || contentType === 'story') {
    if (Math.abs(r - RATIO.story) > 0.03)
      add('warn', `${contentType === 'reel' ? 'Reel' : 'Story'} għandu jkun 9:16; dan huwa ${shape} u jista’ jinqata’ jew ikollu faxex suwed.`);
    if (fb && (Math.min(info.width, info.height) < 540 || Math.max(info.width, info.height) < 960))
      add('warn', `Riżoluzzjoni baxxa (${info.width}×${info.height}); Facebook jitlob mill-inqas 540×960.`);
  }
  if (ig && info.width > 1920) add('warn', `Wiesa’ ${info.width} px; Instagram jaċċetta sa 1920 px. Esportah f’1080p.`);
  if (ig && info.size > 100 * MB) add('warn', 'Video ta’ aktar minn 100 MB jista’ jiġi rrifjutat minn Instagram.');
  return out;
}

/**
 * Where to draw the source for a crop or pad to `ratio`, inside a canvas no
 * larger than `max` ({ maxWidth, maxHeight }). Returns
 * { width, height, src: [sx, sy, sw, sh], dst: [dx, dy, dw, dh], pad }.
 */
export function fitPlan(w, h, op, ratio, max) {
  let sx = 0, sy = 0, sw = w, sh = h, cw = w, ch = h;
  if (op === 'crop' && ratio) {
    if (w / h > ratio) { sw = Math.round(h * ratio); sx = Math.round((w - sw) / 2); }
    else { sh = Math.round(w / ratio); sy = Math.round((h - sh) / 2); }
    cw = sw; ch = sh;
  } else if (op === 'pad' && ratio) {
    if (w / h > ratio) ch = Math.round(w / ratio);
    else cw = Math.round(h * ratio);
  }
  const scale = Math.min(1, max.maxWidth / cw, max.maxHeight / ch);
  const width = Math.max(1, Math.round(cw * scale));
  const height = Math.max(1, Math.round(ch * scale));
  const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
  return {
    width, height,
    src: [sx, sy, sw, sh],
    dst: [Math.round((width - dw) / 2), Math.round((height - dh) / 2), dw, dh],
    pad: op === 'pad' && (width !== dw || height !== dh),
  };
}
