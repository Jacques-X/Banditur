<script>
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { api } from '../../lib/api.js';
  import { addMedia, normalizeMime, post } from './composer.svelte.js';
  import { toast } from '../../lib/app.svelte.js';
  import { EMPTY, TOAST, SCHED } from '../../strings.js';

  let { onclose } = $props();
  const FOLDER = 'application/vnd.google-apps.folder';
  const cache = new Map();
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  let stack = $state([]);           // [{ id, name }]
  let files = $state([]);
  let loading = $state(true);
  let error = $state('');
  let fetching = $state('');        // id of the file being downloaded

  async function load(folderId) {
    loading = true; error = '';
    try {
      const key = folderId || '__root__';
      let list = cache.get(key);
      if (!list) {
        list = await api('/api/drive/posters', { query: { folderId } });
        list = (list || []).filter(f => f.mimeType === FOLDER || normalizeMime(f.mimeType, f.name))
          .sort((a, b) => ((a.mimeType === FOLDER ? 0 : 1) - (b.mimeType === FOLDER ? 0 : 1)) || collator.compare(a.name || '', b.name || ''));
        cache.set(key, list);
      }
      files = list;
    } catch (e) { error = e.message; files = []; }
    loading = false;
  }
  $effect(() => { load(stack.at(-1)?.id || null); });

  async function pick(f) {
    if (f.mimeType === FOLDER) { stack.push({ id: f.id, name: f.name }); return; }
    fetching = f.id;
    try {
      const res = await api(`/api/drive/file/${f.id}`, { raw: true });
      const blob = await res.blob();
      if (!blob.size) throw new Error('Il-file minn Drive huwa vojt.');
      const type = normalizeMime(blob.type || res.headers.get('Content-Type') || f.mimeType, f.name);
      if (!type) throw new Error('Dan il-file mhux stampa jew video.');
      const before = post.media.length;
      addMedia([new File([blob], f.name, { type })]);
      if (post.media.length > before) onclose();
    } catch (e) {
      toast(TOAST.drive_err(e.message), 'error');
    }
    fetching = '';
  }
</script>

<Modal title="Google Drive" width={760} {onclose}>
  <nav class="crumbs" aria-label="Fejn qiegħed">
    <button class="link" type="button" onclick={() => (stack = [])} disabled={!stack.length}>Drive</button>
    {#each stack as s, i}
      <span class="muted">/</span>
      <button class="link" type="button" disabled={i === stack.length - 1} onclick={() => stack.splice(i + 1)}>{s.name}</button>
    {/each}
  </nav>
  {#if loading}
    <div class="empty">{EMPTY.loading}</div>
  {:else if error}
    <div class="notice danger">{error}</div>
  {:else if !files.length}
    <div class="empty"><strong>{EMPTY.no_drive}</strong>Dan il-folder ma fihx ritratti jew videos.</div>
  {:else}
    <div class="grid">
      {#each files as f (f.id)}
        <button class="item" type="button" onclick={() => pick(f)} disabled={!!fetching} aria-busy={fetching === f.id}>
          <span class="thumb">
            {#if f.mimeType === FOLDER}
              <Icon name="folder" size={34} stroke={1.5} />
            {:else if f.thumbnailLink}
              <img src={f.thumbnailLink.replace(/=s\d+$/, '=s240')} alt="" loading="lazy" onerror={e => (e.currentTarget.style.display = 'none')} />
            {:else}
              <Icon name="image" size={28} stroke={1.5} />
            {/if}
            {#if fetching === f.id}<span class="busy">{SCHED.downloading}</span>{/if}
          </span>
          <span class="name truncate">{f.name}</span>
        </button>
      {/each}
    </div>
  {/if}
</Modal>

<style>
  .crumbs { display: flex; align-items: center; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
  .crumbs .link:disabled { color: var(--fg); cursor: default; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; }
  .item { display: flex; flex-direction: column; gap: 6px; border: 0; background: none; padding: 0; text-align: left; color: var(--fg); }
  .thumb { position: relative; aspect-ratio: 1; border-radius: 8px; background: var(--bg-sunken); border: 1px solid var(--line); display: grid; place-items: center; overflow: hidden; color: var(--muted); }
  .item:hover .thumb { border-color: var(--accent); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .busy { position: absolute; inset: auto 0 0 0; background: rgba(0,0,0,.6); color: #fff; font-size: 11px; padding: 4px; text-align: center; }
  .name { font-size: 12px; }
</style>
