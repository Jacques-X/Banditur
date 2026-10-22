<script>
  import { toasts, dismissToast, openSettings } from '../lib/app.svelte.js';
  import Icon from './Icon.svelte';

  // Errors stay until closed; the rest leave after a while, but not while hovered/focused.
  const timers = new Map();
  function arm(t) {
    clearTimeout(timers.get(t.id));
    if (t.type === 'error') return;
    timers.set(t.id, setTimeout(() => dismissToast(t.id), t.action ? 10000 : 6000));
  }
  function hold(t) { clearTimeout(timers.get(t.id)); }

  $effect(() => {
    for (const t of toasts) if (!timers.has(t.id)) arm(t);
  });

  const settingsHint = t => /Settings/.test(t.msg) && !t.action;
</script>

<div class="layer" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast {t.type}" role={t.type === 'error' ? 'alert' : 'status'}
         onmouseenter={() => hold(t)} onmouseleave={() => arm(t)} onfocusin={() => hold(t)} onfocusout={() => arm(t)}>
      <span class="dot" aria-hidden="true"></span>
      <span class="msg">{t.msg}</span>
      {#if t.action}
        <button class="link" type="button" onclick={() => { t.action.onClick(); dismissToast(t.id); }}>{t.action.label}</button>
      {:else if settingsHint(t)}
        <button class="link" type="button" onclick={() => { openSettings('konnessjoni'); dismissToast(t.id); }}>Iftaħ is-Settings</button>
      {/if}
      <button class="x" type="button" aria-label="Agħlaq" onclick={() => dismissToast(t.id)}><Icon name="x" size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .layer { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 200; display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
  .toast {
    pointer-events: auto; display: flex; align-items: center; gap: 10px;
    max-width: min(560px, calc(100vw - 32px)); padding: 10px 10px 10px 14px;
    background: var(--fg); color: var(--bg); border-radius: 10px; box-shadow: var(--shadow-pop);
    animation: up .16s ease-out; line-height: 1.4;
  }
  .dot { width: 8px; height: 8px; border-radius: 4px; background: #8AA4FF; flex-shrink: 0; }
  .ok .dot { background: #5BD18B; }
  .warn .dot { background: #F2C14E; }
  .error .dot { background: #FF6B5E; }
  .msg { flex: 1; }
  .link { color: inherit; text-decoration: underline; font-weight: 600; white-space: nowrap; }
  .x { border: 0; background: none; color: inherit; opacity: .7; padding: 4px; display: flex; border-radius: 6px; }
  .x:hover { opacity: 1; }
  @keyframes up { from { transform: translateY(8px); opacity: 0; } }
</style>
