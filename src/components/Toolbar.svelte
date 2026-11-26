<script>
  import { onMount, tick, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { app, go, openTool, openSettings, TOOLS, SKEDA_PARTS, setProfile, profileName } from '../lib/app.svelte.js';
  import { toolbarActive } from '../lib/video-parts.js';

  import { upd } from '../lib/updates.svelte.js';
  import { needsAttention } from '../lib/updates.js';

  // A dot on the Settings button while commits wait on GitHub or an update was built but not installed.
  const update = $derived(needsAttention(upd.status) && !upd.running);

  let profileOpen = $state(false);
  let profileWrap = $state();

  // Every screen is one click away. Labels fold into icons as the window narrows (see the CSS).
  const social = [
    { id: 'skeda', label: 'Skeda', icon: 'pen', key: '1' }, // with L-Arkivju and Rapporti inside
    { id: 'kalendarju', label: 'Kalendarju', icon: 'calendar', key: '2' },
    { id: 'xoghol', label: 'Xogħol', icon: 'grid', key: '3' },
  ];

  // The tabs sit in the middle, so they fit when they are no wider than the bar minus twice the
  // wider side. Try icon + label, then label only, then icon only, and keep the first that fits.
  let mode = $state('full');
  let barEl = $state(), navEl = $state(), leftEl = $state(), rightEl = $state();
  const sideWidth = (el) => [...el.children].reduce((w, c) => w + c.getBoundingClientRect().width, 0) + 14 * Math.max(0, el.children.length - 1);
  async function fit() {
    if (!barEl || !navEl) return;
    for (const m of ['full', 'text', 'icon']) {
      mode = m;
      await tick();
      const room = barEl.clientWidth - 30 - 2 * (Math.max(sideWidth(leftEl), sideWidth(rightEl)) + 14);
      if (navEl.scrollWidth <= room) return;
    }
  }
  onMount(() => {
    const ro = new ResizeObserver(() => fit());
    ro.observe(barEl);
    return () => ro.disconnect();
  });
  // A longer profile name or a failed-posts badge changes what fits. (The connection check is in
  // Settings → Sistema only; it no longer shows in the top bar.)
  $effect(() => { profileName(); app.failed; untrack(fit); });

  function outside(e) {
    if (profileOpen && !profileWrap?.contains(e.target)) profileOpen = false;
  }
  function menuKeys(e, close) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
  function focusFirst(node) { node.querySelector('[role^="menuitem"]')?.focus(); }
</script>

<svelte:window onclick={outside} />

<header class="bar" data-tauri-drag-region bind:this={barEl}>
  <!-- room for the macOS traffic lights (titleBarStyle: Overlay) -->
  <div class="side-l" data-tauri-drag-region bind:this={leftEl}>
    <div class="lights" data-tauri-drag-region aria-hidden="true"></div>

    <div class="wrap" bind:this={profileWrap}>
      <button class="profile" type="button" aria-haspopup="menu" aria-expanded={profileOpen}
              onclick={() => (profileOpen = !profileOpen)} title="Il-profil li qed taħdem fuqu">
        <span class="swatch" aria-hidden="true">{profileName().slice(0, 1)}</span>
        <span class="truncate">{profileName()}</span>
        <Icon name="chevron" size={12} stroke={2.2} />
      </button>
      {#if profileOpen}
        <div class="menu left" role="menu" aria-label="Profili" tabindex="-1" onkeydown={e => menuKeys(e, () => (profileOpen = false))} use:focusFirst>
          <div class="menu-h">Profiles</div>
          {#each app.profiles as p (p.id)}
            <button role="menuitemradio" aria-checked={p.id === app.profileId} type="button"
                    onclick={() => { setProfile(p.id); profileOpen = false; }}>
              <span class="check">{p.id === app.profileId ? '✓' : ''}</span>{p.name || p.id}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <nav class="tabs {mode}" aria-label="Navigazzjoni" bind:this={navEl}>
    <button type="button" class="tab home-tab" aria-current={app.view === 'home' ? 'page' : undefined}
            title="Home (0)" aria-label="Home" onclick={() => openTool(null)}>
      <Icon name="home" size={16} />
    </button>
    <span class="sep" aria-hidden="true"></span>
    {#each social as t (t.id)}
      <button type="button" class="tab social" aria-current={(t.id === 'skeda' ? SKEDA_PARTS.includes(app.view) : app.view === t.id) ? 'page' : undefined}
              title="{t.label} ({t.key})" aria-label={t.label} onclick={() => go(t.id === 'skeda' ? app.skedaPart : t.id)}>
        <Icon name={t.icon} size={16} cls="ti" /><span class="lbl">{t.label}</span>
        {#if t.id === 'skeda' && app.failed > 0}<span class="badge" title="{app.failed} falluti">{app.failed}</span>{/if}
      </button>
    {/each}
    <span class="sep" aria-hidden="true"></span>
    {#each TOOLS as t (t.id)}
      <button type="button" class="tab studio" aria-current={app.view === 'studio' && toolbarActive(t.id, app.tool) ? 'page' : undefined}
              title="{t.label} — {t.desc} (⌘{t.key})" aria-label={t.label} onclick={() => openTool(t.id)}>
        <Icon name={t.icon} size={16} cls="ti" /><span class="lbl">{t.label}</span>
      </button>
    {/each}
  </nav>

  <div class="side-r" bind:this={rightEl}>
    <button class="find" type="button" title="Mur fejn trid (⌘K)" aria-label="Mur fejn trid (⌘K)" onclick={() => (app.palette = true)}>
      <Icon name="search" size={14} /><kbd>⌘K</kbd>
    </button>
    <button class="gear" type="button" aria-label={update ? 'Settings (⌘,): hemm aġġornament' : 'Settings (⌘,)'} title={update ? 'Settings (⌘,): hemm aġġornament li jistenna' : 'Settings (⌘,)'}
            aria-current={app.view === 'settings' ? 'page' : undefined} onclick={() => openSettings()}>
      <Icon name="sliders" size={17} />
      {#if update}<span class="updot" aria-hidden="true"></span>{/if}
    </button>
  </div>
</header>

<style>
  .bar {
    height: 52px; flex-shrink: 0; position: relative; z-index: 20;
    display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 14px; padding: 0 14px 0 16px;
    background: var(--bar); border-bottom: 1px solid var(--line);
  }
  .lights { width: 64px; align-self: stretch; }
  .wrap { position: relative; }
  .profile {
    min-width: 0; display: flex; align-items: center; gap: 8px; max-width: 240px; height: 30px; padding: 0 10px 0 6px;
    border-radius: 7px; border: 1px solid var(--line-strong); background: var(--card); color: var(--fg); font-weight: 600;
  }
  .swatch { width: 20px; height: 20px; border-radius: 5px; background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: 700; display: grid; place-items: center; flex-shrink: 0; }
  .side-l { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .side-l .wrap { min-width: 0; }
  .side-r { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
  .tabs { display: flex; align-items: center; background: var(--track); border-radius: 9px; padding: 3px; }
  .tab {
    display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 0; border-radius: 7px;
    background: transparent; color: var(--muted); white-space: nowrap;
  }
  .home-tab { padding: 0 10px; }
  .tab :global(svg) { flex-shrink: 0; }
  /* The bar picks one style for every tab (see fit()): icon + label, label only, or icon only. */
  .tabs.text :global(svg.ti) { display: none; }
  .tabs.icon .lbl { display: none; }
  .tabs.text .tab.social, .tabs.text .tab.studio { padding: 0 10px; }
  .tabs.icon .tab.social, .tabs.icon .tab.studio { padding: 0 9px; }
  .tab:hover { color: var(--fg); }
  .tab[aria-current="page"] { background: var(--card); color: var(--fg); font-weight: 600; box-shadow: var(--shadow-sm); }
  :global(:root[data-theme="dark"]) .tab[aria-current="page"] { background: #33363E; }
  .badge { background: var(--danger); color: #fff; border-radius: 8px; padding: 0 5px; font-size: 11px; font-weight: 600; line-height: 16px; }
  .sep { width: 1px; height: 16px; background: var(--line-strong); margin: 0 4px; }
  .find { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--card); color: var(--muted); }
  .find:hover { color: var(--fg); border-color: var(--line-strong); }
  .gear { position: relative; width: 32px; height: 32px; border-radius: 7px; border: 0; background: transparent; color: var(--muted); display: grid; place-items: center; }
  .updot { position: absolute; top: 5px; right: 5px; width: 8px; height: 8px; border-radius: 4px; background: var(--accent); border: 1.5px solid var(--bar, var(--card)); }
  .gear:hover, .gear[aria-current="page"] { background: var(--track); color: var(--fg); }

  .menu {
    position: absolute; top: calc(100% + 8px); z-index: 50; min-width: 220px;
    background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-pop);
    padding: 6px; display: flex; flex-direction: column; outline: none;
  }
  .menu.left { left: 0; }
  .menu-h { font-size: 12px; font-weight: 600; color: var(--muted); padding: 6px 10px 4px; }
  .menu button {
    display: flex; align-items: center; gap: 12px; text-align: left; padding: 9px 10px; border: 0; border-radius: 8px;
    background: none; color: var(--fg);
  }
  .menu button:hover, .menu button:focus-visible { background: var(--accent-soft); outline: none; }
  .menu .check { width: 14px; color: var(--accent-fg); font-weight: 700; }
</style>
