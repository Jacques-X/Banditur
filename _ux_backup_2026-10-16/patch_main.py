import re
miss=[]
def load(p): return open(p,encoding='utf8').read()
def save(p,s): open(p,'w',encoding='utf8').write(s)
class F:
    def __init__(self,p): self.p=p; self.s=load(p)
    def rep(self,a,b,count=1):
        n=self.s.count(a)
        if n!=count: miss.append((self.p,n,count,a[:80]))
        self.s=self.s.replace(a,b)
    def rx(self,pat,b,flags=re.S):
        self.s,n=re.subn(pat,lambda m:b,self.s,count=1,flags=flags)
        if n!=1: miss.append((self.p,n,1,'RX '+pat[:60]))
    def done(self): save(self.p,self.s)

# ============================================================== strings.js
st=F('src/strings.js')
st.rep("export const STATUS_LABELS", r'''// Turns raw technical errors (HTTP codes, "Failed to fetch"...) into a plain
// Maltese sentence, keeping the original text in brackets for support.
export function friendlyError(raw) {
  const m = String(raw ?? '').trim();
  if (!m) return 'Xi ħaġa marret ħażin. Erġa\' pprova.';
  const low = m.toLowerCase();
  let nice = '';
  if (/failed to fetch|networkerror|load failed|network request failed/.test(low)) nice = 'Ma stajniex nikkonnettjaw mas-server. Iċċekkja l-internet u erġa\' pprova.';
  else if (/\b401\b|unauthori[sz]ed|invalid api key/.test(low)) nice = 'L-API Key mhix tajba jew skadiet. Iċċekkjaha fis-Settings.';
  else if (/\b403\b|forbidden/.test(low)) nice = 'M\'għandekx permess għal din l-azzjoni.';
  else if (/\b404\b/.test(low)) nice = 'Is-server ma sab dak li qed tfittex. Iċċekkja l-Backend URL fis-Settings.';
  else if (/\b413\b|too large|payload/.test(low)) nice = 'Il-fajl huwa kbir wisq.';
  else if (/\b429\b|rate limit/.test(low)) nice = 'Wisq talbiet f\'daqqa. Stenna ftit u erġa\' pprova.';
  else if (/\b5\d\d\b|internal server|bad gateway|timeout|timed out/.test(low)) nice = 'Is-server għandu problema jew dam wisq. Erġa\' pprova aktar tard.';
  return nice ? `${nice} (${m.split('\n')[0].slice(0, 140)})` : m;
}

export const STATUS_LABELS''')
st.rep("no_caption:      'Il-kaptjon hija meħtieġa.'","no_caption:      'Il-kaption hija meħtieġa.'")
st.rep("fatal:      e => `Żball fatali: ${e}`,","fatal:      e => `Żball fatali: ${friendlyError(e)}`,")
st.rep("generic:  msg => `Żball: ${msg}`,","generic:  msg => `Żball: ${friendlyError(msg)}`,")
st.rep("offline:       'M\\'intix konness. Il-post ġiet issejvjata bħala abbozz.',","offline:       'M\\'intix konness. Il-post ġie ssejvjat bħala abbozz, bil-media wkoll. Skedah meta terġa\\' tkun online.',")
st.rep("error: msg => `Żball: ${msg}`,\n  drive_err: msg => `Drive żball: ${msg}`,","error: msg => `Żball: ${friendlyError(msg)}`,\n  drive_err: msg => `Żball minn Drive: ${friendlyError(msg)}`,")
st.rep("error:   msg => `Żball: ${msg}`,\n};","error:   msg => `Żball: ${friendlyError(msg)}`,\n};")
st.rep("reset_form:  'Trid tirrisettja l-formola? Il-bidliet mhux issejvjati jintilfu.',",
 "reset_form:  'Trid tibda mill-ġdid? Il-kaption, il-media u d-dati jitnaddfu mill-formola (l-abbozzi ssejvjati ma jintmessux).',\n  past_time:   'Il-ħin magħżul diġà għadda. Il-post jiġi ppubblikat mal-ewwel run li jmiss. Tkompli?',\n  quit_busy:   'Għad hawn xogħol għaddej (proċessar, traskrizzjoni, esportazzjoni jew download). Jekk tagħlaq issa, jintilef.',\n  delete_event:'Trid tħassar dan l-avveniment?',")
st.rep("error: e => `Żball: ${e}`,\n};","error: e => `Żball: ${friendlyError(e)}`,\n};") if False else None
st.rep("  error:  msg  => `Żball: ${msg}`,\n  no_url:","  error:  msg  => `Żball: ${friendlyError(msg)}`,\n  no_url:")
st.done()

