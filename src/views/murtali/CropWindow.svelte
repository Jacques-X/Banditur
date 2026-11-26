<script>
  // The 9:16 window over a picture of the source frame (preview or thumbnail). Drag it sideways to aim.
  // Everything outside the window is dimmed. Positions come from reel.cropWindow (same maths as the renderer).
  import { cropWindow, centreOf } from './reel.js';
  import { FW } from '../../strings.js';

  let { x = null, srcW, srcH, onstart = () => {}, onchange = () => {}, onend = () => {}, small = false } = $props();
  const win = $derived(cropWindow(x, srcW, srcH));
  let box = $state();
  let drag = null;

  function down(e) {
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = { px: e.clientX, left: win.x };
    onstart();
  }
  function move(e) {
    if (!drag || !box) return;
    const rect = box.getBoundingClientRect();
    const dxSrc = ((e.clientX - drag.px) / rect.width) * srcW;
    onchange(centreOf(drag.left + dxSrc, win.w, srcW));
  }
  function up() { if (drag) { drag = null; onend(); } }
  function key(e) {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    onstart();
    onchange(Math.max(0, Math.min(1, (x ?? 0.5) + (e.key === 'ArrowLeft' ? -step : step))));
    onend();
  }
</script>

<div class="cw" bind:this={box} class:small>
  <div class="win" role="slider" tabindex="0" aria-label={FW.cropHint} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round((x ?? 0.5) * 100)}
       title={FW.cropHint} style="left: {(win.x / srcW) * 100}%; width: {(win.w / srcW) * 100}%"
       onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}></div>
</div>

<style>
  .cw { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .win {
    position: absolute; top: 0; bottom: 0; pointer-events: auto; cursor: ew-resize; touch-action: none;
    border: 2px solid var(--accent); box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5); border-radius: 2px;
  }
  .small .win { border-width: 1.5px; }
  .win:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }
</style>
