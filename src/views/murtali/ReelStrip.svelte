<script>
  // The Reel: the ticked fireworks in the order they will play (drag to reorder, or use the arrows),
  // a counter that guides toward 6-7, "Agħżel l-aqwa 7", "L-istess għal kollha" and the platform checks.
  import { clock, duration, aimed } from './reel.js';
  import { fileSrc } from '../../lib/tauri.js';
  import { FW } from '../../strings.js';

  let {
    reel = [], numbers = {}, thumbs = {}, selectedId = null, total = 0, canCopyCrop = false,
    onselect = () => {}, onreorder = () => {}, onremove = () => {}, onbest = () => {}, oncopy = () => {},
  } = $props();
  let dragFrom = $state(-1);
  let over = $state(-1);
</script>

<section class="reel card" aria-label={FW.reelStrip}>
  <div class="head">
    <strong>{FW.reelStrip}</strong>
    <span class="count" role="status">{FW.reelCount(reel.length)}</span>
    <span class="muted small">{clock(total)}</span>
    <span class="spacer"></span>
    <button class="btn sm" type="button" onclick={onbest}>{FW.best7}</button>
    <button class="btn sm" type="button" disabled={!canCopyCrop} onclick={oncopy}>{FW.sameForAll}</button>
  </div>
  {#if reel.length}
    <ol class="strip" aria-label={FW.reelHint}>
      {#each reel as it, i (it.id)}
        <li class="chip" class:sel={it.id === selectedId} class:over={over === i && dragFrom !== i} draggable="true"
            ondragstart={(e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
            ondragover={(e) => { e.preventDefault(); over = i; }}
            ondragleave={() => { if (over === i) over = -1; }}
            ondrop={(e) => { e.preventDefault(); if (dragFrom >= 0) onreorder(dragFrom, i); dragFrom = -1; over = -1; }}
            ondragend={() => { dragFrom = -1; over = -1; }}>
          <button type="button" class="pic" onclick={() => onselect(it.id)} title="{FW.itemN(numbers[it.id] ?? '')} · {clock(duration(it))}">
            {#if thumbs[it.id]?.file}<img src={fileSrc(thumbs[it.id].file)} alt="" draggable="false" />{/if}
            <span class="n">{i + 1}</span>
            {#if !aimed(it)}<span class="na">{FW.notAimed}</span>{/if}
          </button>
          <div class="ctl">
            <button type="button" class="btn ghost sm" aria-label="←" disabled={i === 0} onclick={() => onreorder(i, i - 1)}>‹</button>
            <button type="button" class="btn ghost sm" aria-label={FW.remove} onclick={() => onremove(it.id)}>×</button>
            <button type="button" class="btn ghost sm" aria-label="→" disabled={i === reel.length - 1} onclick={() => onreorder(i, i + 1)}>›</button>
          </div>
        </li>
      {/each}
    </ol>
    <p class="muted small">{FW.reelHint}</p>
  {:else}
    <p class="muted small">{FW.reelEmpty}</p>
  {/if}
</section>

<style>
  .reel { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .count { font-weight: 600; padding: 1px 8px; border-radius: 10px; background: var(--ok-bg); color: var(--ok-fg); font-size: 12px; }
  .strip { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
  .chip { flex: 0 0 auto; width: 96px; display: flex; flex-direction: column; gap: 2px; border-radius: 6px; }
  .chip.sel .pic { outline: 2px solid var(--accent); }
  .chip.over { box-shadow: -3px 0 0 var(--accent); }
  .pic { position: relative; width: 96px; height: 54px; border: 0; padding: 0; border-radius: 6px; background: #0c0d10; overflow: hidden; cursor: grab; }
  .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .n { position: absolute; left: 4px; top: 3px; font-size: 11px; font-weight: 700; color: #fff; background: var(--accent); border-radius: 4px; padding: 0 5px; }
  .na { position: absolute; left: 0; right: 0; bottom: 0; font-size: 10px; text-align: center; color: #fff; background: #000a; }
  .ctl { display: flex; justify-content: space-between; }
</style>