# ============================================================== ui.js
ui=F('src/ui.js')
ui.rep("export function renderTableState({ tone = 'muted', title, body = '', colspan = 6 }) {\n  return `<tr class=\"table-state-row\"><td colspan=\"${colspan}\">${renderState({ tone, title, body })}</td></tr>`;",
       "export function renderTableState({ tone = 'muted', title, body = '', colspan = 6, action = '' }) {\n  return `<tr class=\"table-state-row\"><td colspan=\"${colspan}\">${renderState({ tone, title, body, action })}</td></tr>`;")
ui.rep("'<div class=\"preview-caption preview-caption-empty\">Ebda kaption s\\'issa.</div>'","'<div class=\"preview-caption preview-caption-empty\">L-ebda kaption s\\'issa.</div>'")
ui.done()

# ============================================================== main.js
m=F('src/main.js')
m.rep("import { groupWatermarks","import { saveMedia, loadMedia, deleteMedia, pruneMedia } from './media-store.js';\nimport { groupWatermarks")

# ---- toast
m.rx(r"function showToast\(msg, type = 'info'\) \{.*?\n\}\n\n// ── Custom confirm dialog", r'''function showToast(msg, type = 'info', action = null) {
  const layer = document.getElementById('toast-layer');
  const card  = document.createElement('div');
  card.className   = `toast-card toast-${type}`;
  card.innerHTML = renderToast(msg, type);
  if (type === 'error') card.setAttribute('role', 'alert');
  if (action) {
    const a = document.createElement('button');
    a.type = 'button'; a.className = 'toast-action'; a.textContent = action.label;
    card.querySelector('.toast-body')?.appendChild(a);
    a.addEventListener('click', () => { action.onClick(); dismiss(); });
  }
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'toast-close'; x.setAttribute('aria-label', 'Agħlaq'); x.textContent = '×';
  card.appendChild(x);
  let timer = null;
  function dismiss() {
    clearTimeout(timer);
    card.classList.remove('toast-in');
    card.classList.add('toast-out');
    setTimeout(() => card.remove(), 300);
  }
  // Errors stay until closed; the rest wait while the pointer or focus is on them.
  const arm = () => { clearTimeout(timer); if (type !== 'error') timer = setTimeout(dismiss, action ? 10000 : 6000); };
  card.addEventListener('mouseenter', () => clearTimeout(timer));
  card.addEventListener('mouseleave', arm);
  card.addEventListener('focusin', () => clearTimeout(timer));
  card.addEventListener('focusout', arm);
  x.addEventListener('click', dismiss);
  layer.appendChild(card);
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('toast-in')));
  arm();
}

// ── Custom confirm dialog''')

# ---- confirm
m.rx(r"function showConfirm\(message\) \{.*?\n\}\n\n// ── Modal focus management", r'''function showConfirm(message, { yes: yesLabel = 'Iva', no: noLabel = 'Le', danger = false } = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-msg').textContent = message;
    const yes = document.getElementById('confirm-yes');
    const no  = document.getElementById('confirm-no');
    yes.textContent = yesLabel;
    no.textContent  = noLabel;
    yes.classList.toggle('btn-danger', danger);
    modal.style.display = 'flex';
    focusModal(modal);
    function cleanup(result) {
      modal.style.display = 'none';
      yes.onclick = null;
      no.onclick  = null;
      yes.classList.remove('btn-danger');
      resolve(result);
    }
    yes.onclick = () => cleanup(true);
    no.onclick  = () => cleanup(false);
  });
}

// ── Modal focus management''')
m.rep("function focusModal(modalEl) {\n  requestAnimationFrame(() => {","function focusModal(modalEl) {\n  modalEl._returnFocus = document.activeElement;\n  requestAnimationFrame(() => {")

# ---- shortcuts
m.rep("  if (!inInput) {\n    if (e.key === '1') { showView('ghodda'); return; }\n    if (e.key === '2') { showView('skeda');  return; }\n    if (e.key === '3') { showView('calendar'); return; }\n    if (e.key === '4') { showView('arkivju'); return; }\n  }",
"  if (!inInput && !e.metaKey && !e.ctrlKey && !e.altKey && !topmostOpenModal()) {\n    if (e.key === '1') { showView('skeda');  return; }\n    if (e.key === '2') { showView('calendar'); return; }\n    if (e.key === '3') { showView('arkivju'); return; }\n    if (e.key === '4') { showView('ghodda'); return; }\n  }")
m.rep("  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {\n    e.preventDefault();\n    document.getElementById('btn-schedule')?.click();\n    return;\n  }",
"  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {\n    // Only schedule from the composer — never from Calendar, Archive or Tools.\n    if (activeView !== 'skeda' || topmostOpenModal()) return;\n    e.preventDefault();\n    document.getElementById('btn-schedule')?.click();\n    return;\n  }")

