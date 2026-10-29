<script>
  import { onMount } from 'svelte';
  import Modal from '../components/Modal.svelte';
  import { invoke, fileSrc } from '../lib/tauri.js';
  import { toast } from '../lib/app.svelte.js';
  import Icon from '../components/Icon.svelte';
  import FolderField from '../components/FolderField.svelte';
  import JobPanel from '../components/JobPanel.svelte';
  import WatermarkPacks from './marka/WatermarkPacks.svelte';
  import { marks, refreshPacks, select, markCount } from './marka/packs.svelte.js';
  import { job, start, ensureListening } from '../lib/photojob.svelte.js';
  import { ls } from '../lib/app.svelte.js';
  import { onDragDrop } from '../lib/tauri.js';
  import { ERR, WM } from '../strings.js';
  import { handoff, sendFolder } from '../lib/handoff.svelte.js';

  let { active } = $props();
  const saved = ls.json('banditur_marka_opts', {});
  let input = $state('');
  let output = $state('');
  let watermark = $state(saved.watermark ?? true);
  let quality = $state(saved.quality ?? 85);
  let maxDim = $state(saved.maxDim ?? 2048);
  let dedupe = $state(ls.get('banditur_dedupe', '0') === '1');
  let packsOpen = $state(false);
  let errors = $state({});
  let preview=$state(null), previewBusy=$state(false), keepFiles=$state([]);

  onMount(() => { ensureListening(); refreshPacks(); });
  $effect(() => { ls.set('banditur_marka_opts', JSON.stringify({ watermark, quality, maxDim })); });
  $effect(() => { ls.set('banditur_dedupe', dedupe ? '1' : '0'); });

  // A folder dropped on the window becomes the source.
  onMount(() => onDragDrop(p => { if (active && p.type === 'drop' && p.paths?.[0]) setInput(p.paths[0]); }));

  const sibling = p => { const sep = p.includes('\\') ? '\\' : '/'; const parts = p.split(sep); const n = parts.pop(); return [...parts, `${n}-riżultat`].join(sep); };
  function setInput(p) { input = p; output = sibling(p); errors = {};preview=null;keepFiles=[]; }

  // RAW → JPG can hand its output folder over.
  $effect(() => { if (handoff.markaInput) { setInput(handoff.markaInput); handoff.markaInput = ''; } });

  const SIZES = [[1080, '1080'], [1600, '1600'], [2048, '2048'], [4096, '4096'], [0, 'Original']];

  async function inspect() {
    previewBusy=true;
    try {preview=await invoke('inspect_photos',{inputDir:input,watermarkId:marks.selected || '',watermark,quality:Number(quality),maxDim:Number(maxDim)});}
    catch(e){toast(String(e),'error');}finally{previewBusy=false;}
  }
  function run() {
    errors = {};
    if (!input) { errors.input = ERR.no_input_dir; return; }
    if (watermark && !marks.selected) { errors.mark = markCount() ? ERR.no_photographer : WM.none_installed; return; }
    start('marka', 'process_images', {
      inputDir: input, outputDir: output || 'riżultat', watermarkId: marks.selected, watermark,
      quality: Number(quality), maxDim: Number(maxDim), skipDuplicates: dedupe,keepFiles:[...keepFiles],skipFiles:preview ? preview.filter(p=>p.duplicateOf && !keepFiles.includes(p.path)).map(p=>p.path) : null,
    });
  }
</script>

