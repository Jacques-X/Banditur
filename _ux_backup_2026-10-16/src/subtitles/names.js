// Capital letters for proper names.
//
// The Maltese Whisper model writes everything in lower case ("santa katarina
// taż-żurrieq"). This finds known names — Maltese places, common saints'
// names and the user's own list — written in the wrong case and offers the
// right spelling. A name after an article keeps the article lower case:
// "taż-żurrieq" → "taż-Żurrieq".

// Localities of Malta and Gozo, plus the islands.
export const PLACES = [
  'Malta', 'Għawdex', 'Kemmuna', 'Valletta', 'Birgu', 'Bormla', 'Isla', 'Kalkara',
  'Żabbar', 'Żejtun', 'Marsaskala', 'Marsaxlokk', 'Birżebbuġa', 'Żurrieq', 'Qrendi',
  'Mqabba', 'Kirkop', 'Safi', 'Gudja', 'Għaxaq', 'Luqa', 'Tarxien', 'Paola', 'Fgura',
  'Santa Luċija', 'Marsa', 'Ħamrun', 'Pietà', 'Floriana', 'Gżira', 'Msida', 'Sliema',
  'San Ġiljan', 'Swieqi', 'Pembroke', 'San Ġwann', 'Birkirkara', 'Balzan', 'Lija',
  'Attard', 'Iklin', 'Naxxar', 'Għargħur', 'Mosta', 'Mġarr', 'Mellieħa', 'Rabat',
  'Mdina', 'Dingli', 'Siġġiewi', 'Żebbuġ', 'Qormi', 'Xgħajra', 'Santa Venera',
  'San Pawl il-Baħar', 'Buġibba', 'Qawra', 'Kerċem', 'Nadur', 'Xagħra', 'Xewkija',
  'Sannat', 'Munxar', 'Fontana', 'Għajnsielem', 'Għarb', 'Għasri', 'Qala',
  'San Lawrenz', 'Victoria', 'Marsalforn', 'Xlendi',
];

// Names that are (nearly) always capitalised in festa / parish texts.
export const COMMON_NAMES = [
  'Alla', 'Kristu', 'Ġesù', 'Marija', 'Madonna', 'Katarina', 'Ġorġ', 'Pawl', 'Pietru',
  'Ġużepp', 'Rokku', 'Filep', 'Duminku', 'Nikola', 'Lawrenz', 'Ġwann', 'Ġiljan',
  'Wistin', 'Bastjan', 'Sebastjan', 'Leonardu', 'Venera', 'Luċija', 'Bartilmew',
  'Kalċidonju', 'Andrija', 'Margerita', 'Elena', 'Agata', 'Mikiel', 'Grazzja',
  'Karmnu', 'Antnin', 'Franġisku', 'Publju', 'Injazju', 'Tumas', 'Anna',
];

// Saints' titles: "santa katarina" → "Santa Katarina".
const SANTA = ['Katarina', 'Marija', 'Venera', 'Luċija', 'Margerita', 'Lucija'];
const SAN = ['Ġorġ', 'Pawl', 'Pietru', 'Ġużepp', 'Filep', 'Duminku', 'Nikola', 'Lawrenz', 'Ġwann',
  'Ġiljan', 'Wistin', 'Bastjan', 'Sebastjan', 'Leonardu', 'Bartilmew', 'Kalċidonju', 'Mikiel',
  'Publju', 'Injazju', 'Tumas', 'Franġisku', 'Girgor', 'Martin'];
export const SAINTS = [
  ...SANTA.filter(n => n !== 'Lucija').map(n => `Santa ${n}`),
  ...SAN.map(n => `San ${n}`),
  'Santu Rokku', "Sant'Andrija", "Sant'Antnin", "Sant'Elena", "Sant'Agata", "Sant'Anna",
];

const ARTICLE_HEAD = /^((?:[\p{L}]{0,5})[-‐]|[\p{L}]['’])(?=\p{L})/u;   // "taż-", "il-", "f'"
const EDGE = /^([\s"'“”‘’«»(]*)(.*?)([\s"“”«»).,;:!?…]*)$/u;

const lower = s => s.toLocaleLowerCase('mt');

/** Split a word into { pre, head, core, post }: punctuation, article, name, punctuation. */
function parts(text) {
  const [, pre, mid, post] = text.match(EDGE);
  const m = mid.match(ARTICLE_HEAD);
  // only treat a short head as an article ("taż-", "il-", "f'"), not "San-Ġwann"
  const head = m && m[1].length <= 6 ? m[1] : '';
  return { pre, head, core: mid.slice(head.length), post };
}

/**
 * Build the list of phrases to look for. Each entry is a proper spelling,
 * one or more words ("Santa Katarina").
 */
export function nameList(userNames = []) {
  const seen = new Set();
  const out = [];
  for (const n of [...userNames, ...SAINTS, ...PLACES, ...COMMON_NAMES]) {
    const t = String(n || '').trim().replace(/\s+/g, ' ');
    if (!t || seen.has(lower(t))) continue;
    seen.add(lower(t));
    out.push(t);
  }
  // longer phrases first so "Santa Venera" wins over a lone "Venera"
  return out.sort((a, b) => b.split(' ').length - a.split(' ').length);
}

/**
 * Words whose case differs from a known name.
 * Returns groups [{ to, from, count, refs: [{ i, k, text }] }], where `text`
 * is the corrected word (article and punctuation kept).
 */
export function findCaseFixes(cues, names) {
  const flat = [];
  cues.forEach((c, i) => c.words.forEach((w, k) => {
    const p = parts(w.text);
    flat.push({ i, k, text: w.text, p, low: lower(p.core) });
  }));
  const used = new Set();
  const groups = new Map();
  for (const name of names) {
    const want = name.split(' ');
    const wantLower = want.map(lower);
    for (let s = 0; s + want.length <= flat.length; s++) {
      let ok = true;
      for (let j = 0; j < want.length && ok; j++) {
        const f = flat[s + j];
        // only the first word of a phrase may carry an article ("taż-Żurrieq")
        if (used.has(s + j) || (j > 0 && f.p.head) || f.low !== wantLower[j]) ok = false;
        // later words must not be split from the first by sentence punctuation
        if (ok && j < want.length - 1 && /[.!?…,;:]/u.test(f.p.post)) ok = false;
      }
      if (!ok) continue;
      const refs = [];
      for (let j = 0; j < want.length; j++) {
        const f = flat[s + j];
        if (f.p.core !== want[j]) refs.push({ i: f.i, k: f.k, text: f.p.pre + f.p.head + want[j] + f.p.post });
        used.add(s + j);
      }
      if (!refs.length) continue;
      const from = flat.slice(s, s + want.length).map(f => f.p.core).join(' ');
      const g = groups.get(name) || { to: name, from, count: 0, refs: [] };
      g.count += 1;
      g.refs.push(...refs);
      groups.set(name, g);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Apply some of the groups from findCaseFixes. Returns the number of words changed. */
export function applyCaseFixes(cues, groups) {
  let n = 0;
  for (const g of groups) for (const r of g.refs) {
    const w = cues[r.i]?.words[r.k];
    if (w && w.text !== r.text) { w.text = r.text; n++; }
  }
  return n;
}