# ---- aria-selected sync
m.rep("    btn.dataset.active = btn.dataset.tool === tab ? 'true' : 'false';\n  });","    btn.dataset.active = btn.dataset.tool === tab ? 'true' : 'false';\n    btn.setAttribute('aria-selected', btn.dataset.tool === tab ? 'true' : 'false');\n  });")
m.rep("document.querySelectorAll('.archive-source-tab').forEach(t => t.dataset.active = String(t === tab));","document.querySelectorAll('.archive-source-tab').forEach(t => { t.dataset.active = String(t === tab); t.setAttribute('aria-selected', String(t === tab)); });")

# ---- profile name in composer
m.rep("    sel.value = _profiles.some(p => p.id === _selectedProfileId) ? _selectedProfileId : _profiles[0]?.id || 'main';\n  });\n}",
"    sel.value = _profiles.some(p => p.id === _selectedProfileId) ? _selectedProfileId : _profiles[0]?.id || 'main';\n  });\n  const pn = document.getElementById('composer-profile-name');\n  if (pn) pn.textContent = selectedProfileName() || '—';\n}")
m.rep("showToast('Ma stajtx niġbed il-lista tal-profili. Qed nuża l-aħħar waħda maħżuna.', 'warn');","showToast('Ma stajtx niġbed il-lista tal-profili. Qed nuża l-aħħar waħda maħżuna.', 'warn');")

# ---- tool messages / inline errors
m.rep("    if (!inputDir) { appendLog('error', ERR.no_input_dir); runBtn.disabled = false; return; }\n    if (watermark && !photographer) {\n      appendLog('error', wmPacks.some(p => p.watermarks.length) ? ERR.no_photographer : WM.none_installed);\n      runBtn.disabled = false;\n      return;\n    }",
"    if (!inputDir) { appendLog('error', ERR.no_input_dir); flagField(inputField, ERR.no_input_dir); statusLabel.textContent = TOOLS.ready; runBtn.disabled = false; return; }\n    if (watermark && !photographer) {\n      const why = wmPacks.some(p => p.watermarks.length) ? ERR.no_photographer : WM.none_installed;\n      appendLog('error', why);\n      flagField(photographerSel, why);\n      statusLabel.textContent = TOOLS.ready;\n      runBtn.disabled = false;\n      return;\n    }")
m.rep("    if (!inputDir) { appendLog('error', ERR.no_arw_dir); runBtn.disabled = false; return; }","    if (!inputDir) { appendLog('error', ERR.no_arw_dir); flagField(arwInputField, ERR.no_arw_dir); statusLabel.textContent = TOOLS.ready; runBtn.disabled = false; return; }")
m.rep("// ── Log ────────────────────────────────────────────────────────────────────────\nlet _logScrollRaf = null;",
r'''// ── Inline field errors ───────────────────────────────────────────────────────
function clearFlag(el) {
  if (!el) return;
  el.classList.remove('is-invalid');
  el.removeAttribute('aria-invalid');
  el.removeAttribute('aria-describedby');
  const row = el.closest('.folder-row') || el.parentElement;
  const err = row?.nextElementSibling;
  if (err?.classList?.contains('field-error')) err.remove();
}
function flagField(el, msg) {
  if (!el) return;
  clearFlag(el);
  el.classList.add('is-invalid');
  el.setAttribute('aria-invalid', 'true');
  const p = document.createElement('p');
  p.className = 'field-error';
  p.id = `${el.id || 'field'}-err`;
  p.setAttribute('role', 'alert');
  p.textContent = msg;
  el.setAttribute('aria-describedby', p.id);
  (el.closest('.folder-row') || el.parentElement).insertAdjacentElement('afterend', p);
  el.focus();
}
['input', 'change'].forEach(evt => document.addEventListener(evt, e => {
  if (e.target?.classList?.contains('is-invalid')) clearFlag(e.target);
}));

// ── Log ────────────────────────────────────────────────────────────────────────
let _logScrollRaf = null;''')
m.rep("    openBtn.disabled        = false;\n    statusLabel.textContent = TOOLS.done_wm(processed, failed);","    openBtn.disabled        = false;\n    statusLabel.textContent = TOOLS.done_wm(processed, failed);\n    if (failed) showToast(`${failed} ${failed === 1 ? 'ritratt ma ġiex ipproċessat' : 'ritratti ma ġewx ipproċessati'}. Ara l-log għad-dettalji.`, 'warn');")
m.rep("    openBtn.disabled        = false;\n    statusLabel.textContent = TOOLS.done_arw(converted, skipped);","    openBtn.disabled        = false;\n    statusLabel.textContent = TOOLS.done_arw(converted, skipped);\n    if (skipped) showToast(`${skipped} ${skipped === 1 ? 'fajl ġie mqabbeż' : 'fajls ġew mqabbża'}. Ara l-log għad-dettalji.`, 'warn');")

