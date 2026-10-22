<script>
  // Traskrittura: pick or drop a video → transcribe (Python sidecar) → the
  // subtitle editor (src/subtitles/editor.js), which brings its own markup.
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { app, toast } from '../lib/app.svelte.js';
  import { invoke, listen, openDialog, saveDialog, openPath, fileSrc, onDragDrop, isMock, baseName } from '../lib/tauri.js';
  import { createSubtitleEditor, loadSavedSession, listRecentSessions, deleteSavedSession, clearSavedSessions } from '../subtitles/editor.js';
  import { SUB, TX, ERR } from '../strings.js';
  import { ago } from '../lib/format.js';
  import { handoffTx } from './traskrittura/handoff.svelte.js';
  import editorHtml from './traskrittura/editor.html?raw';

  let { active } = $props();
  const EXT = ['mp4', 'mov', 'mp3', 'wav'];

  let root = $state();
  let editor = null;
  let video = null;
  let open = $state(false);
  let videoPath = $state('');
  let processing = $state(false);
  let status = $state('');
  let statusTone = $state('idle');
  let pct = $state(null);           // null = hidden, -1 = indeterminate
  let over = $state(false);
  let resume = $state(null);        // { path, saved, resolve }
  let recent = $state(listRecentSessions(6));
  let armed = $state('');           // path whose × was clicked once

  onMount(() => {
    video = root.querySelector('#tx-video');
    editor = createSubtitleEditor({
      root, video, invoke, saveDialog, openDialog, openPath, fileSrc, listen,
      toast: (m, t) => toast(m, t), S: SUB,
    });
    root.querySelector('#tx-btn-back').addEventListener('click', close);
    video.addEventListener('error', () => {
      if (!open || !video.getAttribute('src') || isMock()) return;
      toast(SUB.missing_file, 'error');
      close();
    });
    // Track a running export so the window asks before closing.
    const cancel = root.querySelector('#sub-export-cancel');
    const bar = root.querySelector('#sub-export-status');
    const mo = new MutationObserver(() => { app.busy.export = !bar.hidden && !cancel.hidden; });
    mo.observe(bar, { attributes: true, attributeFilter: ['hidden'] });
    mo.observe(cancel, { attributes: true, attributeFilter: ['hidden'] });
    return () => mo.disconnect();
  });

  // Warm the model while the user picks a file.
  $effect(() => { if (active && !open) invoke('preload_transcribe').catch(() => {}); });
  $effect(() => { if (handoffTx.open && editor) { const p = handoffTx.open; handoffTx.open = ''; const s = loadSavedSession(p); if (s) openSaved(p, s); } });

  onMount(() => onDragDrop(p => {
    if (!active || open) return;
    if (p.type === 'enter' || p.type === 'over') over = !processing;
    else if (p.type === 'leave') over = false;
    else if (p.type === 'drop') { over = false; if (!processing && p.paths?.length) start(p.paths[0]); }
  }));

  function show(path) {
    video.src = fileSrc(path);
    open = true;
  }
  function close() {
    video.pause();
    video.removeAttribute('src');
    video.load();
    editor.clear();
    videoPath = '';
    open = false;
    status = ''; statusTone = 'idle'; pct = null;
    recent = listRecentSessions(6);
  }
  function openSaved(path, saved) {
    videoPath = path;
    show(path);
    editor.load({ cues: saved.cues, session: saved, videoPath: path, srtPath: path.replace(/\.[^./\\]+$/, '') + '.srt' });
  }

  async function pick() {
    if (processing) return;
    const p = await openDialog({ multiple: false, filters: [{ name: 'Video jew awdjo', extensions: EXT }] });
    if (p) start(p);
  }

  let unlisten = null;
  async function start(path) {
    if (processing) return;
    if (!EXT.includes(path.split('.').pop()?.toLowerCase())) { status = ERR.video_format; statusTone = 'error'; return; }
    const saved = loadSavedSession(path);
    if (saved) {
      const go = await new Promise(resolve => (resume = { path, saved, resolve }));
      resume = null;
      if (go) { openSaved(path, saved); return; }
    }
    videoPath = path;
    processing = true;
    app.busy.transcribe = true;
    status = TX.starting; statusTone = 'active'; pct = -1;
    unlisten = await listen('transcribe-update', e => handle(typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload));
    try { await invoke('process_video', { videoPath: path }); }
    catch (err) { handle({ type: 'error', message: String(err) }); }
  }
  function stop() { unlisten?.(); unlisten = null; processing = false; app.busy.transcribe = false; }
  function handle(d) {
    if (d.type === 'status') { status = d.message; statusTone = 'active'; }
    else if (d.type === 'progress') {
      if (d.value < 0) pct = -1; else if (d.value === 0) pct = null;
      else { pct = d.value; status = TX.transcribing(d.value); }
    } else if (d.type === 'done') {
      stop();
      show(videoPath);
      editor.load({
        words: d.all_words || [], videoPath, srtPath: d.srt_path,
        peaks: d.peaks?.length ? { rate: d.peaks_rate || 50, peaks: d.peaks } : null,
      });
      invoke('preload_transcribe').catch(() => {});
    } else if (d.type === 'error') {
      stop();
      status = TX.error(String(d.message).split('\n')[0]); statusTone = 'error'; pct = null;
    }
  }

  function del(path) {
    if (armed !== path) { armed = path; setTimeout(() => { if (armed === path) armed = ''; }, 3000); return; }
    armed = '';
    deleteSavedSession(path);
    recent = listRecentSessions(6);
  }
