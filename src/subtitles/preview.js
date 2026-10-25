// Live subtitle preview drawn over the <video> element, plus the pure
// renderer the preset tiles use.
//
// Positions, line breaks, sizes and animation timing come from the same
// layoutFor() / frameState() / wrapLines() as the ASS export. Font sizes use
// each font's measured libass ratio (FONTS[].em), and the bundled fonts are
// the same files libass renders with, so preview and export line up closely.

import { frameState, layoutFor, displayText, normalizeLook, fontInfo, fontFaceCss, safeArea, SINGLE_SIZE, FORMAT_SCALE, formatOf } from './styles.js';
import { cueIndexAt, wrapLines } from './model.js';
import { escapeHtml } from '../ui.js';

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

let fontsInjected = false;
/** Add @font-face rules for the bundled fonts (once per page). */
export function ensureFonts(base = '/fonts/') {
  if (fontsInjected || typeof document === 'undefined') return;
  fontsInjected = true;
  const style = document.createElement('style');
  style.dataset.subFonts = '';
  style.textContent = fontFaceCss(base);
  document.head.appendChild(style);
}

const TRANSLATE = {
  1: '0,-100%', 2: '-50%,-100%', 4: '0,-50%', 5: '-50%,-50%', 7: '0,0', 8: '-50%,0',
};

/**
 * HTML for one cue at time t, drawn into a box of `boxW × boxH` CSS px that
 * represents a frame of `frameW × frameH` video pixels.
 */
export function cueHtml(cue, lookIn, t, { boxW, boxH, frameW, frameH }) {
  if (!cue?.words?.length) return '';
  const st = frameState(cue, lookIn, t);
  const look = st.look;
  const L = layoutFor(look, frameW, frameH);   // the effective look: the big line has its own size and position
  const s = boxH / frameH;                  // video px → CSS px
  const single = st.single != null;
  const assPx = L.fontSize * s * (single ? SINGLE_SIZE : 1);
  const fontPx = assPx * fontInfo(look.font).em;
  const outline = L.outline * s;
  const stroke = !look.box && outline > 0
    ? `-webkit-text-stroke:${(outline * 2).toFixed(2)}px ${look.outlineColor};paint-order:stroke fill;`
    : '';
  const shadows = [];
  if (L.shadow) shadows.push(`${(L.shadow * s).toFixed(1)}px ${(L.shadow * s).toFixed(1)}px 0 rgba(0,0,0,.45)`);
  if (L.blur) {
    const b = (L.blur * s * 1.6).toFixed(1);
    shadows.push(`0 0 ${b}px ${look.outlineColor}`, `0 0 ${b}px ${look.outlineColor}`);
  }
  const shadowCss = shadows.length ? `text-shadow:${shadows.join(',')};` : '';

  const lines = single ? [[st.single]] : wrapLines(cue.words, L.maxChars);
  const lineOf = new Map();
  lines.forEach((l, li) => l.forEach(k => lineOf.set(k, li)));
  let curLine = 0;
  st.words.forEach((w, k) => { if (w.visible) curLine = Math.max(curLine, lineOf.get(k) ?? 0); });
  const colorOf = c => (c === 'accent' ? look.accent : c === 'pillText' ? look.pillText : look.color);
  const pad = L.pillPad * s;

  const wordHtml = k => {
    const w = cue.words[k];
    const ws = st.words[k];
    const txt = escapeHtml(displayText(w.text, look));
    let css = `color:${colorOf(ws.color)};`;
    let fill = '';
    if (!ws.visible) css += 'visibility:hidden;';
    if (ws.fill != null) {
      if (ws.fill >= 1) css = `color:${look.accent};`;
      else if (ws.fill > 0) {
        const rest = ((1 - ws.fill) * 100).toFixed(1);
        fill = `<span class="sub-ov-fill" style="color:${look.accent};clip-path:inset(-30% ${rest}% -30% -5%)">${txt}</span>`;
      }
    }
    if (ws.pill) css += `background:${look.accent};box-shadow:0 0 0 ${pad.toFixed(1)}px ${look.accent};-webkit-text-stroke:0;text-shadow:none;`;
    if (ws.scale !== 1) css += `transform:scale(${ws.scale.toFixed(3)});`;
    return `<span class="sub-ov-w" style="${css}">${txt}${fill}</span>`;
  };

  const boxCss = look.box
    ? `background:${rgba(look.boxColor, look.boxOpacity)};padding:${(outline * 0.6).toFixed(1)}px ${outline.toFixed(1)}px;`
    : '';
  const hideLaterLines = look.box && (look.word === 'reveal' || look.word === 'pop');
  const lineHtml = lines
    .map((l, li) => (hideLaterLines && li > curLine
      ? ''
      : `<div class="sub-ov-line"><span style="${boxCss}">${l.map(wordHtml).join(' ')}</span></div>`))
    .join('');

  const x = L.anchor.x * s;
  const y = L.anchor.y * s + st.dy * L.fontSize * s;
  const block = [
    `left:${x.toFixed(1)}px`, `top:${y.toFixed(1)}px`,
    `transform:translate(${TRANSLATE[L.an]}) scale(${st.lineScale.toFixed(3)})${look.slant ? ' skewX(-11.3deg)' : ''}`,
    `transform-origin:${look.align === 'left' ? '0' : '50%'} 50%`,
    `text-align:${look.align === 'left' ? 'left' : 'center'}`,
    `font-family:'${look.font}',system-ui,sans-serif`,
    `font-weight:${look.bold ? 700 : 400}`,
    `font-size:${fontPx.toFixed(2)}px`,
    `line-height:${assPx.toFixed(2)}px`,
    `color:${look.color}`,
    `opacity:${st.opacity.toFixed(3)}`,
  ].join(';');
  return `<div class="sub-ov-block" style="${block};${stroke}${shadowCss}">${lineHtml}</div>`;
}

