// One colour picker for the whole app: a colour wheel, a brightness slider,
// R G B values and a hex field. It replaces the WebKit popover (a fixed grid of
// swatches) for every <input type="color">, wherever it lives (Svelte views,
// the subtitle editor, the post maker): clicking the input opens this instead,
// and the input gets ordinary `input` events while you pick and a `change`
// event when the picker closes, so existing listeners and bind:value work.

const RECENT_KEY = 'banditur_recent_colors';
const WHEEL = 196;   // CSS px

// ── colour maths ────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hex2 = n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
export const rgbToHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex).trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}
export function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const recent = {
  get() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter(c => hexToRgb(c)); } catch { return []; } },
  add(c) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...recent.get().filter(x => x.toLowerCase() !== c.toLowerCase())].slice(0, 10))); } catch { /* private mode */ }
  },
};

// ── the popover ─────────────────────────────────────────────────────────────
let pop = null;        // { el, input, start, h, s, v, ... }

function build() {
  const el = document.createElement('div');
  el.className = 'cp-pop';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Kulur');
  el.innerHTML = `
    <div class="cp-wheel-wrap">
      <canvas class="cp-wheel" width="${WHEEL}" height="${WHEEL}" aria-hidden="true"></canvas>
      <span class="cp-dot" aria-hidden="true"></span>
    </div>
    <label class="cp-row cp-bright"><span>Dawl</span><input type="range" min="0" max="100" step="1" class="cp-v" aria-label="Dawl" /></label>
    <div class="cp-row cp-nums">
      <span class="cp-swatch" aria-hidden="true"></span>
      <label>R<input type="number" min="0" max="255" class="cp-r" /></label>
      <label>G<input type="number" min="0" max="255" class="cp-g" /></label>
      <label>B<input type="number" min="0" max="255" class="cp-b" /></label>
    </div>
    <div class="cp-row">
      <label class="cp-hexl">Hex<input type="text" class="cp-hex" maxlength="7" spellcheck="false" autocomplete="off" /></label>
      ${'EyeDropper' in window ? '<button type="button" class="cp-eye" title="Ħu kulur mill-iskrin">Pipetta</button>' : ''}
    </div>
    <div class="cp-recent" aria-label="Kuluri riċenti"></div>`;
  return el;
}

function drawWheel(canvas, v) {
  const dpr = window.devicePixelRatio || 1;
  const n = Math.round(WHEEL * dpr);
  if (canvas.width !== n) { canvas.width = n; canvas.height = n; canvas.style.width = canvas.style.height = `${WHEEL}px`; }
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(n, n);
  const R = n / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x - R + 0.5, dy = y - R + 0.5;
      const d = Math.hypot(dx, dy);
      const i = (y * n + x) * 4;
      if (d > R) { img.data[i + 3] = 0; continue; }
      let h = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (h < 0) h += 360;
      const [r, g, b] = hsvToRgb(h, Math.min(1, d / R), v);
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
      img.data[i + 3] = d > R - 1 ? Math.round((R - d) * 255) : 255;   // soft edge
    }
  }
  ctx.putImageData(img, 0, 0);
}

function render({ wheel = false, from = '' } = {}) {
  const p = pop;
  const [r, g, b] = hsvToRgb(p.h, p.s, p.v);
  const hex = rgbToHex(r, g, b);
  const $ = s => p.el.querySelector(s);
  if (wheel) drawWheel($('.cp-wheel'), p.v);
  const ang = (p.h * Math.PI) / 180;
  const rad = (p.s * WHEEL) / 2;
  $('.cp-dot').style.transform = `translate(${WHEEL / 2 + Math.cos(ang) * rad}px, ${WHEEL / 2 + Math.sin(ang) * rad}px)`;
  $('.cp-dot').style.background = hex;
  const top = rgbToHex(...hsvToRgb(p.h, p.s, 1));
  $('.cp-v').style.background = `linear-gradient(to right, #000, ${top})`;
  if (from !== 'v') $('.cp-v').value = Math.round(p.v * 100);
  if (from !== 'rgb') { $('.cp-r').value = Math.round(r); $('.cp-g').value = Math.round(g); $('.cp-b').value = Math.round(b); }
  if (from !== 'hex') $('.cp-hex').value = hex.toUpperCase();
  $('.cp-swatch').style.background = hex;
  return hex;
}

