<script>
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { app, toast, confirm, go } from '../lib/app.svelte.js';
  import { api } from '../lib/api.js';
  import { openUrl } from '../lib/tauri.js';
  import { refreshCounts, statusOf } from '../lib/queue.svelte.js';
  import { shortDateTime, num } from '../lib/format.js';
  import { platformById, platformIdFields } from '../platforms.js';
  import { applyState, autosave } from './skeda/composer.svelte.js';
  import { CONFIRM, TOAST, EMPTY } from '../strings.js';

  let { active } = $props();
  const PER_PAGE = 50;
  const ID_FIELD = platformIdFields();

  let source = $state('queue');       // queue (Banditur) | live (Meta)
  let filter = $state('all');
  let search = $state('');
  let page = $state(1);
  let rows = $state([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state('');
  let selected = $state(null);
  let counts = $state({});
  let busyId = $state('');

  const filters = [
    ['all', 'Kollha'], ['pending', 'Pending'], ['fb_native', 'On Meta'], ['published', 'Published'], ['failed', 'Failed'],
  ];

  let token = 0;
  async function load() {
    const my = ++token;
    loading = true; error = '';
    try {
      if (source === 'live') {
        const r = await api('/api/meta', { query: { type: 'live-posts', limit: 30, profile_id: app.profileId, search } });
        if (my !== token) return;
        rows = r.posts || []; total = r.total || rows.length;
        if (!rows.length && r.errors?.length) error = r.errors[0].message;
      } else {
        const r = await api('/api/history', { query: { page, limit: PER_PAGE, status: filter, profile_id: app.profileId, search } });
        if (my !== token) return;
        rows = r.posts || []; total = r.total || 0;
      }
      if (selected && !rows.some(r => r.id === selected.id)) selected = null;
      if (!selected && rows.length) selected = rows.find(r => r.status === 'failed') || null;
    } catch (e) {
      if (my === token) { error = e.message; rows = []; total = 0; }
    }
    if (my === token) loading = false;
  }
  async function loadCounts() {
    if (source !== 'queue') return;
    try {
      const all = await Promise.all(filters.map(([id]) => api('/api/history', { query: { status: id, limit: 1, profile_id: app.profileId } })));
      counts = Object.fromEntries(filters.map(([id], i) => [id, all[i].total ?? 0]));
    } catch { counts = {}; }
  }

  // Reload when the screen opens or anything that changes the list changes.
  $effect(() => { if (active) { app.profileId; source; filter; page; untrack(load); } });
  $effect(() => { if (active) { app.profileId; source; untrack(loadCounts); } });
  let searchTimer;
  function onSearch(v) {
    search = v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { page = 1; load(); }, 350);
  }

  async function retry(p) {
    busyId = p.id;
    try {
      await api(`/api/posts/${p.id}`, { method: 'POST' });
      toast(TOAST.retried, 'ok');
      await load(); loadCounts(); refreshCounts();
    } catch (e) { toast(TOAST.error(e.message), 'error'); }
    busyId = '';
  }
  async function remove(p) {
    if (!await confirm(CONFIRM.delete_post, { yes: 'Ħassar', no: 'Żomm', danger: true })) return;
    busyId = p.id;
    try {
      await api(`/api/posts/${p.id}`, { method: 'DELETE' });
      selected = null;
      await load(); loadCounts(); refreshCounts();
    } catch (e) { toast(TOAST.error(e.message), 'error'); }
    busyId = '';
  }
  function reuse(p) {
    applyState({ caption: p.caption, contentType: p.content_type || 'post', platforms: p.platforms, profileId: p.profile_id }, []);
    autosave();
    go('skeda');
    if (p.media?.length) toast('Il-caption u il-platforms ġew ikkupjati. Żid il-media mill-ġdid.', 'info');
  }

  const typeName = t => (t === 'reel' ? 'Reel' : t === 'story' ? 'Story' : 'Post');
  const pf = p => (p.platforms || []).map(id => {
    const short = platformById(id)?.short || id.toUpperCase();
    return p.status === 'failed' && p[ID_FIELD[id]] ? `${short} ✓` : short;
  }).join(' ');
  const eng = p => (p.likes_count || p.comments_count) ? `${num(p.likes_count)} · ${num(p.comments_count)}` : '—';
  const from = $derived((page - 1) * PER_PAGE + 1);
  const to = $derived(from + rows.length - 1);
</script>

<div class="ark">
  <section class="list" aria-label="Posts">
    <div class="page-head head">
      <h1>L-Arkivju</h1>
      <div class="seg" role="tablist" aria-label="Sors">
        <button type="button" role="tab" aria-selected={source === 'queue'} onclick={() => { source = 'queue'; page = 1; selected = null; }}>Queue tal-Banditur</button>
        <button type="button" role="tab" aria-selected={source === 'live'} onclick={() => { source = 'live'; page = 1; selected = null; }}>Live on Meta</button>
      </div>
      <span class="spacer"></span>
      <label class="search">
        <Icon name="search" size={14} />
        <input id="archive-search" type="search" placeholder="Fittex fil-captions" aria-label="Fittex fil-captions" value={search} oninput={e => onSearch(e.currentTarget.value)} />
        <kbd>⌘K</kbd>
      </label>
      <button class="btn icon" type="button" aria-label="Refresh" title="Refresh" onclick={() => { load(); loadCounts(); }}><Icon name="refresh" size={15} /></button>
    </div>
    <div class="subhead">
        {#if source === 'queue'}
          <div class="filters" role="group" aria-label="Status">
            {#each filters as [id, label]}
                <button type="button" class="f" class:danger={id === 'failed'} aria-pressed={filter === id} onclick={() => { filter = id; page = 1; }}>
                  {label}{#if counts[id] !== undefined}{' '}<span class="mono">{counts[id]}</span>{/if}
                </button>
            {/each}
          </div>
        {/if}
      {#if source === 'live'}<span class="muted small">Posts li Facebook u Instagram juru issa, direttament minn Meta.</span>{/if}
    </div>

    <div class="thead row" aria-hidden="true">
      <span></span><span>Post</span><span>Fejn</span><span>Tip</span><span>Ħin</span><span>Status</span><span class="r">Likes · Comments</span>
    </div>
    <div class="tbody scroll" aria-busy={loading}>
      {#if error}
        <div class="empty"><strong>Ma stajniex naqraw il-lista.</strong>{error}</div>
      {:else if !rows.length && !loading}
        <div class="empty">
          <strong>{EMPTY.no_posts}</strong>
          {source === 'queue' ? "M'hemmx posts għal dan il-filtru." : 'Meta ma tat l-ebda post għal dan il-profil.'}
          <button class="btn sm" type="button" onclick={() => go('skeda')}>Skeda post ġdid</button>
        </div>
      {:else}
        {#each rows as p (p.id)}
          {@const s = source === 'live' ? { label: p.state === 'scheduled' ? 'Scheduled on Meta' : 'Live', tone: p.state === 'scheduled' ? 'meta' : 'ok' } : statusOf(p)}
          <button type="button" class="row item" class:sel={selected?.id === p.id} onclick={() => (selected = p)}>
            <span class="thumb">
              {#if (p.media?.[0]?.url || p.media_url) && !(p.media?.[0]?.url || '').startsWith('mock')}<img src={p.media?.[0]?.url || p.media_url} alt="" loading="lazy" onerror={e => (e.currentTarget.style.display = 'none')} />{/if}
            </span>
            <span class="cap truncate">{(p.caption || '(mingħajr caption)').split('\n')[0]}</span>
            <span class="mono muted">{source === 'live' ? (platformById(p.platform)?.short || 'FB') : pf(p)}</span>
            <span class="muted">{typeName(p.content_type)}</span>
            <span class="mono muted">{shortDateTime(p.scheduled_time || p.created_time)}</span>
            <span><span class="pill {s.tone}">{s.label}</span></span>
            <span class="mono muted r">{eng(p)}</span>
          </button>
        {/each}
      {/if}
    </div>
    <div class="foot">
      <span class="muted small">{rows.length ? `${source === 'queue' ? `${from}–${to} minn ` : ''}${total} posts` : ''}</span>
      <span class="spacer"></span>
      {#if source === 'queue'}
        <button class="btn sm" type="button" disabled={page <= 1} onclick={() => page--}><Icon name="chevronLeft" size={14} />Ta' qabel</button>
        <button class="btn sm" type="button" disabled={to >= total} onclick={() => page++}>Li jmiss<Icon name="chevronRight" size={14} /></button>
      {/if}
    </div>
  </section>

  <aside class="detail" aria-label="Dettalji tal-post">
    {#if selected}
      {@const p = selected}
      {@const s = source === 'live' ? { label: p.state === 'scheduled' ? 'Scheduled on Meta' : 'Live on Meta', tone: 'meta' } : statusOf(p)}
      <div class="d-head"><span class="pill {s.tone}">{s.long || s.label}</span><span class="mono muted">{shortDateTime(p.scheduled_time || p.created_time)}</span></div>
      <div class="d-media">
        {#if (p.media?.[0]?.url || p.media_url) && !(p.media?.[0]?.url || '').startsWith('mock')}<img src={p.media?.[0]?.url || p.media_url} alt="" />{:else}<Icon name="image" size={28} stroke={1.5} />{/if}
        {#if p.media?.length > 1}<span class="more">+{p.media.length - 1}</span>{/if}
      </div>
      <p class="d-cap">{p.caption || '(mingħajr caption)'}</p>
      <dl class="facts">
        <dt>Fejn</dt><dd>{source === 'live' ? (platformById(p.platform)?.label || p.platform) : (p.platforms || []).map(id => platformById(id)?.label || id).join(', ')}</dd>
        <dt>Tip</dt><dd>{typeName(p.content_type)}</dd>
        <dt>Profil</dt><dd>{p.profile_name || app.profiles.find(x => x.id === p.profile_id)?.name || p.profile_id || '—'}</dd>
        {#if p.likes_count || p.comments_count}<dt>Likes · Comments</dt><dd>{num(p.likes_count)} · {num(p.comments_count)}</dd>{/if}
      </dl>
      {#if p.status === 'failed'}
        <div class="notice danger" role="alert">
          <div><strong>Il-pubblikazzjoni ma rnexxietx.</strong><br />{p.error_message || 'Ma ngħatatx raġuni.'}</div>
        </div>
      {/if}
      <div class="d-actions">
        {#if p.status === 'failed'}<button class="btn primary" type="button" disabled={busyId === p.id} onclick={() => retry(p)}>{busyId === p.id ? '…' : "Erġa' pprova"}</button>{/if}
        {#if source === 'queue'}<button class="btn" type="button" onclick={() => reuse(p)}>Erġa' uża f'Skeda</button>{/if}
        {#if p.permalink}<button class="btn" type="button" onclick={() => openUrl(p.permalink)}><Icon name="external" size={14} />Iftaħ</button>{/if}
      </div>
      {#if p.status === 'pending'}<button class="link danger" type="button" disabled={busyId === p.id} onclick={() => remove(p)}>Ħassar il-post</button>{/if}
    {:else}
      <div class="empty"><strong>Agħżel post</strong>Id-dettalji u l-azzjonijiet jidhru hawn.</div>
    {/if}
  </aside>
</div>

<style>
  .ark { flex: 1; min-height: 0; display: flex; }
  .list { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .head { padding: 18px 24px 10px; }
  .subhead { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 20px 10px; }
  .filters { display: flex; gap: 2px; }
  .f { border: 0; background: transparent; color: var(--fg-2); padding: 5px 9px; border-radius: 6px; }
  .f:hover { background: var(--hover); }
  .f[aria-pressed="true"] { background: var(--accent-soft-2); color: var(--fg); font-weight: 600; }
  .f.danger { color: var(--danger-fg); }
  .f .mono { color: var(--muted); font-size: 11px; }
  .search { display: flex; align-items: center; gap: 8px; height: 32px; width: 260px; padding: 0 8px 0 10px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--input); color: var(--muted); }
  .search:focus-within { border-color: var(--accent); box-shadow: var(--focus); }
  .search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--fg); }
  .row { display: grid; grid-template-columns: 52px minmax(0, 1fr) 70px 60px 140px 130px 100px; gap: 12px; align-items: center; padding: 7px 24px; }
  .thead { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; font-weight: 600; padding-top: 8px; padding-bottom: 8px; }
  .r { text-align: right; }
  .tbody { flex: 1; }
  .item { width: 100%; border: 0; border-bottom: 1px solid var(--line-soft); background: transparent; color: var(--fg); text-align: left; }
  .item:hover { background: var(--hover); }
  .item.sel { background: var(--accent-soft); }
  .thumb { width: 36px; height: 36px; border-radius: 6px; background: var(--track); overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .foot { display: flex; align-items: center; gap: 6px; padding: 10px 24px; border-top: 1px solid var(--line); }
  .detail { width: 370px; flex-shrink: 0; border-left: 1px solid var(--line); background: var(--bg-sunken); padding: 20px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
  .d-head { display: flex; align-items: center; gap: 8px; }
  .d-media { position: relative; height: 210px; border-radius: 10px; background: var(--track); overflow: hidden; display: grid; place-items: center; color: var(--muted); }
  .d-media img { width: 100%; height: 100%; object-fit: cover; }
  .more { position: absolute; right: 8px; bottom: 8px; background: rgba(0,0,0,.6); color: #fff; font-size: 12px; padding: 2px 7px; border-radius: 8px; }
  .d-cap { line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere; max-height: 160px; overflow: auto; user-select: text; }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 12px; }
  .facts dt { color: var(--muted); }
  .facts dd { margin: 0; }
  .d-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .link.danger { align-self: flex-start; }
  @media (max-width: 1240px) {
    .row { grid-template-columns: 46px minmax(0, 1fr) 60px 120px 110px; }
    .row > :nth-child(4), .row > :nth-child(7) { display: none; }
    .detail { width: 320px; }
  }
</style>
