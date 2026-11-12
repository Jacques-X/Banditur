<script>
  // Posts → "Proġetti, templates u batch": durable projects (autosave, open,
  // export), branded starter templates, .btemplate packs, per-profile brand,
  // and the reviewed batch (names/CSV + photos → JPGs or Skeda drafts).
  // It drives the make screen only through the `maker` callbacks.
  import { projects, saveProject, exportProject, importProject, eventWork } from '../../lib/projects.svelte.js';
  import { app, go, toast, confirm, ls } from '../../lib/app.svelte.js';
  import { invoke, saveDialog, openDialog, fileSrc, baseName } from '../../lib/tauri.js';
  import { fileSlug, resolutionLevel } from '../../postmaker/model.js';
  import { namesFromCsv, nameLines, packJson, templatesFromPack, starterManifest, drawStarterOverlay } from '../../postmaker/production.js';
  import { post, saveDraft, reset, addMedia, keepCurrent } from '../skeda/composer.svelte.js';

  /**
   * maker: { state(), loadPhoto, renderBlob, reload, overlayFor, restore, setFormat, setBatch, newProject }
   * busy:  true while a batch is reviewed or produced (the make screen locks its controls).
   */
  let { maker, busy = $bindable(false) } = $props();

  const image = url => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
  const dataUrl = file => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
  const bytesOf = async blob => Array.from(new Uint8Array(await blob.arrayBuffer()));

  // ── Brand (per profile, this computer) ────────────────────────────────────
  const brandKey = () => `banditur_brand:${app.profileId}`;
  const brand = () => ls.json(brandKey(), {});
  let brandName = $state(brand().name || '');
  let brandColor = $state(brand().color || '#596dbb');
  let brandLogo = $state(brand().logo || '');
  let captionText = $state(brand().caption || '');

  // ── Project ────────────────────────────────────────────────────────────────
  let ownerProfile = app.profileId;
  let projectId = crypto.randomUUID();
  let projectEventId = eventWork.id;
  let projectState = 'working';
  let photoPath = '';
  let timer = 0;
  let status = $state('');
  let format = $state('1350');

  // ── Batch ──────────────────────────────────────────────────────────────────
  let names = $state('');
  let batchFiles = $state.raw([]);
  let batchRows = $state.raw([]);
  let batchNote = $state('');
  let batchTemplate = '';
  let editingBatch = -1;
  let reviewing = $state(false);
  let running = $state(false);
  let cancelled = false;
  const batchBad = $derived(batchRows.some(r => r.bad));
  $effect(() => { busy = reviewing || running; });

  async function safe(fn) {
    try { await fn(); } catch (e) { toast(e.message || String(e), 'error'); }
  }

  /** The caption for the current name ([ISEM] filled in). */
  export function caption() {
    const s = maker.state();
    return (captionText || s.current?.caption || '').replaceAll('[ISEM]', s.texts[s.current?.zones[0]?.id] || '');
  }
  export const eventId = () => projectEventId;

  async function record() {
    const s = maker.state();
    if (!s.current) return null;
    const current = structuredClone(s.current);
    const texts = structuredClone(s.texts);
    const placement = s.photo ? structuredClone(s.photo.state) : undefined;
    const id = projectId, eventId = projectEventId, recState = projectState, profileId = ownerProfile, capt = captionText;
    photoPath = s.photo ? s.photo.path || '' : photoPath;
    let photo = '';
    if (s.photo && !photoPath) {
      const c = document.createElement('canvas');
      c.width = s.photo.w; c.height = s.photo.h;
      c.getContext('2d').drawImage(s.photo.bitmap, 0, 0);
      photo = c.toDataURL('image/jpeg', 0.93);
    }
    const mediaPath = photoPath;
    const overlay = await maker.overlayFor(current);
    let overlayData = '';
    if (overlay) {
      const c = document.createElement('canvas');
      c.width = current.width || 1080; c.height = current.height || 1350;
      c.getContext('2d').drawImage(overlay, 0, 0, c.width, c.height);
      overlayData = c.toDataURL('image/png');
    }
    return {
      id, version: 1, kind: 'post', status: recState, name: texts[current.zones[0].id] || current.name, mediaPath, eventId,
      data: { template: current, texts, placement, photo, overlay: overlayData, caption: capt, profileId },
    };
  }
  async function save() {
    const p = await record();
    if (p) await saveProject(p);
    status = 'Il-proġett ġie ssejvjat.';
    return p;
  }

  /** Something changed on the make screen: save the project shortly. */
  export function autosave() {
    projectState = 'working';
    clearTimeout(timer);
    status = 'Qed jinżamm…';
    timer = setTimeout(() => save().catch(e => { status = `Ma ġiex issejvjat: ${e.message}`; }), 700);
  }
  /** The photo was moved or zoomed: remember it for the batch row being edited, then autosave. */
  export function placementChanged() {
    const s = maker.state();
    if (editingBatch >= 0 && batchRows[editingBatch] && s.photo) batchRows[editingBatch].placement = structuredClone(s.photo.state);
    autosave();
  }

  /** Open a saved Posts project. */
  export async function open(p) {
    if (!p || p.kind !== 'post') throw new Error('Agħżel proġett ta’ Posts.');
    clearTimeout(timer);
    if (maker.state().current && projectId !== p.id) await save();
    projectId = p.id;
    projectEventId = p.eventId || '';
    projectState = p.status || 'working';
    photoPath = p.mediaPath || '';
    await maker.restore(p);
    captionText = p.data.caption || '';
  }
  /** The post was exported or sent to Skeda. */
  export async function complete() { projectState = 'exported'; await save(); }
  /** The profile changed: keep the old project, start a new one with this profile's brand. */
  export async function refreshBrand() {
    if (ownerProfile === app.profileId) return;
    clearTimeout(timer);
    await save();
    ownerProfile = app.profileId;
    projectId = crypto.randomUUID();
    projectEventId = eventWork.id;
    brandName = brand().name || '';
    brandColor = brand().color || '#596dbb';
    captionText = brand().caption || '';
    brandLogo = brand().logo || '';
  }
  /** First visit: reopen this profile's latest Posts project. */
  export async function resume() {
    const p = projects.items.find(p => p.kind === 'post' && p.data?.profileId === app.profileId);
    if (p) await open(p);
  }

  const newProject = () => safe(async () => {
    clearTimeout(timer);
    await save();
    projectId = crypto.randomUUID();
    projectEventId = eventWork.id;
    projectState = 'working';
    photoPath = '';
    invalidateBatch();
    maker.newProject();
    autosave();
  });
  const exportProj = media => safe(async () => { const p = await save(); if (p) await exportProject(p, media); });
  const openProj = () => safe(async () => open(await importProject()));
  function changeFormat() { maker.setFormat(Number(format)); invalidateBatch(); autosave(); }

  // ── Brand and templates ───────────────────────────────────────────────────
  const pickLogo = () => safe(async () => {
    const path = await openDialog({ filters: [{ name: 'Logo', extensions: ['png'] }] });
    if (path) brandLogo = await dataUrl(await (await fetch(fileSrc(path))).blob());
  });
  function saveBrand() {
    ls.set(brandKey(), JSON.stringify({ name: brandName, color: brandColor, logo: brandLogo, caption: captionText }));
    toast('Il-brand ġie miżmum għal dan il-profil.', 'ok');
  }
  const addStarter = () => safe(async () => {
    const height = Number(format);
    const c = document.createElement('canvas');
    c.width = 1080; c.height = height;
    drawStarterOverlay(c.getContext('2d'), { height, color: brandColor, name: brandName, logo: brandLogo ? await image(brandLogo) : null });
    const manifest = starterManifest({ height, caption: captionText, takenIds: maker.state().templates.map(t => t.id) });
    await invoke('save_post_template', { manifest, overlayBytes: await bytesOf(await new Promise(ok => c.toBlob(ok, 'image/png'))) });
    await maker.reload(manifest.id);
  });
  const exportPack = () => safe(async () => {
    const templates = [];
    for (const t of maker.state().templates) templates.push({ manifest: t, overlay: await invoke('get_post_template_overlay', { id: t.id }) });
    const path = await saveDialog({ defaultPath: 'Templates.btemplate', filters: [{ name: 'Banditur templates', extensions: ['btemplate'] }] });
    if (path) await invoke('save_work_text', { path, content: packJson(templates) });
  });
  const importPack = () => safe(async () => {
    const path = await openDialog({ filters: [{ name: 'Banditur templates', extensions: ['btemplate'] }] });
    if (!path) return;
    const pack = JSON.parse(await invoke('read_work_text', { path }));
    const templates = templatesFromPack(pack, maker.state().templates.map(t => t.id));
    if (!await confirm(`Timporta ${templates.length} templates? Identifikaturi eżistenti jingħataw isem ġdid.`, { yes: 'Importa', no: 'Ikkanċella' })) return;
    await invoke('import_post_templates', { templates });
    await maker.reload();
  });

  // ── Batch ──────────────────────────────────────────────────────────────────
  function invalidateBatch() {
    batchRows = [];
    editingBatch = -1;
    batchNote = 'Ivverifika mill-ġdid wara l-bidliet.';
  }
  const pickBatch = () => safe(async () => {
    const paths = await openDialog({ multiple: true, filters: [{ name: 'Ritratti', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
    if (!paths) return;
    invalidateBatch();
    batchFiles = await Promise.all((Array.isArray(paths) ? paths : [paths]).map(async p =>
      new File([await (await fetch(fileSrc(p))).blob()], baseName(p), { type: 'image/jpeg' })));
    batchNote = `${batchFiles.length} ritratti magħżula`;
  });
  const importCsv = () => safe(async () => {
    const path = await openDialog({ filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!path) return;
    const text = await invoke('read_work_text', { path });
    invalidateBatch();
    names = namesFromCsv(text);
  });
  const review = () => safe(async () => {
    if (!maker.state().current) throw new Error('Agħżel template l-ewwel.');
    const list = nameLines(names);
    if (list.length !== batchFiles.length || !list.length) throw new Error('Agħżel ritratt wieħed għal kull isem, fl-istess ordni.');
    batchRows = [];
    editingBatch = -1;
    batchTemplate = JSON.stringify(maker.state().current);
    reviewing = true;
    try {
      const rows = [];
      for (let i = 0; i < list.length; i++) {
        const report = await maker.setBatch(batchFiles[i], list[i]);
        const s = maker.state();
        rows.push({
          name: list[i], file: batchFiles[i], placement: structuredClone(s.photo.state),
          preview: await dataUrl(await maker.renderBlob()),
          bad: Object.values(report).some(r => !r.fits),
          soft: resolutionLevel(s.photo.w, s.photo.h, s.photo.state, s.frameW, s.frameH) !== 'ok',
        });
      }
      batchRows = rows;
    } catch (e) {
      invalidateBatch();
      throw e;
    } finally {
      reviewing = false;
    }
  });
  const editRow = index => safe(async () => {
    editingBatch = -1;
    const r = batchRows[index];
    await maker.setBatch(r.file, r.name, r.placement);
    editingBatch = index;
  });
  const runBatch = drafts => safe(async () => {
    if (running || !batchRows.length) return;
    if (JSON.stringify(maker.state().current) !== batchTemplate) {
      invalidateBatch();
      throw new Error('It-template inbidlet. Ivverifika l-batch mill-ġdid.');
    }
    editingBatch = -1;
    const folder = drafts ? null : await openDialog({ directory: true });
    if (!drafts && !folder) return;
    if (drafts && !(await keepCurrent())) return;
    running = true;
    cancelled = false;
    try {
      let count = 0;
      for (const row of batchRows) {
        if (cancelled) break;
        await maker.setBatch(row.file, row.name, row.placement);
        const blob = await maker.renderBlob();
        if (drafts) {
          reset();
          post.caption = caption();
          post.eventId = projectEventId;
          addMedia([new File([blob], `${fileSlug(row.name)}.jpg`, { type: 'image/jpeg' })]);
          await saveDraft();
        } else {
          const path = `${folder}/${String(count + 1).padStart(3, '0')}-${fileSlug(row.name)}-${Date.now()}.jpg`;
          await invoke('save_post_image', new Uint8Array(await blob.arrayBuffer()), { headers: { path: encodeURIComponent(path) } });
        }
        count++;
        status = `${count} minn ${batchRows.length} lesti`;
      }
      if (drafts) { reset(); go('skeda'); }
      toast(`${count} lesti${cancelled ? ' · ikkanċellat' : ''}.`, 'ok');
    } finally {
      running = false;
    }
  });
</script>

<details class="form-card pm-card">
  <summary>Proġetti, templates u batch</summary>
  <div class="pm-field"><label class="form-label" for="pm-work-format">Daqs</label>
    <select id="pm-work-format" class="form-input" disabled={busy} bind:value={format} onchange={changeFormat}>
      <option value="1350">Portrait · 4:5</option><option value="1080">Square · 1:1</option><option value="1920">Story · 9:16</option>
    </select></div>
  <div class="pm-row">
    <button class="btn sm" type="button" disabled={busy} onclick={newProject}>Proġett ġdid</button>
    <button class="btn sm" type="button" disabled={busy} onclick={() => exportProj(false)}>Save project…</button>
    <button class="btn sm" type="button" disabled={busy} onclick={() => exportProj(true)}>Bil-media…</button>
    <button class="btn sm" type="button" disabled={busy} onclick={openProj}>Iftaħ…</button>
  </div>
  <div class="pm-field"><label class="form-label" for="pm-work-caption">Caption · [ISEM]</label>
    <textarea id="pm-work-caption" class="form-input" placeholder="Awguri [ISEM]…" disabled={busy} bind:value={captionText}></textarea></div>
  <div class="pm-row">
    <button class="btn sm" type="button" disabled={busy} onclick={addStarter}>Żid template tal-bidu</button>
    <button class="btn sm" type="button" disabled={busy} onclick={exportPack}>Esporta templates…</button>
    <button class="btn sm" type="button" disabled={busy} onclick={importPack}>Importa templates…</button>
  </div>
  <div class="pm-field"><label class="form-label" for="pm-work-brand">Brand ta’ dan il-profil</label><input id="pm-work-brand" class="form-input" placeholder="Isem" disabled={busy} bind:value={brandName} /><input type="color" aria-label="Kulur tal-brand" disabled={busy} bind:value={brandColor} /><button class="btn sm" type="button" disabled={busy} onclick={pickLogo}>Agħżel logo…</button><button class="btn sm" type="button" disabled={busy} onclick={saveBrand}>Żomm il-brand</button></div>
  <div class="pm-field"><label class="form-label" for="pm-work-names">Batch · isem wieħed kull linja, fl-ordni tar-ritratti</label><textarea id="pm-work-names" class="form-input" disabled={busy} bind:value={names} oninput={invalidateBatch}></textarea><div class="pm-row"><button class="btn sm" type="button" disabled={busy} onclick={pickBatch}>Agħżel ritratti…</button><button class="btn sm" type="button" disabled={busy} onclick={importCsv}>Importa CSV…</button><button class="btn sm" type="button" disabled={busy} onclick={review}>Ivverifika</button></div><div role="status">
      {#if batchRows.length}
        {#each batchRows as r, i}
          <div class="pm-batch-item"><img src={r.preview} alt="Preview" /><button class="btn sm" type="button" disabled={busy} onclick={() => editRow(i)}>{i + 1}. {r.name} · {r.file.name}{r.bad ? ' · IT-TEST MA JIDĦOLX' : r.soft ? ' · Riżoluzzjoni baxxa' : ' · ✓'}</button></div>
        {/each}
      {:else}{batchNote}{/if}
    </div><div class="pm-row"><button class="btn sm" type="button" disabled={busy || !batchRows.length || batchBad} onclick={() => runBatch(false)}>Esporta l-batch…</button><button class="btn sm" type="button" disabled={busy || !batchRows.length || batchBad} onclick={() => runBatch(true)}>Oħloq drafts</button><button class="btn sm" type="button" hidden={!running} onclick={() => (cancelled = true)}>Ikkanċella</button></div></div>
  <p class="pm-hint" role="status">{status}</p>
</details>