# ---- wm bulk english
m.rep("'<p class=\"wm-hint\">No files chosen yet.</p>'","'<p class=\"wm-hint\">Ma ntgħażel l-ebda fajl għadu.</p>'")
m.rep('aria-label="Photographer name"','aria-label="Isem tal-fotografu/a"')
m.rep("'No portrait file'","'L-ebda fajl tal-portrett'")
m.rep("'No landscape file'","'L-ebda fajl tal-pajsaġġ'")
m.rep('">portrait</span>','">portrett</span>')
m.rep('">landscape</span>','">pajsaġġ</span>')
m.rep("r.state === 'ok' ? 'Added'","r.state === 'ok' ? 'Miżjud'")
m.rep('aria-label="Remove ${escHtml(r.name)}"','aria-label="Neħħi ${escHtml(r.name)}"')
m.rep("wmBulkGo.textContent = n ? `Add ${n} ${n === 1 ? 'watermark' : 'watermarks'}` : 'Add';","wmBulkGo.textContent = n ? `Żid ${n} ${n === 1 ? 'marka' : 'marki'}` : 'Żid';")
m.rx(r"showToast\(`\$\{bad\.length\} \$\{bad\.length === 1 \? 'file' : 'files'\} skipped:[^\n]*?'warn'\);", r'''showToast(`${bad.length} ${bad.length === 1 ? 'fajl tqabbeż' : 'fajls tqabbżu'}: ma stajtx ngħid jekk huwiex portrett jew pajsaġġ. Poġġi "portrait" jew "landscape" fl-isem tal-fajl.`, 'warn');''')
m.rep("showToast('Every row needs a name.', 'warn');","showToast('Kull ringiela teħtieġ isem.', 'warn');")
m.rep("showToast(`Added ${added} ${added === 1 ? 'watermark' : 'watermarks'} to \"${packName}\".`, 'ok');","showToast(`Żdiedu ${added} ${added === 1 ? 'marka' : 'marki'} mal-pack \"${packName}\".`, 'ok');")
m.rep("showToast(`${failed} could not be added. See the red text in the list.`, 'error');","showToast(`${failed} ${failed === 1 ? 'ma setgħetx tiżdied' : 'ma setgħux jiżdiedu'}. Ara t-test aħmar fil-lista.`, 'error');")

# ---- confirm labels
m.rep("const ok = await showConfirm(CONFIRM.reset_form);","const ok = await showConfirm(CONFIRM.reset_form, { yes: 'Ibda mill-ġdid', no: 'Ikkanċella', danger: true });")
m.rep("const ok = await showConfirm(CONFIRM.delete_post);","const ok = await showConfirm(CONFIRM.delete_post, { yes: 'Ħassar', no: 'Żomm', danger: true });")
m.rep("if (!await showConfirm('Trid tħassar dan l-avveniment?')) return;","if (!await showConfirm(CONFIRM.delete_event, { yes: 'Ħassar', no: 'Żomm', danger: true })) return;")
m.rep("if (!await showConfirm(`Trid tneħħi l-label \"${label.name}\"?`)) return;","if (!await showConfirm(`Trid tneħħi t-tikketta \"${label.name}\"?`, { yes: 'Neħħi', no: 'Żomm', danger: true })) return;")
m.rep("showToast(TOAST.error('Isem tal-label huwa meħtieġ.'), 'error');","showToast(TOAST.error('L-isem tat-tikketta huwa meħtieġ.'), 'error');")
m.rep("showToast('Label issejvjata.', 'ok');","showToast('Tikketta issejvjata.', 'ok');")
m.rep("showToast('Label imneħħija.', 'ok');","showToast('Tikketta mneħħija.', 'ok');")
m.rep("if (!await showConfirm(WM.confirm_delete(pack.name, pack.watermarks.length))) return;","if (!await showConfirm(WM.confirm_delete(pack.name, pack.watermarks.length), { yes: 'Ħassar', no: 'Żomm', danger: true })) return;")
m.rep("!await showConfirm(WM.confirm_remove(wm.name, pack.name))","!await showConfirm(WM.confirm_remove(wm.name, pack.name), { yes: 'Neħħi', no: 'Żomm', danger: true })")
m.rep("const ok = await showConfirm(`Verżjoni ${update.version} disponibbli. Tinstallaha issa?${notes}`);","const ok = await showConfirm(`Verżjoni ${update.version} disponibbli. Tinstallaha issa?${notes}`, { yes: 'Installa', no: 'Aktar tard' });")
m.rep("'<button type=\"button\" class=\"settings-link\" data-open-settings>Open Settings</button>'","'<button type=\"button\" class=\"settings-link\" data-open-settings>Iftaħ is-Settings</button>'")
m.rep("body: 'Open Settings to connect the backend.'","body: 'Iftaħ is-Settings biex tikkonnettja l-backend.'")
m.rep("body: 'Meta ssalva abbozz jidher hawn.'","body: 'Meta tissejvja abbozz, jidher hawn.'")

