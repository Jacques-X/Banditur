// SD cards → the committee archive on Google Drive.
//   • watches for cards (a DCIM folder) and offers to upload them
//   • review: files grouped into events by time, named by the user (see views/archive/Review.svelte)
//   • upload jobs: up to PARALLEL (3) files at a time, straight from the Mac to Drive; the backend opens the sessions
//     and verifies the files in batches (`sessions` / `finishMany`, per-file calls against an older backend); a local
//     backup copy runs as its own lane. Kept in localStorage (debounced while running) so a quit, a pulled card or a
//     lost connection only pauses them. Drive itself decides what is already there.
import { app, ls, toast, configured } from './app.svelte.js';
import { api } from './api.js';
import { invoke, listen, isTauri, isMock, notify } from './tauri.js';
import { groupByGap, mergeGroups, splitGroup, shiftTaken, eventFolderName, fingerprintOf, cleanName, destPath } from '../../backend/api/_lib/archive-rules.js';
import { buildItems, jobStats, safeToFormat, matchEvents, countKinds, PARALLEL, chunks, takeGroup, nowLabel, sessionBody, finishBody, applySession, applyFinish, stopReason } from './archive-job.js';
import { eventsFor } from '../views/kalendarju/calendar.svelte.js';
import { occurrences, addDays } from '../views/kalendarju/model.js';

const DEFAULTS = { gapMin: 120, limitKbps: 0, backupDir: '' };
const KEY = { jobs: 'banditur_archive_jobs', cfg: 'banditur_archive_cfg', people: 'banditur_archive_people', seen: 'banditur_archive_seen' };

export const arch = $state({
  cards: [],            // cards plugged in now: { path, name }
  offer: null,          // a card nobody has answered yet
  review: null,         // the open review (see openReview)
  cfg: { ...DEFAULTS, ...ls.object(KEY.cfg) },
  jobs: ls.list(KEY.jobs).map((j) => ({
    ...j,
    items: Array.isArray(j.items) ? j.items : [],
    state: j.state === 'running' ? 'interrupted' : j.state,
  })),
  sent: {},             // item id → bytes sent so far in this run
  now: '',              // the items being uploaded (names joined with " · "), for the progress line
});

let saveTimer = 0;
/** Save now (job state changes, a new upload session). */
const saveJobs = () => { clearTimeout(saveTimer); saveTimer = 0; ls.set(KEY.jobs, JSON.stringify($state.snapshot(arch.jobs).slice(0, 20))); };
/** Save within ~2 s, one timer (per-file progress while running). */
const saveJobsSoon = () => { if (!saveTimer) saveTimer = setTimeout(saveJobs, 2000); };
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (saveTimer) saveJobs(); });
export function setCfg(patch) { Object.assign(arch.cfg, patch); ls.set(KEY.cfg, JSON.stringify($state.snapshot(arch.cfg))); }

/** Names used before, newest first: { fotografu: [], vidjografu: [] } */
export const people = () => { const p = ls.object(KEY.people); return { fotografu: p.fotografu || [], vidjografu: p.vidjografu || [] }; };
function rememberPeople(groups) {
  const p = people();
  for (const g of groups) {
    if (g.skip) continue;
    for (const [k, v] of [['fotografu', g.fotografu], ['vidjografu', g.vidjografu]]) {
      const n = cleanName(v);
      if (n) p[k] = [n, ...p[k].filter((x) => x !== n)].slice(0, 12);
    }
  }
  ls.set(KEY.people, JSON.stringify(p));
}

const canArchive = () => (isTauri || isMock()) && (configured() || isMock());
const message = (e) => String(e?.message || e || '');

// ── Cards ──────────────────────────────────────────────────────────────────
let timer = 0;
const answered = new Set(); // card paths the user already said "not now" to (until it is unplugged)
export function watchCards() {
  if (timer || !(isTauri || isMock())) return;
  const poll = async () => {
    let vols = [];
    try { vols = (await invoke('archive_volumes')) || []; } catch { return; }
    arch.cards = vols;
    for (const p of [...answered]) if (!vols.some((v) => v.path === p)) answered.delete(p);
    if (arch.offer && !vols.some((v) => v.path === arch.offer.path)) arch.offer = null;
    const fresh = vols.find((v) => !answered.has(v.path) && v.path !== arch.offer?.path && !arch.review);
    if (fresh) {
      answered.add(fresh.path);
      arch.offer = fresh;
      notify('Card ġdida', `${fresh.name} — tixtieq tgħabbiha fl-Arkivju?`);
      // A job for this card that was cut short goes on from where it stopped.
      const stopped = arch.jobs.find((j) => j.card === fresh.path && j.state === 'interrupted');
      if (stopped) toast(`Il-card ${fresh.name} reġgħet hawn. Kompli l-upload.`, 'info', { label: 'Kompli', onClick: () => resumeJob(stopped.id) });
    }
  };
  poll();
  timer = setInterval(poll, 3000);
}
export function dismissOffer() { arch.offer = null; }

