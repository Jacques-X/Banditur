<script>
  // Murtali's timeline: the waveform and the sound-activity curve, the items as blocks over dimmed dead time,
  // and the playhead. Click or drag on empty space to seek; drag an item's edge to trim; ⌘/Ctrl + wheel
  // (or pinch) zooms around the pointer, plain wheel pans. Maths lives in timeline.js.
  import { timeToX, xToTime, fitView, clampView, zoomAt, panBy, reveal, hitTest, snap, columns, ticks } from './timeline.js';
  import { FW } from '../../strings.js';

  let {
    peaks = [], peaksRate = 50, score = [], rate = 10, duration = 0, items = [], reelOf = {}, selectedId = null,
    t = 0, markIn = null, follow = false,
    onseek = () => {}, onselect = () => {}, ontrimstart = () => {}, ontrim = () => {}, ontrimend = () => {},
  } = $props();

  let canvas = $state();
  let width = $state(600);
  let height = $state(150);
  let view = $state({ start: 0, pps: 1 });
  let fitted = false;
  let drag = null;
  let hover = $state(null);

  // fit the whole clip once the size and the length are known
  $effect(() => {
    if (!fitted && width > 50 && duration > 0) { view = fitView(duration, width); fitted = true; }
  });
  $effect(() => {
    if (!fitted) return;
    const v = clampView(view, duration, width);
    if (v.start !== view.start || v.pps !== view.pps) view = v;   // only when it moved: an effect that rewrites what it reads must settle
  });
  $effect(() => { if (follow && fitted) { const v = reveal(view, t, duration, width); if (v !== view) view = v; } });

  export function zoom(factor) { view = zoomAt(view, factor, width / 2, duration, width); }
  export function fit() { view = fitView(duration, width); }
  /** Scroll so `time` is visible (Shift+arrow jumps while paused). */
  export function show(time) { if (!fitted) return; const v = reveal(view, time, duration, width); if (v !== view) view = v; }

  const css = (name, fallback) => (canvas ? getComputedStyle(canvas).getPropertyValue(name).trim() || fallback : fallback);

  function draw() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const C = { wave: css('--muted', '#888'), accent: css('--accent', '#3355d1'), soft: css('--accent-soft-2', '#dde'), line: css('--line-strong', '#ccc'), fg: css('--fg', '#111'), warn: css('--warn', '#b7791f') };
    const top = 22, mid = top + (height - top) / 2, half = (height - top) / 2 - 4;
    // ruler
    ctx.fillStyle = C.wave; ctx.font = '11px system-ui'; ctx.textBaseline = 'top';
    for (const s of ticks(view, width).times) {
      const x = Math.round(timeToX(s, view)) + 0.5;
      ctx.fillRect(x, 14, 1, 6);
      const m = Math.floor(s / 60), r = Math.round(s % 60);
      ctx.fillText(`${m}:${String(r).padStart(2, '0')}`, x + 3, 2);
    }
    // waveform, dimmed, then bright inside the items
    const wave = columns(peaks, peaksRate, view, Math.floor(width), 255);
    const act = columns(score, rate, view, Math.floor(width), 1);
    const paintWave = (color, from, to) => {
      ctx.fillStyle = color;
      for (let x = Math.max(0, Math.floor(from)); x < Math.min(width, Math.ceil(to)); x++) {
        const h = Math.max(1, wave[x] * half);
        ctx.fillRect(x, mid - h, 1, h * 2);
      }
    };
    ctx.globalAlpha = 0.35; paintWave(C.wave, 0, width); ctx.globalAlpha = 1;
    for (const it of items) {
      const x0 = timeToX(it.start, view), x1 = timeToX(it.end, view);
      if (x1 < 0 || x0 > width) continue;
      const sel = it.id === selectedId;
      ctx.fillStyle = C.accent; ctx.globalAlpha = it.keep === false ? 0.06 : sel ? 0.28 : 0.16;
      ctx.fillRect(x0, top, x1 - x0, height - top); ctx.globalAlpha = 1;
      if (it.keep !== false) paintWave(C.accent, x0, x1);
      ctx.strokeStyle = C.accent; ctx.lineWidth = sel ? 2 : 1; ctx.globalAlpha = it.keep === false ? 0.4 : 1;
      ctx.strokeRect(x0 + 0.5, top + 0.5, Math.max(1, x1 - x0 - 1), height - top - 1); ctx.globalAlpha = 1;
      // edge handles
      ctx.fillStyle = C.accent; ctx.fillRect(x0, top, 3, height - top); ctx.fillRect(x1 - 3, top, 3, height - top);
      const r = reelOf[it.id];
      if (r) {
        ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(x0 + 14, top + 12, 9, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 11px system-ui';
        ctx.fillText(String(r), x0 + 14, top + 12); ctx.textAlign = 'start';
      }
    }
    // sound activity: a thin line along the bottom
    ctx.strokeStyle = C.warn; ctx.lineWidth = 1.5; ctx.beginPath();
    const base = height - 3, span = Math.min(40, (height - top) / 2.5);
    for (let x = 0; x < act.length; x++) { const y = base - act[x] * span; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    // mark-in flag
    if (markIn != null) {
      const x = timeToX(markIn, view);
      ctx.fillStyle = C.warn; ctx.fillRect(x, top, 2, height - top); ctx.fillRect(x, top, 10, 8);
    }
    // playhead
    const px = timeToX(t, view);
    if (px >= 0 && px <= width) { ctx.fillStyle = C.fg; ctx.fillRect(Math.round(px), 0, 2, height); }
  }
  $effect(() => { peaks; score; items; reelOf; selectedId; t; view; width; height; markIn; draw(); });

  const xOf = (e) => e.clientX - canvas.getBoundingClientRect().left;
  const clampT = (v) => Math.max(0, Math.min(duration, v));

  function down(e) {
    canvas.setPointerCapture(e.pointerId);
    const x = xOf(e);
    const hit = hitTest(items, x, view);
    if (hit && hit.part !== 'body') {
      onselect(hit.id);
      drag = { kind: 'edge', id: hit.id, part: hit.part };
      ontrimstart();
    } else if (hit) {
      onselect(hit.id);
      drag = { kind: 'seek' };
      onseek(clampT(xToTime(x, view)));
    } else {
      onselect(null);
      drag = { kind: 'seek' };
      onseek(clampT(xToTime(x, view)));
    }
  }
  function move(e) {
    const x = xOf(e);
    if (!drag) {
      const h = hitTest(items, x, view);
      hover = h && h.part !== 'body' ? 'ew-resize' : null;
      return;
    }
    if (drag.kind === 'seek') { onseek(clampT(xToTime(x, view))); return; }
    const time = e.altKey ? xToTime(x, view) : snap(xToTime(x, view), [t], view);
    ontrim(drag.id, drag.part === 'start' ? { start: clampT(time) } : { end: clampT(time) });
  }
  function up() {
    if (drag?.kind === 'edge') ontrimend();
    drag = null;
  }
  function wheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) view = zoomAt(view, Math.exp(-e.deltaY * 0.01), xOf(e), duration, width);
    else view = panBy(view, Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY, duration, width);
  }
</script>

<div class="tl" role="group" aria-label={FW.timelineLabel} bind:clientWidth={width} bind:clientHeight={height}>
  <canvas bind:this={canvas} style="width:{width}px;height:{height}px;cursor:{hover || 'default'}"
          onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onwheel={wheel}></canvas>
</div>

<style>
  .tl { position: relative; height: 150px; min-height: 100px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-sunken); overflow: hidden; }
  canvas { display: block; touch-action: none; }
</style>
