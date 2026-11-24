// Matching for the ⌘K box. Pure, so it can be tested.
// Maltese letters match their plain forms (xoghol finds Xogħol), case is ignored,
// and every typed word has to appear somewhere in the item's text.

export const fold = (s = '') =>
  String(s)
    .toLowerCase()
    .replace(/ħ/g, 'h').replace(/ġ/g, 'g').replace(/ċ/g, 'c').replace(/ż/g, 'z')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'");

/** Lower is better; null when it does not match. */
export function score(item, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return item.rank ?? 0;
  const title = fold(item.title);
  const hay = `${title} ${fold(item.hint)} ${fold(item.keywords)}`;
  let s = item.rank ?? 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) return null;
    if (title.startsWith(w)) s -= 30;
    else if (title.includes(` ${w}`) || title.includes(`-${w}`)) s -= 20;
    else if (i < title.length) s -= 10;
  }
  return s;
}

/** items → the best `limit`, best first (stable for equal scores). */
export function search(items, query, limit = 12) {
  return items
    .map((item, i) => ({ item, i, s: score(item, query) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item);
}
