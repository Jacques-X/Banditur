// Unit tests for the subtitle engine. Run: npm test (or node --test src/subtitles/subtitles.test.mjs)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  wordsFromSidecar, buildCues, cueText, cueIndexAt, splitAt, splitBefore, joinNext,
  trimIn, trimOut, rollIn, rollOut, moveFirstWordToPrev, moveLastWordToNext,
  setCueText, toggleKeyword, findNameVariants, replaceVariants, replaceText, wrapLines,
  buildSrt, nextUnsure, normKey, SubtitleDoc, flattenWords, mergeArticlesInCues,
  joinWordWithNext, cueIssues, suggestKeywords, setCueTimes, moveCue, moveCueFree, snapTimes,
} from './model.js';
import { setWordStart, splitGap, setCueLook, resetCueLook } from './model.js';
import { behindCues, behindRanges } from './styles.js';
import { KEY_FIT, migrateCueStyles, DEFAULT_PRESET, DEFAULT_LOOK, riseWord, riseKeyScale, riseFadeOut, riseAt, riseEdges, easeOutCubic, RISE_MS, RISE_DY, fitLimits, TIER_MIN, tierKeyword, cueLines, withRotation, cueAnchor, ROTATION, TIER_HELPER, buildAss, assColor, assTime, wordSlots, frameState, normalizeLook, PRESETS, WORD_EFFECTS, ENTRIES, lookFromPreset, layoutFor, formatOf, effectiveLook, CUE_LOOK_KEYS, restoreLook, FONTS, PUNCH } from './styles.js';

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
  assert.equal(restoreLook({ preset: 'hoss', sizePct: 8.5 }).preset, 'dinamiku', 'removed presets start from the default');
  assert.equal(restoreLook({ preset: 'custom', sizePct: 9 }).sizePct, 9, 'custom looks are kept');
  assert.equal(restoreLook({ preset: 'saved:x' }).preset, 'saved:x');
  assert.equal(restoreLook(null).preset, 'dinamiku');
  assert.deepEqual(PRESETS.map(p => p.id), ['dinamiku', 'pillola', 'klassiku']);
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
  assert.equal(left.an, 4, 'left: anchored on the middle of the caption');
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

// ── Maltese articles (shared cases with sidecar/test_maltese.py) ───────────
import { readFileSync } from 'node:fs';
import { mergeTokens, mergeWords, articleIssue } from './maltese.js';
const MT = JSON.parse(readFileSync(new URL('./maltese-cases.json', import.meta.url), 'utf8'));
for (const c of MT.merge) {
  test(`Maltese merge ${JSON.stringify(c.in)}`, () => {
    assert.deepEqual(mergeTokens(c.in).map(g => g.text), c.out);
  });
}
for (const c of MT.issues) {
  test(`Maltese article issue ${c.word}`, () => {
    const got = articleIssue(c.word);
    assert.equal(got?.fix ?? null, c.fix);
    if (c.kind) assert.equal(got?.kind, c.kind);
  });
}
test('Maltese mergeWords keeps timing, probability and keyword flag', () => {
  const w = mergeWords([
    { text: 'Kienet', start: 0, end: 0.4, prob: 0.9 },
    { text: 'L', start: 0.5, end: 0.6, prob: 0.8 },
    { text: '-festa', start: 0.6, end: 1.1, prob: 0.95, kw: true },
  ]);
  assert.deepEqual(w.map(x => x.text), ['Kienet', 'l-festa']);
  assert.equal(w[1].start, 0.5); assert.equal(w[1].end, 1.1); assert.equal(w[1].prob, 0.8); assert.equal(w[1].kw, true);
});

// ── Capital letters for names ────────────────────────────────────────────────
import { nameList, findCaseFixes, applyCaseFixes } from './names.js';
test('capital letters for names', () => {
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
});

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
// ── caption-free gaps ──
test('caption-free gaps', () => {
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
});


// ── free move ──
test('free move of a caption', () => {
  const mk = (id, s, e) => ({ id, start: s, end: e, speaker: 'S', style: null, words: [] });
  const cs = [mk('a', 0, 1), mk('b', 1, 2), mk('c', 2, 3)];
  const ni = moveCueFree(cs, 1, 6);
  assert.equal(ni, 2, 'jumps past its neighbour');
  assert.deepEqual(cs.map(c => c.id), ['a', 'c', 'b']);
  assert.ok(cs[2].start === 6 && cs[2].end === 7);
  assert.ok(moveCueFree(cs, 2, 4) >= 0 && cs[2].start === 4, 'moves into open space');
  const t = [mk('a', 0, 1), mk('b', 1, 2)];
  assert.equal(moveCueFree(t, 0, 1.2), 1, 'a cue never overlaps another');
});

