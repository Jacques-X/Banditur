<script>
  // Traskrittura: pick or drop a video → transcribe (Python sidecar) → the
  // subtitle editor (src/subtitles/editor.js), which brings its own markup.
  import { onMount } from 'svelte';
  import { updateStudioJob } from '../lib/studio-jobs.svelte.js';
  import Modal from '../components/Modal.svelte';
  import { projects, saveProject, exportProject, importProject, eventWork } from '../lib/projects.svelte.js';
  import { parseSrt } from '../subtitles/import.js';
  import { wordsFromSidecar } from '../subtitles/model.js';
  import { sendPaths } from '../lib/handoff.svelte.js';
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
  let editor = $state.raw(null);
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
  let taskId='';
  let language=$state('mt'), missing=$state(null), review=$state(null), passage=$state(null), replacement=$state(null);
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
      missing={path:videoPath,saved:loadSavedSession(videoPath)};
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
  $effect(() => { if (handoffTx.open && editor) { const p = handoffTx.open; handoffTx.open = ''; const s = loadSavedSession(p); if (s) openSaved(p, s); else start(p); } });

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
    const p = await openDialog({ multiple: false, filters: [{ name: 'Video jew audio', extensions: EXT }] });
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
    taskId=crypto.randomUUID();updateStudioJob(taskId,{kind:'traskrittura',name:baseName(path),state:'running',path});
    processing = true;
    app.busy.transcribe = true;
    status = TX.starting; statusTone = 'active'; pct = -1;
    unlisten = await listen('transcribe-update', e => handle(typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload));
    try { await invoke('process_video', { videoPath: path,language }); }
    catch (err) { handle({ type: 'error', message: String(err) }); }
  }
  function stop() { unlisten?.(); unlisten = null; processing = false; app.busy.transcribe = false; }
  function handle(d) {
    if (d.type === 'status') { status = d.message; statusTone = 'active'; }
    else if (d.type === 'progress') {
      if (d.value < 0) pct = -1; else if (d.value === 0) pct = null;
      else { pct = d.value; status = TX.transcribing(d.value); }
    } else if (d.type === 'done') {
      if(taskId)updateStudioJob(taskId,{state:'done'});
      stop();
      if(passage) {replacement=wordsFromSidecar(d.all_words || []);return;}
      show(videoPath);
      editor.load({
        words: d.all_words || [], videoPath, srtPath: d.srt_path,
        peaks: d.peaks?.length ? { rate: d.peaks_rate || 50, peaks: d.peaks } : null,
      });
      invoke('preload_transcribe').catch(() => {});
    } else if (d.type === 'error') {
      if(taskId)updateStudioJob(taskId,{state:'failed',error:d.message});
      stop();
      status = TX.error(String(d.message).split('\n')[0]); statusTone = 'error'; pct = null;
    }
  }

  async function locate(path) {
    const saved=loadSavedSession(path);if(!saved) return;
    const picked=await openDialog({filters:[{name:'Video / audio',extensions:EXT}]});if(!picked) return;
    try {
      const id=saved.projectId || crypto.randomUUID();
      await saveProject({id,version:1,kind:'subtitles',name:baseName(picked),mediaPath:picked,data:{...saved,projectId:id},eventId:saved.eventId ?? eventWork.id});
      localStorage.removeItem(`banditur_subs:${path}`);missing=null;openSaved(picked,{...saved,projectId:id});recent=listRecentSessions(6);
    } catch(e) {toast(e.message,'error');}
  }
  async function openPortable() {
    try {const p=await importProject();if(p?.kind==='subtitles') {if(p.logoPath && p.data.logo)p.data.logo.path=p.logoPath;openSaved(p.mediaPath,{...p.data,projectId:p.id,eventId:p.eventId,projectState:p.status});}else if(p) toast('Dan il-proġett jinfetaħ minn Posts.','info');}
    catch(e) {toast(String(e),'error');}
  }
  async function importSrt(withVideo=false) {
    try {
      if(withVideo) {const p=await openDialog({filters:[{name:'Video / audio',extensions:EXT}]});if(!p) return;videoPath=p;}
      const p=await openDialog({filters:[{name:'SRT',extensions:['srt']}]});if(!p) return;
      const cues=parseSrt(await invoke('read_work_text',{path:p}));
      if(withVideo) {show(videoPath);await editor.load({cues,videoPath,srtPath:p});} else editor.importCues(cues);
    } catch(e) {toast(String(e),'error');}
  }
  async function transcribePassage() {
    if(processing) return;
    if(!(passage.end>passage.start && passage.start>=0)) {toast('Agħżel ħinijiet validi.','error');return;}
    processing=true;app.busy.transcribe=true;replacement=null;
    unlisten=await listen('transcribe-update',e=>handle(e.payload));
    try {await invoke('process_video',{videoPath,language,start:passage.start,end:passage.end});}
    catch(e) {stop();toast(String(e),'error');}
  }
  async function sendExport() {
    if(editor.lastExportPath) await sendPaths([editor.lastExportPath],{contentType:'reel',eventId:editor.getProject().eventId});
  }
  function del(path) {
    if (armed !== path) { armed = path; setTimeout(() => { if (armed === path) armed = ''; }, 3000); return; }
    armed = '';
    deleteSavedSession(path);
    recent = listRecentSessions(6);
  }
