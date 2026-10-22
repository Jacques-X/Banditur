<script>
  // Installed watermark packs: import / export / delete a pack, add or remove
  // single watermarks, or add many photographers in one go from their PNGs.
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { invoke, openDialog, saveDialog, fileSrc } from '../../lib/tauri.js';
  import { toast, confirm } from '../../lib/app.svelte.js';
  import { groupWatermarks, baseName as wmBaseName } from '../../wm-bulk.js';
  import { WM } from '../../strings.js';
  import { marks, refreshPacks } from './packs.svelte.js';

  let { onclose } = $props();
  let mode = $state('list');           // list | add | bulk
  let busy = $state('');
  const NEW = '__new__';

  // ── List ─────────────────────────────────────────────────────────────────
  async function exportPack(p) {
    let dest = await saveDialog({ defaultPath: `${p.name}.bwpack`, filters: [{ name: WM.file_filter, extensions: ['bwpack'] }] });
    if (!dest) return;
    if (!/\.bwpack$/i.test(dest)) dest += '.bwpack';
    busy = p.id;
    try { await invoke('export_watermark_pack', { packId: p.id, dest }); toast(WM.exported(p.name), 'ok'); }
    catch (e) { toast(WM.error(e), 'error'); }
    busy = '';
  }
  async function deletePack(p) {
    if (!await confirm(WM.confirm_delete(p.name, p.watermarks.length), { yes: 'Ħassar', no: 'Żomm', danger: true })) return;
    try { await invoke('delete_watermark_pack', { packId: p.id }); toast(WM.deleted(p.name), 'ok'); await refreshPacks(); }
    catch (e) { toast(WM.error(e), 'error'); }
  }
  async function removeMark(p, w) {
    if (!await confirm(WM.confirm_remove(w.name, p.name), { yes: 'Neħħi', no: 'Żomm', danger: true })) return;
    try { await invoke('remove_watermark', { packId: p.id, watermarkId: w.id }); toast(WM.removed(w.name), 'ok'); await refreshPacks(); }
    catch (e) { toast(WM.error(e), 'error'); }
  }
  async function importPack() {
    const path = await openDialog({ multiple: false, directory: false, filters: [{ name: WM.file_filter, extensions: ['bwpack', 'zip'] }] });
    if (!path) return;
    busy = 'import';
    try {
      const { pack, installedVersion } = await invoke('inspect_watermark_pack', { path });
      const msg = installedVersion == null ? WM.confirm_install(pack.name, pack.version, pack.watermarks.length)
        : pack.version > installedVersion ? WM.confirm_update(pack.name, installedVersion, pack.version)
        : WM.confirm_downgrade(pack.name, pack.version, installedVersion);
      if (await confirm(msg, { yes: 'Installa', no: 'Le' })) {
        await invoke('import_watermark_pack', { path });
        toast(WM.imported(pack.name), 'ok');
        await refreshPacks();
      }
    } catch (e) { toast(WM.error(e), 'error'); }
    busy = '';
  }

  // ── Add one ──────────────────────────────────────────────────────────────
  let add = $state({ pack: '', newPack: '', name: '', portrait: null, landscape: null });
  function openAdd() { add = { pack: marks.packs[0]?.id ?? NEW, newPack: '', name: '', portrait: null, landscape: null }; mode = 'add'; }
  async function pickPng(which) {
    const p = await openDialog({ multiple: false, directory: false, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (p) add[which] = p;
  }
  async function saveAdd() {
    const isNew = add.pack === NEW;
    if (!add.name.trim()) return toast(WM.need_name, 'warn');
    if (isNew && !add.newPack.trim()) return toast(WM.need_pack_name, 'warn');
    if (!add.portrait && !add.landscape) return toast(WM.need_file, 'warn');
    busy = 'add';
    try {
      const info = await invoke('add_watermark', { packId: isNew ? null : add.pack, newPackName: isNew ? add.newPack.trim() : null, name: add.name.trim(), portraitPath: add.portrait, landscapePath: add.landscape });
      toast(WM.added(add.name.trim()), 'ok');
      await refreshPacks();
      const w = info.watermarks.find(x => x.name === add.name.trim());
      if (w) marks.selected = `${info.id}/${w.id}`;
      mode = 'list';
    } catch (e) { toast(WM.error(e), 'error'); }
    busy = '';
  }

  // ── Add many ─────────────────────────────────────────────────────────────
  let bulk = $state({ pack: '', newPack: '', rows: [], exportAfter: false });
  function openBulk() { bulk = { pack: marks.packs[0]?.id ?? NEW, newPack: marks.packs.length ? '' : 'Banditur', rows: [], exportAfter: false }; mode = 'bulk'; }
  const pngSize = path => new Promise(res => { const i = new Image(); i.onload = () => res({ path, w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ path, w: 0, h: 0 }); i.src = fileSrc(path); });
  async function pickBulk() {
    const picked = await openDialog({ multiple: true, directory: false, filters: [{ name: 'PNG', extensions: ['png'] }] });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (!paths.length) return;
    const sizes = await Promise.all(paths.map(pngSize));
    // A picture outside the home folder can't be read here; fall back to the word in its name.
    const guess = f => (/portrait|portrett|vertical|vert\b|port\b/i.test(wmBaseName(f.path)) ? { ...f, w: 2, h: 3 }
      : /landscape|pajsa|horizontal|horiz|land\b/i.test(wmBaseName(f.path)) ? { ...f, w: 3, h: 2 } : f);
    const fixed = sizes.map(f => (f.w ? f : guess(f)));
    const bad = fixed.filter(f => !f.w);
    bulk.rows = groupWatermarks(fixed.filter(f => f.w));
    if (bad.length) toast(`${bad.length} ${bad.length === 1 ? 'file tqabbeż' : 'files tqabbżu'}: ma stajtx ngħid jekk huwiex portrett jew pajsaġġ. Poġġi "portrait" jew "landscape" fl-isem.`, 'warn');
  }
  const todo = $derived(bulk.rows.filter(r => r.state !== 'ok'));
  async function runBulk() {
    const isNew = bulk.pack === NEW;
    if (isNew && !bulk.newPack.trim()) return toast(WM.need_pack_name, 'warn');
    if (todo.some(r => !r.name.trim())) return toast('Kull ringiela teħtieġ isem.', 'warn');
    busy = 'bulk';
    let packId = isNew ? null : bulk.pack;
    let packName = isNew ? bulk.newPack.trim() : marks.packs.find(p => p.id === packId)?.name || '';
    let added = 0;
    for (const r of todo) {
      try {
        const info = await invoke('add_watermark', { packId, newPackName: packId ? null : bulk.newPack.trim(), name: r.name.trim(), portraitPath: r.portrait, landscapePath: r.landscape });
        packId = info.id; packName = info.name; r.state = 'ok'; added++;
      } catch (e) { r.state = 'error'; r.error = String(e); }
    }
    busy = '';
    await refreshPacks();
    if (packId) bulk.pack = packId;
    if (added) toast(`Żdiedu ${added} ${added === 1 ? 'watermark' : 'watermarks'} mal-pack "${packName}".`, 'ok');
    const failed = bulk.rows.filter(r => r.state === 'error').length;
    if (failed) toast(`${failed} ${failed === 1 ? 'ma setgħetx tiżdied' : 'ma setgħux jiżdiedu'}. Ara t-test aħmar fil-lista.`, 'error');
    if (added && !failed && bulk.exportAfter && packId) await exportPack({ id: packId, name: packName });
    if (!failed) mode = 'list';
  }
</script>

{#if mode === 'list'}
  <Modal title="Watermarks (packs)" width={640} {onclose}>
    <div class="actions">
      <button class="btn" type="button" disabled={busy === 'import'} onclick={importPack}><Icon name="download" size={15} />Import pack (.bwpack)</button>
      <button class="btn" type="button" onclick={openAdd}><Icon name="plus" size={15} />Watermark wieħed</button>
      <button class="btn" type="button" onclick={openBulk}><Icon name="plus" size={15} />Ħafna f'daqqa</button>
    </div>
    {#if !marks.packs.length}
      <div class="empty"><strong>L-ebda pack installat għadu.</strong>{WM.empty_list}</div>
    {:else}
      {#each marks.packs as p (p.id)}
        <div class="pack">
          <div class="pack-h">
            <div><strong>{p.name}</strong><div class="muted small">{WM.meta(p.version, p.watermarks.length)}</div></div>
            <span class="spacer"></span>
            <button class="btn sm" type="button" disabled={busy === p.id} onclick={() => exportPack(p)}>Export</button>
            <button class="btn sm" type="button" onclick={() => deletePack(p)}>Ħassar</button>
          </div>
          {#if p.watermarks.length}
            <ul>
              {#each p.watermarks as w (w.id)}
                <li><span>{w.name}</span><span class="muted small">{[w.portrait && WM.portrait, w.landscape && WM.landscape].filter(Boolean).join(' · ')}</span>
                  <button class="x" type="button" aria-label="Neħħi {w.name}" title="Neħħi" onclick={() => removeMark(p, w)}><Icon name="x" size={12} /></button></li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    {/if}
  </Modal>
{:else if mode === 'add'}
  <Modal title="Żid watermark" width={500} onclose={() => (mode = 'list')}>
    <div class="form">
      <div class="field"><label class="label" for="wa-pack">Pack</label>
        <select id="wa-pack" class="select" bind:value={add.pack}>
          {#each marks.packs as p}<option value={p.id}>{p.name}</option>{/each}
          <option value={NEW}>{WM.new_pack_opt}</option>
        </select></div>
      {#if add.pack === NEW}<div class="field"><label class="label" for="wa-np">Isem tal-pack il-ġdid</label><input id="wa-np" class="input" bind:value={add.newPack} /></div>{/if}
      <div class="field"><label class="label" for="wa-name">Isem tal-fotografu/a</label><input id="wa-name" class="input" bind:value={add.name} maxlength="80" /></div>
      <div class="two">
        <div class="field"><span class="label">Portrett (PNG)</span><button class="btn" type="button" onclick={() => pickPng('portrait')}>{add.portrait ? wmBaseName(add.portrait) : 'Agħżel…'}</button></div>
        <div class="field"><span class="label">Pajsaġġ (PNG)</span><button class="btn" type="button" onclick={() => pickPng('landscape')}>{add.landscape ? wmBaseName(add.landscape) : 'Agħżel…'}</button></div>
      </div>
      <p class="help">Tal-inqas waħda. Jekk tagħżel waħda biss, tintuża għal kull ritratt.</p>
    </div>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => (mode = 'list')}>Lura</button>
      <button class="btn primary" type="button" disabled={busy === 'add'} onclick={saveAdd}>Żid</button>
    {/snippet}
  </Modal>
{:else}
  <Modal title="Żid ħafna watermarks" width={680} onclose={() => { if (!busy) mode = 'list'; }}>
    <div class="form">
      <p class="help">Agħżel il-PNGs kollha f'daqqa. Il-files jingħaqdu skont l-isem (eż. <span class="mono">Ganni-portrait.png</span> u <span class="mono">Ganni-landscape.png</span>).</p>
      <div class="two">
        <div class="field"><label class="label" for="wb-pack">Fil-pack</label>
          <select id="wb-pack" class="select" bind:value={bulk.pack} disabled={!!busy}>
            {#each marks.packs as p}<option value={p.id}>{p.name}</option>{/each}
            <option value={NEW}>{WM.new_pack_opt}</option>
          </select></div>
        {#if bulk.pack === NEW}<div class="field"><label class="label" for="wb-np">Isem tal-pack il-ġdid</label><input id="wb-np" class="input" bind:value={bulk.newPack} disabled={!!busy} /></div>{/if}
      </div>
      <button class="btn" type="button" disabled={!!busy} onclick={pickBulk}><Icon name="image" size={15} />Agħżel il-PNGs…</button>
      {#if bulk.rows.length}
        <div class="rows">
          {#each bulk.rows as r, i}
            <div class="brow">
              <input class="input" bind:value={r.name} maxlength="80" aria-label="Isem tal-fotografu/a" disabled={!!busy || r.state === 'ok'} />
              <span class="tag" class:on={r.portrait}>portrett</span>
              <span class="tag" class:on={r.landscape}>pajsaġġ</span>
              <span class="st small" class:ok={r.state === 'ok'} class:err={r.state === 'error'}>{r.state === 'ok' ? 'Miżjud' : r.state === 'error' ? r.error : r.notes.join(' · ')}</span>
              <button class="x" type="button" aria-label="Neħħi {r.name}" disabled={!!busy} onclick={() => bulk.rows.splice(i, 1)}><Icon name="x" size={12} /></button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="muted">Ma ntgħażel l-ebda file għadu.</p>
      {/if}
      <label class="check"><input type="checkbox" bind:checked={bulk.exportAfter} />Export il-pack wara (biex taqsmu ma' oħrajn)</label>
    </div>
    {#snippet footer()}
      <button class="btn" type="button" disabled={!!busy} onclick={() => (mode = 'list')}>Lura</button>
      <button class="btn primary" type="button" disabled={!!busy || !todo.length} onclick={runBulk}>{todo.length ? `Żid ${todo.length} ${todo.length === 1 ? 'watermark' : 'watermarks'}` : 'Żid'}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .pack { border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-bottom: 10px; }
  .pack-h { display: flex; align-items: center; gap: 8px; }
  ul { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  li { display: flex; align-items: center; gap: 10px; padding: 4px 0; border-top: 1px solid var(--line-soft); }
  li span:first-child { flex: 1; }
  .x { border: 0; background: none; color: var(--muted); padding: 4px; border-radius: 5px; display: flex; }
  .x:hover:not(:disabled) { background: var(--hover); color: var(--fg); }
  .form { display: flex; flex-direction: column; gap: 14px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .rows { display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow: auto; }
  .brow { display: grid; grid-template-columns: minmax(0, 1fr) auto auto minmax(0, 1fr) auto; gap: 8px; align-items: center; }
  .tag { font-size: 11px; padding: 2px 7px; border-radius: 8px; background: var(--bar); color: var(--muted); text-decoration: line-through; }
  .tag.on { background: var(--accent-soft); color: var(--accent-fg); text-decoration: none; }
  .st { color: var(--muted); } .st.ok { color: var(--ok-fg); } .st.err { color: var(--danger-fg); }
</style>
