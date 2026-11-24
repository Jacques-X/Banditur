// Pure helpers for the SD-card archive: turning the review into an upload job, matching Kalendarju
// events to a group, and telling when a card is safe to format. (Rules live in backend/api/_lib/archive-rules.js.)
import { planGroup, fingerprintOf, extOf, dayOf, clockOf, KINDS } from '../../backend/api/_lib/archive-rules.js';

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', mov: 'video/quicktime', mxf: 'application/mxf', mts: 'video/mp2t', m2ts: 'video/mp2t', avi: 'video/x-msvideo', mkv: 'video/x-matroska', m4v: 'video/x-m4v',
};
export const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';

const minutes = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

/**
 * Calendar events that fit a group: on the group's date and, for timed events, within a couple of hours of it.
 * occurrences: [{ event, start, end, allDay, first, last }]  (start/end are 'YYYY-MM-DDTHH:MM')
 * → [{ id, title, score }] best first.
 */
export function matchEvents(group, occurrences) {
  const from = minutes(clockOf(group.from)), to = minutes(clockOf(group.to));
  const out = [];
  for (const o of occurrences) {
    if (!(o.first <= group.date && group.date <= o.last)) continue;
    let score = 1;
    if (!o.allDay) {
      const s = minutes(o.start.slice(11, 16)), e = o.end ? minutes(o.end.slice(11, 16)) : s + 60;
      const lo = Math.min(s, e) - 120, hi = Math.max(s, e) + 120;
      if (o.first === o.last && (to < lo || from > hi)) continue; // a timed event that day, but nowhere near
      score = from <= hi && to >= lo ? 3 : 2;
    }
    out.push({ id: o.event.id, title: o.event.title, score });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

/** Items to upload, one per file of every group that is not left out. `dest` is the Drive folder path, `rel` the same below a local backup folder. */
export function buildItems(groups) {
  const items = [];
  let n = 0;
  for (const g of groups) {
    for (const { file, path } of planGroup(g)) {
      if (!path || file.onDrive) continue;
      items.push({
        id: `i${++n}`, path: file.path, name: file.name, size: file.size, kind: file.kind, taken: file.taken, mime: mimeOf(file.name),
        fp: fingerprintOf(file), dest: path, rel: `${path.slice(1).join('/')}/${file.name}`, state: 'pending', sessionUrl: '', error: '',
      });
    }
  }
  return items;
}

/** How many files of one job are uploaded at the same time. */
export const PARALLEL = 3;

/** Split a list into pieces of at most `n`. */
export function chunks(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** The next files to upload, looking from index `from`: finished ones are passed over. → { group, next } (`next` = where to look afterwards). */
export function takeGroup(items, from = 0, n = PARALLEL) {
  const group = [];
  let i = from;
  for (; i < items.length && group.length < n; i++) {
    if (items[i].state === 'done' || items[i].state === 'skipped') continue;
    group.push(items[i]);
  }
  return { group, next: i };
}

/** Names of the files in flight, for the progress line. */
export const nowLabel = (group) => group.map((i) => i.name).join(' · ');

/** What the backend's `session` / `sessions` expect for one file. */
export const sessionBody = (it) => ({ path: it.dest, name: it.name, size: it.size, mime: it.mime, fingerprint: it.fp });

/** What `finish` / `finishMany` expect for one uploaded file. */
export const finishBody = (it, put) => ({ fileId: put.file_id, md5: put.md5, size: it.size, fingerprint: it.fp });

/** Put the backend's answer for one file on the item. → 'skipped' (already on Drive) | 'ready' (has a session) | 'error' */
export function applySession(it, r) {
  if (r?.exists) { it.state = 'skipped'; return 'skipped'; }
  if (r?.sessionUrl) { it.sessionUrl = r.sessionUrl; return 'ready'; }
  return 'error';
}

/** Put the backend's verification of one file on the item. → '' when fine, else the message to show. */
export function applyFinish(it, r) {
  if (!r || r.error) return r?.error || 'Drive ma kkonfermax il-fajl.';
  if (!r.ok) { it.sessionUrl = ''; return `${it.name} ma wasalx sħiħ fuq Drive. Se nerġgħu nippruvaw.`; }
  it.state = r.duplicate ? 'skipped' : 'done';
  return '';
}

/** Why a group of parallel uploads must stop the job, from the errors it produced: 'paused' | 'card' | 'offline' | '' (just mark the files failed). */
export function stopReason(errors) {
  const text = errors.map((e) => String(e?.message || e || ''));
  if (text.includes('cancelled')) return 'paused';
  if (text.some((m) => /nstabx|tqrax|inbidel/.test(m))) return 'card';
  if (errors.some((e) => !e?.status)) return 'offline';
  return '';
}

export function jobStats(job) {
  const s = { total: job.items.length, done: 0, skipped: 0, failed: 0, bytes: 0, bytesDone: 0 };
  for (const it of job.items) {
    s.bytes += it.size;
    if (it.state === 'done') { s.done++; s.bytesDone += it.size; }
    else if (it.state === 'skipped') { s.skipped++; s.bytesDone += it.size; }
    else if (it.state === 'failed') s.failed++;
  }
  return s;
}

/** Everything on the card is on Drive (uploaded now, or already there): the user may format it. */
export const safeToFormat = (job) => !!job.items.length && job.items.every((i) => i.state === 'done' || i.state === 'skipped') && !job.leftOut;

/** What a review holds, for the summary line. */
export function countKinds(files) {
  const c = { photo: 0, raw: 0, video: 0, bytes: 0, onDrive: 0 };
  for (const f of files) { c[f.kind]++; c.bytes += f.size; if (f.onDrive) c.onDrive++; }
  return c;
}

export const sizeLabel = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

/** The biggest quiet gaps inside a group — where it makes sense to cut it in two. → [{ index, gapMin, at }] */
export function splitPoints(group, n = 6) {
  const pts = [];
  for (let i = 1; i < group.files.length; i++) {
    const gap = group.files[i].taken - group.files[i - 1].taken;
    if (gap >= 600) pts.push({ index: i, gapMin: Math.round(gap / 60), at: clockOf(group.files[i].taken) });
  }
  return pts.sort((a, b) => b.gapMin - a.gapMin).slice(0, n).sort((a, b) => a.index - b.index);
}

/** The path shown under a group's fields: Arkivju/2026/2026-08-15 Festa/Ritratti/Joe */
export function destLabel(group, kind) {
  const p = planGroup({ ...group, skip: false }).find((x) => KINDS[x.file.kind] === kind)?.path;
  return p ? `Arkivju/${p.join('/')}` : '';
}
export { dayOf };
