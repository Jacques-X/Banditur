// Posters are named after their event's date: DD:MM:YY (15:11:26 Festa.jpg). People also type
// the other usual separators, and Drive does not allow some of them in every place, so any of
// : . - _ / or a space between the parts is accepted, with a 2- or 4-digit year.

const SEPS = [':', '.', '-', '_', '/', ' '];

function parts(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  return m ? { yyyy: m[1], yy: m[1].slice(2), mm: m[2], dd: m[3] } : null;
}

/** Literal spellings to hand to Drive's `name contains` search (it cannot do patterns). */
export function posterNameVariants(date) {
  const p = parts(date);
  if (!p) return [];
  const out = [];
  for (const s of SEPS) for (const y of [p.yy, p.yyyy]) out.push(`${p.dd}${s}${p.mm}${s}${y}`);
  return out;
}

/** True when `name` holds the date as DD?MM?YY or DD?MM?YYYY, not as part of a longer number. */
export function nameHasDate(name, date) {
  const p = parts(date);
  if (!p) return false;
  const sep = '[:.\\-_/ ]';
  return new RegExp(`(?<!\\d)${p.dd}${sep}${p.mm}${sep}(?:${p.yyyy}|${p.yy})(?!\\d)`).test(String(name || ''));
}
