// Helpers for "Add many watermarks": turn a pile of PNG files into one row per
// photographer. Names come from the file names (or the folder they sit in), and
// portrait / landscape comes from the picture size, so files can be called anything.

const MALTESE = { 'ħ': 'h', 'ġ': 'g', 'ċ': 'c', 'ż': 'z', 'Ħ': 'h', 'Ġ': 'g', 'Ċ': 'c', 'Ż': 'z' };
const ORIENT_WORDS = /(^|[\s._-]+)(portrait|portrett|vertical|landscape|pajsaġġ|pajsagg|horizontal|port|land|vert|horiz|watermark|wm)(?=$|[\s._-]+)/giu;

export const baseName = p => String(p).split(/[\\/]/).pop();
const parentName = p => String(p).split(/[\\/]/).slice(-2, -1)[0] || '';

/** The id the app will give a name (same idea as slugify in scripts/make-watermark-pack.py). */
export function slugOf(name) {
  const s = [...String(name).toLowerCase()].map(c => MALTESE[c] || c).join('');
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/** "jacques-xuereb portrait.png" → "Jacques Xuereb"; "Sebio Audio Visuals_landscape.png" → "Sebio Audio Visuals". */
export function nameFromPath(path) {
  let n = baseName(path).replace(/\.[^.]+$/, '');
  n = n.replace(ORIENT_WORDS, ' ').replace(ORIENT_WORDS, ' ');
  n = n.replace(/[_]+/g, ' ').replace(/^[\s.\-]+|[\s.\-]+$/g, '').replace(/\s+/g, ' ');
  if (!n) n = parentName(path).replace(/[_]+/g, ' ').trim();
  // all lowercase with hyphens ("jacques-xuereb") → Title Case
  if (n && n === n.toLowerCase() && /-/.test(n) && !/\s/.test(n)) {
    n = n.split('-').filter(Boolean).map(w => w[0].toLocaleUpperCase('mt') + w.slice(1)).join(' ');
  }
  return n.slice(0, 80);
}

export const orientationOf = (w, h) => (h > w ? 'portrait' : w > h ? 'landscape' : null);

/** The app wants 3:2 (landscape) or 2:3 (portrait) within 2%. */
export function ratioOk(w, h) {
  if (!w || !h) return false;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  return Math.abs(long / short - 1.5) / 1.5 <= 0.02;
}

/**
 * items: [{ path, w, h }] → rows [{ key, name, portrait, landscape, notes: [] }]
 * `portrait` / `landscape` are the chosen file paths (first one wins).
 */
export function groupWatermarks(items) {
  const rows = new Map();
  for (const it of items) {
    const name = nameFromPath(it.path);
    const key = slugOf(name);
    const orient = orientationOf(it.w, it.h);
    if (!key) continue;
    const row = rows.get(key) || { key, name, portrait: null, landscape: null, notes: [] };
    if (!orient) row.notes.push(`${baseName(it.path)} huwa kwadru`);
    else if (row[orient]) row.notes.push(`żewġ fajls ${orient === 'portrait' ? 'tal-portrett' : 'tal-pajsaġġ'}: qed nuża ${baseName(row[orient])}`);
    else {
      row[orient] = it.path;
      if (!ratioOk(it.w, it.h)) row.notes.push(`${orient === 'portrait' ? 'il-portrett' : 'il-pajsaġġ'} huwa ${it.w}×${it.h}, mhux ${orient === 'portrait' ? '2:3' : '3:2'}`);
    }
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'mt'));
}