<div class="tool">
  <section class="settings" aria-label="Settings tax-xogħol">
    <div>
      <h1>Marka &amp; Ssortja</h1>
      <p class="muted lead">Poġġi l-watermark tal-fotografu fuq folder ritratti. Joħorġu f'folder wieħed, bl-ordni tal-isem.</p>
    </div>

    <FolderField id="mk-in" label="Ritratti" bind:value={input} onpick={setInput} error={errors.input} placeholder="Agħżel jew waqqa' folder…" />
    <FolderField id="mk-out" label="Fejn jinħażnu" bind:value={output} placeholder="Ħdejn il-folder tar-ritratti" />

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
          <div class="marks" role="radiogroup" aria-label="Marka">
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

    <div class="field">
      <label class="label lrow" for="mk-q">Quality <span class="spacer"></span><span class="mono muted">{quality}%</span></label>
      <input id="mk-q" type="range" min="60" max="95" bind:value={quality} />
    </div>
    <div class="field">
      <span class="label">Max size (px)</span>
      <div class="seg" role="group" aria-label="Max size">
        {#each SIZES as [v, l]}<button type="button" aria-pressed={Number(maxDim) === v} onclick={() => (maxDim = v)}>{l}</button>{/each}
      </div>
    </div>
    <label class="check"><input type="checkbox" bind:checked={dedupe} />Aqbeż ritratti duplikati (meħuda wara xulxin)</label>

    <button class="btn" type="button" disabled={!input || previewBusy} onclick={inspect}>{previewBusy?'Qed jipprevedi…':'Preview u duplikati…'}</button>
    <span class="spacer"></span>
    <button class="btn primary lg" type="button" onclick={run}>
      {job.running ? 'Żid fil-queue' : 'Ipproċessa r-ritratti'}
    </button>
  </section>

  {#snippet readyActions()}<button class="btn" type="button" onclick={()=>sendFolder(job.outputDir)}>Agħżel ritratti għal Skeda</button>{/snippet}
  <section class="out">
    <JobPanel kind="marka" extra={readyActions} idle="Agħżel il-folder tar-ritratti u l-marka, imbagħad ibda. Il-progress u l-log jidhru hawn." />
  </section>
</div>

{#if preview}
  <Modal title="Preview u ritratti simili" width={920} onclose={()=>preview=null}>
    <p class="muted">Il-previews jużaw l-istess resize, watermark u kompressjoni tal-export. L-oriġinali ma jintmessux.</p>
    <div class="preview-grid">{#each preview.filter(p=>p.preview) as p}<figure><img src={p.preview} alt="Preview tar-riżultat"/><figcaption>{p.path.split('/').pop()}</figcaption></figure>{/each}</div>
    {#each preview.filter(p=>p.duplicateOf) as p}<div class="duplicate-row"><img src={fileSrc(p.duplicateOf)} alt="Ritratt miżmum" loading="lazy"/><img src={fileSrc(p.path)} alt="Ritratt simili" loading="lazy"/><label class="check"><input type="checkbox" checked={keepFiles.includes(p.path)} onchange={e=>{keepFiles=e.currentTarget.checked?[...keepFiles,p.path]:keepFiles.filter(f=>f!==p.path);}}/>Żomm {p.path.split('/').pop()} anki jekk jixbah</label></div>{:else}<p>Ma nstabux duplikati qrib xulxin.</p>{/each}
    {#each preview.filter(p=>p.error) as p}<p class="notice danger">{p.path}: {p.error}</p>{/each}
  </Modal>
{/if}
{#if packsOpen}<WatermarkPacks onclose={() => (packsOpen = false)} />{/if}

<style>
  .preview-grid{display:flex;gap:12px;flex-wrap:wrap}.preview-grid figure{margin:0;max-width:200px}.preview-grid img{width:100%;border-radius:8px}.duplicate-row{display:flex;align-items:center;gap:12px;border-top:1px solid var(--line);padding:12px 0}.duplicate-row img{width:100px;height:100px;object-fit:contain;border-radius:8px;}
  .tool { flex: 1; min-height: 0; display: flex; }
  .settings { width: 420px; flex-shrink: 0; border-right: 1px solid var(--line); padding: 24px; overflow: auto; display: flex; flex-direction: column; gap: 18px; }
  .lead { margin-top: 4px; line-height: 1.45; }
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
