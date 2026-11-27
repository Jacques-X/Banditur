<script>
  // ⌘K: one box to go anywhere — screens, common actions, calendar events and projects. Matching is in lib/palette.js.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { app, go, openTool, openSettings, TOOLS } from '../lib/app.svelte.js';
  import { search } from '../lib/palette.js';
  import { projects } from '../lib/projects.svelte.js';
  import { openProject } from '../lib/handoff.svelte.js';
  import { cal, eventsFor, today } from '../views/kalendarju/calendar.svelte.js';

  let { onclose } = $props();
  let q = $state('');
  let sel = $state(0);
  let list = $state();

  const dmy = (d) => `${+d.slice(8, 10)}/${+d.slice(5, 7)}/${d.slice(2, 4)}`;
  const run = (fn) => () => { onclose(); fn(); };

  // Built once when the box opens: the data does not change while it is open.
  const items = (() => {
    const out = [
      { title: 'Home', hint: 'Screen', icon: 'home', key: '0', rank: 0, run: run(() => openTool(null)) },
      { title: 'Kalendarju', hint: 'Screen', icon: 'calendar', key: '1', rank: 0, run: run(() => go('kalendarju')) },
      { title: 'Xogħol', hint: 'Screen', icon: 'grid', key: '2', keywords: 'boards tasks kanban gantt', rank: 0, run: run(() => go('xoghol')) },
      ...TOOLS.map((t) => ({ title: t.label, hint: t.desc, icon: t.icon, key: `⌘${t.key}`, keywords: t.id === 'ritratti' ? 'marka watermark raw jpg ssortja' : '', rank: 0, run: run(() => openTool(t.id)) })),
      { title: 'Traskrittura', hint: 'Video', icon: 'captions', keywords: 'subtitles srt video', rank: 0, run: run(() => openTool('traskrittura')) },
      { title: 'Murtali', hint: 'Video → Reel', icon: 'video', keywords: 'murtali fireworks reel', rank: 0, run: run(() => openTool('murtali')) },
      { title: 'Avveniment ġdid', hint: 'Azzjoni', icon: 'plus', keywords: 'new event calendar', rank: 1, run: run(() => go('kalendarju')) },
      { title: 'Import watermark pack', hint: 'Settings → Watermarks', icon: 'drop', keywords: 'bwpack', rank: 1, run: run(() => openSettings('marki')) },
      ...[['sistema', 'System'], ['profili', 'Profiles'], ['dehra', 'Appearance'], ['marki', 'Watermarks'], ['aggornamenti', 'Components'], ['shortcuts', 'Shortcuts']]
        .map(([id, label]) => ({ title: `Settings: ${label}`, hint: 'Settings', icon: 'sliders', key: id === 'sistema' ? '⌘,' : '', rank: 2, run: run(() => openSettings(id)) })),
    ];
    let events = [];
    try { events = eventsFor(app.profileId); } catch { /* unreadable calendar */ }
    const t = today();
    // Coming events first, then past ones, newest first.
    events = [...events].sort((a, b) => {
      const fa = a.start.slice(0, 10) >= t, fb = b.start.slice(0, 10) >= t;
      return fa !== fb ? (fa ? -1 : 1) : fa ? (a.start < b.start ? -1 : 1) : (a.start > b.start ? -1 : 1);
    });
    for (const e of events.slice(0, 300))
      out.push({ title: e.title, hint: `Avveniment · ${dmy(e.start)}${e.location ? ` · ${e.location}` : ''}`, icon: 'calendar', rank: 3, keywords: e.label,
        run: run(() => { cal.day = e.start.slice(0, 10); cal.focus = e.id; go('kalendarju'); }) });
    for (const p of projects.items.filter((p) => p.kind !== 'event').slice(0, 100))
      out.push({ title: p.name, hint: p.kind === 'subtitles' ? 'Proġett · Traskrittura' : p.kind === 'fireworks' ? 'Proġett · Murtali' : 'Proġett · Posts', icon: p.kind === 'subtitles' ? 'captions' : p.kind === 'fireworks' ? 'video' : 'template', rank: 4, run: run(() => openProject(p)) });
    return out;
  })();

  const results = $derived(search(items, q, 12));
  $effect(() => { q; sel = 0; });

  function keydown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = results.length;
      if (n) sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      list?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[sel]?.run();
    }
  }
</script>

<Modal width={620} {onclose}>
  <div class="pal">
    <label class="q">
      <Icon name="search" size={16} />
      <input type="text" placeholder="Mur fejn trid jew fittex… (screens, avvenimenti, proġetti)" aria-label="Fittex"
             bind:value={q} onkeydown={keydown} autofocus spellcheck="false" autocomplete="off" />
      <kbd>Esc</kbd>
    </label>
    <div class="list" role="listbox" aria-label="Riżultati" bind:this={list}>
      {#each results as r, i (i)}
        <button type="button" role="option" aria-selected={i === sel} data-i={i} class:sel={i === sel}
                onmousemove={() => (sel = i)} onclick={r.run}>
          <Icon name={r.icon || 'chevronRight'} size={16} />
          <span class="t truncate">{r.title}</span>
          <span class="h muted small truncate">{r.hint}</span>
          {#if r.key}<kbd>{r.key}</kbd>{/if}
        </button>
      {:else}
        <p class="muted small none">Ma nstab xejn.</p>
      {/each}
    </div>
  </div>
</Modal>

<style>
  .pal { display: flex; flex-direction: column; gap: 8px; }
  .q { display: flex; align-items: center; gap: 10px; height: 42px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: 9px; background: var(--input); color: var(--muted); }
  .q input { flex: 1; border: 0; outline: none; background: none; color: var(--fg); font: inherit; font-size: 15px; }
  .list { max-height: min(420px, 60vh); overflow-y: auto; display: flex; flex-direction: column; }
  .list button {
    display: grid; grid-template-columns: 18px minmax(0, 1fr) minmax(0, auto) auto; align-items: center; gap: 10px;
    padding: 8px 10px; border: 0; border-radius: 8px; background: none; color: var(--fg); text-align: left;
  }
  .list button :global(svg) { color: var(--accent-fg); }
  .list button.sel { background: var(--accent-soft); }
  .t { font-weight: 500; }
  .h { max-width: 260px; }
  .none { padding: 12px 10px; }
</style>
