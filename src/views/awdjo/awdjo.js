// Awdjo (Video → Awdjo): the pure rules. The screen is views/Awdjo.svelte; the work is sidecar/awdjo.py.
// Which file a clean copy is written to, which sound format it gets, and how the queue of files moves.
// The sidecar re-checks the container → codec choice (AUDIO_OUT in awdjo.py); keep the two in step.

export const SUFFIX = ' (nadif)';
/** Containers the picture is copied into untouched. Everything else is written as MOV. */
export const NATIVE_EXT = ['mov', 'mp4', 'm4v', 'mxf'];
export const VIDEO_EXT = ['mov', 'mp4', 'm4v', 'mxf', 'mkv', 'avi', 'mts', 'm2ts', 'mpg', 'mpeg', 'webm', '3gp', 'wmv', 'flv'];
export const AUDIO_EXT = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'ogg', 'opus'];
export const PICK_EXT = [...VIDEO_EXT, ...AUDIO_EXT];
export const DEFAULT_STRENGTH = 100;

const sepAt = (p) => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
export const baseOf = (p) => String(p ?? '').slice(sepAt(String(p ?? '')) + 1);
export const dirOf = (p) => { const s = String(p ?? ''); const i = sepAt(s); return i < 0 ? '' : s.slice(0, i); };
export const extOf = (p) => { const n = baseOf(p); const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
export const stemOf = (p) => { const n = baseOf(p); const i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; };

export const isAudioOnly = (path) => AUDIO_EXT.includes(extOf(path));
export const isSupported = (path) => PICK_EXT.includes(extOf(path));

/** The output file's extension: the picture's own container when it is MOV/MP4/M4V/MXF, MOV for any other video, WAV for sound-only files. */
export function outputExt(path) {
  const e = extOf(path);
  if (AUDIO_EXT.includes(e)) return 'wav';
  return NATIVE_EXT.includes(e) ? e : 'mov';
}

/** The sound format of the output: MP4/M4V cannot carry PCM reliably, so they get AAC; the rest PCM 24-bit. */
export function soundFormat(ext) {
  return ['mp4', 'm4v'].includes(ext) ? { codec: 'aac', label: 'AAC 320 kbps' } : { codec: 'pcm_s24le', label: 'PCM 24-bit' };
}

/** The first `count` names to try, in order: `name (nadif).ext`, `name (nadif) 2.ext`, … next to the original. */
export function outputCandidates(path, count = 20) {
  const dir = dirOf(path);
  const stem = stemOf(path) + SUFFIX;
  const ext = outputExt(path);
  const join = (n) => `${dir ? dir + '/' : ''}${stem}${n > 1 ? ' ' + n : ''}.${ext}`;
  return Array.from({ length: count }, (_, i) => join(i + 1));
}

/** The first candidate that is not taken. `taken(paths) → Promise<boolean[]>` (the native `awdjo_taken`). Throws when 200 are all taken. */
export async function freeOutput(path, taken) {
  for (let round = 0; round < 10; round++) {
    const all = outputCandidates(path, 20 * (round + 1)).slice(20 * round);
    const used = await taken(all);
    const i = used.findIndex((u) => !u);
    if (i >= 0) return all[i];
  }
  throw new Error('too-many');
}

/** 0–100 from a slider (anything else → the default); the sidecar wants 0–1. */
export const clampStrength = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_STRENGTH; };
export const strengthFraction = (pct) => clampStrength(pct) / 100;

// ── The queue ────────────────────────────────────────────────────────────────
// item: { id, path, name, state: 'wait' | 'run' | 'done' | 'error' | 'cancelled', pct, status, output?, error?, seconds? }

export const makeItem = (path, id) => ({ id, path, name: baseOf(path), state: 'wait', pct: 0, status: '' });

/** Add files that fit (supported kind, not already waiting/running). → { queue, added, rejected } */
export function addFiles(queue, paths, newId) {
  const out = [...queue];
  let added = 0;
  const rejected = [];
  for (const p of paths) {
    if (!p) continue;
    if (!isSupported(p)) { rejected.push(baseOf(p)); continue; }
    if (out.some((q) => q.path === p && (q.state === 'wait' || q.state === 'run'))) continue;
    out.push(makeItem(p, newId()));
    added++;
  }
  return { queue: out, added, rejected };
}

export const nextWaiting = (queue) => queue.find((q) => q.state === 'wait') ?? null;
export const isRunning = (queue) => queue.some((q) => q.state === 'run');
export const finished = (q) => ['done', 'error', 'cancelled'].includes(q.state);

/** Take out one item (never one that is running). */
export const removeItem = (queue, id) => queue.filter((q) => q.id !== id || q.state === 'run');
/** Take out everything that has ended (done, failed, cancelled). */
export const clearFinished = (queue) => queue.filter((q) => !finished(q));
/** Failed and cancelled items go back to waiting. */
export const retryFailed = (queue) => queue.map((q) => (q.state === 'error' || q.state === 'cancelled' ? { ...q, state: 'wait', pct: 0, status: '', error: undefined } : q));

export function counts(queue) {
  const c = { wait: 0, run: 0, done: 0, error: 0, cancelled: 0 };
  for (const q of queue) c[q.state]++;
  return c;
}

/** Overall progress 0–100 of the files not yet taken out: each finished file counts 1, the running one its own percentage. */
export function overallPct(queue) {
  const live = queue.filter((q) => q.state !== 'cancelled' || q.pct > 0);
  if (!live.length) return 0;
  const sum = live.reduce((s, q) => s + (finished(q) ? 100 : q.state === 'run' ? q.pct : 0), 0);
  return Math.round(sum / live.length);
}