# ---- autosave labels + media/profile/type
m.rep("autosaveLabelEl.textContent = 'Mhux issejvjat';","autosaveLabelEl.textContent = 'Bidliet mhux issejvjati…';")
m.rep("autosaveLabelEl.textContent = `Salvat ${time.toLocaleTimeString('mt', { hour: '2-digit', minute: '2-digit' })}`;","autosaveLabelEl.textContent = `Abbozz awtomatiku ${time.toLocaleTimeString('mt', { hour: '2-digit', minute: '2-digit' })} · fuq dan il-kompjuter`;")
m.rep("function doAutosave() {\n  const state = collectScheduleForm();\n  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state));\n  markSaved(new Date());\n}",
"function doAutosave() {\n  const state = collectScheduleForm();\n  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state));\n  if (pickedMedia.length) saveMedia('autosave', pickedMedia); else deleteMedia('autosave');\n  markSaved(new Date());\n}")
m.rep("    markSaved(new Date(saved.savedAt || Date.now()));\n    updateInlinePreview();\n  } catch {}\n}",
"""    if (saved.contentType && saved.contentType !== 'post') setContentType(saved.contentType);
    if (saved.profileId && _profiles.some(p => p.id === saved.profileId)) {
      _selectedProfileId = saved.profileId;
      localStorage.setItem('banditur_profile_id', _selectedProfileId);
      syncProfileSelects();
    }
    markSaved(new Date(saved.savedAt || Date.now()));
    updateInlinePreview();
    loadMedia('autosave').then(files => {
      if (files.length && !pickedMedia.length) { pickedMedia = files; renderMediaPreviews(); }
    });
  } catch {}
}""")

# content type helper + hints
m.rep("const CT_HINTS = {\n  post:  '',\n  reel:  'Video wieħed meħtieġ',\n  story: 'Medjum wieħed meħtieġ · Kaptjon fakultattiv',\n};",
"""const CT_HINTS = {
  post:  '',
  reel:  'Video wieħed biss (9:16)',
  story: 'Medjum wieħed biss (9:16) · Kaption fakultattiv',
};

function setContentType(type) {
  contentType = type;
  document.querySelectorAll('.ct-tab[data-ct]').forEach(b => {
    b.dataset.active = b.dataset.ct === type ? 'true' : 'false';
  });
  const hint = document.getElementById('ct-hint');
  if (hint) hint.textContent = CT_HINTS[type] || '';
}

// What the chosen content type accepts. Returns a Maltese message, or '' if fine.
const MAX_POST_MEDIA = 10;
function mediaFitProblem() {
  const n = pickedMedia.length;
  if (contentType === 'reel') {
    if (n !== 1 || !pickedMedia[0].type.startsWith('video/')) return 'Reel jeħtieġ video wieħed biss. Neħħi l-bqija tal-media.';
  } else if (contentType === 'story') {
    if (n > 1) return 'Storja tiħu medjum wieħed biss. Neħħi l-bqija tal-media.';
  } else if (n > MAX_POST_MEDIA) {
    return `Post jiħu sa ${MAX_POST_MEDIA} ritratti. Neħħi ${n - MAX_POST_MEDIA}.`;
  }
  return '';
}
function checkMediaFitsType() {
  const why = pickedMedia.length ? mediaFitProblem() : '';
  if (why) showScheduleStatus(why, 'warn');
  else if (/(Reel|Storja|Post) (jeħtieġ|tiħu|jiħu)/.test(document.getElementById('schedule-status')?.textContent || '')) {
    const ss = document.getElementById('schedule-status'); if (ss) ss.style.display = 'none';
  }
}""")
m.rep("    const hint = document.getElementById('ct-hint');\n    if (hint) hint.textContent = CT_HINTS[contentType] || '';\n    updateInlinePreview();\n    scheduleAutosave();",
"    const hint = document.getElementById('ct-hint');\n    if (hint) hint.textContent = CT_HINTS[contentType] || '';\n    checkMediaFitsType();\n    updateInlinePreview();\n    scheduleAutosave();")

