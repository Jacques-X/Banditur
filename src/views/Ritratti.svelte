<script>
  // Ritratti: one tool for a folder of photos — RAW files become JPGs, and the watermark, size and
  // duplicate skipping happen in the same run. What runs is decided by ritratti/plan.js; the
  // native work goes through the shared photo lane (lib/photojob.svelte.js).
  import { onMount } from 'svelte';
  import { resultFolder } from '../ui.js';
  import FolderField from '../components/FolderField.svelte';
  import ImageOptions from '../components/ImageOptions.svelte';
  import JobPanel from '../components/JobPanel.svelte';
  import WatermarkPacks from './marka/WatermarkPacks.svelte';
  import { marks, refreshPacks, select, markCount } from './marka/packs.svelte.js';
  import { start, ensureListening, job } from '../lib/photojob.svelte.js';
  import { invoke, onDragDrop, baseName } from '../lib/tauri.js';
  import { ls } from '../lib/app.svelte.js';
  import { handoff, sendFolder } from '../lib/handoff.svelte.js';
  import { countFiles, sourceOf, planRun } from './ritratti/plan.js';
  const BLUR_NAMES = { light: 'Ħafifa', normal: 'Normali', strict: 'Stretta' };
  import { ERR, WM } from '../strings.js';

  let { active } = $props();
  const saved = ls.json('banditur_marka_opts', {});
  let input = $state('');
  let output = $state('');
  let counts = $state(null); // { raw, images } of the chosen folder
  let use = $state('raw');   // a folder with both kinds: which to use
  let watermark = $state(saved.watermark ?? true);
  let quality = $state(saved.quality ?? 85);
  let maxDim = $state(saved.maxDim ?? 2048);
  let dedupe = $state(ls.get('banditur_dedupe', '0') === '1');
  let bright = $state(ls.get('banditur_bright', '0') === '1');
  let keepJpg = $state(ls.get('banditur_keep_jpg', '0') === '1');
  let blur = $state(['light', 'normal', 'strict'].includes(ls.get('banditur_blur', '')) ? ls.get('banditur_blur', '') : null);
  let packsOpen = $state(false);
  let errors = $state({});

  onMount(() => { ensureListening(); refreshPacks(); });
  $effect(() => { ls.set('banditur_marka_opts', JSON.stringify({ watermark, quality, maxDim })); });
  $effect(() => { ls.set('banditur_dedupe', dedupe ? '1' : '0'); });
  $effect(() => { ls.set('banditur_blur', blur || ''); });
  $effect(() => { ls.set('banditur_bright', bright ? '1' : '0'); });
  $effect(() => { ls.set('banditur_keep_jpg', keepJpg ? '1' : '0'); });

  // A folder dropped on the window (or a RAW file's folder) becomes the source.
  onMount(() => onDragDrop(p => {
    if (!active || p.type !== 'drop' || !p.paths?.[0]) return;
    const first = p.paths[0];
    setInput(/\.[a-z0-9]{2,5}$/i.test(first) ? first.replace(/[\\/][^\\/]*$/, '') : first);
  }));
  $effect(() => { if (handoff.ritrattiInput) { setInput(handoff.ritrattiInput); handoff.ritrattiInput = ''; } });

  async function setInput(p) {
    input = p; output = resultFolder(p); errors = {}; counts = null;
    try { counts = countFiles(await invoke('list_media_files', { path: p })); } catch { counts = null; }
  }

  const source = $derived(counts ? sourceOf(counts, use) : null);
  const both = $derived(!!(counts?.raw && counts?.images));
  const SIZES = [[1080, '1080'], [1600, '1600'], [2048, '2048'], [4096, '4096'], [0, 'Original']];
  const plan = $derived(planRun({ input, output, counts: counts || { raw: 0, images: 1 }, use, watermark, watermarkId: marks.selected, quality, maxDim, dedupe, blur, bright, keepJpg }));

  function run() {
    errors = {};
    if (!input) { errors.input = ERR.no_input_dir; return; }
    if (watermark && !marks.selected) { errors.mark = markCount() ? ERR.no_photographer : WM.none_installed; return; }
    const r = planRun({ input, output, counts: counts || { raw: 0, images: 1 }, use, watermark, watermarkId: marks.selected, quality, maxDim, dedupe, blur, bright, keepJpg });
    if (r.error) { errors.input = r.error; return; }
    const [first, ...rest] = r.steps;
    start(first.kind, first.cmd, first.args, rest);
  }
</script>

