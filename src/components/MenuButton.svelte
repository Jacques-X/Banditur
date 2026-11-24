<script>
  // A button that opens a short list of actions. Looks like the toolbar menus.
  // items: [{ label, onclick, disabled?, danger?, hint? } | { sep: true }]
  import Icon from './Icon.svelte';

  let { label, items = [], align = 'left', cls = 'btn', title = undefined } = $props();
  let open = $state(false);
  let wrap = $state();

  function outside(e) { if (open && !wrap?.contains(e.target)) open = false; }
  function keys(e) {
    if (e.key === 'Escape') { e.stopPropagation(); open = false; wrap?.querySelector('button')?.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...e.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const i = list.indexOf(document.activeElement);
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  }
  function focusFirst(node) { node.querySelector('[role="menuitem"]:not(:disabled)')?.focus(); }
  function pick(it) { open = false; it.onclick?.(); }
</script>

<svelte:window onclick={outside} />

<div class="mb" bind:this={wrap}>
  <button class={cls} type="button" aria-haspopup="menu" aria-expanded={open} {title} onclick={() => (open = !open)}>
    {label}<Icon name="chevron" size={12} stroke={2.2} />
  </button>
  {#if open}
    <div class="menu {align}" role="menu" tabindex="-1" onkeydown={keys} use:focusFirst>
      {#each items as it, i (i)}
        {#if it.sep}<div class="sep" role="separator"></div>
        {:else}
          <button role="menuitem" type="button" class:danger={it.danger} disabled={it.disabled} onclick={() => pick(it)}>
            <span class="txt">{it.label}</span>{#if it.hint}<kbd>{it.hint}</kbd>{/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .mb { position: relative; display: inline-flex; }
  .mb > button { display: inline-flex; align-items: center; gap: 6px; }
  .menu {
    position: absolute; top: calc(100% + 6px); z-index: 50; min-width: 220px;
    background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-pop);
    padding: 6px; display: flex; flex-direction: column; outline: none;
  }
  .menu.left { left: 0; }
  .menu.right { right: 0; }
  .menu button {
    display: flex; align-items: center; gap: 12px; text-align: left; padding: 8px 10px; border: 0; border-radius: 8px;
    background: none; color: var(--fg); white-space: nowrap;
  }
  .menu button:hover:not(:disabled), .menu button:focus-visible { background: var(--accent-soft); outline: none; }
  .menu button:disabled { color: var(--muted); opacity: .6; }
  .menu button.danger { color: var(--danger-fg); }
  .txt { flex: 1; }
  .sep { height: 1px; background: var(--line-soft); margin: 4px 6px; }
</style>
