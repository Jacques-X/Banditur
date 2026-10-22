<script>
  import Icon from './Icon.svelte';
  import { job } from '../lib/photojob.svelte.js';
  import { openPath } from '../lib/tauri.js';

  /** Progress, result and log of the Marka / RAW run of this `kind`. */
  let { kind, idle = 'Agħżel folder u ibda.', extra } = $props();
  const mine = $derived(job.kind === kind);
  let logEl = $state();
  $effect(() => { if (mine && job.log.length && logEl) logEl.scrollTop = logEl.scrollHeight; });
</script>

<section class="panel" aria-label="Progress">
  {#if mine && (job.running || job.result)}
    <div class="top">
      <span class="title">{job.running ? 'Qed jipproċessa…' : job.result.title}</span>
      {#if job.running}<span class="mono muted">{Math.round(job.fraction * 100)}%</span>{/if}
      <span class="spacer"></span>
      {#if !job.running && job.outputDir}
        {@render extra?.()}
        <button class="btn" type="button" onclick={() => openPath(job.outputDir)}><Icon name="folder" size={15} />Iftaħ il-folder</button>
      {/if}
    </div>
    <div class="progress" aria-hidden="true"><span style="width: {Math.round(job.fraction * 100)}%"></span></div>
    {#if job.result?.detail}<div class="notice {job.result.tone === 'error' ? 'danger' : job.result.tone}">{job.result.detail}</div>{/if}
  {:else if job.running}
    <div class="notice info">Għaddej xogħol ieħor ({job.kind === 'raw' ? 'RAW → JPG' : 'Marka'}). Dan jibda meta jispiċċa.</div>
  {:else}
    <div class="empty idle"><Icon name="image" size={30} stroke={1.4} /><span>{idle}</span></div>
  {/if}
  {#if mine && job.log.length}
    <div class="log mono" bind:this={logEl} aria-label="Log" role="log">
      {#each job.log as l}<div class={l.tag}>{l.msg}</div>{/each}
    </div>
  {/if}
</section>

<style>
  .panel { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; }
  .top { display: flex; align-items: center; gap: 10px; min-height: 32px; }
  .title { font-size: 15px; font-weight: 600; }
  .idle { flex: 1; gap: 10px; }
  .log { flex: 1; min-height: 120px; overflow: auto; border-radius: 10px; background: var(--card); border: 1px solid var(--line); padding: 10px 12px; line-height: 1.7; color: var(--fg-2); user-select: text; }
  .log .error { color: var(--danger-fg); }
  .log .warn { color: var(--warn-fg); }
  .log .ok { color: var(--fg-2); }
</style>