// ── Review ─────────────────────────────────────────────────────────────────
export async function openReview(card) {
  arch.offer = null;
  arch.review = { card, state: 'scanning', error: '', files: [], groups: [], gapMin: arch.cfg.gapMin, shift: 0, onDriveChecked: false, drivePeople: {}, backup: !!arch.cfg.backupDir };
  try {
    const files = await invoke('archive_scan', { root: card.path });
    if (!files.length) { arch.review.state = 'empty'; return; }
    arch.review.files = files;
    regroup();
    arch.review.state = 'ready';
    markOnDrive(); // in the background: the review is usable while Drive answers
  } catch (e) {
    arch.review.state = 'error';
    arch.review.error = message(e);
  }
}
export function closeReview() { arch.review = null; }

function eventSuggestions(g) {
  try {
    const profile = app.profileId;
    const occ = occurrences(eventsFor(profile), addDays(g.date, -1), addDays(g.date, 2));
    return matchEvents(g, occ).slice(0, 4);
  } catch { return []; }
}

/** (Re)build the groups from the files with the current gap and camera-clock shift. Names typed so far are kept for groups that did not change. */
export function regroup() {
  const r = arch.review;
  if (!r) return;
  const old = r.groups;
  const files = shiftTaken($state.snapshot(r.files), r.shift);
  r.groups = groupByGap(files, r.gapMin).map((g) => {
    const same = old.find((o) => o.files.length === g.files.length && o.files[0]?.path === g.files[0].path);
    const suggestions = eventSuggestions(g);
    return same ? { ...g, event: same.event, eventId: same.eventId, fotografu: same.fotografu, vidjografu: same.vidjografu, skip: same.skip, suggestions }
      : { ...g, event: suggestions[0]?.score >= 3 ? suggestions[0].title : '', eventId: suggestions[0]?.score >= 3 ? suggestions[0].id : '', fotografu: '', vidjografu: '', skip: false, suggestions };
  });
}
export const setGap = (m) => { arch.review.gapMin = m; setCfg({ gapMin: m }); regroup(); };
export const setShift = (sec) => { arch.review.shift = sec; regroup(); };
export function merge(aId, bId) { arch.review.groups = mergeGroups($state.snapshot(arch.review.groups), aId, bId); }
export function split(id, index) { arch.review.groups = splitGroup($state.snapshot(arch.review.groups), id, index).map((g) => ({ ...g, suggestions: g.suggestions || eventSuggestions(g) })); }
export function pickSuggestion(g, s) { g.event = s.title; g.eventId = s.id; }

/** Ask Drive which of the card's files are already archived (any Mac, any time). */
async function markOnDrive() {
  const r = arch.review;
  if (!r || !canArchive()) return;
  try {
    const fps = r.files.map((f) => fingerprintOf(f));
    const found = {};
    for (let i = 0; i < fps.length; i += 300) Object.assign(found, (await api('/api/drive/archive/check', { method: 'POST', body: { fingerprints: fps.slice(i, i + 300) } })).found || {});
    if (arch.review !== r) return;
    for (const f of r.files) f.onDrive = !!found[fingerprintOf(f)];
    regroup();
    r.onDriveChecked = true;
  } catch (e) { r.driveNote = 'Ma setgħetx niċċekkja d-Drive. L-upload jerġa jiċċekkja kull fajl.'; }
}

/** Person-folder names already used for an event on Drive, to suggest the same spelling. */
export async function loadPeople(g) {
  const name = eventFolderName(g.date, g.event);
  if (!name || !canArchive() || arch.review?.drivePeople[name]) return;
  const out = { Ritratti: [], Footage: [] };
  try {
    for (const k of Object.keys(out)) out[k] = (await api('/api/drive/archive/ls', { method: 'POST', body: { path: [g.date.slice(0, 4), name, k] } })).folders || [];
  } catch { /* suggestions only */ }
  if (arch.review) arch.review.drivePeople[name] = out;
}

export function startUpload() {
  const r = arch.review;
  const groups = $state.snapshot(r.groups);
  const items = buildItems(groups);
  const left = groups.filter((g) => g.skip).length;
  if (!items.length) { toast('Kollox diġà fl-Arkivju — m’hemm xejn x’jittella’.', 'ok'); closeReview(); return; }
  rememberPeople(groups);
  const queued = new Set(items.map((i) => i.path));
  const job = {
    id: `u${Date.now().toString(36)}`, card: r.card.path, label: r.card.name, created: Date.now(), state: 'queued', error: '',
    leftOut: left > 0 || r.files.some((f) => !f.onDrive && !queued.has(f.path)),
    backup: r.backup ? arch.cfg.backupDir : '', items,
    events: [...new Set(groups.filter((g) => !g.skip).map((g) => eventFolderName(g.date, g.event)))],
  };
  arch.jobs.unshift(job);
  saveJobs();
  closeReview();
  runJobs();
}

