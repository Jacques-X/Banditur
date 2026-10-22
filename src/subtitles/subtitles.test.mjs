// Unit tests for the subtitle engine. Run: node src/subtitles/subtitles.test.mjs
import assert from 'node:assert/strict';
import {
  wordsFromSidecar, buildCues, cueText, cueIndexAt, splitAt, splitBefore, joinNext,
  trimIn, trimOut, rollIn, rollOut, moveFirstWordToPrev, moveLastWordToNext,
  setCueText, toggleKeyword, findNameVariants, replaceVariants, replaceText, wrapLines,
  buildSrt, nextUnsure, normKey, SubtitleDoc, flattenWords, mergeArticlesInCues,
  joinWordWithNext, cueIssues, suggestKeywords, setCueTimes, moveCue, moveCueFree, snapTimes,
} from './model.js';
import { setWordStart, splitGap } from './model.js';
import { buildAss, assColor, assTime, wordSlots, frameState, normalizeLook, PRESETS, WORD_EFFECTS, ENTRIES, lookFromPreset, layoutFor, formatOf, effectiveLook, restoreLook, FONTS, PUNCH } from './styles.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};

const raw = [
  { word: ' Il-', start: 0.0, end: 0.2, probability: 0.9, speaker: 'S1' },
  { word: ' festa', start: 0.2, end: 0.6, probability: 0.95, speaker: 'S1' },
  { word: ' ta\'', start: 0.6, end: 0.8, probability: 0.5, speaker: 'S1' },
  { word: ' Ġużeppi', start: 0.8, end: 1.3, probability: 0.9, speaker: 'S1' },
  { word: ' kienet', start: 1.4, end: 1.8, probability: 0.9, speaker: 'S1' },
  { word: ' sabiħa.', start: 1.8, end: 2.3, probability: 0.9, speaker: 'S1' },
  { word: ' Guzeppi', start: 3.5, end: 4.0, probability: 0.6, speaker: 'S1' },
  { word: ' kien', start: 4.0, end: 4.2, probability: 0.9, speaker: 'S1' },
  { word: ' hemm', start: 4.2, end: 4.6, probability: 0.9, speaker: 'S1' },
  { word: ' Dan', start: 5.6, end: 5.8, probability: 0.9, speaker: 'S1' },
  { word: ' dan', start: 5.8, end: 6.0, probability: 0.9, speaker: 'S1' },
];
const words = () => wordsFromSidecar(raw);
const cuesOf = opts => buildCues(words(), { maxWords: 4, maxPause: 0.8, maxChars: 42, ...opts });

test('wordsFromSidecar trims and normalises', () => {
  const w = words();
  assert.equal(w.length, 11);
  assert.equal(w[0].text, 'Il-');
  assert.equal(w[2].prob, 0.5);
});

test('buildCues splits on max words, pauses and sentence ends', () => {
  const c = cuesOf();
  assert.deepEqual(c.map(cueText), ["Il- festa ta' Ġużeppi", 'kienet sabiħa.', 'Guzeppi kien hemm', 'Dan dan']);
  for (let i = 0; i + 1 < c.length; i++) assert.ok(c[i].end <= c[i + 1].start);
});

test('cueIndexAt', () => {
  const c = cuesOf();
  assert.equal(cueIndexAt(c, 0.5), 0);
  assert.equal(cueIndexAt(c, 2.0), 1);
  assert.equal(cueIndexAt(c, 3.0), -1);
  assert.equal(cueIndexAt(c, 4.1), 2);
});

test('split at playhead and join back', () => {
  const c = cuesOf();
  assert.ok(splitAt(c, 0, 0.62));
  assert.deepEqual(c.slice(0, 2).map(cueText), ['Il- festa', "ta' Ġużeppi"]);
  assert.equal(c[0].end, c[1].start);
  assert.ok(joinNext(c, 0));
  assert.equal(cueText(c[0]), "Il- festa ta' Ġużeppi");
  assert.equal(splitAt(c, 0, 0.0), false, 'cannot split before the first word');
  assert.ok(splitBefore(c, 0, 3));
  assert.equal(cueText(c[1]), 'Ġużeppi');
});

