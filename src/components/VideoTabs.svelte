<script>
  // The Video tab's two parts: Traskrittura (subtitles) and Murtali (fireworks → Reel).
  import { app, openTool } from '../lib/app.svelte.js';

  const parts = [['traskrittura', 'Traskrittura'], ['murtali', 'Murtali']];
</script>

<div class="sub" data-tauri-drag-region>
  <div class="seg" role="tablist" aria-label="Video">
    {#each parts as [id, label] (id)}
      <button type="button" role="tab" aria-selected={app.tool === id} onclick={() => openTool(id)}>{label}</button>
    {/each}
  </div>
</div>

<style>
  .sub { flex-shrink: 0; display: flex; justify-content: center; padding: 10px 20px; border-bottom: 1px solid var(--line); background: var(--bg); }
</style>
