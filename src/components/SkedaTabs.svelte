<script>
  // Skeda's three parts, one tab in the top bar: writing a post, the archive of posts, and reports.
  import { app, go } from '../lib/app.svelte.js';

  const parts = [['skeda', 'Post ġdid'], ['arkivju', 'L-Arkivju'], ['rapporti', 'Rapporti']];
</script>

<div class="sub" data-tauri-drag-region>
  <div class="seg" role="tablist" aria-label="Skeda">
    {#each parts as [id, label] (id)}
      <button type="button" role="tab" aria-selected={app.view === id} onclick={() => go(id)}>
        {label}{#if id === 'arkivju' && app.failed}<span class="badge" title="{app.failed} falluti">{app.failed}</span>{/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .sub { flex-shrink: 0; display: flex; justify-content: center; padding: 10px 20px; border-bottom: 1px solid var(--line); background: var(--bg); }
  .seg > button { display: inline-flex; align-items: center; gap: 6px; }
  .badge { background: var(--danger); color: #fff; border-radius: 8px; padding: 0 5px; font-size: 11px; font-weight: 600; line-height: 16px; }
</style>
