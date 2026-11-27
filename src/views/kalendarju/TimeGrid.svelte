<script>
  // Week / day view: one column per day, hours down the side. Drag a block to move it (15-minute
  // steps, across days), drag its bottom edge to change the length, click an empty slot to add.
  import { onMount } from 'svelte';
  import { DAYS } from '../../lib/format.js';
  import { maltaWall } from '../../lib/malta-time.js';
  import { layoutDay, minutesOf, timeOf, weekday } from './model.js';
  let { days, items, today, selected, onselect, onopen, onmove, oncreate } = $props();

  const HOUR = 44;
  const px = (m) => (m / 60) * HOUR;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const on = (d) => items.filter((i) => i.first <= d && d <= i.last);

  let scroller = $state();
  let colsEl = $state();
  let now = $state(minutesOf(maltaWall()));
  onMount(() => {
    scroller.scrollTop = px(7 * 60);
    const t = setInterval(() => (now = minutesOf(maltaWall())), 60000);
    return () => clearInterval(t);
  });

  let press = null;
  let ghost = $state(null); // { day, top, height, title, color }
  function down(e, item, d, block, mode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    press = { x: e.clientX, y: e.clientY, item, d, block, mode, moved: false, dDays: 0, dMin: 0 };
  }
  function move(e) {
    if (!press) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (!press.moved && Math.hypot(dx, dy) < 5) return;
    if (!press.item.movable) return;
    press.moved = true;
    const colW = colsEl.getBoundingClientRect().width / days.length;
    press.dMin = Math.round(((dy / HOUR) * 60) / 15) * 15;
    press.dDays = press.mode === 'move' ? Math.round(dx / colW) : 0;
    const col = Math.min(days.length - 1, Math.max(0, days.indexOf(press.d) + press.dDays));
    const b = press.block;
    ghost = press.mode === 'move'
      ? { day: days[col], top: Math.max(0, b.top + press.dMin), height: b.height, title: press.item.title, color: press.item.color }
      : { day: press.d, top: b.top, height: Math.max(15, b.height + press.dMin), title: press.item.title, color: press.item.color };
  }
  function up() {
    const p = press;
    press = null;
    ghost = null;
    if (!p) return;
    if (!p.moved) onopen(p.item);
    else if (p.dDays || p.dMin) onmove(p.item, p.dDays, p.dMin);
  }
  function cancel() {
    press = null;
    ghost = null;
  }
  function slotClick(e, d) {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    oncreate(d, Math.min(23 * 60 + 30, Math.floor((((e.clientY - r.top) / HOUR) * 60) / 30) * 30));
  }
</script>

