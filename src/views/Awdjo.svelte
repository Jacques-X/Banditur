<script>
  // Awdjo (Video → Awdjo): drop videos → each gets a NEW file next to the original with the speech cleaned by
  // NVIDIA RE-USE (sidecar/awdjo.py, on the GPU through MLX). The picture is copied untouched; the original is
  // never changed. One file at a time; the pure rules (names, formats, queue) are in views/awdjo/awdjo.js.
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { app, toast, ls, confirm } from '../lib/app.svelte.js';
  import { updateStudioJob } from '../lib/studio-jobs.svelte.js';
  import { invoke, listen, openDialog, onDragDrop, fileSrc, notify } from '../lib/tauri.js';
  import { AW, friendlyError } from '../strings.js';
  import { awdjoModel, refreshAwdjoModel, downloadAwdjoModel, removeAwdjoModel, mb } from '../lib/awdjo-model.svelte.js';
  import * as Q from './awdjo/awdjo.js';

  let { active } = $props();
  const uuid = () => crypto.randomUUID();

  let queue = $state([]);
  let strength = $state(Q.clampStrength(ls.get('banditur_awdjo_strength', Q.DEFAULT_STRENGTH)));
  let running = $state(false);
  let over = $state(false);
  let reqId = null;
  let current = null;
  let finishRun = null;
  let stopRequested = false;

  const c = $derived(Q.counts(queue));
  const waiting = $derived(c.wait);
  const total = $derived(Q.overallPct(queue));
  const hasEnded = $derived(c.done + c.error + c.cancelled > 0);
  const fmt = (path) => Q.soundFormat(Q.outputExt(path)).label;
  const outExt = (path) => Q.outputExt(path).toUpperCase();

  onMount(() => { refreshAwdjoModel(); });

  // ── adding files ─────────────────────────────────────────────────────────
  function add(paths) {
    const r = Q.addFiles(queue, paths, uuid);
    queue = r.queue;
    if (r.rejected.length) toast(AW.unsupported(r.rejected), 'warn');
  }
  async function pick() {
    const p = await openDialog({ multiple: true, filters: [{ name: 'Video / Awdjo', extensions: Q.PICK_EXT }] });
    if (p) add(Array.isArray(p) ? p : [p]);
  }
  onMount(() => onDragDrop((p) => {
    if (!active) return;
    if (p.type === 'enter' || p.type === 'over') over = true;
    else if (p.type === 'leave') over = false;
    else if (p.type === 'drop') { over = false; if (p.paths?.length) add(p.paths); }
  }));

  // ── the model ────────────────────────────────────────────────────────────
  async function getModel() {
    const ok = await downloadAwdjoModel();
    if (ok) toast(AW.modelDone, 'ok');
    else if (awdjoModel.error) toast(`${AW.modelFailed} ${awdjoModel.error}`, 'error');
  }

  // ── running the queue ────────────────────────────────────────────────────
  function setStrength(v) { strength = Q.clampStrength(v); ls.set('banditur_awdjo_strength', String(strength)); }

  const messageOf = (m) => {
    const text = String(m || '');
    if (/--awdjo/.test(text)) return AW.engineOld;
    return friendlyError(text);
  };

  async function runQueue() {
    if (running) return;
    if (!awdjoModel.installed) { toast(AW.needModel, 'warn'); return; }
    stopCompare();
    running = true; stopRequested = false; app.busy.export = true;
    let ok = 0, bad = 0;
    try {
      for (let it; !stopRequested && (it = Q.nextWaiting(queue)); ) {
        const r = await runOne(it);
        if (r === 'done') ok++; else if (r === 'error') bad++;
      }
    } finally { running = false; app.busy.export = false; }
    if (ok || bad) {
      toast(bad ? `${AW.allDone(ok)} ${AW.someFailed(bad)}` : AW.allDone(ok), bad ? 'warn' : 'ok');
      notify(AW.title, bad ? AW.someFailed(bad) : AW.allDone(ok));
    }
  }

  async function runOne(it) {
    const taskId = uuid();
    it.state = 'run'; it.pct = 0; it.status = AW.running; it.error = undefined;
    updateStudioJob(taskId, { kind: 'awdjo', name: AW.jobName(Q.stemOf(it.path)), state: 'running', path: it.path });
    reqId = uuid(); current = it;
    const ended = new Promise((res) => { finishRun = res; });
    try {
      it.output = await Q.freeOutput(it.path, (paths) => invoke('awdjo_taken', { paths }));
      await invoke('awdjo_run', { job: { path: it.path, output: it.output, strength: Q.strengthFraction(strength) }, requestId: reqId });
    } catch (e) {
      it.output = undefined;
      it.state = 'error';
      it.error = e?.message === 'too-many' ? AW.tooMany : messageOf(e?.message || e);
      finishRun?.('error');
    }
    const result = await ended;
    updateStudioJob(taskId, { state: result === 'done' ? 'done' : result === 'cancelled' ? 'cancelled' : 'failed', ...(it.error ? { error: it.error } : {}) });
    current = null; reqId = null; finishRun = null;
    return result;
  }

  onMount(() => {
    const un = listen('awdjo-update', (e) => {
      const d = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
      const it = current;
      if (!it || !reqId || d.id !== reqId) return;
      if (d.type === 'status') it.status = d.message;
      else if (d.type === 'progress') it.pct = Math.max(it.pct, Math.round(d.value));
      else if (d.type === 'done') { it.state = 'done'; it.pct = 100; it.output = d.path || it.output; it.seconds = d.seconds; it.status = ''; finishRun?.('done'); }
      else if (d.type === 'error') { it.state = 'error'; it.error = messageOf(d.message); it.output = undefined; finishRun?.('error'); }
      else if (d.type === 'cancelled') { it.state = 'cancelled'; it.output = undefined; it.status = AW.cancelled; stopRequested = true; finishRun?.('cancelled'); }
    });
    return () => { un.then((f) => f()); };
  });

  async function cancelJob() {
    stopRequested = true;
    try { await invoke('cancel_awdjo'); } catch (e) { toast(String(e), 'error'); }
  }
  const remove = (id) => { queue = Q.removeItem(queue, id); };
  const clearEnded = () => { stopCompare(); queue = Q.clearFinished(queue); };
  const retry = () => { queue = Q.retryFailed(queue); };
  const reveal = (path) => invoke('reveal_in_finder', { path }).catch((e) => toast(String(e), 'error'));

  async function dropModel() {
    if (!await confirm(AW.modelRemoveAsk, { yes: AW.modelRemove, no: AW.cancel, danger: true })) return;
    await removeAwdjoModel();
  }

  // ── before / after: 6 s of the original, then 6 s of the clean file, from the middle of the clip ──
  let cmp = $state(null);                     // { id, side: 'before' | 'after' }
  let audioEl = null;
  let cmpToken = 0;
  function stopCompare() { cmpToken++; if (audioEl) { audioEl.pause(); audioEl = null; } cmp = null; }
  async function playSide(token, id, side, path, start) {
    const a = new Audio(fileSrc(path));
    audioEl = a;
    cmp = { id, side };
    await new Promise((res, rej) => { a.onloadedmetadata = res; a.onerror = () => rej(new Error('audio')); });
    if (token !== cmpToken) return null;
    const from = start ?? Math.max(0, (a.duration || 0) / 2 - 3);
    a.currentTime = from;
    await a.play();
    await new Promise((res) => { const h = setTimeout(res, 6000); a.onended = () => { clearTimeout(h); res(); }; a.onpause = () => { clearTimeout(h); res(); }; });
    a.pause();
    return from;
  }
  async function compare(it) {
    if (cmp?.id === it.id) { stopCompare(); return; }
    stopCompare();
    const token = cmpToken;
    try {
      const from = await playSide(token, it.id, 'before', it.path, null);
      if (from == null || token !== cmpToken) return;
      await playSide(token, it.id, 'after', it.output, from);
    } catch { if (token === cmpToken) toast(AW.compareFailed, 'warn'); }
    if (token === cmpToken) stopCompare();
  }