# ---- media add limits
m.rep("function addMediaFiles(files) {\n  for (const f of files) {\n    if (isSupportedMediaFile(f)) pickedMedia.push(f);\n  }\n  renderMediaPreviews();\n}",
"""function addMediaFiles(files) {
  const limit = contentType === 'post' ? MAX_POST_MEDIA : 1;
  let badType = 0, overLimit = 0, notVideo = 0;
  for (const f of files) {
    if (!isSupportedMediaFile(f)) { badType++; continue; }
    if (contentType === 'reel' && !f.type.startsWith('video/')) { notVideo++; continue; }
    if (pickedMedia.length >= limit) { overLimit++; continue; }
    pickedMedia.push(f);
  }
  const notes = [];
  if (badType)   notes.push(`${badType} ${badType === 1 ? 'fajl mhux supportat' : 'fajls mhux supportati'} (JPG, PNG jew MP4 biss)`);
  if (notVideo)  notes.push('Reel jaqbel ma\\' video biss');
  if (overLimit) notes.push(contentType === 'post' ? `l-massimu huwa ${limit} ritratti` : `${contentType === 'reel' ? 'Reel' : 'Storja'} tiħu fajl wieħed biss`);
  if (notes.length) showToast(`Ma żdidx kollox: ${notes.join('; ')}.`, 'warn');
  renderMediaPreviews();
  scheduleAutosave();
}""")

# ---- drafts
m.rep("function updateDraftsBtn() {","""async function saveCurrentAsDraft() {
  const d = collectScheduleForm();
  d.id = `d${Date.now()}`;
  d.mediaCount = pickedMedia.length && await saveMedia(`draft:${d.id}`, pickedMedia) ? pickedMedia.length : 0;
  const drafts = loadDrafts();
  drafts.unshift(d);
  persistDrafts(drafts);
  updateDraftsBtn();
  return d;
}

function updateDraftsBtn() {""")
m.rep("  if (openBt)  openBt.style.display = list.length === 0 ? 'none' : '';\n}","  if (openBt)  openBt.disabled = false;\n}")
m.rep("    caption:       captionEl?.value || '',\n    platforms:     getSelectedPlatforms(),","    caption:       captionEl?.value || '',\n    contentType,\n    profileId:     selectedProfileId(),\n    platforms:     getSelectedPlatforms(),")
m.rx(r"document\.getElementById\('save-draft-btn'\)\?\.addEventListener\('click', \(\) => \{.*?\n\}\);\n", r'''document.getElementById('save-draft-btn')?.addEventListener('click', async () => {
  const d = await saveCurrentAsDraft();
  showScheduleStatus(d.mediaCount ? `${SCHED.draft_saved} (bi ${d.mediaCount} ${d.mediaCount === 1 ? 'fajl' : 'fajls'} media)` : SCHED.draft_saved, 'ok');
  doAutosave();
});
''')
m.rep("<span class=\"draft-meta\">${escHtml((d.platforms||[]).join(', '))} · ${new Date(d.savedAt).toLocaleString()}</span>",
      "<span class=\"draft-meta\">${escHtml((d.platforms||[]).join(', '))} · ${escHtml(d.contentType === 'reel' ? 'Reel' : d.contentType === 'story' ? 'Storja' : 'Post')}${d.mediaCount ? ` · ${d.mediaCount} media` : ''} · ${new Date(d.savedAt).toLocaleString('mt')}</span>")
m.rep("<span class=\"draft-caption\">${escHtml(d.caption.slice(0,80))}${d.caption.length > 80 ? '…' : ''}</span>","<span class=\"draft-caption\">${escHtml((d.caption || '(mingħajr kaption)').slice(0,80))}${(d.caption || '').length > 80 ? '…' : ''}</span>")
m.rep("container.onclick = e => {\n    const btn = e.target.closest('[data-action]');","container.onclick = async e => {\n    const btn = e.target.closest('[data-action]');")
m.rx(r"      const d = loadDrafts\(\)\[i\];\n      if \(!d\) return;.*?      doAutosave\(\);\n    \} else \{\n      const drafts = loadDrafts\(\);\n      drafts\.splice\(i, 1\);",
r'''      const d = loadDrafts()[i];
      if (!d) return;
      const files = d.id && d.mediaCount ? await loadMedia(`draft:${d.id}`) : [];
      applyFormState(d, files);
      document.getElementById('drafts-modal').style.display = 'none';
      doAutosave();
      if (d.mediaCount && !files.length) showToast('Il-media ta\' dan l-abbozz ma setgħetx tinġieb. Erġa\' żidha.', 'warn');
    } else {
      const drafts = loadDrafts();
      const gone = drafts.splice(i, 1)[0];
      if (gone?.id) deleteMedia(`draft:${gone.id}`);''')