test('trim and roll keep cues ordered', () => {
  const c = cuesOf();
  assert.ok(trimIn(c, 1, 1.5));
  assert.equal(c[1].start, 1.5);
  assert.ok(trimIn(c, 1, 0.1));
  assert.equal(c[1].start, c[0].end, 'trim in cannot cross previous cue');
  assert.ok(trimOut(c, 1, 3.0));
  assert.equal(c[1].end, 3.0);
  assert.ok(trimOut(c, 1, 99));
  assert.equal(c[1].end, c[2].start, 'trim out cannot cross next cue');
  assert.ok(rollIn(c, 2, 3.2));
  assert.equal(c[1].end, 3.2);
  assert.equal(c[2].start, 3.2);
  assert.ok(rollOut(c, 2, 4.8));
  assert.equal(c[2].end, 4.8);
  assert.equal(c[3].start, 4.8);
  assert.equal(rollIn(c, 0, 1), false);
});

test('move words between cues keeps timings', () => {
  const c = cuesOf();
  assert.ok(moveFirstWordToPrev(c, 1));
  assert.equal(cueText(c[0]), "Il- festa ta' Ġużeppi kienet");
  assert.equal(c[0].words.at(-1).start, 1.4);
  assert.ok(moveLastWordToNext(c, 0));
  assert.equal(cueText(c[1]), 'kienet sabiħa.');
  // moving the only word removes the empty cue
  const d = cuesOf();
  splitBefore(d, 1, 1);           // "kienet" | "sabiħa."
  const n = d.length;
  assert.ok(moveFirstWordToPrev(d, 2));
  assert.equal(d.length, n - 1);
  assert.equal(cueText(d[1]), 'kienet sabiħa.');
});

test('setCueText keeps timings when word count matches, retimes otherwise', () => {
  const c = cuesOf();
  const before = c[0].words.map(w => w.start);
  assert.ok(setCueText(c, 0, "Il- festa ta' Ġużeppi!", { keepArticles: false }));
  assert.deepEqual(c[0].words.map(w => w.start), before);
  assert.ok(setCueText(c, 0, 'Il-festa'));
  assert.equal(c[0].words.length, 1);
  assert.equal(c[0].words[0].start, c[0].start);
  assert.ok(Math.abs(c[0].words[0].end - c[0].end) < 1e-9);
  const n = c.length;
  assert.ok(setCueText(c, 0, '   '));
  assert.equal(c.length, n - 1, 'empty text deletes the cue');
});

test('name variants: Ġużeppi / Guzeppi grouped, Dan/dan ignored', () => {
  const c = cuesOf();
  const g = findNameVariants(c);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].variants.map(v => v.text).sort(), ['Guzeppi', 'Ġużeppi']);
  assert.equal(normKey('Ħaż-Żebbuġ'), 'hazzebbug');
  assert.ok(replaceVariants(c, ['Guzeppi'], 'Ġużeppi'));
  assert.equal(cueText(c[2]), 'Ġużeppi kien hemm');
  assert.equal(findNameVariants(c).length, 0);
});

test('fuzzy names within one edit', () => {
  const c = buildCues(wordsFromSidecar([
    { word: 'Mellieħa', start: 0, end: 1 }, { word: 'Melliħa', start: 1, end: 2 },
  ]), { maxWords: 1 });
  assert.equal(findNameVariants(c).length, 1);
});

test('replaceText', () => {
  const c = cuesOf();
  assert.equal(replaceText(c, 'hemm', 'hawn'), 1);
  assert.equal(cueText(c[2]), 'Guzeppi kien hawn');
});

