<script>
  // Posts → template editor: pick the overlay PNG and place / style the one or
  // two text boxes on the canvas. Same drawPost() as the make screen and export.
  import { onMount } from 'svelte';
  import { MAX_ZONES, ALIGNS, VALIGNS, CASES, newZone, normalizeZone, normalizeTemplate, makeId } from '../../postmaker/model.js';
  import { drawPost, loadFonts } from '../../postmaker/render.js';
  import { FONTS } from '../../subtitles/styles.js';
  import { invoke, openDialog, fileSrc, baseName } from '../../lib/tauri.js';
  import { toast } from '../../lib/app.svelte.js';
  import { PM as S } from '../../strings.js';

  /** tpl: the template to edit, or null for a new one. onclose(savedId?) */
  let { tpl, overlay = null, templates, onclose } = $props();

  const fontOptions = FONTS.filter(f => f.bundled).map(f => [f.family, f.family.replace('Montserrat', '').trim() || 'Regular']);
  const NUMBERS = [['minSize', 8, 400, 1], ['maxSize', 8, 400, 1], ['maxLines', 1, 4, 1], ['lineHeight', 0.8, 2, 0.02]];

  // svelte-ignore state_referenced_locally
  const isNew = !tpl;
  // svelte-ignore state_referenced_locally
  let draft = $state(tpl ? JSON.parse(JSON.stringify(tpl)) : { version: 1, id: '', name: '', zones: [newZone({ id: 'isem' })] });
  let sel = $state(0);
  // svelte-ignore state_referenced_locally
  let overlayImg = $state.raw(overlay);
  let overlayPath = $state(null);
  // svelte-ignore state_referenced_locally
  let overlayName = $state(tpl ? S.overlayOk : S.overlayNone);
  let canvas = $state();
  let fontsReady = $state(false);

  const W = $derived(draft.width || 1080);
  const H = $derived(draft.height || 1350);
  const zone = $derived(draft.zones[sel]);

  onMount(async () => { await loadFonts(FONTS.filter(f => f.bundled).map(f => f.family)); fontsReady = true; });

  $effect(() => {
    if (!canvas || !fontsReady) return;
    const snapshot = $state.snapshot(draft);
    drawPost(canvas.getContext('2d'), {
      photo: null, overlay: overlayImg, template: snapshot,
      texts: Object.fromEntries(snapshot.zones.map(z => [z.id, z.sample])), showOverlay: true, ghost: false,
    });
  });

  function setField(key, raw) {
    draft.zones[sel] = normalizeZone({ ...$state.snapshot(draft.zones[sel]), [key]: raw }, sel, W, H);
  }
  function addZone() {
    draft.zones.push(newZone({ id: `z${Date.now() % 100000}`, label: S.zoneDefault2, y: 960, h: 110, maxSize: 56, sample: '' }));
    sel = draft.zones.length - 1;
  }
  function removeZone() { draft.zones.splice(sel, 1); sel = 0; }

  async function pickOverlay() {
    const path = await openDialog({ multiple: false, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!path || Array.isArray(path)) return;
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = fileSrc(path); });
      if (img.naturalWidth !== W || img.naturalHeight !== H) { toast(S.overlayBadSize(img.naturalWidth, img.naturalHeight), 'warn'); return; }
      overlayPath = path;
      overlayImg = img;
      overlayName = baseName(path);
    } catch {
      toast(S.overlayBad, 'warn');
    }
  }

  async function save() {
    if (!draft.name.trim()) return toast(S.needTemplateName, 'warn');
    if (!overlayImg) return toast(S.needOverlay, 'warn');
    const d = $state.snapshot(draft);
    if (isNew) d.id = makeId(d.name, templates.map(t => t.id));
    const manifest = normalizeTemplate({ ...d, name: d.name.trim() });
    if (!manifest) return toast(S.saveFail, 'error');
    try {
      await invoke('save_post_template', { manifest, overlayPath });
      toast(S.saved, 'ok');
      onclose(manifest.id);
    } catch (err) {
      toast(`${S.saveFail} (${err})`, 'error');
    }
  }

  // Move / resize the text boxes on the canvas.
  let zdrag = null;
  function zoneDown(e, i) {
    if (e.button !== 0) return;
    sel = i;
    e.currentTarget.parentElement.setPointerCapture(e.pointerId);
    zdrag = { id: e.pointerId, i, handle: e.target.dataset.h || null, x: e.clientX, y: e.clientY };
    e.preventDefault();
  }
  function zoneMove(e) {
    if (!zdrag || zdrag.id !== e.pointerId) return;
    const r = canvas.getBoundingClientRect();
    const dx = (e.clientX - zdrag.x) * W / r.width, dy = (e.clientY - zdrag.y) * H / r.height;
    zdrag.x = e.clientX; zdrag.y = e.clientY;
    const z = { ...$state.snapshot(draft.zones[zdrag.i]) };
    const h = zdrag.handle;
    if (!h) { z.x += dx; z.y += dy; }
    else {
      if (h.includes('w')) { z.x += dx; z.w -= dx; }
      if (h.includes('e')) z.w += dx;
      if (h.includes('n')) { z.y += dy; z.h -= dy; }
      if (h.includes('s')) z.h += dy;
    }
    z.w = Math.max(40, z.w); z.h = Math.max(40, z.h);
    draft.zones[zdrag.i] = normalizeZone(z, zdrag.i, W, H);
  }
  const zoneUp = e => { if (zdrag && zdrag.id === e.pointerId) zdrag = null; };

  function keydown(e) { if (e.key === 'Escape' && !e.target.matches('select')) onclose(); }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pm-edit" onkeydown={keydown}>
  <div class="pm-stage-col">
    <div class="pm-stage pm-stage-edit">
      <canvas bind:this={canvas} width={W} height={H} style:aspect-ratio="{W}/{H}"></canvas>
      <div class="pm-zones" onpointermove={zoneMove} onpointerup={zoneUp} onpointercancel={zoneUp}>
        {#each draft.zones as z, i (z.id)}
          <div class="pm-zone" data-sel={i === sel} onpointerdown={e => zoneDown(e, i)}
               style="left:{z.x / W * 100}%;top:{z.y / H * 100}%;width:{z.w / W * 100}%;height:{z.h / H * 100}%">
            <span class="pm-zone-tag">{z.label || i + 1}</span>
            {#each ['nw', 'ne', 'sw', 'se'] as h}<i class="pm-handle pm-h-{h}" data-h={h}></i>{/each}
          </div>
        {/each}
      </div>
    </div>
    <p class="pm-hint">{S.zoneHint}</p>
  </div>

  <aside class="pm-side">
    <div class="form-card pm-card">
      <div class="pm-card-title">{isNew ? S.newTemplateTitle : S.editTemplateTitle}</div>
      <div class="pm-field"><label class="form-label" for="pm-t-name">{S.templateName}</label>
        <input class="form-input" id="pm-t-name" type="text" maxlength="60" bind:value={draft.name} placeholder="Awguri" autocomplete="off" /></div>
      <div class="pm-field"><span class="form-label">{S.overlayFile}</span>
        <div class="pm-row"><button class="btn-secondary btn-sm" type="button" onclick={pickOverlay}>{S.pickOverlay}</button>
          <span class="pm-filename truncate">{overlayName}</span></div></div>
    </div>

    <div class="form-card pm-card">
      <div class="pm-card-title">{S.zones}</div>
      <div class="pm-tplbar" role="tablist">
        {#each draft.zones as z, i (z.id)}
          <button type="button" class="pm-chip" role="tab" aria-selected={i === sel} onclick={() => (sel = i)}>{z.label || i + 1}</button>
        {/each}
        {#if draft.zones.length < MAX_ZONES}<button type="button" class="pm-chip pm-chip-new" onclick={addZone}>{S.addZone}</button>{/if}
      </div>
      {#key sel}
        <div class="pm-field"><label class="form-label" for="pm-z-label">{S.zoneLabel}</label>
          <input class="form-input" id="pm-z-label" type="text" maxlength="40" value={zone.label} oninput={e => setField('label', e.currentTarget.value)} /></div>
        <div class="pm-field"><label class="form-label" for="pm-z-sample">{S.sample}</label>
          <input class="form-input" id="pm-z-sample" type="text" maxlength="80" value={zone.sample} oninput={e => setField('sample', e.currentTarget.value)} /></div>
        <div class="pm-grid2">
          <div class="pm-field"><label class="form-label" for="pm-z-font">{S.font}</label>
            <select class="form-input" id="pm-z-font" value={zone.font} onchange={e => setField('font', e.currentTarget.value)}>
              {#each fontOptions as [v, l]}<option value={v}>{l}</option>{/each}
            </select></div>
          <div class="pm-field"><label class="form-label" for="pm-z-color">{S.color}</label>
            <input class="form-input pm-color" id="pm-z-color" type="color" value={zone.color} oninput={e => setField('color', e.currentTarget.value)} /></div>
          <div class="pm-field"><label class="form-label" for="pm-z-align">{S.align}</label>
            <select class="form-input" id="pm-z-align" value={zone.align} onchange={e => setField('align', e.currentTarget.value)}>
              {#each ALIGNS as a}<option value={a}>{S.aligns[a]}</option>{/each}
            </select></div>
          <div class="pm-field"><label class="form-label" for="pm-z-valign">{S.valign}</label>
            <select class="form-input" id="pm-z-valign" value={zone.valign} onchange={e => setField('valign', e.currentTarget.value)}>
              {#each VALIGNS as a}<option value={a}>{S.valigns[a]}</option>{/each}
            </select></div>
          <div class="pm-field"><label class="form-label" for="pm-z-case">{S.letters}</label>
            <select class="form-input" id="pm-z-case" value={zone.case} onchange={e => setField('case', e.currentTarget.value)}>
              {#each CASES as a}<option value={a}>{S.cases[a]}</option>{/each}
            </select></div>
          {#each NUMBERS as [key, min, max, step]}
            <!-- Numbers apply when committed (Enter, blur, spinner), so typing isn't clamped mid-way. -->
            <div class="pm-field"><label class="form-label" for="pm-z-{key}">{S[key]}</label>
              <input class="form-input" type="number" id="pm-z-{key}" {min} {max} {step} value={zone[key]} onchange={e => setField(key, e.currentTarget.value)} /></div>
          {/each}
        </div>
        <label class="pm-check"><input type="checkbox" checked={zone.shadow} onchange={e => setField('shadow', e.currentTarget.checked)} /> {S.shadow}</label>
        <div class="pm-card-sub">{S.box}</div>
        <div class="pm-grid4">
          {#each ['x', 'y', 'w', 'h'] as k}
            <div class="pm-field"><label class="form-label" for="pm-z-{k}">{k}</label>
              <input class="form-input" type="number" id="pm-z-{k}" step="1" value={Math.round(zone[k])} onchange={e => setField(k, e.currentTarget.value)} /></div>
          {/each}
        </div>
        {#if draft.zones.length > 1}<button class="btn-link pm-danger" type="button" onclick={removeZone}>{S.removeZone}</button>{/if}
      {/key}
    </div>

    <div class="pm-actions">
      <button class="btn-primary" type="button" onclick={save}>{S.saveTemplate}</button>
      <button class="btn-secondary" type="button" onclick={() => onclose()}>{S.cancel}</button>
    </div>
  </aside>
</div>
