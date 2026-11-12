<script>
  import { onMount, untrack } from 'svelte';
  import { loadProjects } from './lib/projects.svelte.js';
  import Toolbar from './components/Toolbar.svelte';
  import Toasts from './components/Toasts.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import { anyModalOpen } from './components/Modal.svelte';
  import { app, go, openTool, openSettings, initConfig, effectiveTheme, confirm, TOOLS } from './lib/app.svelte.js';
  import { runHealth } from './lib/health.svelte.js';
  import { refreshCounts } from './lib/queue.svelte.js';
  import { guardClose, invoke, isTauri } from './lib/tauri.js';
  import { CONFIRM } from './strings.js';

  // Home is the first screen, so it is part of the main bundle. Every other screen is
  // its own chunk (FullCalendar and the subtitle editor are the big ones), loaded the
  // first time it is opened and fetched ahead when the app is idle.
  import Home from './views/Home.svelte';
  const SCREENS = [
    { key: 'skeda', load: () => import('./views/Skeda.svelte') },
    { key: 'kalendarju', load: () => import('./views/Kalendarju.svelte') },
    { key: 'arkivju', load: () => import('./views/Arkivju.svelte') },
    { key: 'rapporti', load: () => import('./views/Rapporti.svelte') },
    { key: 'xoghol', load: () => import('./views/Xoghol.svelte') },
    { key: 'tool:traskrittura', load: () => import('./views/Traskrittura.svelte') },
    { key: 'tool:posts', load: () => import('./views/Posts.svelte') },
    { key: 'tool:marka', load: () => import('./views/Marka.svelte') },
    { key: 'tool:raw', load: () => import('./views/Raw.svelte') },
    { key: 'tool:youtube', load: () => import('./views/YouTube.svelte') },
    { key: 'settings', load: () => import('./views/Settings.svelte') },
  ];

  // A screen is built the first time it is opened and then kept (hidden), so
  // a running job, a half-written post or an open subtitle edit survive
  // switching tabs. `loaded` holds the code (also for screens only fetched ahead);
  // `seen` marks the screens that have been opened and are therefore mounted.
  const key = $derived(app.view === 'studio' ? (app.tool ? `tool:${app.tool}` : 'home') : app.view);
  let seen = $state({});
  let loaded = $state.raw({});
  let failed = $state.raw({});
  const pending = new Map();
  /** Fetch a screen's code once; resolves when it is loaded or has failed. */
  function ensure(k, wanted = true) {
    const screen = SCREENS.find((x) => x.key === k);
    if (!screen || loaded[k]) return Promise.resolve();
    if (wanted && failed[k]) failed = { ...failed, [k]: false };
    if (pending.has(k)) return pending.get(k);
    const p = screen
      .load()
      .then((m) => { loaded = { ...loaded, [k]: m.default }; })
      // A screen only fetched ahead fails quietly and is tried again when it is opened.
      .catch(() => { if (seen[k]) failed = { ...failed, [k]: true }; })
      .finally(() => pending.delete(k));
    pending.set(k, p);
    return p;
  }
  $effect(() => {
    if (!seen[key]) seen[key] = true;
    untrack(() => ensure(key));
  });
  const retry = (k) => ensure(k);

  // After the first paint, fetch the other screens one at a time while idle.
  $effect(() => {
    if (!ready) return;
    let stop = false;
    const idle = window.requestIdleCallback ?? ((f) => setTimeout(f, 800));
    const next = (i) => {
      if (stop || i >= SCREENS.length) return;
      idle(async () => {
        if (stop) return;
        await untrack(() => ensure(SCREENS[i].key, false));
        next(i + 1);
      });
    };
    next(0);
    return () => { stop = true; };
  });

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
    await loadProjects();
    ready = true;
    // Tell the app this interface drew (otherwise it falls back to the previous one next launch).
    if (isTauri) invoke('interface_ready').catch(() => {});
    runHealth();
    refreshCounts();
    guardClose(
      () => Object.values(app.busy).some(Boolean),
      () => confirm(CONFIRM.quit_busy, { yes: 'Agħlaq xorta', no: 'Ibqa hawn', danger: true }),
    );
  });

  onMount(()=>{const timer=setInterval(refreshCounts,60000);return()=>clearInterval(timer);});

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
      // The archive may not be loaded yet: wait for it, then focus the search box.
      ensure('arkivju').finally(() => {
        go('arkivju');
        requestAnimationFrame(() => document.getElementById('archive-search')?.focus());
      });
      return;
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const tool = TOOLS.find(x => x.key === e.key);
      if (tool) { e.preventDefault(); openTool(tool.id); return; }
    }
    if (typing || mod || e.altKey) return;
    // Plain number keys switch tabs — but not inside Studio tools, where the editor uses them.
    if (app.view === 'studio' && app.tool) return;
    const views = { 0: 'home', 1: 'skeda', 2: 'kalendarju', 3: 'arkivju', 4: 'rapporti', 5: 'xoghol' };
    if (views[e.key]) go(views[e.key]);
  }
</script>

<svelte:window onkeydown={keydown} />

<Toolbar />
<main class="views">
  {#if ready}
    {#if seen.home}<section class="view" hidden={key !== 'home'}><Home /></section>{/if}
    {#each SCREENS as screen (screen.key)}
      {#if seen[screen.key]}
        {@const Screen = loaded[screen.key]}
        <section class="view" hidden={key !== screen.key}>
          {#if Screen}
            <Screen active={key === screen.key} />
          {:else if failed[screen.key]}
            <div class="empty">
              <p>Din l-iskrin ma setgħetx titgħabba.</p>
              <button class="btn" type="button" onclick={() => retry(screen.key)}>Erġa' pprova</button>
            </div>
          {:else}
            <div class="empty"><span class="muted">Qed jitgħabba…</span></div>
          {/if}
        </section>
      {/if}
    {/each}
  {/if}
</main>
<Toasts />
<ConfirmDialog />

<style>
  .views { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
  .view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