// ── captions fit lines × chars per line ──
test('captions fit lines × chars per line', () => {
  const W = (text, start) => ({ text, start, end: start + 0.3, prob: 1, speaker: 'S', kw: false });
  const words = 'il-festa ta Santa Katarina kienet sabiħa ħafna din is-sena'.split(' ').map((t, i) => W(t, i * 0.35));
  const one = buildCues(words, { maxWords: 15, maxPause: 1, maxChars: 999, lineChars: 16, maxLines: 1 });
  assert.ok(one.every(c => cueText(c).length <= 16 || c.words.length === 1), 'one line of 16');
  const two = buildCues(words, { maxWords: 15, maxPause: 1, maxChars: 999, lineChars: 16, maxLines: 2 });
  assert.ok(two.length < one.length, 'two lines hold more');
  const many = buildCues(words, { maxWords: 3, maxPause: 1, maxChars: 999, lineChars: 60, maxLines: 2 });
  assert.ok(many.every(c => c.words.length <= 3), 'word cap still applies');
});

// ── one caption's own look ──
test('one caption\'s own look', () => {
  const W = (text, start) => ({ text, start, end: start + 0.3, prob: 1, speaker: 'S', kw: false });
  const cues = [
    { id: 'a', start: 0, end: 1, speaker: 'S', style: null, words: [W('Bonġu', 0), W('Malta', 0.4)] },
    { id: 'b', start: 1, end: 2, speaker: 'S', style: null, words: [W('il-festa', 1), W('sabiħa', 1.4)] },
  ];
  const look = lookFromPreset('classic');
  assert.ok(setCueLook(cues, 1, { color: '#FF0000', sizePct: 9 }));
  assert.equal(effectiveLook(cues[0], look).color, look.color, 'other captions keep the video look');
  assert.equal(effectiveLook(cues[1], look).color, '#FF0000');
  const ass = buildAss(cues, look, { width: 1920, height: 1080 });
  const lines = ass.split('\n').filter(l => l.startsWith('Dialogue'));
  assert.ok(!lines.find(l => l.includes('Bonġu')).includes('\\1c&H0000FF&'), 'first caption untouched');
  assert.ok(lines.find(l => l.includes('il-festa')).includes('\\1c&H0000FF&'), 'own colour inline');
  assert.ok(/\\fs\d+/.test(lines.find(l => l.includes('il-festa'))), 'own size inline');
  assert.ok(setCueLook(cues, 1, { color: null, sizePct: null }) && !('look' in cues[1]), 'removing every override drops it');
  setCueLook(cues, 1, { font: 'Montserrat Black' });
  assert.ok(!CUE_LOOK_KEYS.includes('box'));
  assert.ok(resetCueLook(cues, 1) && !cues[1].look);
});

// ── the caption's middle is the anchor: a bigger size keeps the same height ──
test('the caption\'s middle is the anchor', () => {
  const base = { ...lookFromPreset('klassiku'), position: 'bottom', safeArea: false };
  const a = layoutFor({ ...base, sizePct: 4 }, 1080, 1920);
  const b = layoutFor({ ...base, sizePct: 10 }, 1080, 1920);
  assert.equal(a.an, 5);
  assert.equal(a.anchor.y, b.anchor.y, 'same middle line at any size');
  const ass = buildAss([{ id: 'x', start: 0, end: 1, speaker: 'S', style: null, words: [{ text: 'Bonġu', start: 0, end: 0.5, prob: 1, speaker: 'S', kw: false }] }], base, { width: 1080, height: 1920 });
  assert.ok(ass.includes('\\an5\\pos('), 'export uses the middle anchor');
});

// ── Dinamiku: big keyword, rotating places, exact places ─────────────────────
const tierCue = (texts, kw = -1) => ({
  start: 0, end: 2, speaker: 'S',
  words: texts.map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35, prob: 1, kw: i === kw })),
});
const dyn = () => normalizeLook({ ...lookFromPreset('dinamiku'), word: 'pop', rotate: true, position: 'middle', maxChars: 12 });   // the first Dinamiku: pop, rotating places
const calm = () => lookFromPreset('dinamiku');

