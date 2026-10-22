<script>
  import { onMount, untrack } from 'svelte';
  import Toolbar from './components/Toolbar.svelte';
  import Toasts from './components/Toasts.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import { anyModalOpen } from './components/Modal.svelte';
  import { app, go, openTool, openSettings, initConfig, effectiveTheme, confirm, TOOLS } from './lib/app.svelte.js';
  import { runHealth } from './lib/health.svelte.js';
  import { refreshCounts } from './lib/queue.svelte.js';
  import { guardClose } from './lib/tauri.js';
  import { CONFIRM } from './strings.js';

  import Skeda from './views/Skeda.svelte';
  import Kalendarju from './views/Kalendarju.svelte';
  import Arkivju from './views/Arkivju.svelte';
  import Rapporti from './views/Rapporti.svelte';
  import Studio from './views/Studio.svelte';
  import Traskrittura from './views/Traskrittura.svelte';
  import Posts from './views/Posts.svelte';
  import Marka from './views/Marka.svelte';
  import Raw from './views/Raw.svelte';
  import YouTube from './views/YouTube.svelte';
  import Settings from './views/Settings.svelte';

  // A screen is built the first time it is opened and then kept (hidden), so
  // a running job, a half-written post or an open subtitle edit survive
  // switching tabs.
  const key = $derived(app.view === 'studio' ? (app.tool ? `tool:${app.tool}` : 'studio') : app.view);
  let seen = $state({});
  $effect(() => { if (!seen[key]) seen[key] = true; });

  let ready = $state(false);

  // Theme: follow macOS unless the user picked one; Traskrittura/Posts can stay dark.
  onMount(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    app.systemDark = mq.matches;
    const on = e => (app.systemDark = e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  $effect(() => { document.documentElement.dataset.theme = effectiveTheme(); });

  onMount(async () => {
    await initConfig();
    ready = true;
    runHealth();
    refreshCounts();
    guardClose(
      () => Object.values(app.busy).some(Boolean),
      () => confirm(CONFIRM.quit_busy, { yes: 'Agħlaq xorta', no: 'Ibqa hawn', danger: true }),
    );
  });

  // Counts in the toolbar follow the chosen profile.
  $effect(() => { app.profileId; if (ready) untrack(refreshCounts); });

  function keydown(e) {
    const t = e.target;
    const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
    const mod = e.metaKey || e.ctrlKey;
    if (anyModalOpen()) return;
    if (mod && e.key === ',') { e.preventDefault(); openSettings(); return; }
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      go('arkivju');
      requestAnimationFrame(() => document.getElementById('archive-search')?.focus());
      return;
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const tool = TOOLS.find(x => x.key === e.key);
      if (tool) { e.preventDefault(); openTool(tool.id); return; }
    }
    if (typing || mod || e.altKey) return;
    // Plain number keys switch tabs — but not inside Studio tools, where the editor uses them.
    if (app.view === 'studio' && app.tool) return;
    const views = { 1: 'skeda', 2: 'kalendarju', 3: 'arkivju', 4: 'rapporti' };
    if (views[e.key]) go(views[e.key]);
  }
</script>

<svelte:window onkeydown={keydown} />

<Toolbar />
<main class="views">
  {#if ready}
    {#if seen.skeda}<section class="view" hidden={key !== 'skeda'}><Skeda active={key === 'skeda'} /></section>{/if}
    {#if seen.kalendarju}<section class="view" hidden={key !== 'kalendarju'}><Kalendarju active={key === 'kalendarju'} /></section>{/if}
    {#if seen.arkivju}<section class="view" hidden={key !== 'arkivju'}><Arkivju active={key === 'arkivju'} /></section>{/if}
    {#if seen.rapporti}<section class="view" hidden={key !== 'rapporti'}><Rapporti active={key === 'rapporti'} /></section>{/if}
    {#if seen.studio}<section class="view" hidden={key !== 'studio'}><Studio /></section>{/if}
    {#if seen['tool:traskrittura']}<section class="view" hidden={key !== 'tool:traskrittura'}><Traskrittura active={key === 'tool:traskrittura'} /></section>{/if}
    {#if seen['tool:posts']}<section class="view" hidden={key !== 'tool:posts'}><Posts active={key === 'tool:posts'} /></section>{/if}
    {#if seen['tool:marka']}<section class="view" hidden={key !== 'tool:marka'}><Marka active={key === 'tool:marka'} /></section>{/if}
    {#if seen['tool:raw']}<section class="view" hidden={key !== 'tool:raw'}><Raw active={key === 'tool:raw'} /></section>{/if}
    {#if seen['tool:youtube']}<section class="view" hidden={key !== 'tool:youtube'}><YouTube active={key === 'tool:youtube'} /></section>{/if}
    {#if seen.settings}<section class="view" hidden={key !== 'settings'}><Settings active={key === 'settings'} /></section>{/if}
  {/if}
</main>
<Toasts />
<ConfirmDialog />

<style>
  .views { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
  .view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
