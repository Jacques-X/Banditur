<script>
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import { post, changed, captionLimit } from './composer.svelte.js';
  import { platformById } from '../../platforms.js';
  import { ls } from '../../lib/app.svelte.js';
  import { BUILTIN_TEMPLATES } from '../../strings.js';

  let ta = $state();
  let emojiOpen = $state(false);
  let tmplOpen = $state(false);
  let linkOpen = $state(false);
  let linkUrl = $state('');
  let fill = $state(null);          // { t, fields: [{ ph, options, value }] }
  let manage = $state(null);        // editable copy of user templates
  let userTemplates = $state(ls.json('banditur_templates', []));

  const EMOJIS = ['🎉','🎶','🎺','🥁','🎸','🎼','🎊','✨','🌟','❤️','👏','🙏','📅','📍','🕗','🎰','🏆','📢','🎤','🌺','⭐','🔔','🎇','🪗','🎆'];
  const limit = $derived(captionLimit());
  const len = $derived(post.caption.length);
  const cut = $derived(Math.min(...post.platforms.map(id => platformById(id)?.previewCut || Infinity)));

  // Unicode sans-serif bold/italic so the style survives on Facebook and Instagram
  // (Maltese ħ ġ ċ ż stay as they are).
  const bold = t => [...t].map(c => { const p = c.codePointAt(0);
    if (p >= 65 && p <= 90) return String.fromCodePoint(p - 65 + 0x1D5D4);
    if (p >= 97 && p <= 122) return String.fromCodePoint(p - 97 + 0x1D5EE);
    if (p >= 48 && p <= 57) return String.fromCodePoint(p - 48 + 0x1D7EC);
    return c; }).join('');
  const italic = t => [...t].map(c => { const p = c.codePointAt(0);
    if (p >= 65 && p <= 90) return String.fromCodePoint(p - 65 + 0x1D608);
    if (p >= 97 && p <= 122) return String.fromCodePoint(p - 97 + 0x1D622);
    return c; }).join('');

  function sync() { post.caption = ta.value; changed(); }
  function transform(fn) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    if (s !== e) { ta.setRangeText(fn(ta.value.slice(s, e)), s, e, 'select'); sync(); }
    ta.focus();
  }
  function insert(before, after = '') {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    ta.setRangeText(before + sel + after, s, e, 'end');
    if (sel) ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    sync();
    ta.focus();
  }

  function placeholders(body) {
    const seen = new Set(), out = [];
    for (const m of body.matchAll(/\[([^\]\n]{1,60})\]/g)) {
      const raw = m[1].trim();
      if (raw && !seen.has(raw)) { seen.add(raw); out.push(raw); }
    }
    return out;
  }
  function useTemplate(t) {
    tmplOpen = false;
    const phs = placeholders(t.body || '');
    if (!phs.length) { post.caption = t.body || ''; changed(); return; }
    fill = { t, fields: phs.map(ph => { const options = ph.split('/').map(s => s.trim()).filter(Boolean); return { ph, options: options.length > 1 ? options : null, value: options.length > 1 ? options[0] : '' }; }) };
  }
  function applyFill() {
    let body = fill.t.body;
    for (const f of fill.fields) body = body.split(`[${f.ph}]`).join(f.value.trim() || `[${f.ph}]`);
    post.caption = body;
    changed();
    fill = null;
  }
  function saveTemplates() {
    userTemplates = manage.filter(t => t.name.trim()).map(t => ({ name: t.name.trim(), body: t.body }));
    ls.set('banditur_templates', JSON.stringify(userTemplates));
    manage = null;
  }
  function closeMenus(e) {
    if (!e.target.closest?.('.tools')) { emojiOpen = false; tmplOpen = false; }
  }
</script>

<svelte:window onclick={closeMenus} />

