// Timeline under the video: waveform, cue blocks and the playhead.
//
//   drag a block edge          → trim that edge (snaps to word boundaries)
//   drag the edge two touching
//   blocks share               → roll the cut (Shift = trim just this one)
//   drag the middle            → move the cue (its words keep their audio timing)
//   click / drag empty space   → seek / scrub
//   ⌘/Ctrl + scroll or pinch   → zoom around the pointer; scroll → pan
//   Alt while dragging         → no snapping · Esc → cancel the drag
// Every drag is one undo step (SubtitleDoc.beginLive / commitLive).

import { setWordStart, setCueTimes, rollIn, rollOut, moveCue, snapTimes, cueText, cueIssues } from './model.js';
import { escapeHtml } from '../ui.js';

const EDGE_PX = 7;
const SNAP_PX = 8;
const TOUCH = 0.02;          // seconds: cues closer than this "touch"
const MIN_PPS = 4;
const MAX_PPS = 800;

export function createTimeline({ root, video, getDoc, getSel, getTarget, onSelect, getLookOpts, labels }) {
  const $ = s => root.querySelector(s);
  const scroller = $('.sub-tl-scroll');
  const inner = $('.sub-tl-inner');
  const lane = $('.sub-tl-cues');
  const playhead = $('.sub-tl-playhead');
  const canvas = $('.sub-tl-wave');
  const ctx = canvas.getContext('2d');

  let pps = 60;               // pixels per second
  let peaks = null;           // { rate, peaks: Uint8Array | number[] }
  let collapsed = false;
  let drag = null;
  let raf = 0;
  let follow = true;

  const duration = () => {
    const d = video.duration;
    if (Number.isFinite(d) && d > 0) return d;
    const cues = getDoc().cues;
    return cues.length ? cues[cues.length - 1].end + 2 : 10;
  };
  const viewW = () => scroller.clientWidth || 1;
  const fitPps = () => Math.max(MIN_PPS, (viewW() - 16) / duration());
  const xOf = t => t * pps;
  const tOf = x => Math.max(0, x / pps);

  // ── Rendering ──────────────────────────────────────────────────────────────

  function blockHtml(c, i, sel, target) {
    const issues = cueIssues(c, getLookOpts?.() || {});
    const cls = ['sub-tl-cue'];
    if (i === sel) cls.push('is-sel');
    if (i === target) cls.push('is-target');
    if (issues.length) cls.push('has-issue');
    const left = xOf(c.start);
    const width = Math.max(2, xOf(c.end) - left);
    const text = width > 28 ? escapeHtml(cueText(c)) : '';
    // the selected caption shows a handle per word start (word 0 is the caption start)
    const ticks = i === sel && width > 40
      ? c.words.map((w, k) => (k < 1 ? '' : `<i class="sub-tl-wtick" data-k="${k}" style="left:${(xOf(w.start) - left - 4).toFixed(1)}px" title="${escapeHtml(w.text)}"></i>`)).join('')
      : '';
    return `<div class="${cls.join(' ')}" data-i="${i}" style="left:${left.toFixed(1)}px;width:${width.toFixed(1)}px" title="${escapeHtml(cueText(c))}"><span>${text}</span>${ticks}</div>`;
  }

  function renderBlocks() {
    const { cues } = getDoc();
    inner.style.width = `${Math.ceil(xOf(duration()) + 40)}px`;
    const sel = getSel();
    const target = getTarget();
    markedSel = sel;
    lane.innerHTML = cues.map((c, i) => blockHtml(c, i, sel, target)).join('');
    drawWave();
    positionPlayhead();
  }

  function updateBlocks(indices) {
    const { cues } = getDoc();
    const sel = getSel();
    const target = getTarget();
    for (const i of indices) {
      const el = lane.querySelector(`.sub-tl-cue[data-i="${i}"]`);
      if (!el || !cues[i]) continue;
      el.outerHTML = blockHtml(cues[i], i, sel, target);
    }
  }

  let markedSel = -1;
  function markClasses() {
    const sel = getSel();
    const target = getTarget();
    // the selected block carries the word handles, so it is drawn again
    if (sel !== markedSel) {
      const old = markedSel;
      markedSel = sel;
      updateBlocks([old, sel].filter(j => j >= 0));
    }
    for (const el of lane.children) {
      const i = Number(el.dataset.i);
      el.classList.toggle('is-sel', i === sel);
      el.classList.toggle('is-target', i === target);
    }
  }

  function drawWave() {
    const dpr = window.devicePixelRatio || 1;
    const w = viewW();
    const h = canvas.clientHeight || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(root);
    const waveColor = css.getPropertyValue('--tl-wave').trim() || '#9aa3b2';
    const tickColor = css.getPropertyValue('--tl-tick').trim() || '#c9ced6';
    const textColor = css.getPropertyValue('--tl-tick-text').trim() || '#6b7280';
    const left = scroller.scrollLeft;
    const rulerH = collapsed ? 0 : 14;

    // ruler
    if (!collapsed) {
      const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
      const step = steps.find(s => s * pps >= 70) || 600;
      ctx.fillStyle = textColor;
      ctx.strokeStyle = tickColor;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textBaseline = 'top';
      ctx.beginPath();
      for (let t = Math.floor(tOf(left) / step) * step; xOf(t) - left < w; t += step) {
        const x = Math.round(xOf(t) - left) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 5);
        const m = Math.floor(t / 60);
        const sec = t % 60;
        ctx.fillText(`${m}:${String(Math.floor(sec)).padStart(2, '0')}${step < 1 ? `.${Math.round((sec % 1) * 10)}` : ''}`, x + 3, 2);
      }
      ctx.stroke();
    }

    // waveform (mirrored, sqrt-scaled so quiet speech is visible)
    const top = rulerH;
    const waveH = collapsed ? 0 : Math.max(0, h - rulerH);
    if (!waveH) return;
    const mid = top + waveH / 2;
    ctx.fillStyle = waveColor;
    if (!peaks?.peaks?.length) {
      ctx.fillRect(0, mid, w, 1);
      return;
    }
    const data = peaks.peaks;
    const rate = peaks.rate || 50;
    for (let x = 0; x < w; x++) {
      const t0 = tOf(left + x);
      const t1 = tOf(left + x + 1);
      let i0 = Math.floor(t0 * rate);
      const i1 = Math.max(i0 + 1, Math.ceil(t1 * rate));
      let v = 0;
      for (; i0 < i1 && i0 < data.length; i0++) if (data[i0] > v) v = data[i0];
      if (!v) continue;
      const a = Math.sqrt(v / 255) * (waveH / 2 - 1);
      ctx.fillRect(x, mid - a, 1, Math.max(1, a * 2));
    }
  }

  function positionPlayhead() {
    playhead.style.transform = `translateX(${xOf(video.currentTime).toFixed(1)}px)`;
  }

  function keepPlayheadVisible() {
    const x = xOf(video.currentTime);
    const l = scroller.scrollLeft;
    const w = viewW();
    if (x < l || x > l + w - 24) scroller.scrollLeft = Math.max(0, x - w * 0.15);
  }

  const tick = () => {
    positionPlayhead();
    if (follow && !drag) keepPlayheadVisible();
    raf = video.paused ? 0 : requestAnimationFrame(tick);
  };
  video.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(tick); });
  for (const ev of ['seeked', 'timeupdate', 'pause']) video.addEventListener(ev, positionPlayhead);
  video.addEventListener('loadedmetadata', () => { setZoom(Math.max(fitPps(), 60)); });
  scroller.addEventListener('scroll', () => drawWave(), { passive: true });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (collapsed) pps = fitPps(); renderBlocks(); }) : null;
  ro?.observe(scroller);

  // ── Zoom ───────────────────────────────────────────────────────────────────

  function setZoom(next, anchorX = viewW() / 2) {
    const tAtAnchor = tOf(scroller.scrollLeft + anchorX);
    pps = Math.min(MAX_PPS, Math.max(fitPps(), next));
    renderBlocks();
    scroller.scrollLeft = Math.max(0, xOf(tAtAnchor) - anchorX);
    drawWave();
  }

  scroller.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = scroller.getBoundingClientRect();
      setZoom(pps * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left);
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      scroller.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  // ── Pointer interactions ───────────────────────────────────────────────────

  const timeAt = e => tOf(e.clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft);

  function zoneOf(el, e) {
    const r = el.getBoundingClientRect();
    if (e.clientX - r.left <= EDGE_PX) return 'start';
    if (r.right - e.clientX <= EDGE_PX) return 'end';
    return 'move';
  }

  function modeFor(i, zone, shift) {
    const { cues } = getDoc();
    const c = cues[i];
    if (zone === 'start' && !shift && cues[i - 1] && Math.abs(c.start - cues[i - 1].end) < TOUCH) return 'rollIn';
    if (zone === 'end' && !shift && cues[i + 1] && Math.abs(cues[i + 1].start - c.end) < TOUCH) return 'rollOut';
    return zone === 'start' ? 'trimIn' : zone === 'end' ? 'trimOut' : 'move';
  }

  function snap(t, i, alt) {
    if (alt) return t;
    const cands = snapTimes(getDoc().cues, i);
    cands.push(video.currentTime);
    let best = t;
    let bestD = SNAP_PX / pps;
    for (const c of cands) {
      const d = Math.abs(c - t);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  lane.addEventListener('pointermove', e => {
    if (drag) return;
    if (e.target.closest('.sub-tl-wtick')) { lane.style.cursor = 'ew-resize'; return; }
    const el = e.target.closest('.sub-tl-cue');
    if (!el) { lane.style.cursor = ''; return; }
    const mode = modeFor(Number(el.dataset.i), zoneOf(el, e), e.shiftKey);
    lane.style.cursor = mode === 'move' ? 'grab' : mode.startsWith('roll') ? 'col-resize' : 'ew-resize';
  });

  scroller.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const el = e.target.closest('.sub-tl-cue');
    scroller.setPointerCapture(e.pointerId);
    const tick = e.target.closest('.sub-tl-wtick');
    if (tick && el) {
      drag = { kind: 'word', i: Number(el.dataset.i), k: Number(tick.dataset.k), x0: e.clientX, moved: false };
      return;
    }
    if (!el) {
      drag = { kind: 'scrub' };
      video.currentTime = timeAt(e);
      return;
    }
    const i = Number(el.dataset.i);
    const doc = getDoc();
    const c = doc.cues[i];
    const mode = modeFor(i, zoneOf(el, e), e.shiftKey);
    drag = { kind: 'cue', i, mode, x0: e.clientX, t0: timeAt(e), origin: { start: c.start, end: c.end }, moved: false };
    onSelect(i, { seek: false });
  });

  scroller.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.kind === 'scrub') { video.currentTime = timeAt(e); return; }
    if (drag.kind === 'word') {
      if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return;
      const doc = getDoc();
      if (!drag.moved) { drag.moved = true; doc.beginLive(); }
      const t = timeAt(e);
      doc.live(cues => setWordStart(cues, drag.i, drag.k, t));
      const w = doc.cues[drag.i].words[drag.k];
      video.currentTime = w.start;      // the picture shows the highlight at this moment
      updateBlocks([drag.i]);
      return;
    }
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return;
    const doc = getDoc();
    if (!drag.moved) { drag.moved = true; doc.beginLive(); lane.style.cursor = drag.mode === 'move' ? 'grabbing' : lane.style.cursor; }
    const { i, mode, origin } = drag;
    const t = timeAt(e);
    doc.live(cues => {
      switch (mode) {
        case 'trimIn': return setCueTimes(cues, i, snap(t, i, e.altKey), cues[i].end);
        case 'trimOut': return setCueTimes(cues, i, cues[i].start, snap(t, i, e.altKey));
        case 'rollIn': return rollIn(cues, i, snap(t, i, e.altKey));
        case 'rollOut': return rollOut(cues, i, snap(t, i, e.altKey));
        default: {
          let dt = t - drag.t0;
          // snap the cue's start (or end) to a word boundary while moving
          const s = snap(origin.start + dt, i, e.altKey);
          if (s !== origin.start + dt) dt = s - origin.start;
          else {
            const en = snap(origin.end + dt, i, e.altKey);
            if (en !== origin.end + dt) dt = en - origin.end;
          }
          return moveCue(cues, i, dt, origin);
        }
      }
    });
    updateBlocks([i - 1, i, i + 1]);
  });

  const endDrag = e => {
    if (!drag) return;
    const d = drag;
    drag = null;
    try { scroller.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (d.kind === 'word') {
      if (d.moved) getDoc().commitLive(labels.word || '');
      return;
    }
    if (d.kind !== 'cue') return;
    const doc = getDoc();
    if (d.moved) doc.commitLive(labels[d.mode] || '');
    else {
      // plain click on a block: select it and put the playhead where clicked
      onSelect(d.i, { seek: false });
      video.currentTime = Math.min(Math.max(d.t0, doc.cues[d.i].start), doc.cues[d.i].end - 0.01);
    }
  };
  scroller.addEventListener('pointerup', endDrag);
  scroller.addEventListener('pointercancel', endDrag);

  function cancelDrag() {
    if ((drag?.kind === 'cue' || drag?.kind === 'word') && drag.moved) {
      getDoc().cancelLive();
      drag = null;
      return true;
    }
    return false;
  }

  return {
    render: renderBlocks,
    update: updateBlocks,
    mark: markClasses,
    setPeaks(p) { peaks = p && p.peaks ? { rate: p.rate || 50, peaks: p.peaks } : null; drawWave(); },
    get hasPeaks() { return !!peaks?.peaks?.length; },
    zoomBy(f) { setZoom(pps * f); },
    zoomFit() { setZoom(fitPps()); },
    toggleCollapsed() {
      collapsed = !collapsed;
      root.classList.toggle('is-collapsed', collapsed);
      if (collapsed) pps = fitPps();
      requestAnimationFrame(() => { renderBlocks(); if (!collapsed) setZoom(Math.max(fitPps(), 60)); });
      return collapsed;
    },
    get collapsed() { return collapsed; },
    cancelDrag,
    get dragging() { return !!drag; },
    setFollow(on) { follow = on; },
    reveal(i) {
      const c = getDoc().cues[i];
      if (!c) return;
      const l = scroller.scrollLeft;
      const w = viewW();
      if (xOf(c.start) < l || xOf(c.end) > l + w) scroller.scrollLeft = Math.max(0, xOf(c.start) - w * 0.2);
    },
  };
}