</script>

<div class="tx">
  {#if !open}
    <div class="drop-view scroll">
      <button class="drop" class:over class:busy={processing} type="button" onclick={pick} disabled={processing}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>
        <strong>{processing ? 'Qed jittraskrivi…' : "Waqqa' video jew awdjo hawn"}</strong>
        <span class="muted">{processing ? baseName(videoPath) : 'jew ikklikkja biex tagħżel · .mp4 .mov .mp3 .wav · bil-Malti'}</span>
      </button>

      {#if status}
        <div class="status card" class:err={statusTone === 'error'} role="status">
          <span>{status}</span>
          {#if pct !== null}<div class="progress" class:indeterminate={pct < 0}><span style="width: {pct < 0 ? 35 : pct}%"></span></div>{/if}
          {#if processing}<span class="muted small">L-ewwel darba jista' jdum aktar għax jgħabbi l-mudell.</span>{/if}
        </div>
      {/if}

      {#if resume}
        <div class="card resume" role="alertdialog" aria-labelledby="rs-t">
          <div><strong id="rs-t">{SUB.resume_title(baseName(resume.path))}</strong><div class="muted small">{SUB.resume_meta(SUB.ago(Date.now() - (resume.saved.savedAt || Date.now())), resume.saved.cues.length)}</div></div>
          <span class="spacer"></span>
          <button class="btn" type="button" onclick={() => resume.resolve(false)}>{SUB.resume_no}</button>
          <button class="btn primary" type="button" onclick={() => resume.resolve(true)}>{SUB.resume_yes}</button>
        </div>
      {/if}

      {#if recent.length && !processing}
        <section class="recent" aria-label="Riċenti">
          <div class="rh"><span class="label">Riċenti</span><span class="spacer"></span>
            <button class="link small" type="button" onclick={() => { if (armed !== '*') { armed = '*'; setTimeout(() => { if (armed === '*') armed = ''; }, 3000); return; } armed = ''; clearSavedSessions(); recent = []; toast(SUB.recent_cleared, 'ok'); }}>{armed === '*' ? SUB.recent_confirm : SUB.recent_clear}</button>
          </div>
          {#each recent as r (r.path)}
            <div class="rr card">
              <button class="ro" type="button" title={r.path} onclick={() => { const s = loadSavedSession(r.path); if (s) openSaved(r.path, s); }}>
                <Icon name="captions" size={18} />
                <span class="rt"><strong class="truncate">{r.name}</strong><span class="muted small">{SUB.resume_meta(ago(r.savedAt), r.cues)}</span></span>
              </button>
              <button class="btn ghost sm" type="button" title={SUB.recent_confirm_t} aria-label={SUB.recent_delete(r.name)} onclick={() => del(r.path)}>{armed === r.path ? SUB.recent_confirm : 'Ħassar'}</button>
            </div>
          {/each}
        </section>
      {/if}
    </div>
  {/if}

  <div id="tx-editor-view" class="sub-editor" bind:this={root} hidden={!open}>
    {@html editorHtml}
  </div>
</div>

<style>
  .tx { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
  .tx :global(#tx-editor-view) { flex: 1; min-height: 0; }
  .drop-view { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 56px 40px; }
  .drop {
    width: min(720px, 100%); height: 220px; border-radius: 16px; border: 1.5px dashed var(--line-strong); background: var(--bg-sunken);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--fg);
  }
  .drop svg { color: var(--accent-fg); margin-bottom: 6px; }
  .drop strong { font-size: 15px; }
  .drop:hover:not(:disabled), .drop.over { border-color: var(--accent); background: var(--accent-soft); }
  .drop.busy { cursor: progress; }
  .status { width: min(720px, 100%); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .status.err { background: var(--danger-bg); border-color: var(--danger-line); color: var(--danger-fg); }
  .resume { width: min(720px, 100%); padding: 14px 16px; display: flex; align-items: center; gap: 10px; }
  .recent { width: min(720px, 100%); display: flex; flex-direction: column; gap: 8px; }
  .rh { display: flex; align-items: baseline; }
  .rr { display: flex; align-items: center; gap: 6px; padding: 4px 8px 4px 4px; }
  .ro { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 0; background: none; color: var(--fg); text-align: left; border-radius: 8px; }
  .ro:hover { background: var(--hover); }
  .ro :global(svg) { color: var(--accent-fg); flex-shrink: 0; }
  .rt { display: flex; flex-direction: column; min-width: 0; }
</style>