<div class="tool">
  <section class="settings" aria-label="Settings tax-xogħol">
    <div>
      <h1>Ritratti</h1>
      <p class="muted lead">Folder ritratti jew RAW: joħorġu JPGs bil-watermark tal-fotografu, fid-daqs li trid, f’folder wieħed. L-oriġinali ma jintmessux.</p>
    </div>

    <FolderField id="rt-in" label="Ritratti jew RAW" bind:value={input} onpick={setInput} error={errors.input} placeholder="Agħżel jew waqqa' folder…" />
    {#if counts}
      <div class="found">
        <span class="muted small">{[counts.raw && `${counts.raw} RAW`, counts.images && `${counts.images} JPG/PNG`].filter(Boolean).join(' · ') || 'L-ebda ritratt f’dan il-folder'}</span>
        {#if both}
          <div class="seg" role="group" aria-label="Liema files">
            <button type="button" aria-pressed={use === 'raw'} onclick={() => { use = 'raw'; }}>Uża r-RAW</button>
            <button type="button" aria-pressed={use === 'jpg'} onclick={() => { use = 'jpg'; }}>Uża l-JPGs</button>
          </div>
        {/if}
      </div>
    {/if}
    <FolderField id="rt-out" label="Fejn jinħażnu" bind:value={output} placeholder="Ħdejn il-folder tar-ritratti" />

    <div class="field">
      <div class="lrow">
        <label class="check"><input type="checkbox" bind:checked={watermark} /><span class="label">Żid watermark</span></label>
        <span class="spacer"></span>
        <button class="link small" type="button" onclick={() => (packsOpen = true)}>Manage watermarks</button>
      </div>
      {#if watermark}
        {#if !marks.loaded}
          <p class="muted small">Qed jgħabbi…</p>
        {:else if !markCount()}
          <div class="notice warn">{WM.none_installed} <button class="link" type="button" onclick={() => (packsOpen = true)}>Import pack</button></div>
        {:else}
          <div class="marks" role="radiogroup" aria-label="Watermark">
            {#each marks.packs.filter(p => p.watermarks.length) as p (p.id)}
              <div class="group" role="group" aria-label={p.name}>
                <div class="gh"><span class="truncate">{p.name}</span><span class="muted small">{p.watermarks.length}</span></div>
                <div class="gl">
                  {#each p.watermarks as w (w.id)}
                    {@const v = `${p.id}/${w.id}`}
                    <button type="button" role="radio" aria-checked={marks.selected === v} class="mark" onclick={() => { select(v); errors.mark = ''; }}>
                      <strong class="truncate">{w.name}</strong>
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
        {#if errors.mark}<span class="field-error" role="alert">{errors.mark}</span>{/if}
      {/if}
    </div>

    <ImageOptions id="rt-q" bind:quality bind:maxDim sizes={SIZES} />
    <label class="check"><input type="checkbox" bind:checked={dedupe} />Aqbeż ritratti duplikati (fil-folder kollu, mhux biss wara xulxin)</label>
    <div class="field">
      <label class="check"><input type="checkbox" bind:checked={bright} />Auto-brightness: dawwal ritratti skuri lejn neutral</label>
      {#if bright}<p class="muted small">Biss ir-ritratti skuri jitgħaddlu, b’mod bil-mod; l-abjad jibqa’ abjad u l-kuluri jżommu l-bilanċ. Ritratti normali ma jintmessux. “Preview” juri r-riżultat.</p>{/if}
    </div>
    <div class="field">
      <label class="check"><input type="checkbox" checked={!!blur} onchange={e => { blur = e.currentTarget.checked ? 'normal' : null; }} />Aqbeż ritratti mċajpra (barra mill-fokus)</label>
      {#if blur}
        <div class="seg" role="group" aria-label="Sensittività tal-mċajpar">
          {#each Object.entries(BLUR_NAMES) as [k, l]}<button type="button" aria-pressed={blur === k} onclick={() => { blur = k; }}>{l}</button>{/each}
        </div>
        <p class="muted small">Tinqara l-aktar parti nitida tal-ritratt, mela sfond mċajpar f’portrait ma jgħoddx. Uża “Preview” biex tara x’se jitqabbeż u erġa’ żomm li trid.</p>
      {/if}
    </div>

    {#if source === 'raw' && (watermark || dedupe || blur || bright)}
      <label class="check"><input type="checkbox" bind:checked={keepJpg} />Żomm ukoll JPGs sħaħ tar-RAW (aktar bil-mod)</label>
      {#if plan.keptJpg}<p class="muted small">L-ewwel ir-RAW isiru JPG f’<span class="mono">{baseName(plan.keptJpg)}</span> (jinżammu), imbagħad jitwaħħal il-watermark.</p>{/if}
    {/if}
    <span class="spacer"></span>
    <button class="btn primary lg" type="button" onclick={run}>
      {job.running ? 'Żid fil-queue' : source === 'raw' && !(watermark || dedupe || blur || bright) ? 'Ikkonverti għal JPG' : 'Ipproċessa r-ritratti'}
    </button>
  </section>

  {#snippet readyActions()}<button class="btn" type="button" onclick={() => sendFolder(job.outputDir)}>Agħżel ritratti għal Skeda</button>{/snippet}
  <section class="out">
    <JobPanel kind={['raw', 'marka']} extra={readyActions} idle="Agħżel folder ta’ ritratti jew RAW, imbagħad ibda. Il-progress u l-log jidhru hawn." />
  </section>
</div>

{#if packsOpen}<WatermarkPacks onclose={() => (packsOpen = false)} />{/if}

<style>
  .tool { flex: 1; min-height: 0; display: flex; }
  .settings { width: 420px; flex-shrink: 0; border-right: 1px solid var(--line); padding: 24px; overflow: auto; display: flex; flex-direction: column; gap: 18px; }
  .lead { margin-top: 4px; line-height: 1.45; }
  .found { display: flex; flex-direction: column; gap: 8px; margin-top: -8px; }
  .lrow { display: flex; align-items: center; gap: 8px; }
  .marks { display: flex; flex-direction: column; gap: 12px; max-height: 300px; overflow: auto; padding: 2px; }
  .gh { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 600; color: var(--muted); padding: 0 2px 5px; position: sticky; top: 0; background: var(--bg); }
  .gl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .mark { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 9px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); min-width: 0; }
  .mark:hover { border-color: var(--line-strong); }
  .mark[aria-checked="true"] { border-color: var(--accent); background: var(--accent-soft); }
  .seg { width: 100%; }
  .seg button { flex: 1; padding: 5px 4px; }
  .out { flex: 1; min-width: 0; padding: 24px; background: var(--bg-sunken); display: flex; flex-direction: column; }
</style>
