<script>
  // Folder → Drive: every file in a chosen folder (subfolders kept), into a Drive folder chosen here.
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { arch, closeFolder, browseTo, folderDest, folderPlan, startFolderUpload } from '../../lib/archive.svelte.js';
  import { sizeLabel, MAX_DEPTH } from '../../lib/archive-job.js';
  import { plural } from '../../lib/format.js';

  const f = $derived(arch.folder);
  const plan = $derived(f?.state === 'ready' ? folderPlan(f) : null);
  const bytes = $derived(plan ? plan.items.reduce((n, i) => n + i.size, 0) : 0);
  const dest = $derived(f ? folderDest(f) : []);
</script>

{#if f}
<Modal title="Folder: {f.name}" width={640} onclose={closeFolder}>
  {#if f.state === 'scanning'}
    <p class="muted">Qed naqra l-folder…</p>
  {:else if f.state === 'empty'}
    <p>M’hemm l-ebda fajl f’dan il-folder.</p>
  {:else if f.state === 'error'}
    <div class="notice danger">{f.error}</div>
  {:else}
    <p class="sum"><strong>{plural(f.files.length, 'fajl', 'fajls')}</strong> · {sizeLabel(f.files.reduce((n, x) => n + x.size, 0))} · is-subfolders jinżammu kif inhuma</p>
  {/if}

  <div class="label">Fejn fuq Drive</div>
  <nav class="crumbs small" aria-label="Folder fuq Drive">
    <button class="link" type="button" onclick={() => browseTo([])}>Arkivju</button>
    {#each f.crumbs as c, i}<span class="muted">/</span><button class="link" type="button" onclick={() => browseTo(f.crumbs.slice(0, i + 1))}>{c}</button>{/each}
  </nav>
  <div class="subs card">
    {#if f.subsState === 'loading'}<div class="muted small pad">Qed infittex fuq Drive…</div>
    {:else if f.subsState === 'error'}<div class="notice danger small">Ma setgħetx naqra d-Drive: {f.subsError}</div>
    {:else}
      {#each f.subs as s}
        <button class="sub" type="button" disabled={f.crumbs.length >= MAX_DEPTH} onclick={() => browseTo([...f.crumbs, s])}><Icon name="folder" size={14} /> {s}</button>
      {:else}<div class="muted small pad">L-ebda folder hawn.</div>{/each}
    {/if}
  </div>
  <label class="field">
    <span class="label">Folder ġdid hawn ġew (ħallih vojt biex jitella’ dritt fil-folder magħżul)</span>
    <input class="input" bind:value={f.newName} placeholder={f.name} spellcheck="false" />
  </label>
  <p class="small dest">Se jmur f’: <strong>Arkivju{dest.length ? ` / ${dest.join(' / ')}` : ''}</strong></p>
  {#if plan?.problem}<div class="notice warn small">{plan.problem}</div>{/if}
  {#if plan?.tooDeep}<div class="notice warn small">{plural(plan.tooDeep, 'fajl', 'fajls')} f’subfolders fondi wisq (aktar minn {MAX_DEPTH} folders) ma jitellgħux.</div>{/if}

  {#snippet footer()}
    {#if plan && !plan.problem}<span class="muted small foot">{plural(plan.items.length, 'fajl', 'fajls')} · {sizeLabel(bytes)} se jitellgħu. Dawk li diġà hemm jinqabżu. Xejn ma jitneħħa minn hawn.</span>{/if}
    <span class="spacer"></span>
    <button class="btn" type="button" onclick={closeFolder}>Mhux issa</button>
    <button class="btn primary" type="button" disabled={!plan || !!plan.problem || !plan.items.length} onclick={startFolderUpload}>Itella’ fuq Drive</button>
  {/snippet}
</Modal>
{/if}

<style>
  .sum { margin: 0 0 12px; }
  .label { font-size: 12px; color: var(--muted); margin: 10px 0 4px; display: block; }
  .crumbs { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 6px; }
  .subs { max-height: 220px; overflow: auto; display: flex; flex-direction: column; padding: 4px; }
  .sub { display: flex; gap: 8px; align-items: center; text-align: left; background: none; border: 0; padding: 6px 10px; border-radius: 6px; font: inherit; color: inherit; cursor: pointer; }
  .sub:hover:not(:disabled) { background: var(--hover); }
  .pad { padding: 8px 10px; }
  .field { display: block; }
  .field .input { width: 100%; }
  .dest { margin: 10px 0 0; }
  .foot { align-self: center; }
  .spacer { flex: 1; }
</style>