test('wrapLines balances two lines', () => {
  const w = wordsFromSidecar('Il-festa ta\' Santa Marija kienet sabiħa ħafna'.split(' ').map((t, i) => ({ word: t, start: i, end: i + 1 })));
  const lines = wrapLines(w, 26);
  assert.equal(lines.length, 2);
  const len = l => l.map(k => w[k].text).join(' ').length;
  assert.ok(Math.abs(len(lines[0]) - len(lines[1])) <= 10);
  assert.equal(wrapLines(w, 24).length, 3, 'falls back to greedy lines');
  assert.equal(wrapLines(w.slice(0, 2), 24).length, 1);
});

test('SRT output', () => {
  const srt = buildSrt(cuesOf());
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:01,300\nIl- festa ta' Ġużeppi\n\n2\n/);
});

test('nextUnsure wraps around', () => {
  const c = cuesOf();
  assert.deepEqual(nextUnsure(c), [0, 2]);
  assert.deepEqual(nextUnsure(c, 0, 2), [2, 0]);
  assert.deepEqual(nextUnsure(c, 2, 0), [0, 2]);
});

test('undo / redo', () => {
  const doc = new SubtitleDoc(cuesOf());
  const n = doc.cues.length;
  assert.ok(doc.apply(c => joinNext(c, 0), 'Għaqqad'));
  assert.equal(doc.cues.length, n - 1);
  assert.equal(doc.apply(c => rollIn(c, 0, 1)), false);
  assert.equal(doc.undo(), 'Għaqqad', 'undo returns the step label');
  assert.equal(doc.cues.length, n);
  assert.equal(doc.redo(), 'Għaqqad');
  assert.equal(doc.cues.length, n - 1);
  assert.equal(doc.redo(), null);
  // live edits collapse into one undo step
  doc.beginLive();
  doc.live(c => { c[0].end -= 0.1; });
  doc.live(c => { c[0].end -= 0.1; });
  assert.ok(doc.commitLive('Tmiem'));
  assert.equal(doc.undo(), 'Tmiem');
  const endBefore = doc.cues[0].end;
  doc.beginLive(); doc.live(c => { c[0].end -= 0.1; }); doc.cancelLive();
  assert.equal(doc.cues[0].end, endBefore, 'cancel restores');
});

test('toggle keyword survives re-split', () => {
  const c = cuesOf();
  assert.ok(toggleKeyword(c, 0, 3));
  const again = buildCues(flattenWords(c), { maxWords: 2 });
  assert.ok(again.flatMap(x => x.words).find(w => w.text === 'Ġużeppi').kw);
});

test('ASS colours and times', () => {
  assert.equal(assColor('#FFD60A'), '&H000AD6FF');
  assert.equal(assColor('#000000', 255), '&HFF000000');
  assert.equal(assTime(3725.456), '1:02:05.46');
});