test('the keyword is the marked word, else the longest one', () => {
  assert.deepEqual(tierKeyword(tierCue(['If', 'the', 'Prospects', 'have'])), [2, 2]);
  assert.deepEqual(tierKeyword(tierCue(['If', 'the', 'Prospects', 'have'], 1)), [1, 1]);
  const run = tierCue(['being', 'on', 'Camera', 'Stresses']);
  run.words[2].kw = run.words[3].kw = true;
  assert.deepEqual(tierKeyword(run), [2, 3]);
  assert.deepEqual(tierKeyword(tierCue(['Aa.', 'bb!'])), [1, 1], 'ties go to the later word, punctuation does not count');
});

test('big keyword layout: helper words above and below, each line has its size', () => {
  const c = tierCue(['If', 'the', 'Prospects', 'have', 'to']);
  const { lines, size, key } = cueLines(c, dyn(), 12);
  assert.deepEqual(lines, [[0, 1], [2], [3, 4]]);
  assert.deepEqual(size, [TIER_HELPER, 1, TIER_HELPER]);
  assert.deepEqual(key, [2, 2]);
  const plain = cueLines(c, normalizeLook({ tier: false }), 32);
  assert.equal(plain.size, null);
  assert.deepEqual(cueLines(tierCue(['Prospects']), dyn(), 12).lines, [[0]]);
});

test('big keyword: the keyword takes the accent colour, no emphasis scale', () => {
  const c = tierCue(['If', 'the', 'Prospects']);
  const st = frameState(c, dyn(), 1);
  assert.deepEqual(st.words.map(w => w.color), ['base', 'base', 'accent']);
  assert.ok(st.words.every(w => w.scale === 1 || w.scale > 0));
});

test('big keyword ASS: each line restates its size and font, keyword coloured', () => {
  const c = { ...tierCue(['If', 'the', 'Prices', 'have']), start: 0, end: 2 };
  const ass = buildAss([c], dyn(), { width: 1080, height: 1920 });
  const lines = ass.split('\n').filter(l => l.startsWith('Dialogue: 1'));
  const last = lines[lines.length - 1];
  assert.match(last, /\\fs\d+\\fnMontserrat SemiBold\}If the/);
  assert.match(last, /\\fnMontserrat Black\}/);
  const L = layoutFor(dyn(), 1080, 1920);
  assert.ok(last.includes(`\\fs${L.fontSize}\\fnMontserrat Black`));
  assert.ok(last.includes(`\\fs${Math.round(L.fontSize * TIER_HELPER)}\\fnMontserrat SemiBold`));
  assert.match(last, /\\N/);
});

test('rotation: consecutive captions take different places, all inside the safe area', () => {
  const cues = Array.from({ length: 8 }, (_, i) => ({ ...tierCue(['a', 'bbb']), start: i * 2, end: i * 2 + 1.5 }));
  const look = dyn();
  const view = withRotation(cues, look);
  for (let i = 1; i < view.length; i++) assert.notDeepEqual(view[i].autoPos, view[i - 1].autoPos);
  assert.deepEqual(view[ROTATION.length].autoPos, view[0].autoPos, 'the cycle repeats');
  assert.equal(withRotation(cues, normalizeLook({ rotate: false })), cues, 'off: the same array');
  const sa = { top: 0.12, bottom: 0.2 };
  for (let i = 0; i < view.length; i++) {
    const { y } = cueAnchor(cues, i, look, 1080, 1920);
    assert.ok(y >= sa.top && y <= 1 - sa.bottom, `slot ${i} y=${y}`);
  }
  assert.notDeepEqual(cueAnchor(cues, 0, look, 1080, 1920), cueAnchor(cues, 1, look, 1080, 1920));
});

