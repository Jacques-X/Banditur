<script module>
  // How many dialogs are open — global shortcuts are ignored while any is.
  let openCount = 0;
  export const anyModalOpen = () => openCount > 0;
</script>

<script>
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';

  /** Close with Esc, the × or a click on the backdrop; focus stays inside and returns afterwards. */
  let { title = '', width = 520, onclose, children, footer, dismissable = true } = $props();
  let box;

  onMount(() => {
    openCount++;
    const back = document.activeElement;
    tick().then(() => (box?.querySelector('[autofocus], input, select, textarea, button:not([disabled])') || box)?.focus());
    return () => {
      openCount--;
      if (back?.isConnected) back.focus();
    };
  });

  function keydown(e) {
    if (e.key === 'Escape' && dismissable) { e.preventDefault(); e.stopPropagation(); onclose?.(); }
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={e => { if (e.target === e.currentTarget && dismissable) onclose?.(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={title} tabindex="-1"
       bind:this={box} onkeydown={keydown} style="width: min({width}px, calc(100vw - 32px))">
    {#if title}
      <header>
        <h2>{title}</h2>
        {#if dismissable}<button class="btn ghost icon" type="button" aria-label="Agħlaq" onclick={() => onclose?.()}><Icon name="x" /></button>{/if}
      </header>
    {/if}
    <div class="body">{@render children?.()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 100;
    background: rgba(10, 12, 16, .38);
    display: flex; align-items: center; justify-content: center; padding: 16px;
    animation: fade .12s ease-out;
  }
  .dialog {
    max-height: calc(100vh - 48px); display: flex; flex-direction: column;
    background: var(--card); color: var(--fg); border: 1px solid var(--line);
    border-radius: 14px; box-shadow: var(--shadow-pop); outline: none;
    animation: pop .14s ease-out;
  }
  header { display: flex; align-items: center; gap: 8px; padding: 16px 16px 0 20px; }
  header h2 { flex: 1; }
  .body { padding: 16px 20px; overflow: auto; min-height: 0; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px 16px; border-top: 1px solid var(--line-soft); }
  @keyframes fade { from { opacity: 0; } }
  @keyframes pop { from { transform: translateY(6px) scale(.98); opacity: 0; } }
</style>