test('ASS file for every preset, entry and word effect', () => {
  const c = cuesOf();
  c[0].words[3].kw = true;
  const looks = [
    ...PRESETS.map(p => lookFromPreset(p.id)),
    ...WORD_EFFECTS.flatMap(w => ENTRIES.map(e => normalizeLook({ word: w.id, entry: e.id }))),
    normalizeLook({ word: 'pill', box: true }), normalizeLook({ word: 'pop', box: true, emphasis: 'both' }),
  ];
  for (const look of looks) {
    const tag = `${look.preset}/${look.entry}/${look.word}`;
    for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
      const ass = buildAss(c, look, { width, height });
      assert.match(ass, new RegExp(`PlayResX: ${width}`));
      const events = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
      assert.ok(events.length >= c.length, `${tag}: events`);
      for (const e of events) {
        const text = e.split(',').slice(9).join(',');
        assert.equal((text.match(/\{/g) || []).length, (text.match(/\}/g) || []).length, `${tag}: braces`);
        assert.doesNotMatch(text, /\d\.\d{4,}/, `${tag}: no float noise`);
        assert.match(text, /\\pos\(|\\move\(/, `${tag}: positioned`);
      }
      if (look.word === 'karaoke') assert.match(ass, /\\kf\d+/);
      if (look.word === 'pop') assert.match(ass, /\\t\(0,90,\\fscx112\\fscy112\)/);
      if (look.word === 'single') assert.equal(events.length, c.flatMap(x => x.words).length);
      if (look.word === 'pill') {
        const pills = events.filter(e => e.includes(',Pill,'));
        assert.equal(pills.length, c.flatMap(x => x.words).length, `${tag}: one pill per word`);
        assert.ok(pills.every(e => e.startsWith('Dialogue: 0,')), 'pill layer under the text');
      }
    }
  }
  const boxed = buildAss(c, { box: true, boxOpacity: 0.5 }, { width: 1080, height: 1920 });
  assert.match(boxed, /Style: Default,[^\n]*,3,\d+,0,\d,/);
  assert.match(buildAss(c, { textCase: 'upper' }), /ĠUŻEPPI/);
  assert.match(buildAss(c, { uppercase: true }), /ĠUŻEPPI/, 'old looks with uppercase: true still work');
  assert.match(buildAss(c, { textCase: 'lower' }), /ġużeppi/);
});

test('word slots are monotonic and frameState matches the layers', () => {
  const c = cuesOf()[0];
  const s = wordSlots(c);
  for (let i = 1; i < s.b.length; i++) assert.ok(s.b[i] >= s.b[i - 1]);
  const f = frameState(c, normalizeLook({ word: 'reveal' }), 0.65);
  assert.deepEqual(f.words.map(w => w.visible), [true, true, true, false]);
  const k = frameState(c, normalizeLook({ word: 'karaoke' }), 0.4);
  assert.equal(k.words[0].fill, 1);
  assert.ok(k.words[1].fill > 0 && k.words[1].fill < 1);
  assert.equal(k.words[3].fill, 0);
  const fade = frameState(c, normalizeLook({ entry: 'fade' }), c.start + 0.05);
  assert.ok(fade.opacity > 0 && fade.opacity < 1);
  const pill = frameState(c, normalizeLook({ word: 'pill' }), 0.65);
  assert.deepEqual(pill.words.map(w => w.pill), [false, false, true, false]);
  const pop = frameState(c, normalizeLook({ entry: 'pop' }), c.start + 0.02);
  assert.ok(pop.lineScale < 1);
});

test('legacy looks and per-cue overrides', () => {
  const old = normalizeLook({ preset: 'karaoke', font: 'Helvetica Neue', uppercase: true });
  assert.equal(old.word, 'karaoke');
  assert.equal(old.textCase, 'upper');
  assert.equal(old.font, 'Montserrat Bold', 'fonts outside Montserrat fall back');
  assert.equal(restoreLook({ preset: 'hoss', sizePct: 8.5 }).preset, 'deheb', 'removed presets start from the default');
  assert.equal(restoreLook({ preset: 'custom', sizePct: 9 }).sizePct, 9, 'custom looks are kept');
  assert.equal(restoreLook({ preset: 'saved:x' }).preset, 'saved:x');
  assert.equal(restoreLook(null).preset, 'deheb');
  assert.deepEqual(PRESETS.map(p => p.id), ['deheb', 'pillola', 'klassiku']);
  assert.ok(FONTS.every(f => f.family.startsWith('Montserrat')));
  const look = lookFromPreset('klassiku');
  assert.equal(effectiveLook({ style: 'pop' }, look).word, 'pop', 'old per-cue ids still apply');
  assert.equal(effectiveLook({ style: 'pillola' }, look).word, 'pill');
  assert.equal(effectiveLook({ style: 'pillola' }, look).font, look.font, 'per-cue preset changes animation only');
});

test('layout: formats, safe areas and line fitting', () => {
  assert.equal(formatOf(1080, 1920), 'reel');
  assert.equal(formatOf(1920, 1080), 'wide');
  assert.equal(formatOf(1080, 1080), 'square');
  const big = { ...lookFromPreset('pillola'), sizePct: 8.5, maxChars: 16 };
  const reel = layoutFor(big, 1080, 1920);
  assert.ok(reel.marginV >= 1920 * 0.2, 'reels keep clear of the bottom fifth');
  assert.ok(reel.maxChars <= big.maxChars);
  const wide = layoutFor({ ...big, maxChars: 80 }, 1920, 1080);
  assert.ok(wide.maxChars < 80, 'line length capped to what fits the frame');
  const left = layoutFor({ ...lookFromPreset('klassiku'), align: 'left' }, 1920, 1080);
  assert.equal(left.an, 1);
  assert.equal(left.anchor.x, left.marginH);
});

test('articles merge across cues and on retype', () => {
  const c = buildCues(wordsFromSidecar([
    { word: 'Kienet', start: 0, end: 0.3 }, { word: 'L', start: 0.3, end: 0.4 },
    { word: '-festa', start: 0.4, end: 0.8 }, { word: 'f\'', start: 0.9, end: 1.0 },
    { word: 'Malta', start: 1.0, end: 1.4 },
  ]), { maxWords: 2 });
  assert.deepEqual(c.map(cueText), ['Kienet L', '-festa f\'', 'Malta']);
  assert.ok(mergeArticlesInCues(c));
  assert.deepEqual(c.map(cueText), ['Kienet l-festa', "f'Malta"]);
  for (let i = 1; i < c.length; i++) assert.ok(c[i].start >= c[i - 1].end);
  assert.equal(mergeArticlesInCues(c), false);
  assert.ok(setCueText(c, 0, 'Kienet il- festa'));
  assert.equal(cueText(c[0]), 'Kienet il-festa');
  assert.equal(c[0].words.length, 2, 'same count after merge keeps timings');
  assert.ok(setCueText(c, 0, 'Kienet il- festa sabiħa', { keepArticles: false }));
  assert.equal(c[0].words.length, 4);
});

test('joinWordWithNext across a cue boundary', () => {
  const c = buildCues(wordsFromSidecar([
    { word: 'dan', start: 0, end: 0.3 }, { word: 'il-', start: 0.3, end: 0.4 }, { word: 'festa', start: 0.4, end: 0.9 },
  ]), { maxWords: 2 });
  assert.deepEqual(c.map(cueText), ['dan il-', 'festa']);
  assert.ok(joinWordWithNext(c, 0, 1));
  assert.deepEqual(c.map(cueText), ['dan il-festa']);
});

test('readability issues', () => {
  const [c] = buildCues(wordsFromSidecar([{ word: 'Ħafna kliem malajr', start: 0, end: 0.4 }]), {});
  assert.deepEqual(cueIssues(c).sort(), ['fast', 'short']);
});

test('suggested keywords: numbers, then names, then long words', () => {
  const c = buildCues(wordsFromSidecar([
    { word: 'Ġew', start: 0, end: 0.3 }, { word: '500', start: 0.3, end: 0.6 }, { word: 'persuna', start: 0.6, end: 0.9 },
    { word: 'u', start: 2, end: 2.1 }, { word: 'Ġużeppi', start: 2.1, end: 2.5 }, { word: 'kien', start: 2.5, end: 2.7 },
    { word: 'kien', start: 4, end: 4.2 }, { word: 'straordinarju', start: 4.2, end: 4.8 },
  ]), { maxWords: 3 });
  assert.deepEqual(suggestKeywords(c), [[0, 1], [1, 1], [2, 1]]);
});

test('timeline helpers clamp to neighbours', () => {
  const c = cuesOf();
  assert.ok(setCueTimes(c, 1, 0, 99));
  assert.equal(c[1].start, c[0].end);
  assert.equal(c[1].end, c[2].start);
  const origin = { ...c[2] };
  assert.ok(moveCue(c, 2, -10, origin));
  assert.equal(c[2].start, c[1].end);
  assert.ok(Math.abs((c[2].end - c[2].start) - (origin.end - origin.start)) < 1e-9);
  const snaps = snapTimes(c, 1);
  assert.ok(snaps.length > 4 && snaps.every((v, i) => i === 0 || v >= snaps[i - 1]));
});

console.log(`✓ ${passed} subtitle tests passed`);

// ── Maltese articles (shared cases with sidecar/test_maltese.py) ───────────
import { readFileSync } from 'node:fs';
import { mergeTokens, mergeWords, articleIssue } from './maltese.js';
const MT = JSON.parse(readFileSync(new URL('./maltese-cases.json', import.meta.url), 'utf8'));
let mtPassed = 0;
for (const c of MT.merge) {
  assert.deepEqual(mergeTokens(c.in).map(g => g.text), c.out, `merge ${JSON.stringify(c.in)}`);
  mtPassed++;
}
for (const c of MT.issues) {
  const got = articleIssue(c.word);
  assert.equal(got?.fix ?? null, c.fix, `issue ${c.word}`);
  if (c.kind) assert.equal(got?.kind, c.kind, `issue kind ${c.word}`);
  mtPassed++;
}
{
  const w = mergeWords([
    { text: 'Kienet', start: 0, end: 0.4, prob: 0.9 },
    { text: 'L', start: 0.5, end: 0.6, prob: 0.8 },
    { text: '-festa', start: 0.6, end: 1.1, prob: 0.95, kw: true },
  ]);
  assert.deepEqual(w.map(x => x.text), ['Kienet', 'l-festa']);
  assert.equal(w[1].start, 0.5); assert.equal(w[1].end, 1.1); assert.equal(w[1].prob, 0.8); assert.equal(w[1].kw, true);
  mtPassed++;
}
console.log(`✓ ${mtPassed} Maltese cases passed (JS)`);

// ── Capital letters for names ────────────────────────────────────────────────
import { nameList, findCaseFixes, applyCaseFixes } from './names.js';
{
  const mk = s => ({ start: 0, end: 1, words: s.split(' ').map(text => ({ text, start: 0, end: 1, prob: 1 })) });
  const cues = [mk('is-soċjetà mużikali santa katarina'), mk("taż-żurrieq mhix biss f'malta."), mk('Santa Katarina u l-madonna. venera')];
  const groups = findCaseFixes(cues, nameList(['Soċjetà Mużikali Santa Katarina']));
  const byTo = Object.fromEntries(groups.map(g => [g.to, g]));
  assert.ok(byTo['Soċjetà Mużikali Santa Katarina'], 'user phrase found');
  assert.ok(!byTo['Santa Katarina'], 'already-correct phrase not offered');
  assert.equal(byTo['Żurrieq'].refs[0].text, 'taż-Żurrieq', 'article stays lower case');
  assert.equal(byTo['Malta'].refs[0].text, "f'Malta.", 'short form and full stop kept');
  const n = applyCaseFixes(cues, groups);
  assert.ok(n >= 6);
  assert.equal(cueText(cues[0]), 'is-Soċjetà Mużikali Santa Katarina');
  assert.equal(cueText(cues[2]), 'Santa Katarina u l-Madonna. Venera');
  assert.equal(findCaseFixes(cues, nameList()).length, 0, 'nothing left after applying');
  console.log('✓ names case-fix tests passed');
}

test('setWordStart retimes one word, staying between its neighbours', () => {
  const cues = cuesOf({ maxWords: 4 });
  const c = cues[0];
  const k = 2;
  const before = c.words.map(w => w.start);
  assert.equal(setWordStart(cues, 0, 0, 0.5), false, 'word 0 is pinned to the cue start');
  const t = (c.words[k - 1].start + c.words[k + 1].start) / 2;
  assert.equal(setWordStart(cues, 0, k, t), true);
  assert.equal(c.words[k].start, t);
  assert.ok(c.words[k - 1].end <= t + 1e-9, 'the word before ends by then');
  assert.deepEqual(c.words.map(w => w.start).filter((_, j) => j !== k), before.filter((_, j) => j !== k), 'others untouched');
  setWordStart(cues, 0, k, 999);
  assert.ok(c.words[k].start < c.words[k + 1].start, 'clamped before the next word');
  setWordStart(cues, 0, k, -5);
  assert.ok(c.words[k].start > c.words[k - 1].start, 'clamped after the previous word');
  console.log('✓ word timing tests passed');
});
test('big line: per-cue size, position, slant and case; end card event', () => {
  const c = cuesOf({ maxWords: 3 });
  c[0].style = PUNCH;
  const base = normalizeLook({ sizePct: 5 });
  const eff = effectiveLook(c[0], base);
  assert.ok(eff.sizePct > base.sizePct * 1.5 && eff.slant && eff.textCase === 'upper' && eff.position === 'middle');
  assert.equal(effectiveLook(c[1], base).slant, false);
  const ass = buildAss(c, base, { width: 1080, height: 1920, endCard: { text: 'Sottokumitat Kaptjins', start: 10, end: 12 } });
  const lines = ass.split('\n').filter(l => l.startsWith('Dialogue'));
  const [big, other] = lines;
  assert.ok(/\\fax-0\.2/.test(big) && /\\an5/.test(big), 'punch cue is slanted and centred');
  assert.ok(!/\\fax/.test(other), 'other cues are not slanted');
  const end = lines.find(l => l.includes('SOTTOKUMITAT'));
  assert.ok(end && end.includes('0:00:10.00,0:00:12.00'), 'end card is timed after the video');
  assert.equal(buildAss(c, base).includes('SOTTOKUMITAT'), false);
});
console.log('✓ big line tests passed');
// ── caption-free gaps ──
{
  const W = (text, start, end) => ({ text, start, end, prob: 1, speaker: 'S', kw: false });
  const words = [W('a', 0, 0.4), W('b', 0.5, 0.9), W('c', 3.0, 3.4), W('d', 3.5, 3.9), W('e', 4.0, 4.4)];
  const cues = buildCues(words, { maxWords: 6, maxPause: 0.8, maxChars: 99, gap: 1 });
  assert.equal(cues.length, 2, 'long pause splits');
  assert.ok(cues[0].end < 1.5 && cues[1].start === 3.0, 'caption leaves the screen in the pause');
  const one = [{ id: 'x', start: 0, end: 5, speaker: 'S', style: null, words: [W('a', 0, 0.4), W('b', 0.5, 0.9), W('c', 3.0, 3.4), W('d', 3.5, 3.9)] }];
  assert.ok(splitGap(one, 0, 2, 0.8));
  assert.equal(one.length, 2);
  assert.ok(one[1].start - one[0].end >= 0.79, 'gap is open');
  const tight = [{ id: 'y', start: 0, end: 2, speaker: 'S', style: null, words: [W('a', 0, 0.9), W('b', 0.9, 1.8)] }];
  assert.equal(splitGap(tight, 0, 0.9, 0.8), false, 'no pause → no gap');
}


// ── free move ──
{
  const mk = (id, s, e) => ({ id, start: s, end: e, speaker: 'S', style: null, words: [] });
  const cs = [mk('a', 0, 1), mk('b', 1, 2), mk('c', 2, 3)];
  const ni = moveCueFree(cs, 1, 6);
  assert.equal(ni, 2, 'jumps past its neighbour');
  assert.deepEqual(cs.map(c => c.id), ['a', 'c', 'b']);
  assert.ok(cs[2].start === 6 && cs[2].end === 7);
  assert.ok(moveCueFree(cs, 2, 4) >= 0 && cs[2].start === 4, 'moves into open space');
  const t = [mk('a', 0, 1), mk('b', 1, 2)];
  assert.equal(moveCueFree(t, 0, 1.2), 1, 'a cue never overlaps another');
}
