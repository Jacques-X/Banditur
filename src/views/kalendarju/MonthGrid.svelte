<script>
  // Month view: Monday-first weeks, up to three chips per day, drag a chip to another day.
  import { DAYS } from '../../lib/format.js';
  import { daysBetween, timeOf } from './model.js';
  let { weeks, day, today, month, items, onselect, onopen, onmove } = $props();

  const head = [1, 2, 3, 4, 5, 6, 0].map((i) => DAYS[i]);
  const MAX = 3;
  const on = (d) => items.filter((i) => i.first <= d && d <= i.last);

  let press = null;
  let hover = $state('');
  function down(e, item, cell) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press = { x: e.clientX, y: e.clientY, item, cell, moved: false };
  }
  function move(e) {
    if (!press) return;
    if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return;
    if (!press.item.movable) return;
    press.moved = true;
    hover = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-day]')?.dataset.day || '';
  }
  function up() {
    const p = press, target = hover;
    press = null;
    hover = '';
    if (!p) return;
    if (!p.moved) onopen(p.item);
    else if (target && target !== p.cell) onmove(p.item, daysBetween(p.cell, target), 0);
  }
  function cancel() {
    press = null;
    hover = '';
  }
</script>

<div class="mg">
  <div class="mg-head">{#each head as h}<span>{h}</span>{/each}</div>
  <div class="mg-body" style:grid-template-rows="repeat({weeks.length}, 1fr)">
    {#each weeks as week}
      {#each week as d (d)}
        {@const list = on(d)}
        <div class="cell" data-day={d} class:out={d.slice(0, 7) !== month} class:today={d === today} class:picked={d === day} class:drop={d === hover}
          role="gridcell" tabindex="-1" onclick={() => onselect(d)} onkeydown={(e) => e.key === 'Enter' && onselect(d)}>
          <span class="num">{+d.slice(8)}</span>
          {#each list.slice(0, MAX) as it (it.key)}
            <div class="chip" class:post={it.kind === 'post'} class:fixed={!it.movable} style:--c={it.color} role="button" tabindex="0"
              onpointerdown={(e) => down(e, it, d)} onpointermove={move} onpointerup={up} onpointercancel={cancel}
              onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onopen(it); } }}>
              {#if !it.allDay && it.first === d}<span class="t">{timeOf(it.start)}</span>{/if}<span class="x">{it.title}</span>
            </div>
          {/each}
          {#if list.length > MAX}<button class="more" type="button" onclick={(e) => { e.stopPropagation(); onselect(d); }}>+{list.length - MAX} oħra</button>{/if}
        </div>
      {/each}
    {/each}
  </div>
</div>

<style>
  .mg { display: flex; flex-direction: column; flex: 1; min-height: 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--card); }
  .mg-head { display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 1px solid var(--line); background: var(--bg-sunken); }
  .mg-head span { padding: 6px 8px; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .mg-body { display: grid; grid-template-columns: repeat(7, 1fr); flex: 1; min-height: 0; }
  .cell { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 3px 4px; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
  .cell:nth-child(7n) { border-right: 0; }
  .cell.out { background: var(--bg-sunken); }
  .cell.out .num { color: var(--muted); }
  .cell.picked { box-shadow: inset 0 0 0 2px var(--accent); }
  .cell.drop { background: var(--accent-soft); }
  .num { font-size: 12px; font-weight: 600; align-self: flex-end; padding: 1px 6px; border-radius: 999px; }
  .cell.today .num { background: var(--accent); color: var(--on-accent); }
  .chip { display: flex; gap: 4px; align-items: baseline; font-size: 11.5px; line-height: 1.35; padding: 1px 6px; border-radius: 5px; background: color-mix(in srgb, var(--c) 18%, transparent); border-left: 3px solid var(--c); color: var(--fg); overflow: hidden; white-space: nowrap; cursor: grab; touch-action: none; user-select: none; }
  .chip.fixed { cursor: pointer; }
  .chip.post { background: var(--bg-sunken); border-left-style: dashed; }
  .chip .t { font-family: var(--font-mono); color: var(--muted); font-size: 10.5px; }
  .chip .x { overflow: hidden; text-overflow: ellipsis; }
  .more { all: unset; font-size: 11px; color: var(--muted); padding: 0 6px; cursor: pointer; }
  .more:hover { color: var(--fg); text-decoration: underline; }
</style>
