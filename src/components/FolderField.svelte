<script>
  import Icon from './Icon.svelte';
  import { openDialog, baseName } from '../lib/tauri.js';

  /** A folder picker that shows the folder's name (full path on hover). */
  let { label, value = $bindable(''), placeholder = 'Agħżel folder…', note = '', error = '', id, onpick } = $props();

  async function pick() {
    const p = await openDialog({ directory: true, multiple: false });
    if (p) { value = p; onpick?.(p); }
  }
</script>

<div class="field">
  <span class="label" id="{id}-l">{label}</span>
  <button class="folder" class:invalid={!!error} type="button" aria-labelledby="{id}-l" aria-describedby={error ? `${id}-e` : undefined} title={value || ''} onclick={pick}>
    <Icon name="folder" size={16} />
    <span class="name truncate" class:muted={!value}>{value ? baseName(value) : placeholder}</span>
    {#if note}<span class="mono muted">{note}</span>{/if}
    <span class="change">{value ? 'Biddel' : 'Agħżel'}</span>
  </button>
  {#if error}<span class="field-error" id="{id}-e" role="alert">{error}</span>{/if}
</div>

<style>
  .folder {
    display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; text-align: left;
    border: 1px solid var(--line-strong); border-radius: 8px; background: var(--input); color: var(--fg);
  }
  .folder:hover { border-color: var(--accent); }
  .folder.invalid { border-color: var(--danger); }
  .folder :global(svg) { color: var(--muted); flex-shrink: 0; }
  .name { flex: 1; }
  .change { color: var(--accent-fg); font-size: 12px; font-weight: 500; }
</style>
