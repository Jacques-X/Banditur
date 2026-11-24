<script>
  // The card's files, grouped into events by time. Each group gets a name, a date and the
  // photographer / videographer folder name before anything goes to Drive.
  import Modal from '../../components/Modal.svelte';
  import { arch, closeReview, setGap, setShift, merge, split, pickSuggestion, loadPeople, startUpload, people, setCfg } from '../../lib/archive.svelte.js';
  import { countKinds, sizeLabel, splitPoints, destLabel } from '../../lib/archive-job.js';
  import { groupProblem, needs, dayOf, clockOf, cleanName } from '../../../backend/api/_lib/archive-rules.js';
  import { DAYS, plural } from '../../lib/format.js';
  import { openDialog } from '../../lib/tauri.js';

  const r = $derived(arch.review);
  const stats = $derived(r ? countKinds(r.files) : null);
  const used = people();
  const ready = $derived(r?.groups.filter((g) => !g.skip) ?? []);
  const blocked = $derived(ready.filter((g) => groupProblem(g)).length);
  const todo = $derived(ready.reduce((n, g) => n + g.files.filter((f) => !f.onDrive).length, 0));
  const dayLabel = (d) => `${DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${+d.slice(8, 10)}/${+d.slice(5, 7)}`;
  const mix = (g) => {
    const c = countKinds(g.files);
    return [c.photo && plural(c.photo, 'ritratt', 'ritratti'), c.raw && `${c.raw} RAW`, c.video && plural(c.video, 'video', 'videos')].filter(Boolean).join(' · ') + ` · ${sizeLabel(c.bytes)}`;
  };
  const suggest = (g, kind) => {
    const key = `${g.date} ${cleanName(g.event)}`;
    return [...new Set([...(r.drivePeople[key]?.[kind] || []), ...(kind === 'Ritratti' ? used.fotografu : used.vidjografu)])].slice(0, 12);
  };
  // Camera clock: "the first photo says 14:02 but it was 15:02" → shift by the difference.
  let shiftH = $state(0), shiftM = $state(0);
  const applyShift = () => setShift(Math.round((+shiftH || 0) * 3600 + (+shiftM || 0) * 60));
  const problem = (g) => ({ name: 'Ikteb isem l-avveniment.', fotografu: 'Ikteb isem il-fotografu.', vidjografu: 'Ikteb isem il-vidjografu.' })[groupProblem(g)] || '';
  async function pickBackup() {
    const dir = await openDialog({ directory: true, title: 'Folder tal-backup lokali' });
    if (dir) { setCfg({ backupDir: dir }); r.backup = true; }
  }
</script>

