<script>
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import FolderField from '../components/FolderField.svelte';
  import { app, ls, logJob, toast } from '../lib/app.svelte.js';
  import { invoke, listen, openPath, openDialog } from '../lib/tauri.js';
  import { YT, friendlyError } from '../strings.js';

  let { active } = $props();
  let url = $state('');
  let format = $state(ls.get('banditur_yt_format', 'mp4'));
  let folder = $state(ls.get('banditur_yt_dir', ''));
  let error = $state('');
  // This session's downloads, newest first: { id, url, format, state: run|convert|done|error, pct, title, path, message }
  let items = $state([]);
  const current = $derived(items.find(i => i.state === 'run' || i.state === 'convert'));

  $effect(() => { ls.set('banditur_yt_format', format); });
  $effect(() => { if (folder) ls.set('banditur_yt_dir', folder); });

  onMount(() => {
    const un = listen('yt-update', e => {
      const p = e.payload;
      const it = items.find(i => i.state === 'run' || i.state === 'convert');
      if (!it) return;
      if (p.type === 'progress') { it.state = 'run'; it.pct = p.value ?? 0; }
      else if (p.type === 'converting') { it.state = 'convert'; it.pct = 99; }
      else if (p.type === 'done') { Object.assign(it, { state: 'done', pct: 100, title: p.title || it.url, path: p.path || '' }); app.busy.youtube = false; logJob({ tool: 'YouTube', name: `${it.title} (${it.format.toUpperCase()})`, status: 'Lest', tone: 'ok', path: it.path }); }
      else if (p.type === 'error') { Object.assign(it, { state: 'error', message: friendlyError(p.message || '') }); app.busy.youtube = false; }
    });
    return () => un.then(f => f());
  });

  async function download() {
    error = '';
    const u = url.trim();
    if (!u) { error = YT.no_url; return; }
    if (!/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(u)) { error = 'Dan ma jidhirx link ta\' YouTube.'; return; }
    if (current) { toast('Diġà qed iniżżel. Stenna li jispiċċa.', 'warn'); return; }
    if (!folder) {
      const picked = await openDialog({ directory: true, title: YT.choose_output });
      if (!picked) return;
      folder = picked;
    }
    const item = { id: Date.now(), url: u, format, state: 'run', pct: 0, title: '', path: '', message: '' };
    items.unshift(item);
    url = '';
    app.busy.youtube = true;
    try {
      await invoke('yt_download', { url: u, outputDir: folder, format });
    } catch (e) {
      const it = items.find(i => i.id === item.id);
      if (it && it.state !== 'done') Object.assign(it, { state: 'error', message: friendlyError(String(e)) });
      app.busy.youtube = false;
    }
  }
</script>

<div class="yt scroll">
  <section class="card main" aria-label="Niżżel minn YouTube">
    <div><h1>YouTube</h1><p class="muted lead">Waħħal link u agħżel jekk tridx il-video jew l-audio biss.</p></div>
    <div class="row">
      <label class="url" class:invalid={!!error}>
        <Icon name="link" size={16} />
        <input type="url" placeholder="https://www.youtube.com/watch?v=…" aria-label="Link ta' YouTube" bind:value={url}
               onkeydown={e => { if (e.key === 'Enter') download(); }} aria-invalid={error ? 'true' : undefined} />
      </label>
      <div class="seg" role="group" aria-label="Format">
        <button type="button" aria-pressed={format === 'mp4'} onclick={() => (format = 'mp4')}>MP4</button>
        <button type="button" aria-pressed={format === 'mp3'} onclick={() => (format = 'mp3')}>MP3</button>
      </div>
    </div>
    {#if error}<span class="field-error" role="alert">{error}</span>{/if}
    <div class="row bottom">
      <div class="dest"><FolderField id="yt-dir" label="Fejn jinħażen" bind:value={folder} /></div>
      <button class="btn primary lg" type="button" disabled={!!current} onclick={download}>{current ? 'Qed iniżżel…' : `Niżżel ${format.toUpperCase()}`}</button>
    </div>
    <p class="help">{format === 'mp4' ? 'L-aħjar kwalità ta\' video u audio, f\'MP4.' : 'Audio biss, MP3 ta\' 192 kbps.'} Juża yt-dlp u ffmpeg.</p>
  </section>

  {#if items.length}
    <section class="list" aria-label="Downloads">
      <span class="label">Din is-sessjoni</span>
      {#each items as it (it.id)}
        <div class="item card" class:err={it.state === 'error'}>
          <div class="ih">
            <strong class="truncate">{it.title || it.url}</strong>
            <span class="pill">{it.format.toUpperCase()}</span>
            <span class="spacer"></span>
            {#if it.state === 'run'}<span class="mono muted">{Math.round(it.pct)}%</span>
            {:else if it.state === 'convert'}<span class="muted small">{YT.converting(it.format.toUpperCase())}</span>
            {:else if it.state === 'done'}<span class="ok small">✓ Lest</span><button class="link small" type="button" onclick={() => openPath(it.path)}>Iftaħ il-file</button>
            {:else}<span class="small" style="color: var(--danger-fg)">{it.message}</span>{/if}
          </div>
          {#if it.state === 'run' || it.state === 'convert'}
            <div class="progress" class:indeterminate={it.state === 'convert'}><span style="width: {it.pct}%"></span></div>
          {/if}
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .yt { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 48px 40px; background: var(--bg-sunken); }
  .main { width: min(720px, 100%); padding: 28px; display: flex; flex-direction: column; gap: 16px; }
  .lead { margin-top: 4px; }
  .row { display: flex; gap: 10px; align-items: center; }
  .row.bottom { align-items: flex-end; }
  .url { flex: 1; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: 9px; background: var(--input); color: var(--muted); }
  .url:focus-within { border-color: var(--accent); box-shadow: var(--focus); }
  .url.invalid { border-color: var(--danger); }
  .url input { flex: 1; border: 0; outline: none; background: transparent; color: var(--fg); font-family: var(--font-mono); font-size: 12px; }
  .dest { flex: 1; }
  .list { width: min(720px, 100%); display: flex; flex-direction: column; gap: 8px; }
  .item { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .item.err { background: var(--danger-bg); border-color: var(--danger-line); }
  .ih { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .ok { color: var(--ok-fg); }
</style>
