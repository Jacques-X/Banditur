// Maltese-specific text rules for Traskrittura.
//
// Whisper often splits an article or a one-letter short form from the word it
// belongs to ("L -festa", "il- festa", "f' Malta"). mergeTokens() glues them
// back so they can't be wrapped, split or animated apart. The same rules live
// in sidecar/maltese.py; both are tested against maltese-cases.json.

const HYPHEN_END = /\p{L}[-‐]$/u;              // "il-", "għall-"
const HYPHEN_START = /^[-‐]+\p{L}/u;           // "-festa"
const SHORT_FORM = /^[bfmxstlkdBFMXSTLKD]['’]$/u; // "f'", "M'", "x’"
const BARE_LETTER = /^[bfmxstlkdBFMXSTLKD]$/u;   // "f" followed by "'Malta"
const APOS_START = /^['’]\p{L}/u;
// Standalone tokens that are only ever articles (or preposition + article)
const BARE_ARTICLES = new Set(['l', 'il', 'tal', 'fil', 'bil', 'mill', 'għall', 'lill']);
const SENTENCE_END = /[.!?…]["”»)]?$/u;

/** Does token b attach to token a? Returns the joined text, or null. */
function join(a, b) {
  if (!a || !b) return null;
  if (HYPHEN_END.test(a) && /^[-‐]*\p{L}/u.test(b)) return a + b.replace(/^[-‐]+/u, '');
  // "is" + "-soċjetà", "taż" + "-Żurrieq", "n" + "-nies": in Maltese a token
  // that starts with a hyphen never stands alone, so it always joins the word
  // before it (real Whisper output splits every article form this way).
  if (HYPHEN_START.test(b) && /\p{L}$/u.test(a)) return a + '-' + b.replace(/^[-‐]+/u, '');
  if (SHORT_FORM.test(a) && /^\p{L}/u.test(b)) return a + b;
  if (BARE_LETTER.test(a) && APOS_START.test(b)) return a + b;
  return null;
}

/**
 * Group a list of token texts. Returns [{ from, to, text }] where tokens
 * from..to (inclusive) become one word with the given text.
 */
export function mergeTokens(texts) {
  const groups = [];
  for (let i = 0; i < texts.length; i++) {
    let text = texts[i];
    const from = i;
    let merged = false;
    let joined;
    while (i + 1 < texts.length && (joined = join(text, texts[i + 1])) != null) {
      text = joined;
      i++;
      merged = true;
    }
    if (merged) {
      // Mid-sentence articles are lowercase: "Kienet L-festa" → "Kienet l-festa".
      const prev = groups.length ? groups[groups.length - 1].text : null;
      const sentenceStart = prev == null || SENTENCE_END.test(prev);
      if (!sentenceStart && /^\p{Lu}[\p{L}]*[-‐'’]/u.test(text) && isArticleLike(text)) {
        text = text[0].toLocaleLowerCase('mt') + text.slice(1);
      }
    }
    groups.push({ from, to: i, text });
  }
  return groups;
}

function isArticleLike(text) {
  const head = text.split(/[-‐'’]/u)[0].toLowerCase();
  return BARE_ARTICLES.has(head) || head.length === 1 || /^(i|ta|fi|bi|mi|għa|li|sa|ma|ġo|bħa)?(l|ll|ċ|d|n|r|s|t|x|ż|z)$/u.test(head);
}

/** Merge word objects ({ text, start, end, prob, speaker, kw }) using mergeTokens. */
export function mergeWords(words) {
  const groups = mergeTokens(words.map(w => w.text));
  if (groups.length === words.length) return words;
  return groups.map(({ from, to, text }) => {
    if (from === to) return words[from];
    const part = words.slice(from, to + 1);
    return {
      ...part[0],
      text,
      end: Math.max(...part.map(w => w.end)),
      prob: Math.min(...part.map(w => w.prob ?? 1)),
      kw: part.some(w => w.kw),
    };
  });
}

// ── "Artikli" check ──────────────────────────────────────────────────────────

const SUN = new Set(['ċ', 'd', 'n', 'r', 's', 't', 'x', 'ż', 'z']);
const ARTICLE_WORD = /^((?:i|ta|fi|bi|mi|għa|li|sa|ma|b|f)?)(ll|l|ċ|d|n|r|s|t|x|ż|z)[-‐](\p{L})/iu;
const DOUBLE_L = new Set(['mi', 'għa', 'li']);

/**
 * Check one word for an article that doesn't match the next letter
 * ("il-ċens" → "iċ-ċens", "id-festa" → "il-festa").
 * Returns { kind, fix } or null. A lone "il-" returns { kind: 'dangling', fix: null }.
 */
export function articleIssue(word) {
  const w = String(word).replace(/^[\s"'“”‘’«»(]+|[\s"“”«»).,;:!?…]+$/gu, '');
  if (/^\p{L}+[-‐]$/u.test(w) && isArticleLike(w)) return { kind: 'dangling', fix: null };
  // "f'il-Mellieħa" → "fil-Mellieħa": a short form glued to an article
  const c = w.match(/^([fbFB])['’](i?)(l|ċ|d|n|r|s|t|x|ż|z)([-‐].+)$/u);
  if (c) {
    const fixed = `${c[1]}i${c[3]}${c[4]}`;
    return { kind: 'contraction', fix: articleIssue(fixed)?.fix ?? fixed };
  }
  const m = w.match(ARTICLE_WORD);
  if (!m) return null;
  const [whole, stem, art, nextRaw] = m;
  const s = stem.toLowerCase();
  const a = art.toLowerCase();
  const next = nextRaw.toLowerCase();
  const rest = w.slice(whole.length - nextRaw.length);
  const keepCase = (orig, repl) => (orig && orig[0] !== orig[0].toLowerCase() ? repl[0].toUpperCase() + repl.slice(1) : repl);
  let replHead = null;
  if ((a === 'l' || a === 'll') && SUN.has(next)) {
    replHead = (stem || '') + next;            // il-ċens → iċ-ċens, mill-dar → mid-dar
    if (!stem && a === 'l') replHead = next;   // l-dar → d-dar (rare; flagged)
  } else if (SUN.has(a) && a !== next) {
    replHead = (stem || '') + (DOUBLE_L.has(s) ? 'll' : 'l'); // id-festa → il-festa
  }
  if (replHead == null) return null;
  const head = keepCase(stem || art, replHead);
  return { kind: 'assimilation', fix: `${head}-${rest}` };
}

/** All article issues in a cue list → [{ i, k, word, kind, fix }] */
export function findArticleIssues(cues) {
  const out = [];
  cues.forEach((c, i) => c.words.forEach((w, k) => {
    const issue = articleIssue(w.text);
    if (!issue) return;
    // a trailing "il-" whose noun is the next cue's first word can be merged
    if (issue.kind === 'dangling') {
      const next = c.words[k + 1] || cues[i + 1]?.words[0];
      if (next) issue.fix = `${w.text}${next.text}`;
    }
    out.push({ i, k, word: w.text, ...issue });
  }));
  return out;
}