test('an exact place wins over rotation and is kept inside the frame; the big line ignores rotation', () => {
  const cues = [tierCue(['a', 'bbb']), tierCue(['c', 'ddd'])];
  cues[0].look = { posX: 0.2, posY: 0.3 };
  const look = dyn();
  const a0 = cueAnchor(cues, 0, look, 1000, 2000);
  assert.ok(Math.abs(a0.x - 0.2) < 0.01 && a0.y >= 0.3 - 0.01);
  assert.equal(normalizeLook({ posX: 5, posY: -2 }).posX, 0.95);
  assert.equal(normalizeLook({ posX: 5, posY: -2 }).posY, 0.05);
  assert.equal(normalizeLook({ posX: 0.4 }).posX, null, 'both or neither');
  assert.equal(normalizeLook({}).posX, null);
  cues[1].style = PUNCH;
  const view = withRotation(cues, look);
  assert.equal(effectiveLook(view[1], look).posX, null, 'big line (A) stays mid-frame');
  assert.ok(CUE_LOOK_KEYS.includes('posX') && CUE_LOOK_KEYS.includes('tier'));
});

test('an exact place reaches the ASS \\pos', () => {
  const c = { ...tierCue(['a', 'bbbb']), start: 0, end: 2, look: { posX: 0.25, posY: 0.4 } };
  const ass = buildAss([c], normalizeLook({ safeArea: false }), { width: 1000, height: 2000 });
  assert.match(ass, /\\an5\\pos\(250,800\)/);
});

test('behind the speaker: layers split the ASS and ranges cover the cues', () => {
  const w = (t, s, e) => ({ text: t, start: s, end: e, key: false });
  const cues = [
    { start: 1, end: 2, words: [w('Bongu', 1, 2)] },
    { start: 3, end: 4, words: [w('Malta', 3, 4)], look: { behind: true } },
  ];
  const look = lookFromPreset('dinamiku');
  const opts = { width: 1920, height: 1080 };
  const count = a => (a.match(/^Dialogue:/gm) || []).length;
  const all = buildAss(cues, look, opts);
  const front = buildAss(cues, look, { ...opts, layer: 'front' });
  const behind = buildAss(cues, look, { ...opts, layer: 'behind' });
  assert.equal(count(front) + count(behind), count(all));
  assert.ok(count(behind) > 0 && count(front) > 0);
  assert.ok(!front.includes('Malta') && behind.includes('Malta') && !behind.includes('Bongu'));
  assert.equal(behindCues(cues, look).length, 1);
  const [r] = behindRanges(cues, look, 0.15);
  assert.ok(Math.abs(r[0] - 2.85) < 1e-9 && Math.abs(r[1] - 4.15) < 1e-9);
  assert.ok(CUE_LOOK_KEYS.includes('behind'));
});

// ── Deheb removed, Dinamiku calm ('rise') ────────────────────────────────────

test('the default preset is Dinamiku and Deheb is gone', () => {
  assert.equal(DEFAULT_PRESET, 'dinamiku');
  assert.equal(DEFAULT_LOOK.preset, 'dinamiku');
  assert.ok(!PRESETS.some(p => p.id === 'deheb'));
  assert.equal(lookFromPreset('nothing').preset, 'dinamiku', 'an unknown id falls back to the default preset');
  const d = PRESETS.find(p => p.id === 'dinamiku');
  assert.equal(d.name, 'Dinamiku');
  assert.equal(d.words, 5);
  assert.equal(d.look.word, 'rise');
  assert.equal(d.look.rotate, false);
  assert.equal(d.look.position, 'lowmid');
  assert.ok(WORD_EFFECTS.some(w => w.id === 'pop') && WORD_EFFECTS.some(w => w.id === 'bounce'), 'pop and bounce stay for hand-picking');
});