{#if r}
<Modal title="Card: {r.card.name}" width={980} onclose={closeReview}>
  {#if r.state === 'scanning'}
    <p class="muted">Qed naqra l-card…</p>
  {:else if r.state === 'empty'}
    <p>M’hemm l-ebda ritratt jew video fuq din il-card.</p>
  {:else if r.state === 'error'}
    <div class="notice danger">{r.error}</div>
  {:else}
    <p class="sum">
      <strong>{plural(r.files.length, 'fajl', 'fajls')}</strong> · {plural(stats.photo, 'ritratt', 'ritratti')} · {stats.raw} RAW · {plural(stats.video, 'video', 'videos')} · {sizeLabel(stats.bytes)}
      {#if r.onDriveChecked}<span class="ok"> · {stats.onDrive} diġà fl-Arkivju</span>{:else}<span class="muted"> · qed niċċekkja d-Drive…</span>{/if}
    </p>
    {#if r.driveNote}<div class="notice warn">{r.driveNote}</div>{/if}

    <div class="opts">
      <label>Avveniment ġdid wara <select class="select" value={r.gapMin} onchange={(e) => setGap(+e.currentTarget.value)}>
        {#each [30, 60, 120, 180, 360] as m}<option value={m}>{m < 60 ? `${m} min` : `${m / 60} sigħat`} waqfa</option>{/each}
      </select></label>
      <label title="Jekk il-kamera kellha l-ħin ħażin">Arloġġ tal-kamera <input class="input num" type="number" step="1" bind:value={shiftH} onchange={applyShift} aria-label="Siegħat" /> h
        <input class="input num" type="number" step="1" bind:value={shiftM} onchange={applyShift} aria-label="Minuti" /> min</label>
      <label class="bk"><input type="checkbox" bind:checked={r.backup} disabled={!arch.cfg.backupDir} /> Kopja lokali
        <button class="link small" type="button" onclick={pickBackup}>{arch.cfg.backupDir ? arch.cfg.backupDir.split('/').pop() : 'Agħżel folder'}</button></label>
    </div>

    {#each r.groups as g, i (g.id)}
      {@const n = needs(g)}
      {@const cuts = splitPoints(g)}
      <section class="group card" class:off={g.skip}>
        <div class="gh">
          <strong>{dayLabel(g.date)} · {clockOf(g.from)}–{clockOf(g.to)}</strong>
          <span class="muted small">{mix(g)}{g.files.some((f) => f.onDrive) ? ` · ${g.files.filter((f) => f.onDrive).length} diġà hemm` : ''}</span>
          <span class="spacer"></span>
          <label class="small"><input type="checkbox" checked={g.skip} onchange={(e) => (g.skip = e.currentTarget.checked)} /> Ħalli barra</label>
        </div>
        {#if !g.skip}
          <div class="fields">
            <label class="f wide">Avveniment
              <input class="input" bind:value={g.event} placeholder="eż. Festa ta’ Santa Marija" onblur={() => loadPeople(g)} />
            </label>
            <label class="f">Data <input class="input" type="date" bind:value={g.date} onchange={() => loadPeople(g)} /></label>
            {#if n.Ritratti}
              <label class="f">Fotografu <input class="input" bind:value={g.fotografu} list="fot-{g.id}" placeholder="Isem" aria-invalid={groupProblem(g) === 'fotografu'} /></label>
              <datalist id="fot-{g.id}">{#each suggest(g, 'Ritratti') as p}<option value={p}></option>{/each}</datalist>
            {/if}
            {#if n.Footage}
              <label class="f">Vidjografu <input class="input" bind:value={g.vidjografu} list="vid-{g.id}" placeholder="Isem" aria-invalid={groupProblem(g) === 'vidjografu'} /></label>
              <datalist id="vid-{g.id}">{#each suggest(g, 'Footage') as p}<option value={p}></option>{/each}</datalist>
            {/if}
          </div>
          {#if g.suggestions?.length}
            <div class="sug small"><span class="muted">Mill-kalendarju:</span>
              {#each g.suggestions as s}<button class="chip" type="button" onclick={() => pickSuggestion(g, s)}>{s.title}</button>{/each}
            </div>
          {/if}
          <div class="dest small muted">
            {#if groupProblem(g)}<span class="warn-text">{problem(g)}</span>
            {:else}{#each ['Ritratti', 'Footage'] as k}{#if destLabel(g, k)}<div class="mono">{destLabel(g, k)}</div>{/if}{/each}{/if}
          </div>
        {/if}
        <div class="acts small">
          {#if i < r.groups.length - 1}<button class="link" type="button" onclick={() => merge(g.id, r.groups[i + 1].id)}> Għaqqad ma’ tal-ġejjieni</button>{/if}
          {#if cuts.length}
            <select class="select sm" aria-label="Aqsam" onchange={(e) => { const v = +e.currentTarget.value; e.currentTarget.value = ''; if (v) split(g.id, v); }}>
              <option value="">Aqsam…</option>
              {#each cuts as c}<option value={c.index}>f’{c.at} (waqfa ta’ {c.gapMin} min)</option>{/each}
            </select>
          {/if}
        </div>
      </section>
    {/each}
  {/if}

  {#snippet footer()}
    {#if r?.state === 'ready'}
      <span class="muted small foot">{#if blocked}Fadal {plural(blocked, 'avveniment', 'avvenimenti')} bla isem.{:else}{plural(todo, 'fajl', 'fajls')} se jitella’.{/if} Xejn ma jitneħħa mill-card.</span>
      <span class="spacer"></span>
    {/if}
    <button class="btn" type="button" onclick={closeReview}>Mhux issa</button>
    {#if r?.state === 'ready'}<button class="btn primary" type="button" disabled={!!blocked || !ready.length} onclick={startUpload}>Itella’ fl-Arkivju</button>{/if}
  {/snippet}
</Modal>
{/if}

<style>
  .sum { margin: 0 0 8px; } .ok { color: var(--ok-fg); }
  .opts { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; margin: 10px 0 14px; font-size: 13px; }
  .opts label { display: flex; gap: 6px; align-items: center; }
  .num { width: 56px; }
  .group { padding: 12px 14px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px; }
  .group.off { opacity: .55; }
  .gh { display: flex; gap: 10px; align-items: baseline; }
  .fields { display: grid; grid-template-columns: minmax(220px, 2fr) 150px 1fr 1fr; gap: 10px; }
  .f { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
  .f.wide { min-width: 0; }
  .sug { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .chip { border: 1px solid var(--line-strong); border-radius: 999px; background: var(--card); padding: 2px 10px; font-size: 12px; }
  .chip:hover { background: var(--hover); }
  .warn-text { color: var(--warn-fg); }
  .acts { display: flex; gap: 12px; align-items: center; }
  .foot { align-self: center; }
  .spacer { flex: 1; }
</style>