</script>

<div class="tx">
  <div class="tx-actions">
    <label class="small">Lingwa <select class="input" bind:value={language} disabled={processing}><option value="mt">Malti</option><option value="en">English</option><option value="it">Italiano</option><option value="auto">Agħraf il-lingwa</option></select></label>
    <button class="btn sm" type="button" onclick={openPortable}>Iftaħ proġett…</button>
    <button class="btn sm" type="button" onclick={()=>importSrt(!open)}>Importa SRT…</button>
    {#if open}
      <button class="btn sm" type="button" onclick={async()=>{try {await exportProject(editor.getProject());}catch(e){toast(String(e),'error');}}}>Save project…</button>
      <button class="btn sm" type="button" onclick={async()=>{try {await exportProject(editor.getProject(),true);}catch(e){toast(String(e),'error');}}}>Proġett bil-media…</button>
      <button class="btn sm" type="button" onclick={()=>review=editor.review()}>Verifika qabel export</button>
      <button class="btn sm" type="button" disabled={processing} onclick={()=>{const c=editor.selection;if(c) passage={start:c.start,end:c.end};}}>Erġa’ traskrivi passaġġ…</button>
      <button class="btn sm" type="button" onclick={sendExport}>Uża l-aħħar MP4 fi Skeda</button>
    {/if}
  </div>
  {#if missing}<div class="notice warn">Il-medjum ma nstabx. Il-bidliet tiegħek għadhom miżmuma.<button class="btn sm" onclick={()=>locate(missing.path)}>Sib il-file…</button></div>{/if}
  {#if !open}
    <div class="drop-view scroll">
      <button class="drop" class:over class:busy={processing} type="button" onclick={pick} disabled={processing}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>
        <strong>{processing ? 'Qed jittraskrivi…' : "Waqqa' video jew audio hawn"}</strong>
        <span class="muted">{processing ? baseName(videoPath) : 'jew ikklikkja biex tagħżel · .mp4 .mov .mp3 .wav · bil-Malti'}</span>
      </button>

      {#if status}
        <div class="status card" class:err={statusTone === 'error'} role="status">
          <span>{status}</span>
          {#if pct !== null}<div class="progress" class:indeterminate={pct < 0}><span style="width: {pct < 0 ? 35 : pct}%"></span></div>{/if}
          {#if processing}<span class="muted small">L-ewwel darba jista' jdum aktar għax jgħabbi il-model.</span>{/if}
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
              <button class="btn ghost sm" type="button" onclick={()=>locate(r.path)}>Sib il-file…</button>
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

{#if review}
  <Modal title="Verifika tas-subtitles" onclose={()=>review=null} width={680}>
    {#each review as issue}<button class="btn" type="button" onclick={()=>{editor.seekCue(issue.index);review=null;}}>{issue.index+1} · {issue.text} · {issue.issues.join(', ')}</button>{:else}<p>Ma nstabu l-ebda twissijiet ta’ qari jew kliem dubjuż.</p>{/each}
    <p class="muted small">L-ismijiet u l-artikli jistgħu jiġu riveduti fit-tab Ismijiet.</p>
  </Modal>
{/if}
{#if passage}
  <Modal title="Erġa’ traskrivi l-passaġġ" onclose={()=>{if(!processing) {passage=null;replacement=null;}}} width={680}>
    <div class="tx-actions"><label>Bidu (sekondi)<input class="input" type="number" min="0" step="0.1" bind:value={passage.start} disabled={processing}/></label><label>Tmiem<input class="input" type="number" min="0" step="0.1" bind:value={passage.end} disabled={processing}/></label><button class="btn primary" disabled={processing} onclick={transcribePassage}>{processing?'Qed jittraskrivi…':'Traskrivi'}</button></div>
    {#if replacement}<p><strong>Issa</strong><br/>{editor.doc.cues.filter(c=>c.end>passage.start && c.start<passage.end).map(c=>c.words.map(w=>w.text).join(' ')).join(' ')}</p><p><strong>Proposta</strong><br/>{replacement.map(w=>w.text).join(' ')}</p><button class="btn primary" onclick={()=>{try {editor.replacePassage(passage.start,passage.end,replacement);passage=null;replacement=null;}catch(e){toast(e.message,'error');}}}>Applika · tista’ tirtira</button>{/if}
    {#if statusTone==='error'}<p class="notice danger">{status}</p>{/if}
  </Modal>
{/if}
<style>
  .tx-actions {display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 16px;border-bottom:1px solid var(--line);}
  .tx-actions label {display:flex;align-items:center;gap:6px;}

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