test('Deheb data keeps its values and becomes custom', () => {
  const stored = { preset: 'deheb', font: 'Montserrat Bold', sizePct: 5.2, color: '#FFFFFF', accent: '#E2AD72', outlinePct: 0, shadow: true, position: 'bottom', maxChars: 20, maxLines: 1, entry: 'none', word: 'active', emphasis: 'none' };
  const r = restoreLook(stored);
  assert.equal(r.preset, 'custom');
  for (const k of ['font', 'sizePct', 'accent', 'maxChars', 'maxLines', 'word', 'emphasis', 'position', 'outlinePct']) assert.equal(r[k], stored[k], k);
  assert.equal(normalizeLook(stored).preset, 'custom', 'saved looks and imported .bstyle files go through normalizeLook');
  assert.equal(normalizeLook({ ...stored, preset: 'saved:abc' }).preset, 'saved:abc');
  assert.equal(restoreLook({ preset: 'hoss' }).preset, 'dinamiku', 'other unknown ids still start from the default');
  // a caption's own preset id → the animation it gave, as the caption's own look
  const cues = [{ id: 1, style: 'deheb', start: 0, end: 1, words: [] }, { id: 2, style: 'pillola', start: 1, end: 2, words: [] }, { id: 3, style: 'deheb', look: { word: 'karaoke' }, start: 2, end: 3, words: [] }];
  const m = migrateCueStyles(cues);
  assert.deepEqual([m[0].style, m[0].look], [null, { entry: 'none', word: 'active', emphasis: 'none' }]);
  assert.equal(m[1], cues[1]);
  assert.equal(m[2].look.word, 'karaoke', 'a look of its own wins');
  assert.equal(cues[0].style, 'deheb', 'the input is not changed');
  assert.equal(migrateCueStyles([cues[1]])[0], cues[1]);
  const base = lookFromPreset('klassiku');
  assert.equal(effectiveLook({ style: 'deheb' }, base).word, 'active', 'even before migration the caption looks as it did');
});

test('rise: opacity and offset follow an ease-out cubic, no overshoot', () => {
  assert.deepEqual(riseWord(0), { opacity: 0, dy: RISE_DY });
  assert.deepEqual(riseWord(RISE_MS), { opacity: 1, dy: 0 });
  assert.deepEqual(riseWord(5000), { opacity: 1, dy: 0 });
  assert.equal(riseWord(-50).opacity, 0);
  const mid = riseWord(RISE_MS / 2);
  assert.ok(Math.abs(mid.opacity - 0.875) < 1e-9 && Math.abs(mid.dy - 0.0625) < 1e-9, 'ease-out cubic at the half: 0.875');
  let prev = riseWord(0);
  for (let ms = 5; ms <= 260; ms += 5) {
    const r = riseWord(ms);
    assert.ok(r.opacity >= prev.opacity && r.dy <= prev.dy && r.opacity <= 1 && r.dy >= 0, 'monotonic, never past the end');
    prev = r;
  }
  assert.equal(easeOutCubic(2), 1);
  assert.equal(riseKeyScale(0), 0.9);
  assert.equal(riseKeyScale(250), 1);
  assert.equal(riseKeyScale(1000), 1);
  for (let ms = 0; ms <= 300; ms += 5) assert.ok(riseKeyScale(ms) <= 1 && riseKeyScale(ms) >= 0.9, 'the keyword scale never passes 1');
  assert.equal(riseFadeOut(1.0, 2.0), 1);
  assert.equal(riseFadeOut(2.0, 2.0), 0);
  assert.ok(Math.abs(riseFadeOut(1.91, 2.0) - 0.5) < 1e-9, 'fades out over the last 180 ms');
});

test('rise: frameState hides unspoken words, keeps spoken ones, scales the keyword and fades the block', () => {
  const c = { ...tierCue(['Il', 'festa', 'ta', 'Santa', 'Marija'], 3), start: 0, end: 3 };
  c.words[3].start = 1.2; c.words[4].start = 1.6;
  const look = calm();
  const before = frameState(c, look, 0.1);
  assert.deepEqual(before.words.map(w => w.visible), [true, false, false, false, false]);
  assert.ok(before.words[0].opacity < 1 && before.words[0].dy > 0, 'the first word is still rising');
  const t = frameState(c, look, 1.2 + 0.11);
  assert.ok(t.words[3].opacity > 0.5 && t.words[3].opacity < 1 && t.words[3].dy > 0 && t.words[3].dy < RISE_DY);
  assert.ok(t.keyScale > 0.9 && t.keyScale < 1, 'the keyword grows while it appears');
  assert.equal(t.words[4].visible, false);
  assert.equal(t.words[0].opacity, 1, 'words already spoken stay fully visible');
  assert.equal(t.words[0].dy, 0);
  const late = frameState(c, look, 2.0);
  assert.ok(late.words.every(w => w.visible && w.opacity === 1 && w.dy === 0) && late.keyScale === 1);
  const out = frameState(c, look, 2.91);
  assert.ok(out.words.every(w => Math.abs(w.opacity - 0.5) < 1e-6), 'the whole block fades together');
  assert.equal(frameState(c, { ...look, entry: 'slide' }, 1.2 + 0.05).dy, 0, "Jitla' has its own entry: the entry layer is ignored");
});

