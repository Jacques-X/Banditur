<script>
  // A planned post (slot): what it is, which day (and optionally when), where it goes, how far it
  // is (idea, abbozz, lest, ippubblikat: set by hand), and which campaign / event it belongs to.
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { PLATFORMS } from '../../platforms.js';
  import { STATUS_NAMES, CONTENT_TYPES } from './campaigns.js';
  import { dayOf } from './model.js';

  // owners / categories: names and types already used, offered while typing.
  let { value, campaigns, events, owners = [], categories = [], onsave, onremove, oncard, onclose } = $props();

  // A copy to edit; the parent re-creates this component ({#key}) for another slot.
  let f = $state(untrack(() => ({ ...value, platforms: [...(value.platforms || [])] })));
  const isNew = untrack(() => !value.id);
  const platforms = PLATFORMS;
  // Events near the slot's day (and the linked one), newest first.
  const nearby = $derived.by(() => {
    const ms = Date.parse(f.day + 'T00:00:00Z');
    return events
      .filter((e) => e.id === f.event || Math.abs(Date.parse(dayOf(e.start) + 'T00:00:00Z') - ms) <= 120 * 86400000)
      .sort((a, b) => (a.start < b.start ? 1 : -1));
  });
  const types = $derived([...new Set([...CONTENT_TYPES, ...categories])]);
  const toggle = (id) => { f.platforms = f.platforms.includes(id) ? f.platforms.filter((x) => x !== id) : [...f.platforms, id]; };
</script>

<form class="insp" onsubmit={(e) => { e.preventDefault(); onsave($state.snapshot(f)); }}>
  <div class="insp-h"><h2>{isNew ? 'Post ippjanat ġdid' : 'Post ippjanat'}</h2>
    <button class="btn ghost icon" type="button" aria-label="Agħlaq" onclick={onclose}><Icon name="x" /></button></div>
  <p class="muted small hint">Post li għadu ma sarx: idea, abbozz jew lest. Meta joħroġ, immarkah Ippubblikat.</p>
  <div class="field"><label class="label" for="sl-title">X’se jkun</label><input id="sl-title" class="input" bind:value={f.title} placeholder="eż. Teaser tal-poster" /></div>
  <div class="two">
    <div class="field"><label class="label" for="sl-day">Jum</label><input id="sl-day" class="input" type="date" bind:value={f.day} /></div>
    <div class="field"><label class="label" for="sl-time">Ħin <span class="muted">(mhux bilfors)</span></label><input id="sl-time" class="input" type="time" bind:value={f.time} /></div>
  </div>
  <div class="two">
    <div class="field"><label class="label" for="sl-cat">Tip</label><input id="sl-cat" class="input" list="sl-cats" bind:value={f.category} placeholder="Poster, Reel…" maxlength="80" />
      <datalist id="sl-cats">{#each types as t}<option value={t}></option>{/each}</datalist></div>
    <div class="field"><label class="label" for="sl-owner">Min jagħmlu</label><input id="sl-owner" class="input" list="sl-owners" bind:value={f.owner} placeholder="Isem" maxlength="60" />
      <datalist id="sl-owners">{#each owners as o}<option value={o}></option>{/each}</datalist></div>
  </div>
  <div class="field"><label class="label" for="sl-due">Lest sa <span class="muted">(mhux bilfors: inkella l-jum tal-post)</span></label><input id="sl-due" class="input" type="date" max={f.day} bind:value={f.due} /></div>
  <div class="field"><span class="label">Fejn</span>
    <div class="plats">
      {#each platforms as p (p.id)}
        <button type="button" class="plat" aria-pressed={f.platforms.includes(p.id)} onclick={() => toggle(p.id)} title={p.label}>{@html p.icon}{p.short}</button>
      {/each}
    </div>
  </div>
  <div class="field"><span class="label">Stat</span>
    <div class="seg" role="group" aria-label="Stat">
      {#each ['idea', 'draft', 'ready', 'done'] as st}<button type="button" aria-pressed={f.status === st} onclick={() => (f.status = st)}>{STATUS_NAMES[st]}</button>{/each}
    </div>
  </div>
  <div class="field"><label class="label" for="sl-camp">Kampanja</label>
    <select id="sl-camp" class="select" bind:value={f.campaign}>
      <option value="">L-ebda</option>
      {#each campaigns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select></div>
  <div class="field"><label class="label" for="sl-ev">Avveniment</label>
    <select id="sl-ev" class="select" bind:value={f.event}>
      <option value="">L-ebda</option>
      {#each nearby as e (e.id)}<option value={e.id}>{e.title} · {dayOf(e.start)}</option>{/each}
    </select></div>
  <div class="field"><label class="label" for="sl-notes">Noti</label><textarea id="sl-notes" class="textarea" rows="3" bind:value={f.notes} placeholder="Ideat, ritratti, min jagħmlu…"></textarea></div>
  <div class="insp-actions">
    <button class="btn primary" type="submit">Save</button>
    {#if f.status !== 'done'}<button class="btn ghost" type="button" onclick={() => oncard($state.snapshot(f))} title="Kard f’Xogħol bit-titlu, min jagħmlu u d-data “lest sa”"><Icon name="grid" size={14} />Kard f’Xogħol</button>{/if}
    {#if !isNew}<button class="link danger" type="button" onclick={onremove}>Ħassar</button>{/if}
  </div>
</form>

<style>
  .insp { display: flex; flex-direction: column; gap: 10px; }
  .insp-h { display: flex; justify-content: space-between; align-items: center; }
  .insp-h h2 { margin: 0; font-size: 16px; }
  .hint { margin: -4px 0 0; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .insp-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .plats { display: flex; gap: 6px; flex-wrap: wrap; }
  .plat { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--muted); font-size: 12px; font-weight: 600; cursor: pointer; }
  .plat[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-soft); color: var(--fg); }
</style>
