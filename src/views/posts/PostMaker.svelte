<script>
  // Posts → make a "repetitive" post (Awguri, Kondoljanzi…) from a template:
  // drop in a portrait, move/zoom it behind the overlay, type the name, export
  // or send to Skeda. The projects/batch panel is WorkPanel.svelte; it drives
  // this screen through the `maker` callbacks below.
  import { onMount, flushSync, tick } from 'svelte';
  import {
    MAX_ZOOM, normalizeZone, normalizeTemplate, fileSlug,
    initialPhoto, clampPhoto, panPhoto, zoomPhotoAt, resolutionLevel,
  } from '../../postmaker/model.js';
  import { drawPost, loadFonts } from '../../postmaker/render.js';
  import { ensureFonts } from '../../subtitles/preview.js';
  import { invoke, saveDialog, openDialog, fileSrc, baseName } from '../../lib/tauri.js';
  import { toast, confirm, ls } from '../../lib/app.svelte.js';
  import { PM as S } from '../../strings.js';
  import TemplateEditor from './TemplateEditor.svelte';
  import WorkPanel from './WorkPanel.svelte';

  /** sendToComposer(file, caption, eventId) → false if the user stayed. ontoast(message, type) logs exports. */
  let { sendToComposer, ontoast = toast } = $props();

  const LAST_TEMPLATE_KEY = 'banditur_pm_template';
  const loadImage = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('image failed to load')); i.src = src; });

  let templates = $state.raw([]);
  let current = $state.raw(null);         // the selected template
  const overlays = new Map();             // template id → overlay image
  let overlayTick = $state(0);            // bumps when an overlay finishes loading
  let photo = $state.raw(null);           // { bitmap, w, h, path, name, state }
  let texts = $state({});                 // zone id → typed text
  let hideOverlay = $state(false);
  let editing = $state.raw(undefined);    // undefined = make screen; null = new template; else template
  let report = $state.raw({});            // drawPost's fit report per zone
  let dropping = $state(false);
  let dragging = $state(false);
  let loaded = false;

  let root = $state(), stage = $state(), canvas = $state(), fileInput = $state();
  let panel = $state();          // WorkPanel: projects, packs, batch
  let busy = $state(false);      // a batch is being reviewed or produced

  const W = $derived(current?.width || 1080);
  const H = $derived(current?.height || 1350);

  // ── Drawing ────────────────────────────────────────────────────────────────
  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!current) { ctx.clearRect(0, 0, W, H); report = {}; return; }
    overlayTick;
    report = drawPost(ctx, {
      photo, overlay: overlays.get(current.id) || null, template: current, texts: $state.snapshot(texts),
      showOverlay: !hideOverlay, ghost: true, guides: true,
    });
  }
  $effect(draw);

  const level = $derived(photo ? resolutionLevel(photo.w, photo.h, photo.state, W, H) : 'ok');
  const tooLong = $derived(current ? current.zones.filter(z => (texts[z.id] || '').trim() && report[z.id] && !report[z.id].fits) : []);
  const reason = $derived(
    !current ? '' : !photo ? S.needPhoto : !(texts[current.zones[0].id] || '').trim() ? S.needText(current.zones[0].label) : '',
  );

  // ── Templates ──────────────────────────────────────────────────────────────
  function setCurrent(tpl) {
    current = tpl;
    if (photo) photo = { ...photo, state: clampPhoto(photo.w, photo.h, photo.state, tpl?.width || 1080, tpl?.height || 1350) };
  }

  async function reload(selectId) {
    try {
      templates = (await invoke('list_post_templates')).map(normalizeTemplate).filter(Boolean);
    } catch (err) {
      templates = [];
      toast(`${S.loadFail} (${err})`, 'error');
    }
    loaded = true;
    const want = selectId || current?.id || ls.get(LAST_TEMPLATE_KEY);
    await select(templates.find(t => t.id === want) || templates[0] || null);
  }

  async function overlayFor(tpl) {
    if (!tpl) return null;
    if (overlays.has(tpl.id)) return overlays.get(tpl.id);
    try {
      const img = await loadImage(await invoke('get_post_template_overlay', { id: tpl.id }));
      overlays.set(tpl.id, img);
      overlayTick++;
      return img;
    } catch (err) {
      toast(`${S.overlayLoadFail} (${err})`, 'error');
      return null;
    }
  }

  async function select(tpl) {
    setCurrent(tpl);
    texts = {};
    if (tpl) ls.set(LAST_TEMPLATE_KEY, tpl.id);
    if (tpl) await Promise.all([overlayFor(tpl), loadFonts(tpl.zones.map(z => z.font))]);
    overlayTick++;
  }

  async function removeTemplate() {
    if (!current || !await confirm(S.deleteConfirm(current.name), { yes: S.remove, no: S.keep, danger: true })) return;
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
  }

  async function closeEditor(savedId) {
    editing = undefined;
    if (savedId) { overlays.delete(savedId); await reload(savedId); }
  }

  // ── Photo: load, pan, zoom ─────────────────────────────────────────────────
  async function loadPhoto(file) {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      photo = { bitmap, w: bitmap.width, h: bitmap.height, path: file.sourcePath || '', name: file.name || 'Ritratt', state: initialPhoto(W, H) };
      await tick();
      stage?.focus();
      panel?.autosave();
    } catch {
      photo = null;
      toast(S.badImage, 'warn');
    }
  }
  async function pickPhoto() {
    try {
      const path = await openDialog({ filters: [{ name: 'Ritratti', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
      if (!path) return;
      const blob = await (await fetch(fileSrc(path))).blob();
      const file = new File([blob], baseName(path));
      file.sourcePath = path;
      await loadPhoto(file);
    } catch (e) {
      toast(String(e), 'error');
    }
  }

  const setState = st => { photo = { ...photo, state: st }; };
  const pan = (dx, dy) => setState(panPhoto(photo.w, photo.h, photo.state, dx, dy, W, H));
  const zoomTo = (z, fx = W / 2, fy = H / 2) => setState(zoomPhotoAt(photo.w, photo.h, photo.state, z, fx, fy, W, H));
  const toFrame = e => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height, k: W / r.width };
  };

  let drag = null;
  function down(e) {
    if (!photo || e.button !== 0) return;
    stage.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    dragging = true;
  }
  function move(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const k = toFrame(e).k;
    pan((e.clientX - drag.x) * k, (e.clientY - drag.y) * k);
    drag.x = e.clientX; drag.y = e.clientY;
  }
  const up = e => { if (drag && drag.id === e.pointerId) { drag = null; dragging = false; } };
  function wheel(e) {
    if (!photo) return;
    e.preventDefault();
    const f = toFrame(e);
    const rate = e.ctrlKey ? 0.01 : 0.0015;   // pinch gestures arrive as ctrl+wheel
    zoomTo(photo.state.zoom * Math.exp(-e.deltaY * rate), f.x, f.y);
  }
  // Arrows pan (Shift = faster), +/− zoom, 0 resets; hold H to see the photo alone.
  function keydown(e) {
    if (!photo) return;
    const step = e.shiftKey ? 24 : 4;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key]) { e.preventDefault(); pan(...arrows[e.key]); }
    else if (e.key === '+' || e.key === '=') zoomTo(photo.state.zoom * 1.05);
    else if (e.key === '-') zoomTo(photo.state.zoom / 1.05);
    else if (e.key === '0') setState(initialPhoto(W, H));
    else if ((e.key === 'h' || e.key === 'H') && !e.repeat) hideOverlay = true;
  }
  function keyup(e) { if ((e.key === 'h' || e.key === 'H') && hideOverlay) hideOverlay = false; }
  function drop(e) {
    e.preventDefault();
    dropping = false;
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
    if (f) loadPhoto(f); else toast(S.badImage, 'warn');
  }

  // ── Export and hand-off ────────────────────────────────────────────────────
  async function renderBlob() {
    await loadFonts(current.zones.map(z => z.font));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    drawPost(c.getContext('2d'), {
      photo, overlay: overlays.get(current.id) || null, template: current, texts: $state.snapshot(texts), showOverlay: true, ghost: false,
    });
    return new Promise((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error('toBlob failed'))), 'image/jpeg', 0.93));
  }
  const baseFileName = () => `${fileSlug(current.name) || 'post'}-${fileSlug(texts[current.zones[0].id]) || 'isem'}`;

  async function exportImage() {
    if (reason) return;
    try {
      const blob = await renderBlob();
      let path = await saveDialog({ defaultPath: `${baseFileName()}.jpg`, filters: [{ name: 'JPG', extensions: ['jpg'] }] });
      if (!path) return;
      if (!/\.jpe?g$/i.test(path)) path += '.jpg';
      await invoke('save_post_image', new Uint8Array(await blob.arrayBuffer()), { headers: { path: encodeURIComponent(path) } });
      await panel.complete();
      ontoast(S.exported(baseName(path)), 'ok');
    } catch (err) {
      toast(`${S.exportFail} (${err})`, 'error');
    }
  }
  async function useInPost() {
    if (reason) return;
    try {
      const blob = await renderBlob();
      const sent = await sendToComposer(new File([blob], `${baseFileName()}.jpg`, { type: 'image/jpeg' }), panel.caption(), panel.eventId());
      if (sent === false) return;
      await panel.complete();
      toast(S.sentToPost, 'ok');
    } catch (err) {
      toast(`${S.exportFail} (${err})`, 'error');
    }
  }

  // ── What the projects / batch panel may do with this screen ────────────────
  const maker = {
    state: () => ({ current, photo, texts: $state.snapshot(texts), templates, frameW: W, frameH: H }),
    loadPhoto, renderBlob, reload, overlayFor,
    newProject: () => { photo = null; texts = {}; },
    restore: async p => {
      photo = null;
      const tpl = normalizeTemplate(p.data.template);
      if (!tpl) throw new Error('Template mhux valida.');
      if (p.data.overlay) overlays.set(tpl.id, await loadImage(p.data.overlay));
      await select(tpl);
      texts = p.data.texts || {};
      if (p.mediaPath) {
        const file = await (await fetch(fileSrc(p.mediaPath))).blob();
        file.sourcePath = p.mediaPath;
        await loadPhoto(file);
      } else if (p.data.photo) await loadPhoto(await (await fetch(p.data.photo)).blob());
      if (photo && p.data.placement) setState(clampPhoto(photo.w, photo.h, p.data.placement, W, H));
    },
    setFormat: height => {
      if (!current) return;
      const old = current.height || 1350;
      setCurrent({ ...current, width: 1080, height, zones: current.zones.map(z => normalizeZone({ ...z, y: z.y * height / old, h: z.h * height / old }, 0, 1080, height)) });
    },
    setBatch: async (file, name, placement) => {
      await loadPhoto(file);
      texts = Object.fromEntries(current.zones.map((z, i) => [z.id, i ? '' : name]));
      if (placement && photo) setState(clampPhoto(photo.w, photo.h, placement, W, H));
      flushSync();   // draw now, so the fit report is for this row
      return report;
    },
  };

  onMount(ensureFonts);

  /** Called each time the Posts tab is shown. */
  export async function show() {
    if (!loaded) { await reload(); await panel.resume(); }
    else { await panel.refreshBrand(); draw(); }
  }
  /** Open a saved Posts project (from Home). */
  export const open = p => panel.open(p);