<div class="cap">
  <div class="head">
    <label for="caption" class="label">Kaption</label>
    <div class="tools" role="toolbar" aria-label="Formattjar tal-kaption">
      <button type="button" title="Grassett (fuq it-test magħżul)" aria-label="Grassett" onclick={() => transform(bold)}><Icon name="bold" size={14} /></button>
      <button type="button" title="Korsiv (fuq it-test magħżul)" aria-label="Korsiv" onclick={() => transform(italic)}><Icon name="italic" size={14} /></button>
      <button type="button" title="Hashtag" aria-label="Hashtag" onclick={() => insert('#')}><Icon name="hash" size={14} /></button>
      <button type="button" title="Link" aria-label="Link" onclick={() => { linkUrl = ''; linkOpen = true; }}><Icon name="link" size={14} /></button>
      <div class="pop-wrap">
        <button type="button" title="Emoji" aria-label="Emoji" aria-expanded={emojiOpen} onclick={() => { emojiOpen = !emojiOpen; tmplOpen = false; }}><Icon name="smile" size={14} /></button>
        {#if emojiOpen}
          <div class="pop emoji" role="menu">
            {#each EMOJIS as em}<button type="button" role="menuitem" onclick={() => { insert(em); emojiOpen = false; }}>{em}</button>{/each}
          </div>
        {/if}
      </div>
      <span class="sep"></span>
      <div class="pop-wrap">
        <button type="button" class="tmpl" aria-expanded={tmplOpen} onclick={() => { tmplOpen = !tmplOpen; emojiOpen = false; }}><Icon name="doc" size={14} />Template<Icon name="chevron" size={12} /></button>
        {#if tmplOpen}
          <div class="pop list" role="menu">
            <div class="pop-h">Mudelli</div>
            {#each BUILTIN_TEMPLATES as t}<button type="button" role="menuitem" onclick={() => useTemplate(t)}>{t.name}</button>{/each}
            {#if userTemplates.length}
              <div class="pop-h">Tiegħek</div>
              {#each userTemplates as t}<button type="button" role="menuitem" onclick={() => useTemplate(t)}>{t.name}</button>{/each}
            {/if}
            <button type="button" role="menuitem" class="manage" onclick={() => { manage = userTemplates.map(t => ({ ...t })); tmplOpen = false; }}>Immaniġġja t-templates tiegħek…</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
  <textarea id="caption" class="textarea" bind:this={ta} value={post.caption} oninput={sync}
            placeholder="Ikteb il-kaption…" aria-invalid={len > limit ? 'true' : undefined}></textarea>
  <div class="foot">
    {#if Number.isFinite(cut)}<span>Instagram juri l-ewwel {cut} karattru qabel "aktar"</span>{/if}
    <span class="spacer"></span>
    <span class="mono count" class:warn={len > limit - 200} class:over={len > limit}>{len.toLocaleString('en-US')} / {limit.toLocaleString('en-US')}</span>
  </div>
</div>

{#if linkOpen}
  <Modal title="Żid link" width={440} onclose={() => (linkOpen = false)}>
    <div class="field">
      <label class="label" for="link-url">URL</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="link-url" class="input" type="url" bind:value={linkUrl} placeholder="https://…" autofocus
             onkeydown={e => { if (e.key === 'Enter' && linkUrl.trim()) { insert('[', `](${linkUrl.trim()})`); linkOpen = false; } }} />
      <p class="help">It-test magħżul isir il-link. Facebook u Instagram juru l-URL kif inhu.</p>
    </div>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => (linkOpen = false)}>Ikkanċella</button>
      <button class="btn primary" type="button" disabled={!linkUrl.trim()} onclick={() => { insert('[', `](${linkUrl.trim()})`); linkOpen = false; }}>Żid</button>
    {/snippet}
  </Modal>
{/if}

{#if fill}
  <Modal title={fill.t.name} width={480} onclose={() => (fill = null)}>
    <div class="fill">
      {#each fill.fields as f, i}
        <div class="field">
          <label class="label" for="ph-{i}">{f.ph}</label>
          {#if f.options}
            <select id="ph-{i}" class="select" bind:value={f.value}>{#each f.options as o}<option>{o}</option>{/each}</select>
          {:else}
            <input id="ph-{i}" class="input" bind:value={f.value} placeholder={f.ph} />
          {/if}
        </div>
      {/each}
      <p class="help">Dak li tħalli vojt jibqa' bejn [ ] fil-kaption.</p>
    </div>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => (fill = null)}>Ikkanċella</button>
      <button class="btn primary" type="button" onclick={applyFill}>Daħħal fil-kaption</button>
    {/snippet}
  </Modal>
{/if}

{#if manage}
  <Modal title="It-templates tiegħek" width={620} onclose={() => (manage = null)}>
    <div class="manage-list">
      {#each manage as t, i}
        <div class="mrow">
          <input class="input" bind:value={t.name} placeholder="Isem…" aria-label="Isem tat-template" />
          <textarea class="textarea" rows="3" bind:value={t.body} aria-label="Test tat-template" placeholder="Uża [ISEM], [DATA]… għal postijiet li jimtlew"></textarea>
          <button class="btn sm" type="button" onclick={() => manage.splice(i, 1)}>Ħassar</button>
        </div>
      {:else}
        <p class="muted">Għad m'għandek l-ebda template. Il-mudelli inklużi jibqgħu disponibbli.</p>
      {/each}
      <button class="btn sm" type="button" onclick={() => manage.push({ name: `Template ${manage.length + 1}`, body: '' })}><Icon name="plus" size={14} />Template ġdida</button>
    </div>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => (manage = null)}>Ikkanċella</button>
      <button class="btn primary" type="button" onclick={saveTemplates}>Issejvja</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .cap { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
  .head { display: flex; align-items: center; gap: 10px; }
  .tools { margin-left: auto; display: flex; align-items: center; gap: 2px; }
  .tools button { height: 26px; min-width: 26px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 0; border-radius: 6px; background: transparent; color: var(--fg-2); font-size: 12px; }
  .tools button:hover, .tools button[aria-expanded="true"] { background: var(--hover); color: var(--fg); }
  .sep { width: 1px; height: 16px; background: var(--line); margin: 0 4px; }
  .pop-wrap { position: relative; }
  .pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; background: var(--card); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow-pop); padding: 6px; }
  .pop.emoji { display: grid; grid-template-columns: repeat(5, 32px); gap: 2px; }
  .pop.emoji button { font-size: 18px; height: 32px; }
  .pop.list { width: 240px; display: flex; flex-direction: column; }
  .pop.list button { justify-content: flex-start; height: 30px; padding: 0 10px; font-size: 13px; color: var(--fg); }
  .pop.list .manage { border-top: 1px solid var(--line-soft); border-radius: 0 0 6px 6px; margin-top: 4px; color: var(--accent-fg); }
  .pop-h { font-size: 11px; font-weight: 600; color: var(--muted); padding: 6px 10px 2px; }
  textarea { flex: 1; min-height: 120px; font-size: 14px; }
  .foot { display: flex; color: var(--muted); font-size: 12px; }
  .count.warn { color: var(--warn-fg); }
  .count.over { color: var(--danger-fg); font-weight: 600; }
  .fill, .manage-list { display: flex; flex-direction: column; gap: 14px; }
  .mrow { display: grid; grid-template-columns: 1fr; gap: 6px; padding-bottom: 12px; border-bottom: 1px solid var(--line-soft); }
  .mrow .btn { justify-self: start; }
</style>
