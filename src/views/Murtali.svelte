<script>
  // Murtali (Video → Murtali): drop a fireworks video → the sound alone says where each display is
  // (sidecar measures, views/murtali/segments.js decides) → review them as separate items → export one
  // full 16:9 video, or a 9:16 Reel from 6-7 picked items. The clip's own sound is always kept.
  import { onMount, untrack, tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import MenuButton from '../components/MenuButton.svelte';
  import { anyModalOpen } from '../components/Modal.svelte';
  import { app, toast, ls } from '../lib/app.svelte.js';
  import { projects, saveProject, removeProject } from '../lib/projects.svelte.js';
  import { updateStudioJob } from '../lib/studio-jobs.svelte.js';
  import { sendPaths } from '../lib/handoff.svelte.js';
  import { invoke, listen, openDialog, saveDialog, openPath, fileSrc, onDragDrop, isMock, baseName, notify } from '../lib/tauri.js';
  import { ago } from '../lib/format.js';
  import { FW, friendlyError } from '../strings.js';
  import { activity, findSegments, redetect, DISTANCE } from './murtali/segments.js';
  import * as I from './murtali/items.js';
  import { History } from './murtali/history.js';
  import { bestN, reelItems, totalDuration, reelWarnings, exportJob, summary, clock } from './murtali/reel.js';
  import { handoffFw } from './murtali/handoff.svelte.js';
  import Timeline from './murtali/Timeline.svelte';
  import ItemsGrid from './murtali/ItemsGrid.svelte';
  import ReelStrip from './murtali/ReelStrip.svelte';
  import CropWindow from './murtali/CropWindow.svelte';
  import LutPreview from './murtali/LutPreview.svelte';
  import { parseCube, lutName, lutJob } from './murtali/lut.js';

  let { active } = $props();
  const EXT = ['mp4', 'mov', 'm4v'];
  const uuid = () => crypto.randomUUID();
  const stem = (p) => baseName(p).replace(/\.[^.]+$/, '');

  // ── state ────────────────────────────────────────────────────────────────
  let phase = $state('drop');                 // drop | analysing | edit
  let project = $state.raw(null);             // { id, name, status, sources: [{ path, duration, w, h, fps, fingerprint, curves }] }
  // The LUT is per project; a new project starts with the last one chosen (same camera, same log).
  const lastLut = () => { const l = ls.object('banditur_fw_lut'); return l?.path ? { path: l.path, name: l.name || lutName(l.path), strength: Number(l.strength ?? 1) } : null; };
  const defaults = () => ({ sensitivity: 0.5, distance: 'medju', size1080: false, lut: lastLut() });
  const settings = $state(defaults());
  const hist = new History(I.emptyDoc());
  let doc = $state.raw(hist.present);         // { items, reel }: always hist.present
  let selectedId = $state(null);
  let thumbs = $state.raw({});                // id → { t, file }
  let markIn = $state(null);
  let over = $state(false);
  let armed = $state('');
  let missing = $state(false);
  let lastExport = $state(null);              // { path, kind, bytes, warnings }
  let job = $state(null);                     // { kind: 'analyse' | 'full' | 'reel', pct, status }
  let reqId = null;
  let taskId = '';
  let pending = $state(null);                 // { path, existing } while analysing

  const src = $derived(project?.sources?.[0] ?? null);
  const score = $derived(src ? activity(src.curves) : []);
  const reelObjs = $derived(reelItems(doc));
  const reelOf = $derived(Object.fromEntries(doc.reel.map((id, k) => [id, k + 1])));
  const numberOf = $derived(Object.fromEntries(doc.items.map((it, k) => [it.id, k + 1])));
  const kept = $derived(doc.items.filter((i) => i.keep !== false));
  const reelTotal = $derived(totalDuration(reelObjs));
  const warnings = $derived(reelWarnings(reelTotal));
  const selected = $derived(doc.items.find((i) => i.id === selectedId) ?? null);
  const recent = $derived(projects.items.filter((p) => p.kind === 'fireworks'));
  const busy = $derived(!!job);

  // ── video, playhead, playback ────────────────────────────────────────────
  let video = $state();
  let tl = $state();
  let t = $state(0);
  let playing = $state(false);
  let playingId = $state(null);
  let playUntil = null;
  let playAll = $state(false);
  let raf = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!video) return;
    t = video.currentTime;
    if (playUntil != null && t >= playUntil - 0.03) reachedEnd();
  }
  const startLoop = () => { playing = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); };
  const stopLoop = () => { playing = false; cancelAnimationFrame(raf); if (video) t = video.currentTime; };
  onMount(() => () => cancelAnimationFrame(raf));
  function seek(to) {
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(src?.duration ?? to, to));
    t = video.currentTime;
  }
  function playItem(id, all = false) {
    const it = doc.items.find((i) => i.id === id);
    if (!it || !video) return;
    selectedId = id; playingId = id; playAll = all; playUntil = it.end;
    seek(it.start);
    video.play().catch(() => {});
  }
  function reachedEnd() {
    if (playAll) {
      const cur = doc.items.find((i) => i.id === playingId);
      const next = kept.find((i) => cur && i.start >= cur.end - 1e-6 && i.id !== cur.id);
      if (next) { playItem(next.id, true); return; }
    }
    video?.pause();
    playUntil = null; playAll = false; playingId = null;
  }
  function togglePlay() {
    if (!video) return;
    if (!video.paused) { video.pause(); playUntil = null; playAll = false; playingId = null; return; }
    playUntil = null; playAll = false; playingId = null;
    video.play().catch(() => {});
  }
  function playEverything() {
    if (playAll && !video?.paused) { video.pause(); playAll = false; playUntil = null; playingId = null; return; }
    if (kept[0]) playItem(kept[0].id, true);
  }
  const previewItem = $derived(selected ?? doc.items.find((i) => t >= i.start && t <= i.end) ?? null);

  // stage: the video's own aspect ratio, as large as the box allows (the 9:16 window is positioned in percent of it)
  let boxW = $state(0), boxH = $state(0);
  const stage = $derived.by(() => {
    const ar = (src?.w || 16) / (src?.h || 9);
    let w = boxW, h = w / ar;
    if (h > boxH) { h = boxH; w = h * ar; }
    return { w: Math.max(0, Math.floor(w)), h: Math.max(0, Math.floor(h)) };
  });

  // ── editing (every edit is one undo step) ────────────────────────────────
  let rev = $state(0);                        // bumped on every history change: History is a plain class
  const sync = () => { doc = hist.present; rev++; };
  const canUndo = $derived.by(() => { rev; return hist.canUndo; });
  const canRedo = $derived.by(() => { rev; return hist.canRedo; });
  const edit = (fn) => { hist.commit(fn(hist.present)); sync(); };
  const live = (fn) => { hist.live(fn(hist.present)); sync(); };
  const begin = () => hist.begin();
  const end = () => { hist.end(); sync(); };
  function undo() { if (hist.undo()) sync(); }
  function redo() { if (hist.redo()) sync(); }

  const detectInto = (base) => {
    if (!src) return base;
    const segs = findSegments(score, { sensitivity: settings.sensitivity, distance: settings.distance, duration: src.duration });
    return I.setItems(base, redetect(base.items, segs, 0));
  };
  function onSensitivity(e) { settings.sensitivity = +e.currentTarget.value; begin(); live(detectInto); }
  function onSensitivityDone(e) { end(); e.currentTarget.blur(); }
  function onDistance(e) { settings.distance = e.currentTarget.value; edit(detectInto); }

  // ── LUT (camera log → normal colour): one per project, live on the preview, in both exports ──
  let lutData = $state.raw(null);             // parsed .cube for the preview (views/murtali/lut.js)
  let lutView = $state(true);                 // false = compare with the original (preview only)
  let lutPreviewOff = $state(false);          // WebGL2 missing or the frame can't be read
  let corsOff = $state(false);                // the video wouldn't load with crossorigin: plain video, no preview
  const lutOn = $derived(!!settings.lut && (settings.lut.strength ?? 1) > 0.005);
  const lutSig = $derived(lutOn ? `${settings.lut.path}|${(+settings.lut.strength).toFixed(2)}` : '');
  const rememberLut = () => ls.set('banditur_fw_lut', JSON.stringify(settings.lut ?? {}));
  async function readLut(path) {
    try { return parseCube(await invoke('read_lut', { path })); }
    catch (e) {
      const m = String(e?.message || e);
      toast(m === 'lut-1d' ? FW.lut1d : /lut-invalid/.test(m) ? FW.lutBad : `${FW.lutMissing} ${friendlyError(m)}`, 'error');
      return null;
    }
  }
  async function pickLut() {
    const p = await openDialog({ multiple: false, filters: [{ name: 'LUT', extensions: ['cube'] }] });
    const path = Array.isArray(p) ? p[0] : p;
    if (!path) return;
    const data = await readLut(path);
    if (!data) return;
    lutData = data;
    settings.lut = { path, name: data.title || lutName(path), strength: settings.lut?.strength ?? 1 };
    lutView = true;
    rememberLut();
  }
  function clearLut() { settings.lut = null; lutData = null; rememberLut(); }
  function setStrength(v) { if (settings.lut) settings.lut = { ...settings.lut, strength: Math.max(0, Math.min(1, v)) }; }
  // (re)load the parsed LUT whenever the project's LUT file changes
  let lutPathLoaded = '';
  $effect(() => {
    const path = phase === 'edit' ? settings.lut?.path || '' : '';
    if (path === lutPathLoaded) return;
    lutPathLoaded = path;
    if (!path) { lutData = null; return; }
    untrack(async () => {
      const data = await readLut(path);
      if (lutPathLoaded !== path) return;
      lutData = data;
    });
  });
  async function videoError() {
    // A video that can't be read with crossorigin (needed for the WebGL preview) is retried without it.
    if (!corsOff && video?.getAttribute('crossorigin') != null && !isMock()) {
      corsOff = true; lutPreviewOff = true;
      const at = video.currentTime || 0;
      await tick();
      video.load();
      video.currentTime = at;
      return;
    }
    if (!isMock() && phase === 'edit') missing = true;
  }

  // ── opening, analysing ───────────────────────────────────────────────────
  async function openVideo(path) {
    if (busy) return;
    if (!EXT.includes(path.split('.').pop()?.toLowerCase())) { toast(FW.badFormat, 'warn'); return; }
    const saved = projects.items.find((p) => p.kind === 'fireworks' && p.data?.sources?.[0]?.path === path);
    if (saved) { await loadProject(saved); return; }
    await analyse(path, null);
  }
  const sameFile = (a, b) => !!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs;

  async function loadProject(p) {
    const d = p.data || {};
    const source = d.sources?.[0];
    if (!source || !Array.isArray(d.items)) { toast(FW.saveFailed, 'error'); return; }
    let fp = null;
    try { fp = await invoke('fireworks_fingerprint', { path: source.path }); } catch { /* file gone: opened below with the missing notice */ }
    if (fp && source.fingerprint && !sameFile(fp, source.fingerprint)) {
      toast(FW.changed, 'info');
      await analyse(source.path, p);
      return;
    }
    show(p);
    missing = !fp && !isMock();
  }
  function show(p) {
    const d = p.data;
    project = { id: p.id, name: p.name, status: p.status || 'draft', sources: d.sources };
    Object.assign(settings, defaults(), d.settings || {});
    hist.reset({ items: d.items.filter((i) => i && typeof i === 'object'), reel: Array.isArray(d.reel) ? d.reel : [] }); sync();
    thumbs = {}; selectedId = null; markIn = null; lastExport = null; t = 0;
    phase = 'edit';
  }

  async function analyse(path, existing) {
    pending = { path, existing };
    reqId = uuid();
    job = { kind: 'analyse', pct: -1, status: FW.analysing };
    phase = 'analysing';
    app.busy.export = true;
    taskId = uuid();
    updateStudioJob(taskId, { kind: 'murtali', name: FW.jobName(stem(path)), state: 'running', path });
    try { await invoke('analyse_fireworks', { path, requestId: reqId }); }
    catch (err) { fail(String(err)); }
  }

  async function analysed(d) {
    const { path, existing } = pending;
    let fp = null;
    try { fp = await invoke('fireworks_fingerprint', { path }); } catch { /* shown as unchanged next time */ }
    const source = {
      path, duration: d.duration, w: d.width, h: d.height, fps: d.fps, fingerprint: fp,
      curves: { rms: d.rms, transient: d.transient, low: d.low, peaks: d.peaks, peaksRate: d.peaks_rate, rate: d.rate },
    };
    project = existing
      ? { id: existing.id, name: existing.name, status: existing.status || 'draft', sources: [source] }
      : { id: `fw-${uuid()}`, name: stem(path), status: 'draft', sources: [source] };
    if (existing) Object.assign(settings, defaults(), existing.data?.settings || {});
    else Object.assign(settings, defaults());
    const base = existing ? { items: existing.data.items, reel: existing.data.reel || [] } : I.emptyDoc();
    hist.reset(detectInto(base)); sync();
    thumbs = {}; selectedId = null; markIn = null; lastExport = null; t = 0; missing = false;
    phase = 'edit';
    finishJob('done');
    if (!doc.items.length) toast(FW.noItems, 'info');
  }

  function finishJob(state, error) {
    if (taskId) updateStudioJob(taskId, { state, ...(error ? { error } : {}) });
    taskId = ''; job = null; reqId = null; pending = null;
    app.busy.export = false;
  }
  function fail(message) {
    const msg = friendlyError(message || '');
    const wasAnalysis = job?.kind === 'analyse';
    finishJob('failed', msg);
    if (wasAnalysis && phase === 'analysing') phase = project ? 'edit' : 'drop';
    toast(msg, 'error');
  }
  async function cancelJob() { try { await invoke('cancel_fireworks'); } catch (e) { toast(String(e), 'error'); } }

  // one listener for the life of the screen; the request id tells which job an event belongs to
  const thumbReqs = new Map();
  onMount(() => {
    const un = listen('fireworks-update', (e) => {
      const d = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
      if (d.id && thumbReqs.has(d.id)) { thumbsEvent(d); return; }
      if (!reqId || d.id !== reqId || !job) return;
      if (d.type === 'status') job.status = d.message;
      else if (d.type === 'progress') job.pct = d.value;
      else if (d.type === 'error') fail(d.message);
      else if (d.type === 'cancelled') { const was = job.kind; finishJob('cancelled'); if (was === 'analyse') phase = project ? 'edit' : 'drop'; toast(was === 'analyse' ? FW.cancelled : FW.exportCancelled, 'info'); }
      else if (d.type === 'done') { if (job.kind === 'analyse') analysed(d); else exported(d); }
    });
    return () => { un.then((f) => f()); };
  });

  // ── thumbnails: the frame just before the loudest bang (sound arrives late) ──
  const round1 = (v) => Math.round(v * 10) / 10;
  const wantT = (it) => round1(Math.max(it.start, Math.min(it.end - 0.1, (it.peakAt ?? it.start) - (DISTANCE[settings.distance] ?? 3))));
  $effect(() => {
    if (phase !== 'edit' || !src) return;
    const sig = lutSig;
    const need = doc.items.map((i) => ({ id: i.id, t: wantT(i), k: `${wantT(i)}|${sig}` })).filter((x) => thumbs[x.id]?.k !== x.k);
    if (!need.length) return;
    const h = setTimeout(() => untrack(() => requestThumbs(need)), 500);
    return () => clearTimeout(h);
  });
  function requestThumbs(need) {
    if (!src) return;
    const id = uuid();
    thumbReqs.set(id, need);
    thumbs = { ...thumbs, ...Object.fromEntries(need.map((n) => [n.id, { t: n.t, k: n.k, file: thumbs[n.id]?.file ?? null }])) };
    invoke('fireworks_thumbs', { path: src.path, times: need.map((n) => n.t), lut: lutJob(settings.lut), requestId: id }).catch(() => thumbReqs.delete(id));
  }
  function thumbsEvent(d) {
    if (d.type === 'progress' || d.type === 'status') return;
    const need = thumbReqs.get(d.id);
    thumbReqs.delete(d.id);
    if (d.type !== 'done' || !need) return;
    thumbs = { ...thumbs, ...Object.fromEntries(need.map((n, i) => [n.id, { t: n.t, k: n.k, file: d.files?.[i] ?? thumbs[n.id]?.file ?? null }])) };
  }

  // ── autosave ─────────────────────────────────────────────────────────────
  function save() {
    if (!project) return Promise.resolve();
    return saveProject({
      id: project.id, kind: 'fireworks', name: project.name, status: project.status, mediaPath: project.sources[0].path,
      data: { sources: project.sources, items: doc.items, reel: doc.reel, settings: { ...settings } },
    }).catch((e) => toast(`${FW.saveFailed} ${friendlyError(String(e))}`, 'error'));
  }
  $effect(() => {
    if (phase !== 'edit' || !project) return;
    doc; project; settings.sensitivity; settings.distance; settings.size1080; settings.lut?.path; settings.lut?.strength;
    const h = setTimeout(() => untrack(save), 700);
    return () => clearTimeout(h);
  });

  async function back() {
    if (busy) return;
    await save();
    video?.pause();
    project = null; hist.reset(I.emptyDoc()); sync(); phase = 'drop'; selectedId = null; thumbs = {}; lastExport = null; missing = false; t = 0;
    corsOff = false; lutPreviewOff = false; lutView = true;
  }

  // ── export ───────────────────────────────────────────────────────────────
  async function exportKind(kind) {
    if (busy || !project) return;
    if (kind === 'full' && !kept.length) { toast(FW.needItems, 'warn'); return; }
    if (kind === 'reel' && !doc.reel.length) { toast(FW.needReel, 'warn'); return; }
    let out = await saveDialog({ defaultPath: `${project.name}-${kind === 'reel' ? 'reel' : '16x9'}.mp4`, filters: [{ name: 'MP4', extensions: ['mp4'] }] });
    if (!out) return;
    if (!out.toLowerCase().endsWith('.mp4')) out += '.mp4';
    const payload = exportJob(kind, { sources: project.sources, items: doc.items, reel: doc.reel }, { output: out, size: settings.size1080 ? '1080p' : 'auto', lut: settings.lut });
    reqId = uuid();
    job = { kind, pct: 0, status: FW.exporting };
    lastExport = null;
    app.busy.export = true;
    taskId = uuid();
    updateStudioJob(taskId, { kind: `murtali-${kind}`, name: FW.jobName(project.name), state: 'running', path: out });
    try { await invoke('render_fireworks', { job: payload, requestId: reqId }); }
    catch (err) { fail(String(err)); }
  }
  async function exported(d) {
    const kind = job.kind;
    let bytes = 0;
    try { bytes = (await invoke('fireworks_fingerprint', { path: d.path })).size || 0; } catch { /* size check is a courtesy */ }
    finishJob('done');
    lastExport = { path: d.path, kind, bytes, warnings: kind === 'reel' ? reelWarnings(reelTotal, { bytes }) : [] };
    project = { ...project, status: 'exported' };
    const what = kind === 'reel' ? FW.exportReel : FW.exportFull;
    toast(FW.exportDone(what), 'ok', { label: FW.open, onClick: () => openPath(d.path) });
    notify(FW.exportDone(what), project.name);
  }
  const useInSkeda = () => lastExport && sendPaths([lastExport.path], { contentType: lastExport.kind === 'reel' ? 'reel' : 'post' });
  const exportItems = $derived([
    { label: FW.exportFull, onclick: () => exportKind('full'), disabled: busy || !kept.length },
    { label: FW.exportReel, onclick: () => exportKind('reel'), disabled: busy || !doc.reel.length },
  ]);

  // ── drop screen ──────────────────────────────────────────────────────────
  async function pick() {
    if (busy) return;
    const p = await openDialog({ multiple: false, filters: [{ name: 'Video', extensions: EXT }] });
    if (p) openVideo(Array.isArray(p) ? p[0] : p);
  }
  onMount(() => onDragDrop((p) => {
    if (!active || phase !== 'drop') return;
    if (p.type === 'enter' || p.type === 'over') over = !busy;
    else if (p.type === 'leave') over = false;
    else if (p.type === 'drop') { over = false; if (!busy && p.paths?.length) openVideo(p.paths[0]); }
  }));
  $effect(() => {
    if (!handoffFw.open) return;
    const id = handoffFw.open;
    handoffFw.open = '';
    const p = projects.items.find((x) => x.id === id);
    if (p) untrack(() => loadProject(p));
  });
  function del(p) {
    if (armed !== p.id) { armed = p.id; setTimeout(() => { if (armed === p.id) armed = ''; }, 3000); return; }
    armed = '';
    removeProject(p.id).catch((e) => toast(String(e), 'error'));
  }
  function clearAll() {
    if (armed !== '*') { armed = '*'; setTimeout(() => { if (armed === '*') armed = ''; }, 3000); return; }
    armed = '';
    Promise.all(recent.map((p) => removeProject(p.id))).catch((e) => toast(String(e), 'error'));
  }
  async function locate() {
    const p = await openDialog({ multiple: false, filters: [{ name: 'Video', extensions: EXT }] });
    const path = Array.isArray(p) ? p[0] : p;
    if (!path || !project) return;
    let fp = null;
    try { fp = await invoke('fireworks_fingerprint', { path }); } catch { /* checked below */ }
    const moved = { ...src, path };
    if (fp && src.fingerprint && !sameFile(fp, src.fingerprint)) {
      toast(FW.changed, 'info');
      await analyse(path, { id: project.id, name: project.name, status: project.status, data: { sources: [moved], items: doc.items, reel: doc.reel, settings: { ...settings } } });
      return;
    }
    project = { ...project, sources: [moved, ...project.sources.slice(1)] };
    missing = false;
  }

  // ── keyboard ─────────────────────────────────────────────────────────────
  function keydown(e) {
    if (!active || phase !== 'edit' || anyModalOpen()) return;
    const el = e.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod) {
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      return;
    }
    if (e.altKey) return;
    const k = e.key;
    if (k === ' ') { if (el.tagName === 'BUTTON') return; e.preventDefault(); togglePlay(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); seek(t + (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1)); }
    else if (k === 'b' || k === 'B') edit((d) => I.split(d, t, 0));
    else if (k === 'j' || k === 'J') { if (selectedId) edit((d) => I.join(d, selectedId)); }
    else if (k === 'Delete' || k === 'Backspace') { if (selectedId) { e.preventDefault(); const id = selectedId; selectedId = null; edit((d) => I.remove(d, id)); } }
    else if (k === 'i' || k === 'I') markIn = t;
    else if (k === 'o' || k === 'O') { if (markIn != null && t > markIn) { const a = markIn; markIn = null; edit((d) => I.add(d, 0, a, t, { duration: src.duration })); } }
    else if (k === '+' || k === '=') tl?.zoom(1.5);
    else if (k === '-' || k === '_') tl?.zoom(1 / 1.5);
  }
  function markOutButton() { if (markIn != null && t > markIn) { const a = markIn; markIn = null; edit((d) => I.add(d, 0, a, t, { duration: src.duration })); } else markIn = t; }
