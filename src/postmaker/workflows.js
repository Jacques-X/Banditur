// Production tools extend the existing maker; rendering still has one drawPost path.
import { projects, saveProject, exportProject, importProject, eventWork } from '../lib/projects.svelte.js';
import { app, go } from '../lib/app.svelte.js';
import { normalizeTemplate, newZone, makeId, fileSlug, resolutionLevel } from './model.js';
import { escapeHtml as esc } from '../ui.js';
import { post, saveDraft, reset, addMedia, changed } from '../views/skeda/composer.svelte.js';
const bytesOf = async (blob) => Array.from(new Uint8Array(await blob.arrayBuffer()));
const image = (url) =>
  new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = no;
    img.src = url;
  });
const dataUrl = (file) =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = no;
    r.readAsDataURL(file);
  });

export function attachWorkflows({
  root,
  invoke,
  saveDialog,
  openDialog,
  fileSrc,
  toast,
  confirm,
  state,
  loadPhoto,
  renderBlob,
  reload,
  overlayFor,
  select,
  restore,
  setFormat,
  setBatch,
  newProject,
}) {
  let ownerProfile = app.profileId,
    projectState = 'working',
    projectEventId = eventWork.id,
    editingBatch = -1;
  let projectId = crypto.randomUUID(),
    saving = null,
    timer = 0,
    photoPath = '',
    batchFiles = [],
    batchRows = [],
    batchCancelled = false,
    batchBusy = false,
    batchTemplate = '';
  const brandKey = () => `banditur_brand:${app.profileId}`;
  const brand = () => {
    try {
      return JSON.parse(localStorage.getItem(brandKey()) || '{}');
    } catch {
      return {};
    }
  };
  const panel = document.createElement('details');
  panel.className = 'form-card pm-card';
  panel.innerHTML =
    `<summary>Proġetti, templates u batch</summary><div class="pm-field"><label class="form-label" for="pm-work-format">Daqs</label><select id="pm-work-format" class="form-input" data-format><option value="1350">Portrait · 4:5</option><option value="1080">Square · 1:1</option><option value="1920">Story · 9:16</option></select></div>
+    <div class="pm-row"><button class="btn sm" data-project-new>Proġett ġdid</button><button class="btn sm" data-project-save>Save project…</button><button class="btn sm" data-project-media>Bil-media…</button><button class="btn sm" data-project-open>Iftaħ…</button></div>
+    <div class="pm-field"><label class="form-label" for="pm-work-caption">Caption · [ISEM]</label><textarea id="pm-work-caption" class="form-input" data-caption placeholder="Awguri [ISEM]…"></textarea></div>
+    <div class="pm-row"><button class="btn sm" data-starter>Żid template tal-bidu</button><button class="btn sm" data-pack-export>Esporta templates…</button><button class="btn sm" data-pack-import>Importa templates…</button></div>
+    <div class="pm-field"><label class="form-label" for="pm-work-brand">Brand ta’ dan il-profil</label><input id="pm-work-brand" class="form-input" data-brand-name placeholder="Isem"/><input type="color" aria-label="Kulur tal-brand" data-brand-color value="#596dbb"/><button class="btn sm" data-brand-logo>Agħżel logo…</button><button class="btn sm" data-brand-save>Żomm il-brand</button></div>
+    <div class="pm-field"><label class="form-label" for="pm-work-names">Batch · isem wieħed kull linja, fl-ordni tar-ritratti</label><textarea id="pm-work-names" class="form-input" data-names></textarea><div class="pm-row"><button class="btn sm" data-batch-pick>Agħżel ritratti…</button><button class="btn sm" data-csv>Importa CSV…</button><button class="btn sm" data-batch-review>Ivverifika</button></div><div data-batch-list role="status"></div><div class="pm-row"><button class="btn sm" data-batch-export disabled>Esporta l-batch…</button><button class="btn sm" data-batch-drafts disabled>Oħloq drafts</button><button class="btn sm" data-batch-cancel hidden>Ikkanċella</button></div></div><p class="pm-hint" data-save-status role="status"></p>`.replace(
      /^\+/gm,
      '',
    );
  root.querySelector('.pm-side').append(panel);
  const $ = (s) => panel.querySelector(s);
  const safe = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      toast(e.message || String(e), 'error');
    }
  };
  let brandLogo = brand().logo || '';
  $('[data-brand-name]').value = brand().name || '';
  $('[data-brand-color]').value = brand().color || '#596dbb';
  $('[data-caption]').value = brand().caption || '';
  const caption = () => {
    const s = state();
    return ($('[data-caption]').value || s.current?.caption || '').replaceAll(
      '[ISEM]',
      s.texts[s.current?.zones[0]?.id] || '',
    );
  };
  async function record() {
    const source = state();
    if (!source.current) return null;
    const s = {
      ...source,
      current: structuredClone(source.current),
      texts: structuredClone(source.texts),
      photo: source.photo ? { ...source.photo, state: structuredClone(source.photo.state) } : null,
    };
    const id = projectId,
      eventId = projectEventId,
      status = projectState,
      profileId = ownerProfile,
      captionText = $('[data-caption]').value;
    photoPath = s.photo ? s.photo.path || '' : photoPath;
    let photo = '';
    if (s.photo && !photoPath) {
      const c = document.createElement('canvas');
      c.width = s.photo.w;
      c.height = s.photo.h;
      c.getContext('2d').drawImage(s.photo.bitmap, 0, 0);
      photo = c.toDataURL('image/jpeg', 0.93);
    }
    const mediaPath = photoPath;
    const overlay = await overlayFor(s.current);
    let overlayData = '';
    if (overlay) {
      const c = document.createElement('canvas');
      c.width = s.current.width || 1080;
      c.height = s.current.height || 1350;
      c.getContext('2d').drawImage(overlay, 0, 0, c.width, c.height);
      overlayData = c.toDataURL('image/png');
    }
    return {
      id,
      version: 1,
      kind: 'post',
      status,
      name: s.texts[s.current.zones[0].id] || s.current.name,
      mediaPath,
      eventId,
      data: {
        template: s.current,
        texts: s.texts,
        placement: s.photo?.state,
        photo,
        overlay: overlayData,
        caption: captionText,
        profileId,
      },
    };
  }
  async function save() {
    const p = await record();
    if (p) await saveProject(p);
    $('[data-save-status]').textContent = 'Il-proġett ġie ssejvjat.';
    return p;
  }
  function autosave() {
    projectState = 'working';
    if (editingBatch >= 0 && batchRows[editingBatch] && state().photo)
      batchRows[editingBatch].placement = structuredClone(state().photo.state);
    clearTimeout(timer);
    $('[data-save-status]').textContent = 'Qed jinżamm…';
    timer = setTimeout(() => {
      saving = save().catch((e) => {
        $('[data-save-status]').textContent = `Ma ġiex issejvjat: ${e.message}`;
      });
    }, 700);
  }
  root.addEventListener('input', autosave);
  root.querySelector('#pm-stage').addEventListener('pointerup', () => {
    if (editingBatch >= 0 && batchRows[editingBatch])
      batchRows[editingBatch].placement = structuredClone(state().photo.state);
    autosave();
  });
  root.querySelector('#pm-stage').addEventListener('wheel', autosave, { passive: true });
  $('[data-format]').onchange = () => {
    setFormat(Number($('[data-format]').value));
    autosave();
  };
  $('[data-project-new]').onclick = safe(async () => {
    clearTimeout(timer);
    await save();
    projectId = crypto.randomUUID();
    projectEventId = eventWork.id;
    projectState = 'working';
    photoPath = '';
    editingBatch = -1;
    invalidateBatch();
    newProject();
    autosave();
  });
  $('[data-project-save]').onclick = safe(async () => {
    const p = await save();
    if (p) await exportProject(p);
  });
  $('[data-project-media]').onclick = safe(async () => {
    const p = await save();
    if (p) await exportProject(p, true);
  });
  async function open(p) {
    if (!p || p.kind !== 'post') throw new Error('Agħżel proġett ta’ Posts.');
    clearTimeout(timer);
    if (state().current && projectId !== p.id) await save();
    projectId = p.id;
    projectEventId = p.eventId || '';
    projectState = p.status || 'working';
    photoPath = p.mediaPath || '';
    await restore(p);
    $('[data-caption]').value = p.data.caption || '';
  }
  $('[data-project-open]').onclick = safe(async () => open(await importProject()));
  $('[data-brand-logo]').onclick = safe(async () => {
    const path = await openDialog({ filters: [{ name: 'Logo', extensions: ['png'] }] });
    if (path) brandLogo = await dataUrl(await (await fetch(fileSrc(path))).blob());
  });
  $('[data-brand-save]').onclick = safe(async () => {
    localStorage.setItem(
      brandKey(),
      JSON.stringify({
        name: $('[data-brand-name]').value,
        color: $('[data-brand-color]').value,
        logo: brandLogo,
        caption: $('[data-caption]').value,
      }),
    );
    toast('Il-brand ġie miżmum għal dan il-profil.', 'ok');
  });
  $('[data-starter]').onclick = safe(async () => {
    const h = Number($('[data-format]').value),
      c = document.createElement('canvas');
    c.width = 1080;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = $('[data-brand-color]').value;
    ctx.fillRect(0, h * 0.75, 1080, h * 0.25);
    ctx.fillRect(0, 0, 1080, 90);
    ctx.fillStyle = '#fff';
    ctx.font = '36px "Montserrat Bold"';
    ctx.textAlign = 'center';
    ctx.fillText($('[data-brand-name]').value || 'Awguri', 540, 58);
    if (brandLogo) {
      const img = await image(brandLogo);
      const w = 90,
        hg = (w * img.height) / img.width;
      ctx.drawImage(img, 30, 110, w, hg);
    }
    const manifest = normalizeTemplate({
      id: makeId(
        'Awguri',
        state().templates.map((t) => t.id),
      ),
      name: 'Awguri',
      width: 1080,
      height: h,
      caption: $('[data-caption]').value || 'Awguri [ISEM]!',
      zones: [{ ...newZone(), x: 80, y: Math.round(h * 0.8), w: 920, h: Math.round(h * 0.14), maxSize: 90 }],
    });
    await invoke('save_post_template', {
      manifest,
      overlayBytes: await bytesOf(await new Promise((ok) => c.toBlob(ok, 'image/png'))),
    });
    await reload(manifest.id);
  });
  $('[data-pack-export]').onclick = safe(async () => {
    const templates = [];
    for (const t of state().templates)
      templates.push({ manifest: t, overlay: await invoke('get_post_template_overlay', { id: t.id }) });
    const path = await saveDialog({
      defaultPath: 'Templates.btemplate',
      filters: [{ name: 'Banditur templates', extensions: ['btemplate'] }],
    });
    if (path)
      await invoke('save_work_text', {
        path,
        content: JSON.stringify({ format: 'banditur-templates', version: 1, templates }),
      });
  });
  $('[data-pack-import]').onclick = safe(async () => {
    const path = await openDialog({ filters: [{ name: 'Banditur templates', extensions: ['btemplate'] }] });
    if (!path) return;
    const pack = JSON.parse(await invoke('read_work_text', { path }));
    if (
      pack.format !== 'banditur-templates' ||
      pack.version !== 1 ||
      !Array.isArray(pack.templates) ||
      pack.templates.length > 100
    )
      throw new Error('Pack mhux validu.');
    const valid = pack.templates.map((t) => {
      const manifest = normalizeTemplate(t.manifest);
      if (!manifest || !/^data:image\/png;base64,/.test(t.overlay || ''))
        throw new Error('Template jew overlay mhux valida.');
      return { manifest, overlay: t.overlay };
    });
    if (
      !(await confirm(`Timporta ${valid.length} templates? Identifikaturi eżistenti jingħataw isem ġdid.`, {
        yes: 'Importa',
        no: 'Ikkanċella',
      }))
    )
      return;
    const taken = state().templates.map((t) => t.id);
    const templates = valid.map((t) => {
      t.manifest.id = makeId(t.manifest.id, taken);
      taken.push(t.manifest.id);
      const raw = atob(t.overlay.split(',')[1]);
      if (raw.length > 40 * 1024 * 1024) throw new Error('Overlay kbir wisq.');
      return { manifest: t.manifest, overlayBytes: Array.from(raw, (c) => c.charCodeAt(0)) };
    });
    await invoke('import_post_templates', { templates });
    await reload();
  });
  function invalidateBatch() {
    batchRows = [];
    editingBatch = -1;
    $('[data-batch-list]').textContent = 'Ivverifika mill-ġdid wara l-bidliet.';
    $('[data-batch-export]').disabled = true;
    $('[data-batch-drafts]').disabled = true;
  }
  $('[data-names]').addEventListener('input', invalidateBatch);
  $('[data-format]').addEventListener('change', invalidateBatch);
  $('[data-batch-pick]').onclick = safe(async () => {
    const paths = await openDialog({
      multiple: true,
      filters: [{ name: 'Ritratti', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (!paths) return;
    invalidateBatch();
    batchFiles = await Promise.all(
      (Array.isArray(paths) ? paths : [paths]).map(
        async (p) =>
          new File([await (await fetch(fileSrc(p))).blob()], p.split(/[\\/]/).pop(), { type: 'image/jpeg' }),
      ),
    );
    $('[data-batch-list]').textContent = `${batchFiles.length} ritratti magħżula`;
  });
  $('[data-csv]').onclick = safe(async () => {
    const path = await openDialog({ filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (path) {
      const text = await invoke('read_work_text', { path });
      invalidateBatch();
      $('[data-names]').value = text
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => l.match(/^"((?:[^"]|"")*)"/)?.[1].replaceAll('""', '"') || l.split(',')[0])
        .filter((s, i) => i || !/^(isem|name)$/i.test(s))
        .join('\n');
    }
  });
  $('[data-batch-review]').onclick = safe(async () => {
    if (!state().current) throw new Error('Agħżel template l-ewwel.');
    const names = $('[data-names]')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length !== batchFiles.length || !names.length)
      throw new Error('Agħżel ritratt wieħed għal kull isem, fl-istess ordni.');
    batchRows = [];
    editingBatch = -1;
    batchTemplate = JSON.stringify(state().current);
    const disabled = [...root.querySelectorAll('button,input,select,textarea')].map((el) => [
      el,
      el.disabled,
    ]);
    for (const [el] of disabled) el.disabled = true;
    root.querySelector('#pm-stage').inert = true;
    try {
      for (let i = 0; i < names.length; i++) {
        const report = await setBatch(batchFiles[i], names[i]);
        const s = state();
        batchRows.push({
          name: names[i],
          file: batchFiles[i],
          placement: structuredClone(s.photo.state),
          preview: await dataUrl(await renderBlob()),
          bad: Object.values(report).some((r) => !r.fits),
          soft: resolutionLevel(s.photo.w, s.photo.h, s.photo.state, s.frameW, s.frameH) !== 'ok',
        });
      }
      $('[data-batch-list]').innerHTML = batchRows
        .map(
          (r, i) =>
            `<div class="pm-batch-item"><img src="${r.preview}" alt="Preview"/><button class="btn sm" type="button" data-batch-row="${i}">${i + 1}. ${esc(r.name)} · ${esc(r.file.name)}${r.bad ? ' · IT-TEST MA JIDĦOLX' : r.soft ? ' · Riżoluzzjoni baxxa' : ' · ✓'}</button></div>`,
        )
        .join('');
      panel.querySelectorAll('[data-batch-row]').forEach(
        (b) =>
          (b.onclick = safe(async () => {
            const index = Number(b.dataset.batchRow);
            editingBatch = -1;
            const r = batchRows[index];
            await setBatch(r.file, r.name, r.placement);
            editingBatch = index;
          })),
      );
    } catch (e) {
      invalidateBatch();
      throw e;
    } finally {
      for (const [el, value] of disabled) el.disabled = value;
      root.querySelector('#pm-stage').inert = false;
    }
    const bad = batchRows.some((r) => r.bad);
    $('[data-batch-export]').disabled = bad;
    $('[data-batch-drafts]').disabled = bad;
  });
  async function runBatch(drafts) {
    if (batchBusy || !batchRows.length) return;
    if (JSON.stringify(state().current) !== batchTemplate) {
      invalidateBatch();
      throw new Error('It-template inbidlet. Ivverifika l-batch mill-ġdid.');
    }
    editingBatch = -1;
    const folder = drafts ? null : await openDialog({ directory: true });
    if (!drafts && !folder) return;
    if (drafts && (post.caption.trim() || post.media.length || post.remoteMedia.length)) await saveDraft();
    const disabled = [...root.querySelectorAll('button,input,select,textarea')]
      .filter((el) => !el.hasAttribute('data-batch-cancel'))
      .map((el) => [el, el.disabled]);
    for (const [el] of disabled) el.disabled = true;
    root.querySelector('#pm-stage').inert = true;
    batchBusy = true;
    batchCancelled = false;
    $('[data-batch-cancel]').hidden = false;
    try {
      let count = 0;
      for (const row of batchRows) {
        if (batchCancelled) break;
        await setBatch(row.file, row.name, row.placement);
        const blob = await renderBlob();
        if (drafts) {
          reset();
          post.caption = caption();
          post.eventId = projectEventId;
          addMedia([new File([blob], `${fileSlug(row.name)}.jpg`, { type: 'image/jpeg' })]);
          await saveDraft();
        } else {
          const path = `${folder}/${String(count + 1).padStart(3, '0')}-${fileSlug(row.name)}-${Date.now()}.jpg`;
          await invoke('save_post_image', new Uint8Array(await blob.arrayBuffer()), {
            headers: { path: encodeURIComponent(path) },
          });
        }
        count++;
        $('[data-save-status]').textContent = `${count} minn ${batchRows.length} lesti`;
      }
      if (drafts) {
        reset();
        go('skeda');
      }
      toast(`${count} lesti${batchCancelled ? ' · ikkanċellat' : ''}.`, 'ok');
    } finally {
      for (const [el, value] of disabled) el.disabled = value;
      root.querySelector('#pm-stage').inert = false;
      batchBusy = false;
      $('[data-batch-cancel]').hidden = true;
    }
  }
  $('[data-batch-export]').onclick = safe(() => runBatch(false));
  $('[data-batch-drafts]').onclick = safe(() => runBatch(true));
  $('[data-batch-cancel]').onclick = () => (batchCancelled = true);
  return {
    get eventId() {
      return projectEventId;
    },
    caption,
    autosave,
    open,
    async complete() {
      projectState = 'exported';
      await save();
    },
    async refreshBrand() {
      if (ownerProfile === app.profileId) return;
      clearTimeout(timer);
      await save();
      ownerProfile = app.profileId;
      projectId = crypto.randomUUID();
      projectEventId = eventWork.id;
      $('[data-brand-name]').value = brand().name || '';
      $('[data-brand-color]').value = brand().color || '#596dbb';
      $('[data-caption]').value = brand().caption || '';
      brandLogo = brand().logo || '';
    },
    async resume() {
      const p = projects.items.find((p) => p.kind === 'post' && p.data?.profileId === app.profileId);
      if (p) await open(p);
    },
  };
}