test('tier layout with 1 to 5 words: empty lines are skipped, the keyword line is the big one', () => {
  const look = calm();
  const words = ['Il-festa', 'ta\'', 'Santa', 'Marija', 'tibda'];
  for (let n = 1; n <= 5; n++) {
    for (let kw = 0; kw < n; kw++) {
      const c = tierCue(words.slice(0, n), kw);
      const { lines, size, key, keyLine } = cueLines(c, look, 10);
      assert.deepEqual(key, [kw, kw]);
      assert.deepEqual(lines.flat(), Array.from({ length: n }, (_, i) => i), `${n} words, keyword ${kw}: every word once, in order`);
      assert.ok(lines.every(l => l.length), 'no empty line');
      assert.equal(keyLine.filter(Boolean).length, 1);
      const ki = keyLine.indexOf(true);
      assert.deepEqual(lines[ki], [kw]);
      const expect = (kw > 0 ? 1 : 0) + 1 + (kw < n - 1 ? 1 : 0);
      assert.ok(lines.length >= expect, 'before, keyword, after');
      for (let i = 0; i < lines.length; i++) if (i !== ki) assert.ok(size[i] < size[ki], 'small words are smaller than the keyword');
    }
  }
  const two = tierCue(['aa', 'Karozza', 'blu', 'sabiħa', 'tassew'], 1);
  two.words[2].kw = true;
  const r = cueLines(two, look, 12);
  assert.deepEqual(r.lines, [[0], [1, 2], [3, 4]], 'a two-word keyword stays on one line');
});

test('tier layout: a long keyword shrinks to fit, never below the minimum', () => {
  const look = calm();
  const fits = cueLines(tierCue(['a', 'Karozza', 'b'], 1), look, 8);
  assert.equal(fits.size[fits.keyLine.indexOf(true)], 1, 'a keyword that fits keeps full size');
  const long = cueLines(tierCue(['a', 'pubblikazzjonijiet', 'b'], 1), look, 10);
  const rel = long.size[long.keyLine.indexOf(true)];
  assert.ok(Math.abs(rel - (10 * KEY_FIT) / 18) < 1e-9, 'shrinks to what fits / length');
  const huge = cueLines(tierCue(['a', 'internazzjonalizzazzjoni', 'b'], 1), look, 8);
  assert.equal(huge.size[huge.keyLine.indexOf(true)], TIER_MIN);
  assert.ok(huge.lines.length >= 3);
  const ass = buildAss([{ ...tierCue(['a', 'pubblikazzjoni', 'b'], 1), start: 0, end: 2 }], look, { width: 1080, height: 1920 });
  const L = layoutFor(look, 1080, 1920);
  assert.ok(ass.includes(`\\fs${Math.round(L.fontSize * (L.maxChars * KEY_FIT / 14))}\\fnMontserrat Black`), 'the keyword line states its shrunk size');
});

test('Dinamiku fits both frames at 5 words: the widest line stays inside the frame', () => {
  const look = calm();
  const sample = [['Il-festa', 'ta\'', 'Santa', 'Marija', 'tibda'], ['aa', 'bb', 'Karrozzi', 'cc', 'dd'], ['pubblikazzjoni', 'ta\'', 'dawn', 'il-ġimgħa', 'x']];
  for (const [w, h] of [[1080, 1920], [1920, 1080], [1080, 1080]]) {
    const L = layoutFor(look, w, h);
    for (const texts of sample) {
      const kw = texts.reduce((b, t, i) => (t.length >= texts[b].length ? i : b), 0);
      const { lines, size, keyLine } = cueLines(tierCue(texts, kw), look, L.maxChars);
      lines.forEach((l, i) => {
        const chars = l.map(k => texts[k].length).reduce((n, x) => n + x, 0) + l.length - 1;
        const wpx = chars * L.fontSize * size[i] * 0.45;   // a real Montserrat letter, capitals included, is about 0.45 of the ASS font size wide
        assert.ok(wpx <= w - 2 * L.marginH + 1, `${w}x${h} line ${i} (${wpx.toFixed(0)}px) fits`);
      });
    }
    assert.equal(L.anchor.y, Math.round(h * 0.64), 'the middle of the caption sits at 64 %');
    assert.equal(look.rotate, false);
  }
});

