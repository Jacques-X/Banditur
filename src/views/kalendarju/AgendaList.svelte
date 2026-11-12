<script>
  // List view: the days of the range that have something on them, one after the other.
  import { DAYS_LONG, MONTHS } from '../../lib/format.js';
  import { addDays, timeOf, weekday } from './model.js';
  let { from, to, items, today, onopen, onselect } = $props();

  const groups = $derived.by(() => {
    const out = [];
    for (let d = from; d < to; d = addDays(d, 1)) {
      const list = items.filter((i) => i.first <= d && d <= i.last);
      if (list.length) out.push({ d, list });
    }
    return out;
  });
  const when = (it, d) => (it.allDay ? 'Il-jum kollu' : it.first < d ? 'Ikompli' : `${timeOf(it.start)} – ${timeOf(it.end)}`);
</script>

<div class="ag">
  {#each groups as g (g.d)}
    <section>
      <button type="button" class="gh" class:today={g.d === today} onclick={() => onselect(g.d)}>
        <b>{+g.d.slice(8)} ta' {MONTHS[+g.d.slice(5, 7) - 1]}</b> <span class="muted">{DAYS_LONG[weekday(g.d)]}</span>
      </button>
      {#each g.list as it (it.key + g.d)}
        <button type="button" class="row" onclick={() => onopen(it)}>
          <span class="bar" style:background={it.color}></span>
          <span class="mono muted">{when(it, g.d)}</span>
          <span class="ttl">{it.title}</span>
          {#if it.kind === 'post'}<span class="tag">post</span>{/if}
          {#if it.repeat}<span class="tag">↻</span>{/if}
        </button>
      {/each}
    </section>
  {:else}
    <p class="muted empty-note">L-ebda avveniment f'dan il-perijodu.</p>
  {/each}
</div>

<style>
  .ag { flex: 1; min-height: 0; overflow-y: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--card); padding: 4px 0; }
  .gh { all: unset; display: block; cursor: pointer; padding: 10px 14px 4px; font-size: 13px; }
  .gh.today b { color: var(--accent-fg); }
  .row { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 14px; cursor: pointer; font-size: 13px; }
  .row:hover { background: var(--hover); }
  .bar { width: 4px; align-self: stretch; border-radius: 2px; }
  .mono { font-family: var(--font-mono); font-size: 11.5px; min-width: 100px; }
  .ttl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { font-size: 10.5px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 0 6px; }
  .empty-note { padding: 24px; text-align: center; }
</style>
