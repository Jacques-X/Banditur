// postmaker/index.js — Għodda → Posts. Make a "repetitive" post (Awguri,
// Kondoljanzi…) from a template: drop in a portrait, move/zoom it behind the
// template's overlay, type the name, export or send to Skeda. The same panel
// has the template editor (overlay PNG + where the text goes).
//
// Everything the module needs from the app comes in through createPostMaker()
// so it stays testable and main.js stays small.

import {
  FRAME_W, FRAME_H, MAX_ZOOM, MAX_ZONES, ALIGNS, VALIGNS, CASES,
  newZone, normalizeZone, normalizeTemplate, makeId, fileSlug,
  initialPhoto, clampPhoto, panPhoto, zoomPhotoAt, resolutionLevel,
} from './model.js';
import { drawPost, loadFonts } from './render.js';
import { FONTS } from '../subtitles/styles.js';
import { ensureFonts } from '../subtitles/preview.js';
import { escapeHtml } from '../ui.js';

const LAST_TEMPLATE_KEY = 'banditur_pm_template';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('image failed to load'));
  img.src = src;
});

/** One option list as <option> tags. */
const options = (items, selected) =>
  items.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');

export function createPostMaker({ root, invoke, saveDialog, openDialog, fileSrc, toast, confirm, S, sendToComposer }) {
  ensureFonts();

  // ── State ──────────────────────────────────────────────────────────────────
  let templates = [];
  let current = null;                 // the selected template
  const overlays = new Map();         // template id → loaded overlay image
  let photo = null;                   // { bitmap, w, h, name, state }
  let texts = {};                     // zone id → typed text
  let hideOverlay = false;
  let edit = null;                    // template editor state, or null
  let loaded = false;

  root.innerHTML = `
    <div class="pm">
      <div class="pm-make" id="pm-make">
        <div class="pm-stage-col">
          <div class="pm-tplbar" id="pm-tplbar" role="tablist" aria-label="${escapeHtml(S.templates)}"></div>
          <div class="pm-stage" id="pm-stage" tabindex="0" aria-label="${escapeHtml(S.stageLabel)}">
            <canvas id="pm-canvas" width="${FRAME_W}" height="${FRAME_H}"></canvas>
            <div class="pm-drop" id="pm-drop" hidden>${escapeHtml(S.dropHint)}</div>
          </div>
        </div>
        <aside class="pm-side">
          <div class="form-card pm-empty" id="pm-empty" hidden>
            <div class="pm-empty-title">${escapeHtml(S.emptyTitle)}</div>
            <p>${escapeHtml(S.emptyBody)}</p>
            <button class="btn-primary" type="button" id="pm-empty-new">${escapeHtml(S.newTemplate)}</button>
          </div>
          <div id="pm-controls">
            <div class="form-card pm-card">
              <div class="pm-card-title">${escapeHtml(S.photo)}</div>
              <div class="pm-row">
                <button class="btn-secondary btn-sm" type="button" id="pm-pick">${escapeHtml(S.pickPhoto)}</button>
                <span class="pm-filename truncate" id="pm-filename"></span>
              </div>
              <div class="pm-row">
                <label class="form-label" for="pm-zoom">${escapeHtml(S.zoom)}</label>
                <input type="range" id="pm-zoom" min="100" max="${MAX_ZOOM * 100}" value="100" step="1" disabled />
                <span class="pm-zoomval tnum" id="pm-zoomval">100%</span>
              </div>
              <div class="pm-row">
                <button class="btn-secondary btn-sm" type="button" id="pm-reset" disabled>${escapeHtml(S.reset)}</button>
                <button class="btn-secondary btn-sm" type="button" id="pm-hide" aria-pressed="false">${escapeHtml(S.hideOverlay)}</button>
              </div>
              <p class="pm-hint">${escapeHtml(S.photoHint)}</p>
              <div class="pm-warn" id="pm-photowarn" hidden></div>
            </div>
            <div class="form-card pm-card">
              <div class="pm-card-title">${escapeHtml(S.text)}</div>
              <div id="pm-fields"></div>
              <div class="pm-warn" id="pm-textwarn" hidden></div>
            </div>
            <div class="pm-actions">
              <button class="btn-primary" type="button" id="pm-export">${escapeHtml(S.exportBtn)}</button>
              <button class="btn-secondary" type="button" id="pm-use">${escapeHtml(S.useInPost)}</button>
            </div>
            <div class="pm-reason" id="pm-reason" role="status"></div>
            <div class="pm-tplactions">
              <button class="btn-link" type="button" id="pm-edit">${escapeHtml(S.edit)}</button>
              <button class="btn-link pm-danger" type="button" id="pm-delete">${escapeHtml(S.remove)}</button>
            </div>
          </div>
        </aside>
        <input type="file" id="pm-file" accept="image/*" hidden />
      </div>

      <div class="pm-edit" id="pm-edit-screen" hidden>
        <div class="pm-stage-col">
          <div class="pm-stage pm-stage-edit" id="pm-estage">
            <canvas id="pm-ecanvas" width="${FRAME_W}" height="${FRAME_H}"></canvas>
            <div class="pm-zones" id="pm-zones"></div>
          </div>
          <p class="pm-hint">${escapeHtml(S.zoneHint)}</p>
        </div>
        <aside class="pm-side" id="pm-eside"></aside>
      </div>
    </div>`;

  const $ = sel => root.querySelector(sel);
  const canvas = $('#pm-canvas'), ctx = canvas.getContext('2d');
  const ecanvas = $('#pm-ecanvas'), ectx = ecanvas.getContext('2d');

  // ── Template list ──────────────────────────────────────────────────────────
  async function reload(selectId) {
    try {
      const raw = await invoke('list_post_templates');
      templates = raw.map(normalizeTemplate).filter(Boolean);
    } catch (err) {
      templates = [];
      toast(`${S.loadFail} (${err})`, 'error');
    }
    loaded = true;
    const want = selectId || current?.id || store.get(LAST_TEMPLATE_KEY);
    await select(templates.find(t => t.id === want) || templates[0] || null);
  }

  async function overlayFor(tpl) {
    if (!tpl) return null;
    if (overlays.has(tpl.id)) return overlays.get(tpl.id);
    try {
      const url = await invoke('get_post_template_overlay', { id: tpl.id });
      const img = await loadImage(url);
      overlays.set(tpl.id, img);
      return img;
    } catch (err) {
      toast(`${S.overlayLoadFail} (${err})`, 'error');
      return null;
    }
  }

  async function select(tpl) {
    current = tpl;
    texts = {};
    if (tpl) store.set(LAST_TEMPLATE_KEY, tpl.id);
    if (tpl) await Promise.all([overlayFor(tpl), loadFonts(tpl.zones.map(z => z.font))]);
    renderTemplateBar();
    renderFields();
    renderMake();
  }

  function renderTemplateBar() {
    const bar = $('#pm-tplbar');
    bar.innerHTML = templates.map(t =>
      `<button class="pm-chip" type="button" role="tab" data-id="${escapeHtml(t.id)}" aria-selected="${t.id === current?.id}">${escapeHtml(t.name)}</button>`
    ).join('') + `<button class="pm-chip pm-chip-new" type="button" id="pm-chip-new">${escapeHtml(S.newTemplate)}</button>`;
    bar.querySelectorAll('.pm-chip[data-id]').forEach(b => b.addEventListener('click', () => select(templates.find(t => t.id === b.dataset.id))));
    bar.querySelector('#pm-chip-new').addEventListener('click', () => startEdit(null));
    const none = !current;
    $('#pm-empty').hidden = !none;
    $('#pm-controls').hidden = none;
    $('#pm-stage').classList.toggle('pm-stage-none', none);
  }

  function renderFields() {
    const box = $('#pm-fields');
    if (!current) { box.innerHTML = ''; return; }
    box.innerHTML = current.zones.map((z, i) => `
      <div class="pm-field">
        <label class="form-label" for="pm-text-${i}">${escapeHtml(z.label)}${i ? ` <span class="pm-opt">(${escapeHtml(S.optional)})</span>` : ''}</label>
        <input type="text" class="form-input" id="pm-text-${i}" data-zone="${escapeHtml(z.id)}" autocomplete="off"
               placeholder="${escapeHtml(z.sample || z.label)}" value="${escapeHtml(texts[z.id] || '')}" />
      </div>`).join('');
    box.querySelectorAll('input[data-zone]').forEach(inp => inp.addEventListener('input', () => {
      texts[inp.dataset.zone] = inp.value;
      renderMake();
    }));
  }

  // ── Drawing the make screen ────────────────────────────────────────────────
  let report = {};
  function renderMake() {
    if (!current) { ctx.clearRect(0, 0, FRAME_W, FRAME_H); updateStatus(); return; }
    report = drawPost(ctx, {
      photo, overlay: overlays.get(current.id) || null, template: current, texts,
      showOverlay: !hideOverlay, ghost: true,
    });
    updateStatus();
  }

  function updateStatus() {
    // Zoom controls
    const zoom = $('#pm-zoom');
    zoom.disabled = !photo; $('#pm-reset').disabled = !photo;
    const z = photo ? photo.state.zoom : 1;
    zoom.value = Math.round(z * 100);
    $('#pm-zoomval').textContent = `${Math.round(z * 100)}%`;
    $('#pm-filename').textContent = photo ? photo.name : '';
    $('#pm-pick').textContent = photo ? S.changePhoto : S.pickPhoto;
    $('#pm-hide').setAttribute('aria-pressed', String(hideOverlay));
    $('#pm-hide').dataset.active = String(hideOverlay);

    // Photo resolution warning
    const pw = $('#pm-photowarn');
    const level = photo ? resolutionLevel(photo.w, photo.h, photo.state) : 'ok';
    pw.hidden = level === 'ok';
    pw.dataset.level = level;
    pw.textContent = level === 'bad' ? S.lowResBad : level === 'soft' ? S.lowResSoft : '';

    // Names that do not fit
    const tw = $('#pm-textwarn');
    const bad = current ? current.zones.filter(z => (texts[z.id] || '').trim() && report[z.id] && !report[z.id].fits) : [];
    tw.hidden = !bad.length;
    tw.textContent = bad.map(z => S.tooLong(z.label)).join(' ');

    // Why the buttons are off
    let reason = '';
    if (current) {
      if (!photo) reason = S.needPhoto;
      else if (!(texts[current.zones[0].id] || '').trim()) reason = S.needText(current.zones[0].label);
    }
    $('#pm-export').disabled = !!reason;
    $('#pm-use').disabled = !!reason;
    $('#pm-reason').textContent = reason;
  }

  // ── Photo: load, pan, zoom ─────────────────────────────────────────────────
  async function loadPhoto(file) {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      photo = { bitmap, w: bitmap.width, h: bitmap.height, name: file.name, state: initialPhoto() };
      renderMake();
      $('#pm-stage').focus();
    } catch {
      toast(S.badImage, 'warn');
    }
  }
  $('#pm-pick').addEventListener('click', () => $('#pm-file').click());
  $('#pm-file').addEventListener('change', e => { loadPhoto(e.target.files[0]); e.target.value = ''; });

  const stage = $('#pm-stage');
  const toFrame = e => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * FRAME_W / r.width, y: (e.clientY - r.top) * FRAME_H / r.height, k: FRAME_W / r.width };
  };

  let drag = null;
  stage.addEventListener('pointerdown', e => {
    if (!photo || e.button !== 0) return;
    stage.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    stage.classList.add('is-dragging');
  });
  stage.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const k = toFrame(e).k;
    photo.state = panPhoto(photo.w, photo.h, photo.state, (e.clientX - drag.x) * k, (e.clientY - drag.y) * k);
    drag.x = e.clientX; drag.y = e.clientY;
    renderMake();
  });
  const endDrag = e => { if (drag && drag.id === e.pointerId) { drag = null; stage.classList.remove('is-dragging'); } };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('wheel', e => {
    if (!photo) return;
    e.preventDefault();
    const f = toFrame(e);
    const rate = e.ctrlKey ? 0.01 : 0.0015;   // pinch gestures arrive as ctrl+wheel
    photo.state = zoomPhotoAt(photo.w, photo.h, photo.state, photo.state.zoom * Math.exp(-e.deltaY * rate), f.x, f.y);
    renderMake();
  }, { passive: false });

  $('#pm-zoom').addEventListener('input', e => {
    if (!photo) return;
    photo.state = zoomPhotoAt(photo.w, photo.h, photo.state, Number(e.target.value) / 100);
    renderMake();
  });
  $('#pm-reset').addEventListener('click', () => { if (photo) { photo.state = initialPhoto(); renderMake(); } });

  // Hold H (while the stage is focused) or press the button to see the photo alone.
  $('#pm-hide').addEventListener('click', () => { hideOverlay = !hideOverlay; renderMake(); });
  stage.addEventListener('keydown', e => {
    if (!photo) return;
    const step = e.shiftKey ? 24 : 4;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key]) {
      e.preventDefault();
      photo.state = panPhoto(photo.w, photo.h, photo.state, ...arrows[e.key]);
    } else if (e.key === '+' || e.key === '=') {
      photo.state = zoomPhotoAt(photo.w, photo.h, photo.state, photo.state.zoom * 1.05);
    } else if (e.key === '-') {
      photo.state = zoomPhotoAt(photo.w, photo.h, photo.state, photo.state.zoom / 1.05);
    } else if (e.key === '0') {
      photo.state = initialPhoto();
    } else if ((e.key === 'h' || e.key === 'H') && !e.repeat) {
      hideOverlay = true;
    } else return;
    renderMake();
  });
  stage.addEventListener('keyup', e => {
    if ((e.key === 'h' || e.key === 'H') && hideOverlay) { hideOverlay = false; renderMake(); }
  });

  // Drag a photo file onto the stage.
  stage.addEventListener('dragover', e => { e.preventDefault(); $('#pm-drop').hidden = false; });
  stage.addEventListener('dragleave', () => { $('#pm-drop').hidden = true; });
  stage.addEventListener('drop', e => {
    e.preventDefault(); $('#pm-drop').hidden = true;
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
    if (f) loadPhoto(f); else toast(S.badImage, 'warn');
  });

  // ── Export and hand-off ────────────────────────────────────────────────────
  async function renderBlob() {
    await loadFonts(current.zones.map(z => z.font));
    const c = document.createElement('canvas');
    c.width = FRAME_W; c.height = FRAME_H;
    drawPost(c.getContext('2d'), {
      photo, overlay: overlays.get(current.id) || null, template: current, texts, showOverlay: true, ghost: false,
    });
    return new Promise((resolve, reject) =>
      c.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.93));
  }

  const baseFileName = () => `${fileSlug(current.name) || 'post'}-${fileSlug(texts[current.zones[0].id]) || 'isem'}`;

  async function exportImage() {
    if ($('#pm-export').disabled) return;
    try {
      const blob = await renderBlob();
      let path = await saveDialog({ defaultPath: `${baseFileName()}.jpg`, filters: [{ name: 'JPG', extensions: ['jpg'] }] });
      if (!path) return;
      if (!/\.jpe?g$/i.test(path)) path += '.jpg';
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await invoke('save_post_image', bytes, { headers: { path: encodeURIComponent(path) } });
      toast(S.exported(path.split(/[\\/]/).pop()), 'ok');
    } catch (err) {
      toast(`${S.exportFail} (${err})`, 'error');
    }
  }

  async function useInPost() {
    if ($('#pm-use').disabled) return;
    try {
      const blob = await renderBlob();
      sendToComposer(new File([blob], `${baseFileName()}.jpg`, { type: 'image/jpeg' }));
      toast(S.sentToPost, 'ok');
    } catch (err) {
      toast(`${S.exportFail} (${err})`, 'error');
    }
  }
  $('#pm-export').addEventListener('click', exportImage);
  $('#pm-use').addEventListener('click', useInPost);

  // ── Template actions ───────────────────────────────────────────────────────
  $('#pm-empty-new').addEventListener('click', () => startEdit(null));
  $('#pm-edit').addEventListener('click', () => current && startEdit(current));
  $('#pm-delete').addEventListener('click', async () => {
    if (!current) return;
    if (!await confirm(S.deleteConfirm(current.name), { yes: S.remove, no: S.keep, danger: true })) return;
    try {
      const id = current.id;
      await invoke('delete_post_template', { id });
      overlays.delete(id);
      current = null;
      toast(S.deleted, 'ok');
      await reload();
    } catch (err) {
      toast(`${S.saveFail} (${err})`, 'error');
    }
  });

  // ═══ Template editor ═════════════════════════════════════════════════════════

  const fontOptions = FONTS.filter(f => f.bundled).map(f => [f.family, f.family.replace('Montserrat', '').trim() || 'Regular']);

  async function startEdit(tpl) {
    const isNew = !tpl;
    const draft = tpl
      ? JSON.parse(JSON.stringify(tpl))
      : { version: 1, id: '', name: '', zones: [newZone({ id: 'isem' })] };
    edit = {
      draft, isNew, sel: 0, overlayPath: null,
      overlayImg: tpl ? await overlayFor(tpl) : null,
      overlayOk: !!tpl,
    };
    await loadFonts(FONTS.filter(f => f.bundled).map(f => f.family));
    $('#pm-make').hidden = true;
    $('#pm-edit-screen').hidden = false;
    renderEditSide();
    renderEdit();
  }

  function closeEdit() {
    edit = null;
    $('#pm-edit-screen').hidden = true;
    $('#pm-make').hidden = false;
    renderMake();
  }

  function renderEdit() {
    if (!edit) return;
    drawPost(ectx, {
      photo: null, overlay: edit.overlayImg, template: edit.draft,
      texts: Object.fromEntries(edit.draft.zones.map(z => [z.id, z.sample])), showOverlay: true, ghost: false,
    });
    // Boxes on top of the canvas (percentages, so they follow the canvas size).
    const holder = $('#pm-zones');
    holder.innerHTML = edit.draft.zones.map((z, i) => `
      <div class="pm-zone" data-i="${i}" data-sel="${i === edit.sel}"
           style="left:${z.x / FRAME_W * 100}%;top:${z.y / FRAME_H * 100}%;width:${z.w / FRAME_W * 100}%;height:${z.h / FRAME_H * 100}%">
        <span class="pm-zone-tag">${escapeHtml(z.label || `${i + 1}`)}</span>
        ${['nw', 'ne', 'sw', 'se'].map(h => `<i class="pm-handle pm-h-${h}" data-h="${h}"></i>`).join('')}
      </div>`).join('');
  }

  const FIELD_NUM = [
    ['minSize', 'minSize', 8, 400, 1], ['maxSize', 'maxSize', 8, 400, 1],
    ['maxLines', 'maxLines', 1, 4, 1], ['lineHeight', 'lineHeight', 0.8, 2, 0.02],
  ];

  function renderEditSide() {
    const side = $('#pm-eside');
    const d = edit.draft, z = d.zones[edit.sel];
    const zoneTabs = d.zones.map((zz, i) =>
      `<button type="button" class="pm-chip" role="tab" data-zone="${i}" aria-selected="${i === edit.sel}">${escapeHtml(zz.label || `${i + 1}`)}</button>`).join('')
      + (d.zones.length < MAX_ZONES ? `<button type="button" class="pm-chip pm-chip-new" id="pm-addzone">${escapeHtml(S.addZone)}</button>` : '');
    const numField = ([key, label, min, max, step]) => `
      <div class="pm-field"><label class="form-label" for="pm-z-${key}">${escapeHtml(S[label])}</label>
        <input class="form-input" type="number" id="pm-z-${key}" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${z[key]}" /></div>`;
    side.innerHTML = `
      <div class="form-card pm-card">
        <div class="pm-card-title">${escapeHtml(edit.isNew ? S.newTemplateTitle : S.editTemplateTitle)}</div>
        <div class="pm-field"><label class="form-label" for="pm-t-name">${escapeHtml(S.templateName)}</label>
          <input class="form-input" id="pm-t-name" type="text" maxlength="60" value="${escapeHtml(d.name)}" placeholder="Awguri" autocomplete="off" /></div>
        <div class="pm-field"><label class="form-label">${escapeHtml(S.overlayFile)}</label>
          <div class="pm-row"><button class="btn-secondary btn-sm" type="button" id="pm-t-overlay">${escapeHtml(S.pickOverlay)}</button>
            <span class="pm-filename truncate" id="pm-t-overlay-state">${escapeHtml(edit.overlayOk ? S.overlayOk : S.overlayNone)}</span></div></div>
      </div>
      <div class="form-card pm-card">
        <div class="pm-card-title">${escapeHtml(S.zones)}</div>
        <div class="pm-tplbar" role="tablist">${zoneTabs}</div>
        <div class="pm-field"><label class="form-label" for="pm-z-label">${escapeHtml(S.zoneLabel)}</label>
          <input class="form-input" id="pm-z-label" data-key="label" type="text" maxlength="40" value="${escapeHtml(z.label)}" /></div>
        <div class="pm-field"><label class="form-label" for="pm-z-sample">${escapeHtml(S.sample)}</label>
          <input class="form-input" id="pm-z-sample" data-key="sample" type="text" maxlength="80" value="${escapeHtml(z.sample)}" /></div>
        <div class="pm-grid2">
          <div class="pm-field"><label class="form-label" for="pm-z-font">${escapeHtml(S.font)}</label>
            <select class="form-input" id="pm-z-font" data-key="font">${options(fontOptions, z.font)}</select></div>
          <div class="pm-field"><label class="form-label" for="pm-z-color">${escapeHtml(S.color)}</label>
            <input class="form-input pm-color" id="pm-z-color" data-key="color" type="color" value="${z.color}" /></div>
          <div class="pm-field"><label class="form-label" for="pm-z-align">${escapeHtml(S.align)}</label>
            <select class="form-input" id="pm-z-align" data-key="align">${options(ALIGNS.map(a => [a, S.aligns[a]]), z.align)}</select></div>
          <div class="pm-field"><label class="form-label" for="pm-z-valign">${escapeHtml(S.valign)}</label>
            <select class="form-input" id="pm-z-valign" data-key="valign">${options(VALIGNS.map(a => [a, S.valigns[a]]), z.valign)}</select></div>
          <div class="pm-field"><label class="form-label" for="pm-z-case">${escapeHtml(S.letters)}</label>
            <select class="form-input" id="pm-z-case" data-key="case">${options(CASES.map(a => [a, S.cases[a]]), z.case)}</select></div>
          ${FIELD_NUM.map(numField).join('')}
        </div>
        <label class="pm-check"><input type="checkbox" id="pm-z-shadow" data-key="shadow" ${z.shadow ? 'checked' : ''} /> ${escapeHtml(S.shadow)}</label>
        <div class="pm-card-sub">${escapeHtml(S.box)}</div>
        <div class="pm-grid4">
          ${['x', 'y', 'w', 'h'].map(k => `<div class="pm-field"><label class="form-label" for="pm-z-${k}">${k}</label>
            <input class="form-input" type="number" id="pm-z-${k}" data-key="${k}" value="${z[k]}" step="1" /></div>`).join('')}
        </div>
        ${d.zones.length > 1 ? `<button class="btn-link pm-danger" type="button" id="pm-rmzone">${escapeHtml(S.removeZone)}</button>` : ''}
      </div>
      <div class="pm-actions">
        <button class="btn-primary" type="button" id="pm-t-save">${escapeHtml(S.saveTemplate)}</button>
        <button class="btn-secondary" type="button" id="pm-t-cancel">${escapeHtml(S.cancel)}</button>
      </div>`;
    wireEditSide(side);
  }

  function wireEditSide(side) {
    side.querySelectorAll('.pm-chip[data-zone]').forEach(b => b.addEventListener('click', () => { edit.sel = Number(b.dataset.zone); renderEditSide(); renderEdit(); }));
    side.querySelector('#pm-addzone')?.addEventListener('click', () => {
      edit.draft.zones.push(newZone({ id: `z${Date.now() % 100000}`, label: S.zoneDefault2, y: 960, h: 110, maxSize: 56, sample: '' }));
      edit.sel = edit.draft.zones.length - 1; renderEditSide(); renderEdit();
    });
    side.querySelector('#pm-rmzone')?.addEventListener('click', () => {
      edit.draft.zones.splice(edit.sel, 1); edit.sel = 0; renderEditSide(); renderEdit();
    });
    side.querySelector('#pm-t-name').addEventListener('input', e => { edit.draft.name = e.target.value; });

    side.querySelectorAll('[data-key]').forEach(el => {
      const apply = () => {
        const key = el.dataset.key;
        const raw = el.type === 'checkbox' ? el.checked : el.value;
        const zones = edit.draft.zones;
        zones[edit.sel] = normalizeZone({ ...zones[edit.sel], [key]: raw }, edit.sel);
        renderEdit();
      };
      el.addEventListener('input', apply);
      // Re-sync clamped numbers (e.g. maxSize raised to minSize) once typing stops.
      el.addEventListener('change', () => { apply(); syncNumbers(); });
    });

    side.querySelector('#pm-t-overlay').addEventListener('click', pickOverlay);
    side.querySelector('#pm-t-cancel').addEventListener('click', closeEdit);
    side.querySelector('#pm-t-save').addEventListener('click', saveTemplate);
  }

  function syncNumbers() {
    const z = edit.draft.zones[edit.sel];
    $('#pm-eside').querySelectorAll('input[type=number][data-key]').forEach(el => {
      if (document.activeElement !== el) el.value = z[el.dataset.key];
    });
  }

  async function pickOverlay() {
    const path = await openDialog({ multiple: false, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!path || Array.isArray(path)) return;
    try {
      const img = await loadImage(fileSrc(path));
      if (img.naturalWidth !== FRAME_W || img.naturalHeight !== FRAME_H) {
        toast(S.overlayBadSize(img.naturalWidth, img.naturalHeight), 'warn');
        return;
      }
      edit.overlayPath = path; edit.overlayImg = img; edit.overlayOk = true;
      $('#pm-t-overlay-state').textContent = path.split(/[\\/]/).pop();
      renderEdit();
    } catch {
      toast(S.overlayBad, 'warn');
    }
  }

  // Move / resize zone boxes on the canvas.
  const zonesLayer = $('#pm-zones');
  let zdrag = null;
  zonesLayer.addEventListener('pointerdown', e => {
    const box = e.target.closest('.pm-zone');
    if (!box || !edit || e.button !== 0) return;
    const i = Number(box.dataset.i);
    if (edit.sel !== i) { edit.sel = i; renderEditSide(); renderEdit(); }
    zonesLayer.setPointerCapture(e.pointerId);
    zdrag = { id: e.pointerId, i, handle: e.target.dataset.h || null, x: e.clientX, y: e.clientY };
    e.preventDefault();
  });
  zonesLayer.addEventListener('pointermove', e => {
    if (!zdrag || zdrag.id !== e.pointerId) return;
    const r = ecanvas.getBoundingClientRect();
    const dx = (e.clientX - zdrag.x) * FRAME_W / r.width, dy = (e.clientY - zdrag.y) * FRAME_H / r.height;
    zdrag.x = e.clientX; zdrag.y = e.clientY;
    const z = { ...edit.draft.zones[zdrag.i] };
    const h = zdrag.handle;
    if (!h) { z.x += dx; z.y += dy; }
    else {
      if (h.includes('w')) { z.x += dx; z.w -= dx; }
      if (h.includes('e')) { z.w += dx; }
      if (h.includes('n')) { z.y += dy; z.h -= dy; }
      if (h.includes('s')) { z.h += dy; }
    }
    z.w = Math.max(40, z.w); z.h = Math.max(40, z.h);
    edit.draft.zones[zdrag.i] = normalizeZone(z, zdrag.i);
    renderEdit(); syncNumbers();
  });
  const endZoneDrag = e => { if (zdrag && zdrag.id === e.pointerId) zdrag = null; };
  zonesLayer.addEventListener('pointerup', endZoneDrag);
  zonesLayer.addEventListener('pointercancel', endZoneDrag);

  async function saveTemplate() {
    const d = edit.draft;
    if (!d.name.trim()) return toast(S.needTemplateName, 'warn');
    if (!edit.overlayOk) return toast(S.needOverlay, 'warn');
    if (edit.isNew) d.id = makeId(d.name, templates.map(t => t.id));
    const manifest = normalizeTemplate({ ...d, name: d.name.trim() });
    if (!manifest) return toast(S.saveFail, 'error');
    try {
      await invoke('save_post_template', { manifest, overlayPath: edit.overlayPath });
      overlays.delete(manifest.id);
      toast(S.saved, 'ok');
      const id = manifest.id;
      closeEdit();
      await reload(id);
    } catch (err) {
      toast(`${S.saveFail} (${err})`, 'error');
    }
  }

  // Leave the editor with Escape.
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape' && edit && !e.target.matches('select')) { closeEdit(); }
  });

  return {
    /** Called each time the Posts tab is shown. */
    async show() { if (!loaded) await reload(); else renderMake(); },
  };
}