<div class="tg">
  <div class="tg-head" style:--n={days.length}>
    <span class="gut"></span>
    {#each days as d (d)}
      <button type="button" class="dh" class:today={d === today} class:picked={d === selected} onclick={() => onselect(d)}>
        <span class="dn">{DAYS[weekday(d)]}</span><span class="dd">{+d.slice(8)}</span>
      </button>
    {/each}
  </div>
  <div class="tg-allday" style:--n={days.length}>
    <span class="gut">Kollu</span>
    {#each days as d (d)}
      <div class="adcol">
        {#each on(d).filter((i) => i.allDay) as it (it.key)}
          <div class="chip" class:post={it.kind === 'post'} class:slot={it.kind === 'slot'} style:--c={it.color} role="button" tabindex="0" onclick={() => onopen(it)} onkeydown={(e) => e.key === 'Enter' && onopen(it)}>{it.title}</div>
        {/each}
      </div>
    {/each}
  </div>
  <div class="tg-scroll" bind:this={scroller}>
    <div class="tg-body" style:--n={days.length} style:height="{px(1440)}px">
      <div class="gut">{#each hours as h}<span class="hl" style:top="{px(h * 60)}px">{h ? String(h).padStart(2, '0') + ':00' : ''}</span>{/each}</div>
      <div class="cols" bind:this={colsEl}>
        {#each days as d (d)}
          <div class="col" role="gridcell" tabindex="-1" onclick={(e) => slotClick(e, d)} onkeydown={() => {}}>
            {#each hours as h}<div class="line" style:top="{px(h * 60)}px"></div>{/each}
            {#each layoutDay(on(d).filter((i) => !i.allDay), d) as b (b.item.key)}
              <div class="blk" class:post={b.item.kind === 'post'} class:slot={b.item.kind === 'slot'} class:fixed={!b.item.movable} style:--c={b.item.color}
                style:top="{px(b.top)}px" style:height="{px(b.height)}px" style:left="{(b.col / b.cols) * 100}%" style:width="{100 / b.cols}%"
                role="button" tabindex="0" onpointerdown={(e) => down(e, b.item, d, b, 'move')} onpointermove={move} onpointerup={up} onpointercancel={cancel}
                onkeydown={(e) => e.key === 'Enter' && onopen(b.item)}>
                <span class="bt">{timeOf(b.item.start)}</span> {b.item.title}
              </div>
            {/each}
            {#if ghost && ghost.day === d}
              <div class="blk ghost" style:--c={ghost.color} style:top="{px(ghost.top)}px" style:height="{px(ghost.height)}px" style:left="0" style:width="100%">{ghost.title}</div>
            {/if}
            {#if d === today}<div class="now" style:top="{px(now)}px"></div>{/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .tg { display: flex; flex-direction: column; flex: 1; min-height: 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--card); }
  .tg-head, .tg-allday { display: grid; grid-template-columns: 48px repeat(var(--n), 1fr); border-bottom: 1px solid var(--line); }
  .tg-head { background: var(--bg-sunken); }
  .gut { font-size: 10.5px; color: var(--muted); padding: 4px 6px; font-family: var(--font-mono); }
  .dh { all: unset; cursor: pointer; display: flex; gap: 6px; align-items: baseline; justify-content: center; padding: 6px; font-size: 12px; color: var(--muted); }
  .dh .dd { font-size: 15px; font-weight: 600; color: var(--fg); padding: 0 7px; border-radius: 999px; }
  .dh.today .dd { background: var(--accent); color: var(--on-accent); }
  .dh.picked { box-shadow: inset 0 -2px 0 var(--accent); }
  .adcol { border-left: 1px solid var(--line); padding: 2px; display: flex; flex-direction: column; gap: 2px; min-height: 24px; min-width: 0; }
  .tg-scroll { flex: 1; min-height: 0; overflow-y: auto; }
  .tg-body { display: grid; grid-template-columns: 48px 1fr; position: relative; }
  .tg-body .gut { position: relative; padding: 0; }
  .hl { position: absolute; right: 6px; transform: translateY(-50%); }
  .cols { display: grid; grid-template-columns: repeat(var(--n), 1fr); }
  .col { position: relative; border-left: 1px solid var(--line); cursor: cell; }
  .line { position: absolute; left: 0; right: 0; border-top: 1px solid var(--line); opacity: .6; pointer-events: none; }
  .now { position: absolute; left: 0; right: 0; border-top: 2px solid var(--danger); pointer-events: none; z-index: 3; }
  .blk { position: absolute; box-sizing: border-box; padding: 2px 5px; font-size: 11.5px; line-height: 1.3; overflow: hidden; border-radius: 6px; background: color-mix(in srgb, var(--c) 22%, var(--card)); border-left: 3px solid var(--c); color: var(--fg); cursor: grab; touch-action: none; user-select: none; z-index: 2; }
  .blk.fixed { cursor: pointer; }
  .blk.post { background: var(--bg-sunken); border-left-style: dashed; }
  .blk.ghost { opacity: .75; z-index: 4; outline: 2px solid var(--accent); pointer-events: none; }
  .bt { font-family: var(--font-mono); color: var(--muted); font-size: 10.5px; }
  .chip { font-size: 11.5px; padding: 1px 6px; border-radius: 5px; background: color-mix(in srgb, var(--c) 18%, transparent); border-left: 3px solid var(--c); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
  .chip.post { background: var(--bg-sunken); border-left-style: dashed; }
  .chip.slot, .blk.slot { background: var(--card); border: 1px dashed var(--c); border-left: 3px dotted var(--c); }
</style>