# applyFormState shared by drafts + "reuse last post"
m.rep("// ── Reset form ────────────────────────────────────────────────────────────────\n","""function applyFormState(d, files = []) {
  if (captionEl) { captionEl.value = d.caption || ''; updateCaptionCount(); }
  const stEl = document.getElementById('scheduled-time');
  const etEl = document.getElementById('expiry-time');
  if (stEl) stEl.value = d.scheduledTime || '';
  if (etEl) etEl.value = d.expiryTime    || '';
  document.querySelectorAll('.platform[data-platform]').forEach(badge => {
    const on = (d.platforms || []).includes(badge.dataset.platform);
    badge.dataset.on = on ? 'true' : 'false';
    badge.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const eg = document.getElementById('expiry-group');
  if (eg) eg.style.display = (d.platforms || []).includes('wp') ? '' : 'none';
  setContentType(d.contentType || 'post');
  if (d.profileId && _profiles.some(p => p.id === d.profileId)) {
    _selectedProfileId = d.profileId;
    localStorage.setItem('banditur_profile_id', _selectedProfileId);
    syncProfileSelects();
  }
  pickedMedia = [...files];
  renderMediaPreviews();
  updateInlinePreview();
}

// ── Reset form ────────────────────────────────────────────────────────────────
""")
m.rep("  pickedMedia = [];\n  renderMediaPreviews();\n  updateInlinePreview();\n  localStorage.removeItem(AUTOSAVE_KEY);\n  markSaved(new Date());\n});",
      "  pickedMedia = [];\n  renderMediaPreviews();\n  updateInlinePreview();\n  localStorage.removeItem(AUTOSAVE_KEY);\n  deleteMedia('autosave');\n  markSaved(new Date());\n});")

# ---- preview extras
m.rx(r"  return platsToShow\.map\(plat => renderPreviewCard\(\{\n    platform: PLAT_LABELS\[plat\] \|\| plat,.*?\}\)\)\.join\(''\);\n\}",
r'''  const IG_CUT = 125;
  const typeNote = contentType === 'post' ? '' : `<p class="preview-note">${contentType === 'reel' ? 'Reel' : 'Storja'} jintwera 9:16 (bil-wieqfa). Iċċekkja li l-parti importanti tidher f'nofs il-frame.</p>`;
  return typeNote + platsToShow.map(plat => {
    const cut = plat === 'ig' && caption.length > IG_CUT;
    return renderPreviewCard({
      platform: PLAT_LABELS[plat] || plat,
      profileName: profName,
      initials,
      scheduledLabel: dt ? `${dt} (ħin ta' Malta)` : '',
      caption: cut ? `${caption.slice(0, IG_CUT).trimEnd()}… aktar` : caption,
      mediaHtml,
    }) + (cut ? `<p class="preview-note">Fuq Instagram jidhru biss l-ewwel ${IG_CUT} karattru qabel "aktar".</p>` : '');
  }).join('');
}''')

# ---- schedule click handler
m.rx(r"  if \(!navigator\.onLine\) \{\n    const drafts = loadDrafts\(\);\n    drafts\.unshift\(collectScheduleForm\(\)\);\n    persistDrafts\(drafts\);\n    updateDraftsBtn\(\);\n    showToast\(TOAST\.offline, 'warn'\);\n    return;\n  \}",
r'''  if (!navigator.onLine) {
    await saveCurrentAsDraft();
    showScheduleStatus(TOAST.offline, 'warn');
    showToast(TOAST.offline, 'warn');
    return;
  }''')
