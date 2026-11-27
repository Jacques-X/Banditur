<script>
  // Create or edit a campaign: a name, a colour, the days it runs, a goal, and how many posts a
  // week it should have (0 = no target). Rules: cleanCampaign in backend/api/_lib/event-rules.js.
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { daysBetween } from './model.js';

  let { value, onsave, onremove, onclose } = $props();
  let f = $state(untrack(() => ({ ...value })));
  const isNew = untrack(() => !value.id);
  const length = $derived(f.from && f.to && f.to >= f.from ? daysBetween(f.from, f.to) + 1 : 0);
</script>

<form class="insp" onsubmit={(e) => { e.preventDefault(); onsave($state.snapshot(f)); }}>
  <div class="insp-h"><h2>{isNew ? 'Kampanja ġdida' : 'Editja l-kampanja'}</h2>
    <button class="btn ghost icon" type="button" aria-label="Agħlaq" onclick={onclose}><Icon name="x" /></button></div>
  <div class="field"><label class="label" for="cp-name">Isem</label>
    <div class="row"><input type="color" bind:value={f.color} aria-label="Kulur" /><input id="cp-name" class="input" bind:value={f.name} placeholder="eż. Festa 2027" /></div></div>
  <div class="two">
    <div class="field"><label class="label" for="cp-from">Mill-</label><input id="cp-from" class="input" type="date" bind:value={f.from} /></div>
    <div class="field"><label class="label" for="cp-to">Sa</label><input id="cp-to" class="input" type="date" bind:value={f.to} /></div>
  </div>
  {#if length}<p class="muted small len">{length} {length === 1 ? 'jum' : 'ijiem'}</p>{/if}
  <div class="field"><label class="label" for="cp-target">Mira: posts fil-ġimgħa</label>
    <input id="cp-target" class="input" type="number" min="0" max="50" bind:value={f.target} />
    <span class="muted small">0 = l-ebda mira. Ġimgħa b’inqas minn hekk tidher bl-oranġjo.</span></div>
  <div class="field"><label class="label" for="cp-goal">L-għan</label><input id="cp-goal" class="input" bind:value={f.goal} placeholder="eż. Biljetti mibjugħa għall-kunċert" /></div>
  <div class="field"><label class="label" for="cp-notes">Noti</label><textarea id="cp-notes" class="textarea" rows="3" bind:value={f.notes}></textarea></div>
  <div class="insp-actions">
    <button class="btn primary" type="submit">Save</button>
    {#if !isNew}<button class="link danger" type="button" onclick={onremove}>Ħassar</button>{/if}
  </div>
</form>

<style>
  .insp { display: flex; flex-direction: column; gap: 10px; }
  .insp-h { display: flex; justify-content: space-between; align-items: center; }
  .insp-h h2 { margin: 0; font-size: 16px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .row { display: flex; gap: 6px; align-items: center; }
  .row .input { flex: 1; min-width: 0; }
  .row input[type='color'] { width: 28px; height: 28px; padding: 0; border: 0; background: none; flex-shrink: 0; }
  .len { margin: -6px 0 0; }
  .insp-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
