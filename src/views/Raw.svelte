<script>
  import { onMount } from 'svelte';
  import FolderField from '../components/FolderField.svelte';
  import JobPanel from '../components/JobPanel.svelte';
  import { job, start, ensureListening } from '../lib/photojob.svelte.js';
  import { ls, openTool } from '../lib/app.svelte.js';
  import { onDragDrop } from '../lib/tauri.js';
  import { ERR } from '../strings.js';
  import { handoff } from '../lib/handoff.svelte.js';

  let { active } = $props();
  const saved = ls.json('banditur_raw_opts', {});
  let input = $state('');
  let output = $state('');
  let quality = $state(saved.quality ?? 90);
  let maxDim = $state(saved.maxDim ?? 0);
  let error = $state('');

  onMount(() => { ensureListening(); });
  onMount(() => onDragDrop(p => { if (active && p.type === 'drop' && p.paths?.[0]) setInput(p.paths[0]); }));
  $effect(() => { ls.set('banditur_raw_opts', JSON.stringify({ quality, maxDim })); });

  const sibling = p => { const sep = p.includes('\\') ? '\\' : '/'; const parts = p.split(sep); const n = parts.pop(); return [...parts, `${n}-riżultat`].join(sep); };
  function setInput(p) { input = p; output = sibling(p); error = ''; }
  const SIZES = [[0, 'Original'], [2048, '2048'], [4096, '4096']];

  function run() {
    error = '';
    if (!input) { error = ERR.no_arw_dir; return; }
    start('raw', 'convert_raw_batch', { inputDir: input, outputDir: output || 'riżultat-jpg', quality: Number(quality), maxDim: Number(maxDim) });
  }
  function sendToMarka() { handoff.markaInput = job.outputDir; openTool('marka'); }
</script>

<div class="tool">
  <section class="settings" aria-label="Settings tax-xogħol">
    <div>
      <h1>RAW → JPG</h1>
      <p class="muted lead">Joħroġ il-JPG li l-kamera diġà ħażnet ġewwa kull file RAW. Veloċi; l-oriġinali ma jintmessux.</p>
    </div>
    <FolderField id="raw-in" label="RAW files" bind:value={input} onpick={setInput} {error} placeholder="Agħżel jew waqqa' folder…" />
    <FolderField id="raw-out" label="Fejn jinħażnu" bind:value={output} placeholder="Ħdejn il-folder oriġinali" />
    <div class="field">
      <label class="label lrow" for="raw-q">Quality <span class="spacer"></span><span class="mono muted">{quality}%</span></label>
      <input id="raw-q" type="range" min="60" max="95" bind:value={quality} />
    </div>
    <div class="field">
      <span class="label">Max size (px)</span>
      <div class="seg" role="group" aria-label="Max size">
        {#each SIZES as [v, l]}<button type="button" aria-pressed={Number(maxDim) === v} onclick={() => (maxDim = v)}>{l}</button>{/each}
      </div>
    </div>
    <div class="formats">
      <span class="label">Formats</span>
      <span class="mono muted">Sony ARW · Canon CR2, CR3 · Nikon NEF · Olympus ORF · Panasonic RW2 · Fujifilm RAF · DNG</span>
    </div>
    <span class="spacer"></span>
    <button class="btn primary lg" type="button" onclick={run}>
      {job.running && job.kind === 'raw' ? 'Qed jikkonverti…' : 'Ikkonverti għal JPG'}
    </button>
  </section>

  <section class="out">
    <JobPanel kind="raw" idle="Agħżel folder b'RAW files. Il-JPGs joħorġu f'folder ġdid ħdejh.">
      {#snippet extra()}<button class="btn" type="button" onclick={sendToMarka}>Ibgħat lil Marka →</button>{/snippet}
    </JobPanel>
  </section>
</div>

<style>
  .tool { flex: 1; min-height: 0; display: flex; }
  .settings { width: 420px; flex-shrink: 0; border-right: 1px solid var(--line); padding: 24px; overflow: auto; display: flex; flex-direction: column; gap: 18px; }
  .lead { margin-top: 4px; line-height: 1.45; }
  .lrow { display: flex; align-items: center; gap: 8px; }
  .seg { width: 100%; }
  .seg button { flex: 1; }
  .formats { display: flex; flex-direction: column; gap: 4px; line-height: 1.6; }
  .out { flex: 1; min-width: 0; padding: 24px; background: var(--bg-sunken); display: flex; flex-direction: column; }
</style>