test('Dinamiku cuts captions of up to 5 words', () => {
  const look = calm();
  const w = Array.from({ length: 20 }, (_, i) => ({ text: ['Il-festa', 'ta\'', 'Santa', 'Marija', 'tibda', 'llum', 'filgħaxija', 'bil-banda'][i % 8], start: i * 0.3, end: i * 0.3 + 0.25, prob: 1, speaker: 'S' }));
  for (const [fw, fh] of [[1080, 1920], [1920, 1080]]) {
    const lim = fitLimits(look, fw, fh);
    const cues = buildCues(w, { maxWords: 5, maxPause: 5, maxChars: 999, ...lim });
    assert.ok(Math.max(...cues.map(c => c.words.length)) === 5, `${fw}x${fh}: five words fit one caption`);
    assert.ok(cues.every(c => c.words.length <= 5));
  }
  assert.equal(PRESETS.find(p => p.id === 'dinamiku').words, 5);
  assert.equal(fitLimits(normalizeLook({ ...DEFAULT_LOOK, tier: false }), 1920, 1080).maxLines, 2, 'other looks keep two lines');
});

test('ASS for Jitla\': one event per word and piece, whole caption in each, others transparent, no overshoot', () => {
  const c = { ...tierCue(['Il-festa', 'ta\'', 'Santa', 'Marija', 'tibda'], 2), start: 0.2, end: 2.6 };
  c.words.forEach((w, i) => { w.start += 0.2; w.end += 0.2; });
  const ass = buildAss([c], calm(), { width: 1080, height: 1920 });
  const ev = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
  const L = layoutFor(calm(), 1080, 1920);
  assert.ok(ev.length >= 5 * 3);
  for (const e of ev) {
    const text = e.split(',').slice(9).join(',');
    assert.equal((text.match(/\{/g) || []).length, (text.match(/\}/g) || []).length);
    assert.equal((text.match(/\\N/g) || []).length, 2, 'the same three lines in every event');
    assert.ok(text.includes('Il-festa') && text.includes('tibda'), 'the whole caption is in every event');
    assert.equal((text.match(/\\1a&H/g) || []).length >= 1, true);
  }
  // the keyword (word 2) first appears at its start, moving from +0.5 em to its place
  const k = ev.filter(e => e.includes('Santa') && /\\1a&HFF&\\3a&HFF&\\4a&HFF&/.test(e.split('Santa')[0].slice(-80) + '') );
  assert.ok(k.length >= 1);
  const m = ev.map(e => e.match(/\\move\((\d+),([\d.]+),(\d+),([\d.]+),0,(\d+)\)/)).filter(Boolean);
  assert.ok(m.length > 5);
  for (const x of m) assert.ok(Number(x[2]) >= Number(x[4]), 'moves up only');
  assert.ok(m.every(x => Number(x[2]) <= L.anchor.y + 0.5 * L.fontSize * 0.64 + 0.1), 'never more than half an em below its place');
  assert.ok(ev.every(e => !/\\fsc[xy](1[1-9]\d)/.test(e)), 'no scale above 100 %');
  assert.ok(ev.some(e => /\\fscx90\\fscy90/.test(e)), 'the keyword line starts at 90 %');
  assert.equal(ev[ev.length - 1].split(',')[2], '0:00:02.60', 'every event ends with the caption');
  const last = ev.filter(e => e.split(',')[2] === '0:00:02.60');
  assert.ok(last.length >= 5, 'every word fades out to the cue end');
  assert.ok(ev.every(e => !/\\fad\(/.test(e)), 'the fade-out is in the alpha pieces, not \\fad');
});

test('riseEdges: on the centisecond grid, inside the caption, ends at the cue end', () => {
  const slots = wordSlots({ ...tierCue(['a', 'b', 'c'], 1), start: 0, end: 2 });
  for (const key of [null, [1, 1]]) {
    for (let i = 0; i < 3; i++) {
      const e = riseEdges(slots, i, key);
      assert.equal(e[0], slots.b[i]);
      assert.equal(e[e.length - 1], 2);
      for (const x of e) assert.ok(Math.abs(x * 100 - Math.round(x * 100)) < 1e-6);
      assert.deepEqual(e, [...e].sort((a, b) => a - b));
      assert.equal(new Set(e).size, e.length);
    }
  }
});
