<script>
  // One event's page in Kalendarju: when and where, and everything made for it — subtitle and post
  // projects, Studio outputs. "Aħdem fuqu" makes it the active event, so new Studio work is linked to it.
  import Icon from '../../components/Icon.svelte';
  import { app } from '../../lib/app.svelte.js';
  import { openPath } from '../../lib/tauri.js';
  import { MONTHS } from '../../lib/format.js';
  import { projects, eventWork, useEvent, saveProject } from '../../lib/projects.svelte.js';
  import { studioJobs } from '../../lib/studio-jobs.svelte.js';
  import { openProject } from '../../lib/handoff.svelte.js';
  import { colorOf } from './calendar.svelte.js';
  import { dayOf, timeOf } from './model.js';

  let { event, onedit, onclose } = $props();

  const REPEAT = { daily: 'kuljum', weekly: 'kull ġimgħa', monthly: 'kull xahar', yearly: 'kull sena' };
  const when = $derived.by(() => {
    const d = dayOf(event.start);
    const date = `${+d.slice(8, 10)} ta' ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
    return event.allDay ? `${date} · il-jum kollu` : `${date} · ${timeOf(event.start)}`;
  });
  const active = $derived(eventWork.id === event.id);
  const made = $derived(projects.items.filter((p) => p.kind !== 'event' && p.eventId === event.id));
  const outputs = $derived(studioJobs.filter((j) => j.eventId === event.id && j.path));

  async function work() {
    if (active) { useEvent(''); return; }
    useEvent(event.id, event.title);
    await saveProject({ id: `event-${event.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)}`, version: 1, kind: 'event', name: event.title, eventId: event.id, data: { event: $state.snapshot(event), profileId: app.profileId } });
  }
</script>

<div class="page">
  <div class="ph">
    <span class="bar" style="background: {colorOf(event.label)}"></span>
    <div class="pt"><h2>{event.title}</h2><span class="muted small">{when}{event.repeat ? ` · ↻ ${REPEAT[event.repeat.freq] || ''}` : ''}</span></div>
    <button class="btn ghost icon" type="button" aria-label="Agħlaq" onclick={onclose}><Icon name="x" /></button>
  </div>
  {#if event.location || event.label}<p class="muted small">{[event.location, event.label].filter(Boolean).join(' · ')}</p>{/if}
  {#if event.description}<p class="desc">{event.description}</p>{/if}

  <div class="acts">
    <button class="btn primary" type="button" onclick={onedit}>Editja</button>
  </div>

  <button class="work" class:on={active} type="button" onclick={work} aria-pressed={active}>
    <span class="dot" aria-hidden="true"></span>
    <span><strong>{active ? 'Qed taħdem fuqu' : 'Aħdem fuq dan l-avveniment'}</strong>
      <span class="muted small">{active ? 'Proġetti ġodda jintrabtu miegħu. Agħfas biex tieqaf.' : 'X-xogħol tal-Studio ġdid jintrabat miegħu.'}</span></span>
  </button>

  <div class="sec">
    <div class="sec-h">Proġetti u files</div>
    {#each made as p (p.id)}
      <button class="ev" type="button" onclick={() => openProject(p)}><Icon name={p.kind === 'subtitles' ? 'captions' : 'template'} size={14} /><span class="truncate">{p.name}</span><span class="muted small">{p.kind === 'subtitles' ? 'Subtitles' : 'Design'}</span></button>
    {/each}
    {#each outputs as j (j.id)}
      <button class="ev" type="button" onclick={() => openPath(j.path)}><Icon name="folder" size={14} /><span class="truncate">{j.name}</span><span class="muted small">Iftaħ</span></button>
    {/each}
    {#if !made.length && !outputs.length}<p class="muted small">Xejn s'issa. {active ? '' : 'Agħfas “Aħdem fuq dan l-avveniment” u x-xogħol li tagħmel jidher hawn.'}</p>{/if}
  </div>
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 12px; }
  .ph { display: flex; gap: 10px; align-items: flex-start; }
  .ph .bar { width: 4px; align-self: stretch; border-radius: 2px; }
  .pt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pt h2 { margin: 0; font-size: 18px; }
  .desc { margin: 0; font-size: 13px; white-space: pre-wrap; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; }
  .acts .btn { display: inline-flex; align-items: center; gap: 6px; }
  .work { all: unset; box-sizing: border-box; cursor: pointer; display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
  .work > span:last-child { display: flex; flex-direction: column; gap: 2px; }
  .work:hover { border-color: var(--line-strong); }
  .work.on { border-color: var(--accent); background: var(--accent-soft); }
  .work .dot { width: 10px; height: 10px; border-radius: 5px; margin-top: 4px; border: 2px solid var(--line-strong); flex-shrink: 0; }
  .work.on .dot { background: var(--accent); border-color: var(--accent); }
  .sec { display: flex; flex-direction: column; gap: 6px; }
  .sec-h { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .ev { all: unset; box-sizing: border-box; display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 8px; cursor: pointer; font-size: 13px; width: 100%; }
  .ev:hover { background: var(--hover); }
  .ev :global(svg) { color: var(--accent-fg); flex-shrink: 0; }
  .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
</style>