/** Write the picked colour into the input, as if the user typed it there. */
function emit(hex) {
  const input = pop.input;
  if (input.value.toLowerCase() === hex.toLowerCase()) return;
  input.value = hex;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setHsv(h, s, v, opts) {
  const wheel = v !== pop.v;
  pop.h = h; pop.s = s; pop.v = v;
  emit(render({ ...opts, wheel }));
}
function setHex(hex, opts) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  let [h, s, v] = rgbToHsv(...rgb);
  if (!s) h = pop.h;            // keep the hue when the colour is grey
  setHsv(h, s, v, opts);
}

function place(el, input) {
  const r = input.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = r.left;
  let top = r.bottom + 6;
  if (left + w > innerWidth - 8) left = innerWidth - w - 8;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${top}px`;
}

function open(input) {
  if (pop?.input === input) return close();
  close();
  const el = build();
  document.body.appendChild(el);
  const rgb = hexToRgb(input.value) || [255, 255, 255];
  const [h, s, v] = rgbToHsv(...rgb);
  pop = { el, input, start: input.value, h, s, v };
  render({ wheel: true });
  renderRecent();
  place(el, input);
  wire(el);
  el.querySelector('.cp-hex').focus();
  el.querySelector('.cp-hex').select();
}

function close(commit = true) {
  if (!pop) return;
  const { el, input, start } = pop;
  pop = null;
  el.remove();
  if (!commit && input.value !== start) {
    input.value = start;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (input.value !== start) {
    if (commit) recent.add(input.value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  input.focus({ preventScroll: true });
}

function renderRecent() {
  const box = pop.el.querySelector('.cp-recent');
  const list = recent.get();
  box.hidden = !list.length;
  box.innerHTML = list.map(c => `<button type="button" class="cp-chip" data-c="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="${c}"></button>`).join('');
}

function wire(el) {
  const $ = s => el.querySelector(s);
  const wheel = $('.cp-wheel');
  const pick = e => {
    const r = wheel.getBoundingClientRect();
    const dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    let h = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (h < 0) h += 360;
    // picking on a black wheel would do nothing visible: lift the brightness
    const v = pop.v < 0.15 ? 1 : pop.v;
    setHsv(h, clamp(Math.hypot(dx, dy) / (r.width / 2), 0, 1), v);
  };
  const wrap = $('.cp-wheel-wrap');
  wrap.addEventListener('pointerdown', e => { wrap.setPointerCapture(e.pointerId); pick(e); });
  wrap.addEventListener('pointermove', e => { if (wrap.hasPointerCapture(e.pointerId)) pick(e); });
  $('.cp-v').addEventListener('input', e => setHsv(pop.h, pop.s, Number(e.target.value) / 100, { from: 'v' }));
  for (const k of ['r', 'g', 'b']) {
    $(`.cp-${k}`).addEventListener('input', () => {
      const vals = ['r', 'g', 'b'].map(c => clamp(Number($(`.cp-${c}`).value) || 0, 0, 255));
      setHex(rgbToHex(...vals), { from: 'rgb' });
    });
  }
  $('.cp-hex').addEventListener('input', e => {
    const v = e.target.value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(v)) setHex(v.startsWith('#') ? v : `#${v}`, { from: 'hex' });
  });
  $('.cp-recent').addEventListener('click', e => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (c) setHex(c);
  });
  $('.cp-eye')?.addEventListener('click', async () => {
    try { const r = await new window.EyeDropper().open(); if (pop) setHex(r.sRGBHex); } catch { /* cancelled */ }
  });
}

// ── take over every <input type="color"> ───────────────────────────────────
let installed = false;
export function installColorPicker() {
  if (installed) return;
  installed = true;
  const isColor = t => t instanceof HTMLInputElement && t.type === 'color' && !t.disabled;
  // the native popover opens on click: stop it and open ours
  document.addEventListener('click', e => {
    if (isColor(e.target)) { e.preventDefault(); open(e.target); }
  }, true);
  document.addEventListener('keydown', e => {
    if (!pop && (e.key === 'Enter' || e.key === ' ') && isColor(e.target)) { e.preventDefault(); open(e.target); }
  }, true);
  // Esc puts the old colour back, Enter keeps the new one. Capture phase and
  // installed first, so the subtitle editor's own Esc (close drawer) doesn't fire.
  document.addEventListener('keydown', e => {
    if (!pop || !(pop.el.contains(e.target) || e.target === pop.input)) return;
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close(e.key === 'Enter');
    }
  }, true);
  // click outside closes (and keeps the colour)
  document.addEventListener('pointerdown', e => {
    if (pop && !pop.el.contains(e.target) && e.target !== pop.input) close(true);
  }, true);
  addEventListener('resize', () => close(true));
  document.addEventListener('scroll', e => { if (pop && !pop.el.contains(e.target)) close(true); }, true);
}