// ── Upload ─────────────────────────────────────────────────────────────────
let running = false;
let wired = false;
let cancelling = null;
const job = (id) => arch.jobs.find((j) => j.id === id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function wire() {
  if (wired) return;
  wired = true;
  await listen('archive://progress', (e) => {
    const p = e.payload || e;
    arch.sent[p.id] = p.sent;
  });
}

/** An API call that gives a flaky connection a few more chances. */
async function call(path, body) {
  let last;
  for (const delay of [0, 2000, 6000, 15000]) {
    if (delay) await wait(delay);
    try { return await api(path, { method: 'POST', body, timeout: 60000 }); }
    catch (e) { last = e; if (e.status && e.status < 500) throw e; }
  }
  throw last;
}

// Old backends have no batch routes: after one 404 this run uses the per-file calls.
let batchApi = true;
const withStatus = (msg, status) => Object.assign(new Error(msg), { status });

/** Open upload sessions for `items` (one request for all of them; per file on an older backend). Fills `errs[id]`; an item that is already on Drive becomes 'skipped'. */
async function openSessions(items, errs) {
  if (batchApi) {
    try {
      for (const part of chunks(items, 25)) {
        const { results } = await call('/api/drive/archive/sessions', { items: part.map(sessionBody) });
        part.forEach((it, i) => {
          if (applySession(it, results?.[i]) === 'error') errs[it.id] = withStatus(results?.[i]?.error || 'Drive ma fetaħx sessjoni.', 400);
        });
      }
      return;
    } catch (e) {
      if (e.status !== 404) { for (const it of items) if (!it.sessionUrl && it.state !== 'skipped' && !errs[it.id]) errs[it.id] = e; return; }
      batchApi = false;
    }
  }
  for (const it of items) { // one after the other: folder creation must not race
    if (it.sessionUrl || it.state === 'skipped' || errs[it.id]) continue;
    try {
      const s = await call('/api/drive/archive/session', sessionBody(it));
      if (applySession(it, s) === 'error') errs[it.id] = withStatus('Drive ma fetaħx sessjoni.', 400);
    } catch (e) { errs[it.id] = e; }
  }
}

/** Send one file. Returns Drive's answer, or null when there is nothing to verify (already there, or `errs[id]` says why not). */
async function putOne(it, errs) {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!it.sessionUrl) {
        await openSessions([it], errs);
        if (errs[it.id] || it.state === 'skipped') return null;
        saveJobs(); // a quit can resume this session
      }
      try {
        return await invoke('archive_put', { id: it.id, path: it.path, url: it.sessionUrl, size: it.size, limitKbps: arch.cfg.limitKbps ? Math.ceil(arch.cfg.limitKbps / PARALLEL) : null });
      } catch (e) {
        if (message(e) === 'session-expired') { it.sessionUrl = ''; continue; }
        throw e;
      }
    }
    throw new Error('Is-sessjoni tad-Drive skadiet darbtejn.');
  } catch (e) { errs[it.id] = e; return null; }
}

/** Check the uploaded files on Drive: one request for the group (per file on an older backend). */
async function verify(sent, errs) {
  let results = null;
  if (batchApi) {
    try { results = (await call('/api/drive/archive/finishMany', { items: sent.map(({ it, put }) => finishBody(it, put)) })).results; }
    catch (e) {
      if (e.status !== 404) { for (const { it } of sent) errs[it.id] = e; return; }
      batchApi = false;
    }
  }
  if (!results) {
    results = [];
    for (const { it, put } of sent) {
      try { results.push(await call('/api/drive/archive/finish', finishBody(it, put))); }
      catch (e) { results.push({ error: message(e), thrown: e }); }
    }
  }
  sent.forEach(({ it }, i) => {
    const r = results[i];
    const m = applyFinish(it, r);
    if (m) errs[it.id] = r?.thrown || withStatus(m, 422);
  });
}

/** Upload up to PARALLEL files together. → '' to go on, or why the job must stop ('paused' | 'card' | 'offline'). */
async function runGroup(j, group) {
  arch.now = nowLabel(group);
  const errs = {};
  for (const it of group) it.error = '';
  await openSessions(group.filter((i) => !i.sessionUrl), errs);
  if (group.some((i) => i.sessionUrl)) saveJobs();
  const ready = group.filter((i) => i.sessionUrl && !errs[i.id]);
  // Every put settles before we look at the result, so a stop never leaves one running behind.
  const sent = (await Promise.all(ready.map(async (it) => ({ it, put: await putOne(it, errs) })))).filter((x) => x.put && !errs[x.it.id]);
  if (sent.length) await verify(sent, errs);
  const failed = group.filter((i) => errs[i.id]);
  const stop = stopReason(failed.map((i) => errs[i.id]));
  for (const it of failed) {
    const m = message(errs[it.id]);
    if (m === 'cancelled') { it.error = ''; continue; }
    it.error = m;
    if (errs[it.id].status) it.state = 'failed'; // a card or connection problem leaves the file as it was
  }
  saveJobsSoon();
  return stop;
}