</script>

<!-- Any typing on this screen (names, panel fields) autosaves the project, as before. -->
<div class="pm" bind:this={root} oninput={() => panel?.autosave()}>
  <div class="pm-make" hidden={editing !== undefined}>
    <div class="pm-stage-col">
      <div class="pm-tplbar" role="tablist" aria-label={S.templates}>
        {#each templates as t (t.id)}
          <button class="pm-chip" type="button" role="tab" aria-selected={t.id === current?.id} disabled={busy} onclick={() => select(t)}>{t.name}</button>
        {/each}
        <button class="pm-chip pm-chip-new" type="button" disabled={busy} onclick={() => (editing = null)}>{S.newTemplate}</button>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="pm-stage" id="pm-stage" tabindex="0" role="application" aria-label={S.stageLabel}
           class:pm-stage-none={!current} class:is-dragging={dragging} bind:this={stage} inert={busy}
           onpointerdown={down} onpointermove={move} onpointerup={e => { up(e); panel?.placementChanged(); }} onpointercancel={up}
           onwheel={e => { wheel(e); panel?.autosave(); }}
           onkeydown={keydown} onkeyup={keyup}
           ondragover={e => { e.preventDefault(); dropping = true; }} ondragleave={() => (dropping = false)} ondrop={drop}>
        <canvas bind:this={canvas} width={W} height={H} style:aspect-ratio="{W}/{H}"></canvas>
        <div class="pm-drop" hidden={!dropping}>{S.dropHint}</div>
      </div>
    </div>
    <aside class="pm-side">
      {#if !current}
        <div class="form-card pm-empty">
          <div class="pm-empty-title">{S.emptyTitle}</div>
          <p>{S.emptyBody}</p>
          <button class="btn-primary" type="button" disabled={busy} onclick={() => (editing = null)}>{S.newTemplate}</button>
        </div>
      {:else}
        <div id="pm-controls">
        <div class="form-card pm-card">
          <div class="pm-card-title">{S.photo}</div>
          <div class="pm-row">
            <button class="btn-secondary btn-sm" type="button" disabled={busy} onclick={pickPhoto}>{photo ? S.changePhoto : S.pickPhoto}</button>
            <span class="pm-filename truncate">{photo?.name || ''}</span>
          </div>
          <div class="pm-row">
            <label class="form-label" for="pm-zoom">{S.zoom}</label>
            <input type="range" id="pm-zoom" min="100" max={MAX_ZOOM * 100} step="1" disabled={!photo || busy}
                   value={Math.round((photo?.state.zoom || 1) * 100)} oninput={e => photo && zoomTo(Number(e.currentTarget.value) / 100)} />
            <span class="pm-zoomval tnum">{Math.round((photo?.state.zoom || 1) * 100)}%</span>
          </div>
          <div class="pm-row">
            <button class="btn-secondary btn-sm" type="button" disabled={!photo || busy} onclick={() => setState(initialPhoto(W, H))}>{S.reset}</button>
            <button class="btn-secondary btn-sm" type="button" id="pm-hide" disabled={busy} aria-pressed={hideOverlay} onclick={() => (hideOverlay = !hideOverlay)}>{S.hideOverlay}</button>
          </div>
          <p class="pm-hint">{S.photoHint}</p>
          {#if level !== 'ok'}<div class="pm-warn" data-level={level}>{level === 'bad' ? S.lowResBad : S.lowResSoft}</div>{/if}
        </div>
        <div class="form-card pm-card">
          <div class="pm-card-title">{S.text}</div>
          <div id="pm-fields">
          {#each current.zones as z, i (z.id)}
            <div class="pm-field">
              <label class="form-label" for="pm-text-{i}">{z.label}{#if i}{' '}<span class="pm-opt">({S.optional})</span>{/if}</label>
              <input type="text" class="form-input" id="pm-text-{i}" autocomplete="off" disabled={busy} placeholder={z.sample || z.label} bind:value={texts[z.id]} />
            </div>
          {/each}
          </div>
          {#if tooLong.length}<div class="pm-warn">{tooLong.map(z => S.tooLong(z.label)).join(' ')}</div>{/if}
        </div>
        <div class="pm-actions">
          <button class="btn-primary" type="button" disabled={!!reason || busy} onclick={exportImage}>{S.exportBtn}</button>
          <button class="btn-secondary" type="button" disabled={!!reason || busy} onclick={useInPost}>{S.useInPost}</button>
        </div>
        <div class="pm-reason" role="status">{reason}</div>
        <div class="pm-tplactions">
          <button class="btn-link" type="button" disabled={busy} onclick={() => (editing = current)}>{S.edit}</button>
          <button class="btn-link pm-danger" type="button" disabled={busy} onclick={removeTemplate}>{S.remove}</button>
        </div>
        </div>
      {/if}
      <WorkPanel bind:this={panel} bind:busy {maker} />
    </aside>
    <input type="file" id="pm-file" accept="image/*" hidden bind:this={fileInput} onchange={e => { loadPhoto(e.currentTarget.files[0]); e.currentTarget.value = ''; }} />
  </div>

  {#if editing !== undefined}
    {#await overlayFor(editing) then overlay}
      <TemplateEditor tpl={editing} overlay={editing ? overlay : null} {templates} onclose={closeEditor} />
    {/await}
  {/if}
</div>
