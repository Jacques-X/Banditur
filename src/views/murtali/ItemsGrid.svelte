<script>
  // The fireworks, kept separate: a card each with its thumbnail, number, length, a "Għar-Reel" tick
  // (with the 9:16 window drawn on the thumbnail once ticked) and a "Fil-video sħiħ" tick.
  import CropWindow from './CropWindow.svelte';
  import { clock, duration, aimed } from './reel.js';
  import { fileSrc } from '../../lib/tauri.js';
  import { FW } from '../../strings.js';

  let {
    items = [], thumbs = {}, reelOf = {}, selectedId = null, srcW = 1920, srcH = 1080, playingId = null,
    onplay = () => {}, ontoggleReel = () => {}, ontoggleKeep = () => {}, onremove = () => {},
    oncropstart = () => {}, oncrop = () => {}, oncropend = () => {},
  } = $props();
</script>

<div class="grid" role="list" aria-label={FW.items}>
  {#each items as it, k (it.id)}
    {@const th = thumbs[it.id]?.file}
    {@const inReel = !!reelOf[it.id]}
    <div class="card item" class:sel={it.id === selectedId} class:off={it.keep === false} role="listitem">
      <div class="pic" style="aspect-ratio: {srcW} / {srcH}">
        <button type="button" class="play" aria-label="{FW.itemN(k + 1)} · {clock(duration(it))}" onclick={() => onplay(it.id)}>
          {#if th}<img src={fileSrc(th)} alt="" draggable="false" />{:else}<span class="noimg" aria-hidden="true">{k + 1}</span>{/if}
          <span class="play-ico" aria-hidden="true">{playingId === it.id ? '❚❚' : '▶'}</span>
        </button>
        {#if inReel}
          <CropWindow x={it.crop?.x ?? null} {srcW} {srcH} small onstart={oncropstart} onchange={(x) => oncrop(it.id, x)} onend={oncropend} />
        {/if}
        <span class="num">{k + 1}</span>
        <span class="dur">{clock(duration(it))}</span>
        {#if inReel}<span class="rn" title={FW.reelOrder(reelOf[it.id])}>{reelOf[it.id]}</span>{/if}
      </div>
      <div class="meta">
        <label class="chk" title={FW.forReel}><input type="checkbox" checked={inReel} disabled={it.keep === false} onchange={() => ontoggleReel(it.id)} />{FW.forReel}</label>
        <label class="chk" title={FW.keep}><input type="checkbox" checked={it.keep !== false} onchange={() => ontoggleKeep(it.id)} />{FW.keep}</label>
        <button class="btn ghost sm x" type="button" title={FW.remove} aria-label="{FW.remove}: {FW.itemN(k + 1)}" onclick={() => onremove(it.id)}>×</button>
      </div>
      {#if inReel && !aimed(it)}<div class="small warn-t">{FW.notAimed}</div>{/if}
    </div>
  {:else}
    <p class="muted small empty">{FW.noItems}</p>
  {/each}
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
  .item { padding: 6px; display: flex; flex-direction: column; gap: 6px; }
  .item.sel { outline: 2px solid var(--accent); }
  .item.off { opacity: 0.55; }
  .pic { position: relative; width: 100%; background: #0c0d10; border-radius: 6px; overflow: hidden; }
  .play { position: absolute; inset: 0; border: 0; padding: 0; background: none; cursor: pointer; display: block; }
  .play img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .noimg { position: absolute; inset: 0; display: grid; place-items: center; font-size: 28px; font-weight: 700; color: #fff4; }
  .play-ico { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); color: #fff; font-size: 16px; opacity: 0; text-shadow: 0 1px 4px #000a; transition: opacity 0.12s; }
  .play:hover .play-ico, .play:focus-visible .play-ico { opacity: 1; }
  .num, .dur, .rn { position: absolute; font-size: 11px; font-weight: 600; color: #fff; background: #000a; border-radius: 4px; padding: 1px 5px; pointer-events: none; }
  .num { left: 5px; top: 5px; }
  .dur { right: 5px; bottom: 5px; }
  .rn { right: 5px; top: 5px; background: var(--accent); }
  .meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .chk { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }
  .x { margin-left: auto; }
  .warn-t { color: var(--warn-fg); }
  .empty { grid-column: 1 / -1; padding: 12px 4px; }
</style>
