<script>
  import Icon from './Icon.svelte';
  import { app, go, openTool, openSettings, TOOLS, setProfile, profileName } from '../lib/app.svelte.js';

  let socialOpen = $state(false);
  let socialWrap = $state();
  let studioOpen = $state(false);
  let profileOpen = $state(false);
  let studioWrap = $state();
  let profileWrap = $state();

  const tabs = [
    { id: 'skeda', label: 'Skeda', key: '1' },
    { id: 'kalendarju', label: 'Kalendarju', key: '2' },
    { id: 'arkivju', label: 'L-Arkivju', key: '3' },
    { id: 'rapporti', label: 'Rapporti', key: '4' },
  ];
  const curTab = $derived(tabs.find(t => t.id === app.view));
  const socialLabel = $derived(curTab ? `Social · ${curTab.label}` : 'Social');
  const tool = $derived(TOOLS.find(t => t.id === app.tool));
  const studioLabel = $derived(app.view === 'studio' && tool ? `Studio · ${tool.label}` : 'Studio');
  const health = $derived({
    ok: { label: '', cls: 'ok', tip: 'Kollox jaħdem' },
    warn: { label: 'Hemm xi ħaġa x\'tiċċekkja', cls: 'warn' },
    error: { label: 'Mhux konness', cls: 'error' },
    unknown: { label: 'Qed niċċekkja…', cls: '' },
  }[app.health]);

  function outside(e) {
    if (socialOpen && !socialWrap?.contains(e.target)) socialOpen = false;
    if (studioOpen && !studioWrap?.contains(e.target)) studioOpen = false;
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

<header class="bar" data-tauri-drag-region>
  <!-- room for the macOS traffic lights (titleBarStyle: Overlay) -->
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

  <nav class="tabs" aria-label="Navigazzjoni">
    <div class="wrap" bind:this={socialWrap}>
      <button type="button" class="tab" aria-current={curTab ? 'page' : undefined}
              aria-haspopup="menu" aria-expanded={socialOpen} onclick={() => (socialOpen = !socialOpen)}>
        {socialLabel}
        {#if app.failed > 0 && !curTab}<span class="badge" title="{app.failed} falluti">{app.failed}</span>{/if}
        <Icon name="chevron" size={12} stroke={2.2} />
      </button>
      {#if socialOpen}
        <div class="menu social" role="menu" aria-label="Social" tabindex="-1" onkeydown={e => menuKeys(e, () => (socialOpen = false))} use:focusFirst>
          {#each tabs as t (t.id)}
            <button role="menuitem" type="button" class="item" aria-current={app.view === t.id ? 'true' : undefined}
                    onclick={() => { go(t.id); socialOpen = false; }}>
              <span class="txt"><strong>{t.label}</strong></span>
              {#if t.id === 'arkivju' && app.failed > 0}<span class="badge" title="{app.failed} falluti">{app.failed}</span>{/if}
              <kbd>{t.key}</kbd>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <span class="sep" aria-hidden="true"></span>
    <div class="wrap" bind:this={studioWrap}>
      <button type="button" class="tab" aria-current={app.view === 'studio' ? 'page' : undefined}
              aria-haspopup="menu" aria-expanded={studioOpen} onclick={() => (studioOpen = !studioOpen)}>
        {studioLabel}<Icon name="chevron" size={12} stroke={2.2} />
      </button>
      {#if studioOpen}
        <div class="menu studio" role="menu" aria-label="Studio" tabindex="-1" onkeydown={e => menuKeys(e, () => (studioOpen = false))} use:focusFirst>
          <button role="menuitem" type="button" class="item home" onclick={() => { openTool(null); studioOpen = false; }}>
            <Icon name="grid" size={18} />
            <span class="txt"><strong>Studio</strong><span>L-għodda kollha u x-xogħol riċenti</span></span>
          </button>
          {#each TOOLS as t (t.id)}
            <button role="menuitem" type="button" class="item" aria-current={app.view === 'studio' && app.tool === t.id ? 'true' : undefined}
                    onclick={() => { openTool(t.id); studioOpen = false; }}>
              <Icon name={t.icon} size={18} />
              <span class="txt"><strong>{t.label}</strong><span>{t.desc}</span></span>
              <kbd>⌘{t.key}</kbd>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </nav>

  <button class="health {health.cls}" type="button" onclick={() => openSettings('sistema')} title={app.healthNote || health.tip || health.label} aria-label={health.tip || health.label}>
    <span class="hdot" aria-hidden="true"></span>{health.label}
  </button>
  <button class="gear" type="button" aria-label="Settings (⌘,)" title="Settings (⌘,)"
          aria-current={app.view === 'settings' ? 'page' : undefined} onclick={() => openSettings()}>
    <Icon name="sliders" size={17} />
  </button>
</header>

<style>
  .bar {
    height: 52px; flex-shrink: 0; position: relative; z-index: 20;
    display: flex; align-items: center; gap: 14px; padding: 0 14px 0 16px;
    background: var(--bar); border-bottom: 1px solid var(--line);
  }
  .lights { width: 64px; align-self: stretch; }
  .wrap { position: relative; }
  .profile {
    display: flex; align-items: center; gap: 8px; max-width: 240px; height: 30px; padding: 0 10px 0 6px;
    border-radius: 7px; border: 1px solid var(--line-strong); background: var(--card); color: var(--fg); font-weight: 600;
  }
  .swatch { width: 20px; height: 20px; border-radius: 5px; background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: 700; display: grid; place-items: center; flex-shrink: 0; }
  .tabs { position: absolute; left: 50%; transform: translateX(-50%); display: flex; align-items: center; background: var(--track); border-radius: 9px; padding: 3px; }
  .tab {
    display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 15px; border: 0; border-radius: 7px;
    background: transparent; color: var(--muted); white-space: nowrap;
  }
  .tab:hover { color: var(--fg); }
  .tab[aria-current="page"], .tab[aria-expanded="true"] { background: var(--card); color: var(--fg); font-weight: 600; box-shadow: var(--shadow-sm); }
  :global(:root[data-theme="dark"]) .tab[aria-current="page"], :global(:root[data-theme="dark"]) .tab[aria-expanded="true"] { background: #33363E; }
  .badge { background: var(--danger); color: #fff; border-radius: 8px; padding: 0 5px; font-size: 11px; font-weight: 600; line-height: 16px; }
  .sep { width: 1px; height: 16px; background: var(--line-strong); margin: 0 4px; }
  .health { margin-left: auto; display: flex; align-items: center; gap: 6px; border: 0; background: none; font-size: 12px; color: var(--muted); padding: 4px 6px; border-radius: 6px; }
  .health:hover { background: var(--hover); }
  .hdot { width: 7px; height: 7px; border-radius: 4px; background: var(--line-strong); }
  .health.ok { color: var(--ok-fg); } .health.ok .hdot { background: var(--ok); }
  .health.warn { color: var(--warn-fg); } .health.warn .hdot { background: var(--warn); }
  .health.error { color: var(--danger-fg); } .health.error .hdot { background: var(--danger); }
  .gear { width: 32px; height: 32px; border-radius: 7px; border: 0; background: transparent; color: var(--muted); display: grid; place-items: center; }
  .gear:hover, .gear[aria-current="page"] { background: var(--track); color: var(--fg); }

  .menu {
    position: absolute; top: calc(100% + 8px); z-index: 50; min-width: 220px;
    background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-pop);
    padding: 6px; display: flex; flex-direction: column; outline: none;
  }
  .menu.left { left: 0; }
  .menu.social { left: 0; min-width: 200px; }
  .menu.studio { right: -40px; width: 340px; }
  .menu-h { font-size: 12px; font-weight: 600; color: var(--muted); padding: 6px 10px 4px; }
  .menu button {
    display: flex; align-items: center; gap: 12px; text-align: left; padding: 9px 10px; border: 0; border-radius: 8px;
    background: none; color: var(--fg);
  }
  .menu button:hover, .menu button:focus-visible, .menu button[aria-current="true"] { background: var(--accent-soft); outline: none; }
  .menu .check { width: 14px; color: var(--accent-fg); font-weight: 700; }
  .item :global(svg) { color: var(--accent-fg); flex-shrink: 0; }
  .item.home { border-bottom: 1px solid var(--line-soft); border-radius: 8px 8px 0 0; margin-bottom: 4px; }
  .txt { flex: 1; display: flex; flex-direction: column; gap: 1px; }
  .txt span { font-size: 12px; color: var(--muted); }
</style>
