import { newId, buildCues, clone } from './model.js';
export function parseSrt(text) {
  const stamp = (s) => {
    const m = s.match(/^(\d{1,3}):(\d\d):(\d\d)[,.](\d{3})$/);
    if (!m || +m[2] > 59 || +m[3] > 59) throw new Error('Ħin SRT mhux validu.');
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
  };
  const cues = [];
  for (const block of text
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim()
    .split(/\n\s*\n/)) {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0]?.trim())) lines.shift();
    const times = lines
      .shift()
      ?.trim()
      .split(/\s*-->\s*/);
    if (times?.length !== 2) throw new Error('Struttura SRT mhux valida.');
    const start = stamp(times[0]),
      end = stamp(times[1].split(/\s/)[0]);
    if (end <= start || (cues.length && start < cues.at(-1).end))
      throw new Error('L-SRT għandu ħinijiet sovrapposti jew maqluba.');
    const text = lines
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .trim();
    if (!text) continue;
    const parts = text.split(/\s+/),
      duration = (end - start) / parts.length;
    cues.push({
      id: newId(),
      start,
      end,
      speaker: 'SPEAKER_00',
      style: null,
      words: parts.map((text, i) => ({
        text,
        start: start + i * duration,
        end: start + (i + 1) * duration,
        prob: 1,
        speaker: 'SPEAKER_00',
        kw: false,
      })),
    });
  }
  if (!cues.length) throw new Error('L-SRT ma fihx subtitles.');
  return cues;
}
export function replacePassage(cues, start, end, words, options = {}) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new Error('Agħżel passaġġ validu.');
  const affected = cues.filter((c) => c.start < end && c.end > start),
    base = affected[0];
  const before = [],
    after = [];
  for (const original of cues) {
    if (original.end <= start) {
      before.push(clone(original));
      continue;
    }
    if (original.start >= end) {
      after.push(clone(original));
      continue;
    }
    const left = original.words.filter((w) => w.end <= start),
      right = original.words.filter((w) => w.start >= end);
    if (left.length)
      before.push({ ...clone(original), end: Math.min(start, original.end), words: clone(left) });
    if (right.length)
      after.push({
        ...clone(original),
        id: newId(),
        start: Math.max(end, original.start),
        words: clone(right),
      });
  }
  const middle = buildCues(
    words.filter((w) => w.start >= start && w.end <= end + 0.02),
    options,
  ).map((c) => ({ ...c, style: base?.style || null, ...(base?.look ? { look: clone(base.look) } : {}) }));
  if (!middle.length) throw new Error('Ma nstab l-ebda kliem ġdid.');
  return [...before, ...middle, ...after];
}