</script>

<svelte:window onkeydown={keydown} />

<div class="mu">
  {#if phase !== 'edit'}
    <div class="drop-view scroll">
      <button class="drop" class:over class:busy={phase === 'analysing'} type="button" onclick={pick} disabled={busy}>
        <Icon name="video" size={40} />
        <strong>{phase === 'analysing' ? FW.analysing : FW.dropTitle}</strong>
        <span class="muted">{phase === 'analysing' ? baseName(pending?.path || '') : FW.dropHint}</span>
      </button>
      {#if job}
        <div class="status card" role="status">
          <span>{job.status}</span>
          <div class="progress" class:indeterminate={job.pct < 0}><span style="width: {job.pct < 0 ? 35 : job.pct}%"></span></div>
          <div><button class="btn sm" type="button" onclick={cancelJob}>{FW.cancel}</button></div>
        </div>
      {:else}
        <p class="muted small explain">{FW.dropExplain}</p>
      {/if}
      {#if recent.length && !busy}
        <section class="recent" aria-label={FW.recent}>
          <div class="rh"><span class="label">{FW.recent}</span><span class="spacer"></span>
            <button class="link small" type="button" onclick={clearAll}>{armed === '*' ? FW.recentConfirm : FW.recentClear}</button>
          </div>
          {#each recent as p (p.id)}
            <div class="rr card">
              <button class="ro" type="button" title={p.data?.sources?.[0]?.path} onclick={() => loadProject(p)}>
                <Icon name="video" size={18} />
                <span class="rt"><strong class="truncate">{p.name}</strong><span class="muted small">{FW.recentMeta(ago(p.savedAt || Date.now()), p.data?.items?.length || 0)}</span></span>
              </button>
              <button class="btn ghost sm" type="button" aria-label={FW.recentDelete(p.name)} onclick={() => del(p)}>{armed === p.id ? FW.recentConfirm : FW.delete}</button>
            </div>
          {/each}
        </section>
      {/if}
    </div>
  {:else}
    <div class="bar">
      <button class="btn sm" type="button" onclick={back} disabled={busy}>← {FW.back}</button>
      <strong class="truncate name" title={src?.path}>{project.name}</strong>
      <label class="small ctl" title={FW.sensitivityTip}>{FW.sensitivity}
        <input type="range" min="0" max="1" step="0.01" value={settings.sensitivity} oninput={onSensitivity} onchange={onSensitivityDone} disabled={busy} /></label>
      <label class="small ctl" title={FW.distanceTip}>{FW.distance}
        <select class="input" value={settings.distance} onchange={onDistance} disabled={busy}>
          {#each Object.entries(FW.distances) as [id, label] (id)}<option value={id}>{label}</option>{/each}
        </select></label>
      <span class="ctl lutc">
        {#if settings.lut}
          <button class="btn sm" type="button" onclick={pickLut} disabled={busy} title="{FW.lutChange} · {settings.lut.path}"><span class="truncate lutn">{FW.lutLabel(settings.lut.name)}</span></button>
          <input type="range" min="0" max="1" step="0.01" value={settings.lut.strength} aria-label={FW.lutStrength} title={FW.lutStrength}
                 oninput={(e) => setStrength(+e.currentTarget.value)} onchange={(e) => { rememberLut(); e.currentTarget.blur(); }} disabled={busy} />
          <span class="small muted pct">{Math.round((settings.lut.strength ?? 1) * 100)}%</span>
          {#if !lutPreviewOff}<button class="btn ghost sm" type="button" aria-pressed={!lutView} title={FW.lutCompareTip} onclick={() => (lutView = !lutView)}>{lutView ? FW.lutBefore : FW.lutAfter}</button>{/if}
          <button class="btn ghost sm" type="button" aria-label={FW.lutRemove} title={FW.lutRemove} onclick={clearLut} disabled={busy}>✕</button>
        {:else}
          <button class="btn sm" type="button" onclick={pickLut} disabled={busy} title={FW.lutAddTip}>{FW.lutAdd}</button>
        {/if}
      </span>
      <button class="btn sm" type="button" disabled title={FW.addClipSoon}>{FW.addClip}</button>
      <span class="spacer"></span>
      <button class="btn ghost sm" type="button" onclick={undo} disabled={!canUndo} title="{FW.undo} (⌘Z)">↶</button>
      <button class="btn ghost sm" type="button" onclick={redo} disabled={!canRedo} title="{FW.redo} (⇧⌘Z)">↷</button>
      <label class="small ctl"><input type="checkbox" bind:checked={settings.size1080} />{FW.size1080}</label>
      <MenuButton cls="btn primary sm" label={FW.export} items={exportItems} align="right" />
    </div>

    <div class="body scroll">
      {#if missing}<div class="notice warn">{FW.missingFile}<button class="btn sm" type="button" onclick={locate}>{FW.findFile}</button></div>{/if}
      {#if lutOn && lutPreviewOff}<div class="notice small">{FW.lutPreviewOff}</div>{/if}

      <div class="top">
        <div class="pv" bind:clientWidth={boxW} bind:clientHeight={boxH}>
          <div class="stage" style="width:{stage.w}px;height:{stage.h}px">
            <!-- svelte-ignore a11y_media_has_caption -->
            <video bind:this={video} src={src ? fileSrc(src.path) : undefined} preload="metadata" crossorigin={corsOff ? undefined : 'anonymous'}
                   onplay={startLoop} onpause={stopLoop} onseeked={() => (t = video.currentTime)} onended={() => { stopLoop(); reachedEnd(); }}
                   onerror={videoError}></video>
            {#if lutOn && lutData && lutView && !lutPreviewOff && video}
              <LutPreview {video} lut={lutData} strength={settings.lut.strength ?? 1} width={stage.w} height={stage.h} onfail={() => (lutPreviewOff = true)} />
            {/if}
            {#if previewItem && reelOf[previewItem.id] && src}
              <CropWindow x={previewItem.crop?.x ?? null} srcW={src.w} srcH={src.h} onstart={begin} onchange={(x) => live((d) => I.setCrop(d, previewItem.id, x))} onend={end} />
            {/if}
          </div>
        </div>
        <div class="side">
          <button class="btn sm" type="button" onclick={togglePlay}>{playing ? '❚❚' : '▶'}</button>
          <button class="btn sm" type="button" onclick={playEverything} disabled={!kept.length}>{playAll && playing ? FW.stopAll : FW.playAll}</button>
          <button class="btn sm" type="button" onclick={() => selectedId && edit((d) => I.split(d, t, 0))}>{FW.split}</button>
          <button class="btn sm" type="button" disabled={!selectedId} onclick={() => edit((d) => I.join(d, selectedId))}>{FW.join}</button>
          <button class="btn sm" type="button" onclick={() => (markIn = t)}>{FW.markIn}</button>
          <button class="btn sm" type="button" onclick={markOutButton} disabled={markIn == null}>{FW.markOut}</button>
          <button class="btn sm" type="button" disabled={!selectedId} onclick={() => { const id = selectedId; selectedId = null; edit((d) => I.remove(d, id)); }}>{FW.remove}</button>
          <span class="spacer"></span>
          <span class="small muted">{clock(t)} / {clock(src.duration)}</span>
          <button class="btn ghost sm" type="button" onclick={() => tl?.zoom(1 / 1.5)} title="{FW.zoomOut} (−)">−</button>
          <button class="btn ghost sm" type="button" onclick={() => tl?.zoom(1.5)} title="{FW.zoomIn} (+)">+</button>
        </div>
      </div>

      <Timeline bind:this={tl} peaks={src.curves.peaks} peaksRate={src.curves.peaksRate} {score} rate={src.curves.rate || 10} duration={src.duration}
                items={doc.items} {reelOf} {selectedId} {t} {markIn} follow={playing}
                onseek={seek} onselect={(id) => (selectedId = id)}
                ontrimstart={begin} ontrim={(id, part) => live((d) => I.trim(d, id, part, { duration: src.duration }))} ontrimend={end} />

      <div class="summary small muted">{summary({ sources: project.sources, items: doc.items, reel: doc.reel })}</div>

      {#if job}
        <div class="status card" role="status">
          <span>{job.status}</span>
          <div class="progress" class:indeterminate={job.pct < 0}><span style="width: {job.pct < 0 ? 35 : job.pct}%"></span></div>
          <div><button class="btn sm" type="button" onclick={cancelJob}>{FW.cancel}</button></div>
        </div>
      {:else if lastExport}
        <div class="notice ok done">
          <span>{FW.exportDone(lastExport.kind === 'reel' ? FW.exportReel : FW.exportFull)} <span class="muted small">{baseName(lastExport.path)}</span></span>
          <button class="btn sm" type="button" onclick={() => openPath(lastExport.path)}>{FW.open}</button>
          <button class="btn sm primary" type="button" onclick={useInSkeda}>{FW.useInSkeda}</button>
        </div>
        {#each lastExport.warnings as w}<div class="notice warn">{w}</div>{/each}
      {/if}

      <ReelStrip reel={reelObjs} numbers={numberOf} {thumbs} {selectedId} total={reelTotal} {warnings} canCopyCrop={!!selected?.crop && !!reelOf[selected.id]}
                 onselect={(id) => { selectedId = id; const it = doc.items.find((i) => i.id === id); if (it) seek(it.start); }}
                 onreorder={(a, b) => edit((d) => I.reorderReel(d, a, b))} onremove={(id) => edit((d) => I.toggleReel(d, id))}
                 onbest={() => edit((d) => I.setReel(d, bestN(d.items, 7).map((i) => i.id)))} oncopy={() => edit((d) => I.copyCropToAll(d, selectedId))} />

      <ItemsGrid items={doc.items} {thumbs} {reelOf} {selectedId} srcW={src.w} srcH={src.h} {playingId}
                 onplay={(id) => (playingId === id && playing ? togglePlay() : playItem(id))}
                 ontoggleReel={(id) => edit((d) => I.toggleReel(d, id))} ontoggleKeep={(id) => edit((d) => I.toggleKeep(d, id))}
                 onremove={(id) => { if (selectedId === id) selectedId = null; edit((d) => I.remove(d, id)); }}
                 oncropstart={begin} oncrop={(id, x) => live((d) => I.setCrop(d, id, x))} oncropend={end} />
    </div>
  {/if}
</div>

<style>
  .mu { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
  .drop-view { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 56px 40px; }
  .drop {
    width: min(720px, 100%); height: 220px; border-radius: 16px; border: 1.5px dashed var(--line-strong); background: var(--bg-sunken);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--fg);
  }
  .drop :global(svg) { color: var(--accent-fg); margin-bottom: 6px; }
  .drop strong { font-size: 15px; }
  .drop:hover:not(:disabled), .drop.over { border-color: var(--accent); background: var(--accent-soft); }
  .drop.busy { cursor: progress; }
  .explain { width: min(720px, 100%); }
  .status { width: min(720px, 100%); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .body .status { width: 100%; }
  .recent { width: min(720px, 100%); display: flex; flex-direction: column; gap: 8px; }
  .rh { display: flex; align-items: baseline; }
  .rr { display: flex; align-items: center; gap: 6px; padding: 4px 8px 4px 4px; }
  .ro { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 0; background: none; color: var(--fg); text-align: left; border-radius: 8px; }
  .ro:hover { background: var(--hover); }
  .ro :global(svg) { color: var(--accent-fg); flex-shrink: 0; }
  .rt { display: flex; flex-direction: column; min-width: 0; }

  .bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 16px; border-bottom: 1px solid var(--line); }
  .name { max-width: 240px; }
  .ctl { display: inline-flex; align-items: center; gap: 6px; }
  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 24px; overflow-y: auto; }
  .top { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
  .pv { height: min(42vh, 420px); min-height: 160px; display: flex; align-items: center; justify-content: center; background: #0c0d10; border-radius: 8px; overflow: hidden; }
  .stage { position: relative; }
  .stage video { width: 100%; height: 100%; display: block; background: #000; }
  .side { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .summary { flex-shrink: 0; }
  .done { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lutc input[type='range'] { width: 90px; }
  .lutn { display: inline-block; max-width: 160px; vertical-align: bottom; }
  .pct { min-width: 3ch; text-align: right; }
</style>