</script>

<div class="aw">
  <div class="wrap scroll">
    <button class="drop" class:over type="button" onclick={pick}>
      <Icon name="video" size={40} />
      <strong>{AW.dropTitle}</strong>
      <span class="muted">{AW.dropHint}</span>
    </button>

    {#if awdjoModel.known && !awdjoModel.installed}
      <div class="notice info model" role="status">
        <div class="mt">
          <strong>{AW.modelTitle}</strong>
          <span class="small">{awdjoModel.downloading ? AW.modelDownloading : AW.modelNeed}</span>
          {#if awdjoModel.downloading}<div class="progress"><span style="width: {awdjoModel.pct}%"></span></div>{/if}
          {#if awdjoModel.error}<span class="small err">{awdjoModel.error}</span>{/if}
        </div>
        <button class="btn primary sm" type="button" onclick={getModel} disabled={awdjoModel.downloading}>{AW.modelDownload}</button>
      </div>
    {/if}

    <div class="opts">
      <label class="small ctl" title={AW.strengthTip}>{AW.strength}
        <input type="range" min="0" max="100" step="1" value={strength} oninput={(e) => setStrength(+e.currentTarget.value)} disabled={running} aria-label={AW.strength} />
        <span class="pct">{strength}%</span></label>
      <span class="spacer"></span>
      {#if awdjoModel.installed}
        <span class="small muted">{AW.modelReady} ({mb(awdjoModel.bytes)})</span>
        <button class="link small" type="button" onclick={dropModel} disabled={running}>{AW.modelRemove}</button>
      {/if}
    </div>

    {#if queue.length}
      <section class="list" aria-label={AW.queue}>
        <div class="lh">
          <span class="label">{AW.queue}</span>
          <span class="spacer"></span>
          {#if c.error + c.cancelled > 0 && !running}<button class="link small" type="button" onclick={retry}>{AW.retry}</button>{/if}
          {#if hasEnded && !running}<button class="link small" type="button" onclick={clearEnded}>{AW.clear}</button>{/if}
        </div>
        {#each queue as it (it.id)}
          <div class="row card" class:run={it.state === 'run'} class:bad={it.state === 'error'}>
            <Icon name="video" size={18} />
            <div class="rt">
              <strong class="truncate" title={it.path}>{it.name}</strong>
              {#if it.state === 'wait'}
                <span class="small muted">{AW.waiting} · {outExt(it.path)} · {fmt(it.path)}</span>
              {:else if it.state === 'run'}
                <span class="small muted">{it.status}</span>
                <div class="progress"><span style="width: {it.pct}%"></span></div>
              {:else if it.state === 'done'}
                <span class="small ok truncate" title={AW.outputTip(Q.baseOf(it.output), fmt(it.path))}>{AW.done} · {Q.baseOf(it.output)}{it.seconds ? ` · ${AW.seconds(it.seconds)}` : ''}</span>
              {:else if it.state === 'error'}
                <span class="small err">{AW.failed}: {it.error}</span>
              {:else}
                <span class="small muted">{AW.cancelled}</span>
              {/if}
            </div>
            <div class="acts">
              {#if it.state === 'run'}
                <span class="small muted pcts">{it.pct}%</span>
                <button class="btn sm" type="button" onclick={cancelJob}>{AW.cancel}</button>
              {:else if it.state === 'done'}
                <button class="btn sm" type="button" onclick={() => compare(it)} disabled={running}>{cmp?.id === it.id ? `${cmp.side === 'before' ? AW.compareBefore : AW.compareAfter} ${AW.compareStop}` : AW.compare}</button>
                <button class="btn sm" type="button" onclick={() => reveal(it.output)}>{AW.reveal}</button>
                <button class="btn ghost sm" type="button" aria-label={AW.remove} title={AW.remove} onclick={() => remove(it.id)}>✕</button>
              {:else}
                <button class="btn ghost sm" type="button" aria-label={AW.remove} title={AW.remove} onclick={() => remove(it.id)}>✕</button>
              {/if}
            </div>
          </div>
        {/each}
        {#if running && queue.length > 1}
          <div class="progress total" aria-label="{total}%"><span style="width: {total}%"></span></div>
        {/if}
        <div class="go">
          <button class="btn primary" type="button" onclick={runQueue} disabled={running || !waiting || !awdjoModel.installed}>{waiting ? AW.startN(waiting) : AW.start}</button>
        </div>
      </section>
    {:else}
      <p class="muted small explain">{AW.explain}</p>
    {/if}
    <p class="muted small explain">{AW.formats}</p>
  </div>
</div>

<style>
  .aw { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
  .wrap { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 48px 40px 32px; overflow-y: auto; }
  .wrap > * { width: min(720px, 100%); }
  .drop {
    height: 190px; border-radius: 16px; border: 1.5px dashed var(--line-strong); background: var(--bg-sunken); flex-shrink: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--fg);
  }
  .drop :global(svg) { color: var(--accent-fg); margin-bottom: 6px; }
  .drop strong { font-size: 15px; }
  .drop:hover, .drop.over { border-color: var(--accent); background: var(--accent-soft); }
  .model { align-items: center; justify-content: space-between; }
  .mt { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
  .err { color: var(--danger-fg); }
  .ok { color: var(--ok-fg); }
  .opts { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .ctl { display: inline-flex; align-items: center; gap: 8px; }
  .ctl input[type='range'] { width: 180px; }
  .pct { min-width: 4ch; text-align: right; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .lh { display: flex; align-items: baseline; gap: 12px; }
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; }
  .row :global(svg) { color: var(--accent-fg); flex-shrink: 0; }
  .row.run { border-color: var(--accent); }
  .row.bad { border-color: var(--danger-line); }
  .rt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .acts { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .pcts { min-width: 4ch; text-align: right; }
  .total { margin-top: 4px; }
  .go { display: flex; justify-content: flex-end; padding-top: 4px; }
  .explain { margin: 0; }
</style>