m.rep("    showScheduleStatus(`${contentType === 'reel' ? 'Reel' : 'Storja'} teħtieġ medjum.`, 'error');\n    return;\n  }",
"    showScheduleStatus(`${contentType === 'reel' ? 'Reel' : 'Storja'} teħtieġ medjum.`, 'error');\n    return;\n  }\n  const fitProblem = mediaFitProblem();\n  if (fitProblem) { showScheduleStatus(fitProblem, 'error'); return; }")
m.rep("  if (!scheduledTime) { showScheduleStatus(ERR.no_time, 'error'); return; }\n",
"""  if (!scheduledTime) { showScheduleStatus(ERR.no_time, 'error'); return; }
  if (new Date(scheduledTime).getTime() < Date.now() - 60000) {
    const go = await showConfirm(CONFIRM.past_time, { yes: 'Ippubblika issa', no: 'Biddel il-ħin' });
    if (!go) { document.getElementById('scheduled-time')?.focus(); return; }
  }
""")
m.rep("    showScheduleStatus(SCHED.scheduled, 'ok');\n    showToast(TOAST.scheduled, 'ok');\n",
"""    _lastScheduled = { form: collectScheduleForm(), files: [...pickedMedia] };
    showScheduleStatus(SCHED.scheduled, 'ok');
    document.getElementById('schedule-status')?.insertAdjacentHTML('beforeend',
      '<button type="button" class="settings-link" id="reuse-last-btn">Erġa\\' uża dan il-post</button>');
    showToast(TOAST.scheduled, 'ok', {
      label: 'Ara fil-kju',
      onClick: () => { showView('arkivju'); document.querySelector('.archive-source-tab[data-archive-source="queue"]')?.click(); },
    });
""")
m.rep("    localStorage.removeItem(AUTOSAVE_KEY);\n    markSaved(new Date());\n\n  } catch (err) {","    localStorage.removeItem(AUTOSAVE_KEY);\n    deleteMedia('autosave');\n    markSaved(new Date());\n\n  } catch (err) {")
m.rep("document.getElementById('btn-schedule')?.addEventListener('click', async () => {","""let _lastScheduled = null;
document.addEventListener('click', e => {
  if (e.target.closest('#reuse-last-btn') && _lastScheduled) {
    applyFormState(_lastScheduled.form, _lastScheduled.files);
    const ss = document.getElementById('schedule-status'); if (ss) ss.style.display = 'none';
    doAutosave();
    captionEl?.focus();
  }
  const go = e.target.closest('[data-goto]');
  if (go) showView(go.dataset.goto);
});

// Quick publish-time buttons
document.querySelectorAll('[data-time-preset]').forEach(btn => btn.addEventListener('click', () => {
  const d = new Date();
  const k = btn.dataset.timePreset;
  if (k === 'hour') { d.setHours(d.getHours() + 1, 0, 0, 0); }
  else if (k === 'tonight') { d.setHours(20, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); }
  else if (k === 'tomorrow-am') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  else { d.setDate(d.getDate() + 1); d.setHours(18, 30, 0, 0); }
  const pad = n => String(n).padStart(2, '0');
  const stEl = document.getElementById('scheduled-time');
  stEl.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  stEl.dispatchEvent(new Event('change', { bubbles: true }));
  stEl.dispatchEvent(new Event('input', { bubbles: true }));
}));

document.getElementById('btn-schedule')?.addEventListener('click', async () => {""")

# ---- archive empty state action
m.rep("title: EMPTY.no_posts, body: errNote.trim() || 'Meta ma rritornat l-ebda post għal dan il-kont.' })","title: EMPTY.no_posts, body: errNote.trim() || 'Meta ma rritornat l-ebda post għal dan il-kont.', action: '<button type=\"button\" class=\"btn-secondary btn-sm\" data-goto=\"skeda\">Skeda post ġdid</button>' })")
m.rep("title: EMPTY.no_posts, body: 'Mhemmx records għall-filtri magħżula.' })","title: EMPTY.no_posts, body: 'M\\'hemmx rekords għall-filtri magħżula.', action: '<button type=\"button\" class=\"btn-secondary btn-sm\" data-goto=\"skeda\">Skeda post ġdid</button>' })")
m.rep("'Records interni tal-Banditur minn Supabase.'","'Rekords interni tal-Banditur minn Supabase.'")
m.rep("body: 'Mhemmx avvenimenti f’dan il-perijodu.'","body: 'M\\'hemm l-ebda avveniment f\\'dan il-perijodu.'") if False else None

# ---- modal focus return + close guard (append before Init block)
m.rep("// Default the publish time to tomorrow 18:30 local","""// Give focus back to whatever opened a dialog once it closes.
document.querySelectorAll('.modal-overlay').forEach(mo => {
  new MutationObserver(() => {
    if (mo.style.display === 'none' && mo._returnFocus) {
      const el = mo._returnFocus; mo._returnFocus = null;
      if (el.isConnected) el.focus();
    }
  }).observe(mo, { attributes: true, attributeFilter: ['style'] });
});

// Warn before closing the window while something is still running.
function anyJobRunning() {
  const exportBar = document.getElementById('sub-export-status');
  const exporting = exportBar && !exportBar.hidden && !document.getElementById('sub-export-cancel')?.hidden;
  return runBtn.disabled || txProcessing || exporting || !!document.getElementById('yt-download-btn')?.disabled;
}
try {
  getCurrentWindow().onCloseRequested(async ev => {
    if (!anyJobRunning()) return;
    ev.preventDefault();
    const quit = await showConfirm(CONFIRM.quit_busy, { yes: 'Agħlaq xorta', no: 'Ibqa hawn', danger: true });
    if (quit) await getCurrentWindow().destroy();
  });
} catch { /* not running inside Tauri (browser preview) */ }

// Default the publish time to tomorrow 18:30 local""")

m.done()
for x in miss: print('MISS',x)
print('misses',len(miss))