/** The local backup copy, in its own lane next to the uploads. → 'paused' if it was cancelled, else ''. */
async function copyLane(j, ctx) {
  const todo = j.items.filter((it) => it.state !== 'done' && it.state !== 'skipped');
  for (const part of chunks(todo, 10)) {
    if (ctx.stop || !j.backup) return '';
    try { await invoke('archive_copy', { id: `${j.id}-copy`, items: part.map((it) => ({ src: it.path, rel: it.rel })), dest: j.backup }); }
    catch (e) {
      if (message(e) === 'cancelled') return 'paused';
      j.backup = ''; toast(`Il-backup lokali twaqqaf: ${message(e)}`, 'warn');
      return '';
    }
  }
  return '';
}

/** Run one job to its end or until something stops it. → '' | 'paused' | 'card' | 'offline' */
async function runJob(j) {
  const ctx = { stop: false };
  const lane = j.backup ? copyLane(j, ctx) : Promise.resolve('');
  let stop = '', from = 0;
  while (!stop) {
    if (j.state !== 'running') { stop = 'paused'; break; }
    const { group, next } = takeGroup(j.items, from, PARALLEL);
    if (!group.length) break;
    from = next;
    stop = await runGroup(j, group);
  }
  if (stop) ctx.stop = true;
  const laneStop = await lane;
  arch.now = '';
  return stop || laneStop;
}

export async function runJobs() {
  if (running || !canArchive()) return;
  running = true;
  batchApi = true;
  await wire();
  try {
    for (let j = arch.jobs.find((x) => x.state === 'queued'); j; j = arch.jobs.find((x) => x.state === 'queued')) {
      j.state = 'running'; j.error = '';
      saveJobs();
      const stop = await runJob(j);
      if (stop === 'paused') j.state = j.state === 'running' ? 'paused' : j.state;
      else if (stop === 'card') { j.state = 'interrupted'; j.error = 'Il-card ħarġet. Poġġiha lura biex tkompli.'; }
      else if (stop === 'offline') { j.state = 'interrupted'; j.error = 'M’hemmx konnessjoni. Nerġa’ nipprova miegħek.'; scheduleRetry(); }
      else finishJob(j);
      saveJobs();
    }
  } finally { running = false; }
}

let retryTimer = 0;
function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { for (const j of arch.jobs) if (j.state === 'interrupted' && /konnessjoni/.test(j.error)) j.state = 'queued'; runJobs(); }, 60000);
}

function finishJob(j) {
  const s = jobStats(j);
  j.state = s.failed ? 'failed' : 'done';
  if (s.failed) { j.error = `${s.failed} fajls ma tellgħux.`; notify('Arkivju', `${j.label}: ${j.error}`); toast(`${j.label}: ${j.error}`, 'warn'); return; }
  const msg = safeToFormat(j) ? `${j.label} kollha fl-Arkivju. Tista’ tifformattja l-card.` : `${j.label} tellgħet. Xi fajls ħallejthom barra, mela żomm il-card.`;
  notify('Arkivju lest', msg);
  toast(msg, 'ok');
}

export function pauseJob(id) {
  const j = job(id);
  if (!j || j.state !== 'running') return;
  j.state = 'paused';
  invoke('archive_cancel').catch(() => {});
  saveJobs();
}
export function resumeJob(id) {
  const j = job(id);
  if (!j || !['paused', 'interrupted', 'failed'].includes(j.state)) return;
  for (const it of j.items) if (it.state === 'failed') it.state = 'pending';
  j.state = 'queued'; j.error = '';
  saveJobs();
  runJobs();
}
export function removeJob(id) {
  const j = job(id);
  if (j?.state === 'running') pauseJob(id);
  arch.jobs = arch.jobs.filter((x) => x.id !== id);
  saveJobs();
}
export async function ejectCard(path) {
  try { await invoke('archive_eject', { path }); toast('Tista’ tneħħi l-card.', 'ok'); }
  catch (e) { toast(message(e), 'warn'); }
}
export { jobStats, safeToFormat, countKinds, destPath };

// Jobs cut short by closing the app start again when the app does (they may need the card, which then says so).
export function resumeOnStart() { for (const j of arch.jobs) if (j.state === 'interrupted' && !/Il-card/.test(j.error)) { j.state = 'queued'; } runJobs(); }