/**
 * Safe-area guides: a dashed rectangle for the frame and, on a vertical video,
 * a sketch of the Instagram / Facebook Reels buttons and caption that cover it
 * on a phone (where the subtitles must not go).
 */
function guidesHtml(boxW, boxH, frameW, frameH) {
  const sa = safeArea(frameW, frameH);
  const px = v => `${v.toFixed(1)}px`;
  let html = `<div class="sub-ov-safe" style="left:${px(sa.side * boxW)};right:${px(sa.side * boxW)};top:${px(sa.top * boxH)};bottom:${px(sa.bottom * boxH)}"></div>`;
  if (formatOf(frameW, frameH) !== 'reel') return html;
  const u = Math.min(boxW, boxH) / 100;            // 1% of the short side
  const svg = d => `<svg viewBox="0 0 24 24" width="${(u * 6.5).toFixed(1)}" height="${(u * 6.5).toFixed(1)}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    like: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    comment: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12z"/>',
    share: '<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  };
  const icon = (name, label) => `<div class="sub-ui-btn">${svg(ICONS[name])}${label ? `<small>${label}</small>` : ''}</div>`;
  html += `<div class="sub-ui" style="font-size:${px(u * 3.4)}" aria-hidden="true">
    <div class="sub-ui-zone" style="left:0;right:0;top:0;height:${px(sa.top * boxH)}"></div>
    <div class="sub-ui-zone" style="left:0;right:0;bottom:0;height:${px(sa.bottom * boxH)}"></div>
    <div class="sub-ui-zone" style="right:0;width:${px(sa.side * boxW * 1.6)};bottom:${px(sa.bottom * boxH)};height:${px(boxH * 0.3)}"></div>
    <div class="sub-ui-top" style="top:${px(u * 5)};left:${px(u * 5)};right:${px(u * 5)}"><b>Reels</b>${svg('<rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/>')}</div>
    <div class="sub-ui-side" style="right:${px(u * 3)};bottom:${px(sa.bottom * boxH + u * 2)};gap:${px(u * 4)}">
      ${icon('like', '1.2K')}${icon('comment', '48')}${icon('share', '')}${icon('more', '')}
    </div>
    <div class="sub-ui-bottom" style="left:${px(u * 5)};right:${px(u * 18)};bottom:${px(u * 6)};gap:${px(u * 1.6)}">
      <div class="sub-ui-user"><i style="width:${px(u * 7)};height:${px(u * 7)}"></i><b>kumitat</b><em>Segwi</em></div>
      <div class="sub-ui-cap">Il-caption tal-post tidher hawn…</div>
      <div class="sub-ui-cap">♫ Original audio</div>
    </div>
  </div>`;
  return html;
}

function logoHtml(logo, boxW, boxH) {
  if (!logo?.src) return '';
  const w = (boxW * (logo.widthPct ?? 12)) / 100;
  const m = (Math.min(boxW, boxH) * (logo.marginPct ?? 4)) / 100;
  const c = logo.corner || 'tr';
  const pos = `${c.includes('t') ? 'top' : 'bottom'}:${m.toFixed(1)}px;${c.includes('l') ? 'left' : 'right'}:${m.toFixed(1)}px`;
  return `<img class="sub-ov-logo" alt="" src="${escapeHtml(logo.src)}" style="width:${w.toFixed(1)}px;opacity:${logo.opacity ?? 1};${pos}">`;
}

export function createPreview({ stage, video, overlay }) {
  ensureFonts();
  let cues = [];
  let look = normalizeLook();
  let tempLook = null;
  let guides = false;
  let logo = null;
  let raf = 0;
  let lastHtml = '';

  function contentRect() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = video.clientWidth;
    const ch = video.clientHeight;
    if (!vw || !vh || !cw || !ch) return null;
    const sc = Math.min(cw / vw, ch / vh);
    const w = vw * sc;
    const h = vh * sc;
    return { x: video.offsetLeft + (cw - w) / 2, y: video.offsetTop + (ch - h) / 2, w, h, vw, vh };
  }

  function draw() {
    const r = contentRect();
    if (!r) { overlay.innerHTML = ''; lastHtml = ''; return; }
    Object.assign(overlay.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    const t = video.currentTime;
    const i = cueIndexAt(cues, t);
    const L = tempLook || look;
    let html = '';
    if (guides) html += guidesHtml(r.w, r.h, r.vw, r.vh);
    html += logoHtml(logo, r.w, r.h);
    if (i >= 0) html += cueHtml(cues[i], L, t, { boxW: r.w, boxH: r.h, frameW: r.vw, frameH: r.vh });
    if (html !== lastHtml) { overlay.innerHTML = html; lastHtml = html; }
  }

  function loop() {
    draw();
    raf = video.paused || video.ended ? 0 : requestAnimationFrame(loop);
  }
  video.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(loop); });
  for (const ev of ['pause', 'seeked', 'seeking', 'timeupdate', 'loadedmetadata', 'resize']) {
    video.addEventListener(ev, draw);
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
  ro?.observe(stage);
  document.fonts?.addEventListener?.('loadingdone', draw);

  return {
    setCues(next) { cues = next; draw(); },
    setLook(next) { look = normalizeLook(next); draw(); },
    /** Show a look temporarily (hovering a preset tile); null to go back. */
    setTempLook(next) { tempLook = next ? normalizeLook(next) : null; draw(); },
    setGuides(on) { guides = !!on; draw(); },
    get guides() { return guides; },
    setLogo(next) { logo = next; draw(); },
    redraw: draw,
    destroy() { cancelAnimationFrame(raf); ro?.disconnect(); overlay.innerHTML = ''; },
  };
}

/**
 * Animated preset tiles: each tile loops a short Maltese sample through
 * cueHtml(). Respects prefers-reduced-motion (draws a still frame).
 */
const TILE_TEXT_BOOST = 2.3;

export function createTiles({ container, getLooks, frame = { w: 1920, h: 1080 } }) {
  ensureFonts();
  // Tiles play a short sample: the selected caption's first few words when
  // there is one (so you judge the style on your own text), else a stock line.
  const makeCue = texts => {
    const n = texts.length;
    const step = Math.min(0.6, 1.8 / Math.max(1, n));
    let kw = 0;
    texts.forEach((t, i) => { if (t.length > texts[kw].length) kw = i; });
    return {
      start: 0, end: 2.6, speaker: 'S',
      words: texts.map((text, i) => ({ text, start: 0.15 + i * step, end: 0.15 + i * step + step * 0.85, prob: 1, kw: i === kw })),
    };
  };
  const STOCK = "Il-festa ta' Santa".split(' ');
  let cue = makeCue(STOCK);
  cue.words.forEach((w, i) => { w.kw = i === 2; });
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let running = false;
  const t0 = performance.now();

  function frameOnce(now) {
    // play the cue, then hold its last frame (before any fade-out) until the loop restarts
    const t = reduce ? 1.6 : Math.min(((now - t0) / 1000) % 3.4, 2.1);
    for (const el of container.querySelectorAll('[data-tile]')) {
      const look = getLooks()[el.dataset.tile];
      const stageEl = el.querySelector('.sub-tile-stage');
      if (!look || !stageEl) continue;
      const boxW = stageEl.clientWidth;
      const boxH = stageEl.clientHeight;
      if (!boxW) continue;
      // Thumbnails exaggerate the text size so the style is readable at a glance.
      const tileLook = {
        ...look,
        sizePct: (look.sizePct * TILE_TEXT_BOOST) / FORMAT_SCALE[formatOf(frame.w, frame.h)],
        maxChars: 60,
        safeArea: false,
        marginPct: 9,
        position: look.position === 'top' ? 'top' : look.position === 'middle' ? 'middle' : 'bottom',
      };
      const html = cueHtml(cue, tileLook, t, { boxW, boxH, frameW: frame.w, frameH: frame.h });
      if (stageEl._html !== html) { stageEl.innerHTML = html; stageEl._html = html; }
    }
    raf = running && !reduce ? requestAnimationFrame(frameOnce) : 0;
  }
  return {
    start() { if (running) return; running = true; raf = requestAnimationFrame(frameOnce); },
    stop() { running = false; cancelAnimationFrame(raf); raf = 0; },
    refresh() { requestAnimationFrame(frameOnce); },
    setFrame(w, h) { frame = { w, h }; requestAnimationFrame(frameOnce); },
    /** Sample text for the tiles (array of words); empty → the stock line. */
    setSample(texts) {
      const pick = (texts || []).filter(Boolean).slice(0, 4);
      cue = pick.length ? makeCue(pick) : makeCue(STOCK);
      if (!pick.length) cue.words.forEach((w, i) => { w.kw = i === 2; });
      for (const el of container.querySelectorAll('.sub-tile-stage')) el._html = '';
      requestAnimationFrame(frameOnce);
    },
  };
}
