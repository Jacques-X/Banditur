import { invoke }           from '@tauri-apps/api/core';
import { convertFileSrc }   from '@tauri-apps/api/core';
import { listen }           from '@tauri-apps/api/event';
import { open }             from '@tauri-apps/plugin-dialog';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { check as checkForUpdate } from '@tauri-apps/plugin-updater';
import { getVersion }       from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Calendar }         from '@fullcalendar/core';
import dayGridPlugin        from '@fullcalendar/daygrid';
import timeGridPlugin       from '@fullcalendar/timegrid';
import listPlugin           from '@fullcalendar/list';
import interactionPlugin    from '@fullcalendar/interaction';
import {
  STATUS_LABELS, ERR, TOOLS, TX, YT, SCHED, TOAST, EMPTY, CONFIRM, BTN, ABOUT, REPORT,
  BUILTIN_TEMPLATES,
} from './strings.js';
import {
  renderArchiveThumb as uiRenderArchiveThumb,
  renderPreviewCard,
  renderState,
  renderStatus,
  renderTableState,
  renderToast,
  setButtonLoading,
} from './ui.js';

// ── Utilities ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'); // L4: escape single quotes for defensive future use
}

// Convert Latin letters/digits to Unicode Mathematical Sans-Serif Bold/Italic.
// Non-Latin characters (e.g. Maltese ħ, ġ, ċ) pass through unchanged so captions
// remain fully readable on Facebook and Instagram.
function unicodeBold(text) {
  return [...text].map(c => {
    const cp = c.codePointAt(0);
    if (cp >= 0x41 && cp <= 0x5A) return String.fromCodePoint(cp - 0x41 + 0x1D5D4); // A-Z
    if (cp >= 0x61 && cp <= 0x7A) return String.fromCodePoint(cp - 0x61 + 0x1D5EE); // a-z
    if (cp >= 0x30 && cp <= 0x39) return String.fromCodePoint(cp - 0x30 + 0x1D7EC); // 0-9
    return c;
  }).join('');
}

function unicodeItalic(text) {
  return [...text].map(c => {
    const cp = c.codePointAt(0);
    if (cp >= 0x41 && cp <= 0x5A) return String.fromCodePoint(cp - 0x41 + 0x1D608); // A-Z sans-serif italic
    if (cp >= 0x61 && cp <= 0x7A) return String.fromCodePoint(cp - 0x61 + 0x1D622); // a-z sans-serif italic
    return c;
  }).join('');
}

// ── Config ─────────────────────────────────────────────────────────────────────
let _appConfig = {};

async function initConfig() {
  try {
    _appConfig = await invoke('get_config');
  } catch {
    try { _appConfig = JSON.parse(localStorage.getItem('banditur_config') || '{}'); } catch {}
  }
}

function loadConfig() { return _appConfig; }

function selectedProfileId() {
  return _selectedProfileId || 'main';
}

function selectedProfileName() {
  return _profiles.find(p => p.id === selectedProfileId())?.name || selectedProfileId();
}

function syncProfileSelects() {
  const options = _profiles
    .map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name || p.id)}</option>`)
    .join('');
  document.querySelectorAll('[data-profile-select]').forEach(sel => {
    sel.innerHTML = options;
    sel.value = _profiles.some(p => p.id === _selectedProfileId) ? _selectedProfileId : _profiles[0]?.id || 'main';
  });
}

async function loadProfiles() {
  const cfg = loadConfig();
  if (!cfg.vercelUrl || !cfg.apiKey) {
    syncProfileSelects();
    return;
  }

  try {
    const res = await fetch(`${cfg.vercelUrl}/api/meta?type=profiles`, {
      headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const profiles = await res.json();
    if (Array.isArray(profiles) && profiles.length) {
      _profiles = profiles;
      if (!_profiles.some(p => p.id === _selectedProfileId)) {
        _selectedProfileId = _profiles[0].id;
        localStorage.setItem('banditur_profile_id', _selectedProfileId);
      }
    }
  } catch {}

  syncProfileSelects();
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const layer = document.getElementById('toast-layer');
  const card  = document.createElement('div');
  card.className   = `toast-card toast-${type}`;
  card.innerHTML = renderToast(msg, type);
  layer.appendChild(card);
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('toast-in')));
  setTimeout(() => {
    card.classList.remove('toast-in');
    card.classList.add('toast-out');
    setTimeout(() => card.remove(), 300);
  }, 4200);
}

// ── Custom confirm dialog ──────────────────────────────────────────────────────
function showConfirm(message) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-msg').textContent = message;
    modal.style.display = 'flex';
    focusModal(modal);
    const yes = document.getElementById('confirm-yes');
    const no  = document.getElementById('confirm-no');
    function cleanup(result) {
      modal.style.display = 'none';
      yes.onclick = null;
      no.onclick  = null;
      resolve(result);
    }
    yes.onclick = () => cleanup(true);
    no.onclick  = () => cleanup(false);
  });
}

// ── Modal focus management ────────────────────────────────────────────────────
function focusModal(modalEl) {
  requestAnimationFrame(() => {
    const first = modalEl.querySelector('input, select, textarea, button:not([disabled])');
    if (first) first.focus();
  });
}

// ── State ──────────────────────────────────────────────────────────────────────
let activeView        = 'skeda';
let activeTab         = 'marka';
let resolvedOutputDir = null;
let txProcessing      = false;
let txUnlisten        = null;
let txVideoPath       = null;
let txSrtPath         = null;
let rawWords          = [];
let currentSegments   = [];
let chunkSize         = 4;
let maxPause          = 0.8;
let pickedMedia       = [];
let currentFilter     = 'all';
let contentType       = 'post';
let _txRechunkTimer   = null;
let _archivePage      = 1;
let _archiveTotal     = 0;
let _archiveSearch    = '';
let _archiveSource    = 'live';
let _autosaveTimer    = null;
let _previewUrls      = [];
let _inlinePreviewUrls = [];
let _profiles         = [{ id: 'main', name: 'Kumitat Ċentrali' }];
let _selectedProfileId = localStorage.getItem('banditur_profile_id') || 'main';
const ARCHIVE_PER_PAGE = 50;

// ── DOM refs ───────────────────────────────────────────────────────────────────
const progressBar     = document.getElementById('progress-bar');
const statusLabel     = document.getElementById('status');
const logEl           = document.getElementById('log');
const runBtn          = document.getElementById('run-btn');
const openBtn         = document.getElementById('open-btn');
const panelTranscribe = document.getElementById('panel-transcribe');
const captionEl       = document.getElementById('caption');
const captionCountEl  = document.getElementById('caption-count');

// watermark
const inputField      = document.getElementById('input-dir');
const outputField     = document.getElementById('output-dir');
const photographerSel = document.getElementById('photographer');
const compressToggle  = document.getElementById('compress-toggle');
const compressOptions = document.getElementById('compress-options');
const qualitySlider   = document.getElementById('quality');
const qualityVal      = document.getElementById('quality-val');
const maxDimSlider    = document.getElementById('max-dim');
const maxDimVal       = document.getElementById('max-dim-val');

// ARW
const arwInputField      = document.getElementById('arw-input-dir');
const arwOutputField     = document.getElementById('arw-output-dir');
const arwCompressToggle  = document.getElementById('arw-compress-toggle');
const arwCompressOptions = document.getElementById('arw-compress-options');
const arwQualitySlider   = document.getElementById('arw-quality');
const arwQualityVal      = document.getElementById('arw-quality-val');
const arwMaxDimSlider    = document.getElementById('arw-max-dim');
const arwMaxDimVal       = document.getElementById('arw-max-dim-val');

// transcription
const txDropView     = document.getElementById('tx-drop-view');
const txEditorView   = document.getElementById('tx-editor-view');
const txDropZone     = document.getElementById('tx-drop-zone');
const txStatus       = document.getElementById('tx-status');
const txProgressWrap = document.getElementById('tx-progress-wrap');
const txProgressFill = document.getElementById('tx-progress-fill');
const txBtnBack      = document.getElementById('tx-btn-back');
const txBtnSave      = document.getElementById('tx-btn-save');
const txVideo        = document.getElementById('tx-video');
const txSegments     = document.getElementById('tx-segments');
const txChunkSlider  = document.getElementById('tx-chunk-slider');
const txChunkVal     = document.getElementById('tx-chunk-val');
const txPauseSlider  = document.getElementById('tx-pause-slider');
const txPauseVal     = document.getElementById('tx-pause-val');

// ── View switching ─────────────────────────────────────────────────────────────
function showView(name) {
  activeView = name;
  localStorage.setItem('banditur_view', name);

  document.querySelectorAll('.nav-item[data-nav]').forEach(btn => {
    const isActive = btn.dataset.nav === name;
    btn.dataset.active = isActive ? 'true' : 'false';
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  document.querySelectorAll('.view').forEach(sec => {
    sec.classList.toggle('active', sec.dataset.view === name);
  });

  if (name === 'arkivju')  { loadArchive(); initReportDates(); }
  if (name === 'calendar') { loadCalendarEvents(); updateSetupBanner(); }
  if (name === 'skeda')    { updateSetupBanner(); }
}

document.querySelectorAll('.nav-item[data-nav]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.nav));
});

document.addEventListener('change', e => {
  const sel = e.target.closest('[data-profile-select]');
  if (!sel) return;
  _selectedProfileId = sel.value || 'main';
  localStorage.setItem('banditur_profile_id', _selectedProfileId);
  syncProfileSelects();
  if (activeView === 'arkivju') loadArchive();
});

function updateSetupBanner() {
  const cfg    = loadConfig();
  const banner = document.getElementById('setup-banner');
  if (!banner) return;
  banner.style.display = (!cfg.vercelUrl || !cfg.apiKey) ? '' : 'none';
}

function compareSemver(a, b) {
  const pa = String(a || '0.0.0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function checkBackendCompatibility() {
  const cfg = loadConfig();
  if (!cfg.vercelUrl) return;

  try {
    const [appVersion, res] = await Promise.all([
      getVersion().catch(() => '0.0.0'),
      fetch(`${cfg.vercelUrl}/api/meta?type=version`, {
        headers: cfg.apiKey ? { 'Authorization': `Bearer ${cfg.apiKey}` } : {},
      }),
    ]);
    if (!res.ok) return;
    const info = await res.json();
    if (info.minimum_desktop_version && compareSemver(appVersion, info.minimum_desktop_version) < 0) {
      showToast(`Banditur ${info.minimum_desktop_version} jew aktar ġdid meħtieġ.`, 'warn');
      setUpdateStatus(`Verżjoni ${info.minimum_desktop_version} jew aktar ġdida meħtieġa.`);
    }
  } catch {}
}

document.getElementById('setup-banner-open')?.addEventListener('click', () => {
  document.getElementById('settings-btn')?.click();
});

// ── Tool tab switching ─────────────────────────────────────────────────────────
function showToolTab(tab) {
  activeTab = tab;

  document.querySelectorAll('.tool-tab[data-tool]').forEach(btn => {
    btn.dataset.active = btn.dataset.tool === tab ? 'true' : 'false';
  });
  document.querySelectorAll('.tool-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === tab);
  });

  const toolContent   = document.getElementById('tool-content');
  const sharedBottom  = document.getElementById('shared-bottom');
  const appFooter     = document.getElementById('app-footer');
  const ytmp3Footer   = document.getElementById('ytmp3-footer');
  const isTrask       = tab === 'trask';
  const isYtmp3       = tab === 'ytmp3';
  const hideShared    = isTrask || isYtmp3;

  toolContent.classList.toggle('tx-mode', isTrask);
  sharedBottom.style.display  = hideShared ? 'none' : '';
  appFooter.style.display     = (hideShared) ? 'none' : '';
  if (ytmp3Footer) ytmp3Footer.style.display = isYtmp3 ? '' : 'none';

  if (!hideShared) {
    runBtn.textContent      = tab === 'marka' ? TOOLS.run_watermark : TOOLS.run_arw;
    statusLabel.textContent = TOOLS.ready;
    progressBar.style.width = '0%';
    openBtn.disabled        = true;
    resolvedOutputDir       = null;
  } else if (isTrask) {
    invoke('preload_transcribe').catch(() => {});
  }
}

document.querySelectorAll('.tool-tab[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => showToolTab(btn.dataset.tool));
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;

  if (!inInput) {
    if (e.key === '1') { showView('ghodda'); return; }
    if (e.key === '2') { showView('skeda');  return; }
    if (e.key === '3') { showView('calendar'); return; }
    if (e.key === '4') { showView('arkivju'); return; }
  }

  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    showView('arkivju');
    document.getElementById('archive-search')?.focus();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('btn-schedule')?.click();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && txSrtPath) {
    e.preventDefault();
    saveSrt();
  }
});

// ── Settings modal ─────────────────────────────────────────────────────────────
document.getElementById('settings-btn').addEventListener('click', () => {
  const cfg = loadConfig();
  const cfgVercel   = document.getElementById('cfg-vercel-url');
  const cfgApiKey   = document.getElementById('cfg-api-key');
  const cfgSbUrl    = document.getElementById('cfg-supabase-url');
  const cfgSbKey    = document.getElementById('cfg-supabase-key');
  if (cfgVercel)  cfgVercel.value  = cfg.vercelUrl    || '';
  if (cfgApiKey)  cfgApiKey.value  = cfg.apiKey       || '';
  if (cfgSbUrl)   cfgSbUrl.value   = cfg.supabaseUrl  || '';
  if (cfgSbKey)   cfgSbKey.value   = cfg.supabaseKey  || '';
  const urlEl = document.getElementById('about-vercel-url');
  if (urlEl) urlEl.textContent = cfg.vercelUrl ? ABOUT.backend(cfg.vercelUrl) : ABOUT.backend_missing;
  const modal = document.getElementById('settings-modal');
  modal.style.display = 'flex';
  focusModal(modal);
});

document.getElementById('close-settings-btn').addEventListener('click', () => {
  document.getElementById('settings-modal').style.display = 'none';
});
document.getElementById('settings-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

document.getElementById('save-settings-btn')?.addEventListener('click', () => {
  const cfg = {
    vercelUrl:   document.getElementById('cfg-vercel-url')?.value.trim()  || '',
    apiKey:      document.getElementById('cfg-api-key')?.value.trim()     || '',
    supabaseUrl: document.getElementById('cfg-supabase-url')?.value.trim() || '',
    supabaseKey: document.getElementById('cfg-supabase-key')?.value.trim() || '',
  };
  localStorage.setItem('banditur_config', JSON.stringify(cfg));
  _appConfig = cfg;
  document.getElementById('settings-modal').style.display = 'none';
  showToast(TOAST.settings_saved, 'ok');
  updateSetupBanner();
  loadProfiles();
  checkBackendCompatibility();
  if (activeView === 'calendar') { loadCalendarEvents(); }
  if (activeView === 'arkivju') loadArchive();
});

function setUpdateStatus(text) {
  const el = document.getElementById('update-status');
  if (el) el.textContent = text;
}

document.getElementById('check-update-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('check-update-btn');
  if (!btn) return;

  setButtonLoading(btn, true, '...');
  setUpdateStatus('Qed niċċekkja...');

  try {
    const update = await checkForUpdate({ timeout: 15000 });
    if (!update) {
      setUpdateStatus('L-aħħar verżjoni diġà installata.');
      return;
    }

    const notes = update.body ? `\n\n${update.body}` : '';
    const ok = await showConfirm(`Verżjoni ${update.version} disponibbli. Tinstallaha issa?${notes}`);
    if (!ok) {
      setUpdateStatus(`Verżjoni ${update.version} disponibbli.`);
      return;
    }

    let downloaded = 0;
    let total = 0;
    setUpdateStatus(`Qed iniżżel ${update.version}...`);
    await update.downloadAndInstall(event => {
      if (event.event === 'Started') {
        total = event.data.contentLength || 0;
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        if (total) setUpdateStatus(`Qed iniżżel ${Math.round((downloaded / total) * 100)}%...`);
      } else if (event.event === 'Finished') {
        setUpdateStatus('Aġġornament installat. Qed jerġa\' jiftaħ...');
      }
    });
    await invoke('restart_app');
  } catch (err) {
    setUpdateStatus(`Ma setax jiċċekkja: ${String(err).split('\n')[0]}`);
  } finally {
    setButtonLoading(btn, false);
  }
});

// ── Compression controls ───────────────────────────────────────────────────────
const watermarkToggle   = document.getElementById('watermark-toggle');
const photographerWrap  = document.getElementById('photographer-wrap');

watermarkToggle?.addEventListener('change', () => {
  if (photographerWrap) photographerWrap.style.display = watermarkToggle.checked ? '' : 'none';
});

compressToggle.addEventListener('change', () => {
  compressOptions.style.display = compressToggle.checked ? '' : 'none';
});
qualitySlider.addEventListener('input', () => { qualityVal.textContent = `${qualitySlider.value}%`; });
maxDimSlider.addEventListener('input',  () => { maxDimVal.textContent  = `${maxDimSlider.value}px`; });

arwCompressToggle.addEventListener('change', () => {
  arwCompressOptions.style.display = arwCompressToggle.checked ? '' : 'none';
});
arwQualitySlider.addEventListener('input', () => { arwQualityVal.textContent = `${arwQualitySlider.value}%`; });
arwMaxDimSlider.addEventListener('input',  () => { arwMaxDimVal.textContent  = `${arwMaxDimSlider.value}px`; });

// ── Folder pickers ─────────────────────────────────────────────────────────────
function autoOutputPath(p) {
  const sep   = p.includes('\\') ? '\\' : '/';
  const parts = p.split(sep);
  const name  = parts.pop();
  return [...parts, `${name}-riżultat`].join(sep);
}

async function pickDir(field, afterPick) {
  const selected = await open({ directory: true, multiple: false });
  if (selected) { field.value = selected; afterPick?.(selected); }
}

document.getElementById('browse-input').addEventListener('click', () =>
  pickDir(inputField, p => { outputField.value = autoOutputPath(p); refreshPhotographers(); })
);
document.getElementById('browse-output').addEventListener('click', () => pickDir(outputField));
document.getElementById('browse-arw-input').addEventListener('click', () =>
  pickDir(arwInputField, p => { arwOutputField.value = autoOutputPath(p); })
);
document.getElementById('browse-arw-output').addEventListener('click', () => pickDir(arwOutputField));

// ── Photographers ──────────────────────────────────────────────────────────────
async function refreshPhotographers() {
  try {
    const names   = await invoke('list_photographers');
    const current = photographerSel.value;
    photographerSel.innerHTML = names.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
    if (current && names.includes(current)) photographerSel.value = current;
  } catch (_) {}
}

document.getElementById('refresh-btn').addEventListener('click', refreshPhotographers);

// ── Log ────────────────────────────────────────────────────────────────────────
let _logScrollRaf = null;
function appendLog(tag, msg) {
  const span = document.createElement('span');
  span.className   = `l-${tag}`;
  span.textContent = msg + '\n';
  logEl.appendChild(span);
  if (_logScrollRaf === null) {
    _logScrollRaf = requestAnimationFrame(() => {
      logEl.scrollTop = logEl.scrollHeight;
      _logScrollRaf   = null;
    });
  }
}

document.getElementById('clear-log').addEventListener('click', () => { logEl.innerHTML = ''; });
openBtn.addEventListener('click', async () => { if (resolvedOutputDir) await openPath(resolvedOutputDir); });

// ── Rust events ────────────────────────────────────────────────────────────────
function safeListen(eventName, handler) {
  try {
    listen(eventName, handler).catch(() => {});
  } catch (_) {}
}

safeListen('log', e => appendLog(e.payload.tag, e.payload.msg));

safeListen('progress', e => {
    const pct = Math.round(e.payload.fraction * 100);
    progressBar.style.width = `${pct}%`;
    statusLabel.textContent = TOOLS.progress(pct);
});

safeListen('done', e => {
    const { portrett, pajsagg, imqabbla, output_dir } = e.payload;
    resolvedOutputDir       = output_dir;
    runBtn.disabled         = false;
    runBtn.textContent      = TOOLS.run_watermark;
    openBtn.disabled        = false;
    statusLabel.textContent = TOOLS.done_wm(portrett, pajsagg, imqabbla);
});

safeListen('raw-done', e => {
    const { converted, skipped, output_dir } = e.payload;
    resolvedOutputDir       = output_dir;
    runBtn.disabled         = false;
    runBtn.textContent      = TOOLS.run_arw;
    openBtn.disabled        = false;
    statusLabel.textContent = TOOLS.done_arw(converted, skipped);
});

// ── Run button ─────────────────────────────────────────────────────────────────
runBtn.addEventListener('click', async () => {
  if (runBtn.disabled) return;
  logEl.innerHTML         = '';
  progressBar.style.width = '0%';
  statusLabel.textContent = TOOLS.starting;
  openBtn.disabled        = true;
  runBtn.disabled         = true;

  if (activeTab === 'marka') {
    const inputDir     = inputField.value.trim();
    const outputDir    = outputField.value.trim() || 'riżultat';
    const photographer = photographerSel.value.trim();
    const watermark    = watermarkToggle?.checked ?? true;

    if (!inputDir) { appendLog('error', ERR.no_input_dir); runBtn.disabled = false; return; }
    if (watermark && !photographer) { appendLog('error', ERR.no_photographer); runBtn.disabled = false; return; }

    runBtn.textContent = TOOLS.running_wm;
    try {
      const quality = compressToggle.checked ? parseInt(qualitySlider.value) : 95;
      const maxDim  = compressToggle.checked ? parseInt(maxDimSlider.value)  : 0;
      await invoke('process_images', { inputDir, outputDir, photographer, quality, maxDim, watermark });
    } catch (e) {
      appendLog('error', ERR.fatal(e));
      runBtn.disabled         = false;
      runBtn.textContent      = TOOLS.run_watermark;
      statusLabel.textContent = TOOLS.error_log;
    }
  } else if (activeTab === 'arw') {
    const inputDir  = arwInputField.value.trim();
    const outputDir = arwOutputField.value.trim() || 'riżultat-jpg';

    if (!inputDir) { appendLog('error', ERR.no_arw_dir); runBtn.disabled = false; return; }

    runBtn.textContent = TOOLS.running_arw;
    try {
      const quality = arwCompressToggle.checked ? parseInt(arwQualitySlider.value) : 95;
      const maxDim  = arwCompressToggle.checked ? parseInt(arwMaxDimSlider.value)  : 0;
      await invoke('convert_raw_batch', { inputDir, outputDir, quality, maxDim });
    } catch (e) {
      appendLog('error', ERR.fatal(e));
      runBtn.disabled         = false;
      runBtn.textContent      = TOOLS.run_arw;
      statusLabel.textContent = TOOLS.error_log;
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Transcription
// ═══════════════════════════════════════════════════════════════════════════════

function ts(seconds) {
  const h  = Math.floor(seconds / 3600);
  const m  = Math.floor((seconds % 3600) / 60);
  const s  = Math.floor(seconds % 60);
  const ms = Math.min(Math.round((seconds % 1) * 1000), 999);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function txSetStatus(text, type = 'idle') {
  txStatus.textContent = text;
  txStatus.className   = `tx-status tx-${type}`;
}

function txShowProgress(value) {
  txProgressWrap.hidden = false;
  if (value < 0) {
    txProgressFill.classList.add('indeterminate');
    txProgressFill.style.width = '40%';
  } else {
    txProgressFill.classList.remove('indeterminate');
    txProgressFill.style.width = `${value}%`;
  }
}

function txHideProgress() {
  txProgressWrap.hidden = true;
  txProgressFill.classList.remove('indeterminate');
  txProgressFill.style.width = '0%';
}

function txSetIdle() {
  txSetStatus(TX.idle, 'idle');
  txHideProgress();
  txDropZone.classList.remove('disabled');
  txProcessing = false;
}

function makeSegment(words) {
  return {
    start:   words[0].start,
    end:     words[words.length - 1].end,
    speaker: words[0].speaker,
    text:    words.map(w => w.word).join(''),
    words,
  };
}

function chunkWords(words, size, maxPauseSec) {
  const segments = [];
  let chunk = [];
  for (const w of words) {
    if (chunk.length > 0) {
      const prev = chunk[chunk.length - 1];
      if (
        chunk.length >= size ||
        w.speaker !== prev.speaker ||
        w.start - prev.end > maxPauseSec
      ) {
        segments.push(makeSegment(chunk));
        chunk = [];
      }
    }
    chunk.push(w);
  }
  if (chunk.length) segments.push(makeSegment(chunk));
  return segments;
}

function buildSrt(segments) {
  return segments
    .filter(s => s.text.trim())
    .map((s, i) =>
      `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text.trim()}`
    )
    .join('\n\n') + '\n';
}

function renderEditor(segments) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const div = document.createElement('div');
    div.className       = 'seg';
    div.dataset.start   = seg.start;
    div.dataset.end     = seg.end;
    div.dataset.speaker = seg.speaker;

    const tsDiv = document.createElement('div');
    tsDiv.className   = 'seg-ts';
    tsDiv.textContent = `${ts(seg.start)} → ${ts(seg.end)}`;
    tsDiv.title       = TX.ts_hint;

    const rowDiv = document.createElement('div');
    rowDiv.className = 'seg-row';

    const spk = document.createElement('span');
    spk.className   = 'seg-spk';
    spk.textContent = `[${seg.speaker}]:`;

    const textSpan = document.createElement('span');
    textSpan.className       = 'seg-text';
    textSpan.contentEditable = 'plaintext-only';

    for (const w of seg.words) {
      if (w.probability < 0.65) {
        const span = document.createElement('span');
        span.className   = 'lc';
        span.title       = `${Math.round(w.probability * 100)}%`;
        span.textContent = w.word;
        textSpan.appendChild(span);
      } else {
        textSpan.appendChild(document.createTextNode(w.word));
      }
    }

    const idx = i;
    textSpan.addEventListener('input', () => { segments[idx].text = textSpan.textContent; });

    rowDiv.append(spk, textSpan);
    div.append(tsDiv, rowDiv);
    frag.appendChild(div);
  }
  txSegments.innerHTML = '';
  txSegments.appendChild(frag);
}

async function saveSrt() {
  if (!txSrtPath) return;
  try {
    await invoke('save_srt', { path: txSrtPath, content: buildSrt(currentSegments) });
    txBtnSave.textContent = TX.saved;
    txBtnSave.classList.add('saved');
    setTimeout(() => { txBtnSave.textContent = TX.save_btn; txBtnSave.classList.remove('saved'); }, 2200);
  } catch {
    txBtnSave.textContent = TX.save_error;
    setTimeout(() => { txBtnSave.textContent = TX.save_btn; }, 2000);
  }
}

function handleTxUpdate(data) {
  switch (data.type) {
    case 'status':
      txSetStatus(data.message, 'active');
      break;
    case 'progress':
      if      (data.value < 0) txShowProgress(-1);
      else if (data.value === 0) txHideProgress();
      else { txShowProgress(data.value); txSetStatus(TX.transcribing(data.value), 'active'); }
      break;
    case 'done':
      if (txUnlisten) { txUnlisten(); txUnlisten = null; }
      txProcessing    = false;
      txSrtPath       = data.srt_path;
      rawWords        = data.all_words || [];
      currentSegments = chunkWords(rawWords, chunkSize, maxPause);
      txVideo.src     = convertFileSrc(txVideoPath);
      renderEditor(currentSegments);
      txDropView.hidden   = true;
      txEditorView.hidden = false;
      invoke('preload_transcribe').catch(() => {});
      break;
    case 'error': {
      txSetStatus(TX.error(String(data.message).split('\n')[0]), 'error');
      txHideProgress();
      txDropZone.classList.remove('disabled');
      if (txUnlisten) { txUnlisten(); txUnlisten = null; }
      txProcessing = false;
      break;
    }
  }
}

const TRANSCRIPTION_EXTENSIONS = ['mp4', 'mov', 'mp3', 'wav'];

async function processVideo(path) {
  if (txProcessing) return;
  const extension = path.split('.').pop()?.toLowerCase();
  if (!TRANSCRIPTION_EXTENSIONS.includes(extension)) {
    txSetStatus(ERR.video_format, 'error');
    return;
  }
  txVideoPath = path;
  txProcessing = true;
  txDropZone.classList.add('disabled');
  txSetStatus(TX.starting, 'active');
  txShowProgress(-1);

  txUnlisten = await listen('transcribe-update', e => {
    const data = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
    handleTxUpdate(data);
  });

  try {
    await invoke('process_video', { videoPath: path });
  } catch (err) {
    handleTxUpdate({ type: 'error', message: String(err) });
  }
}

txDropZone.addEventListener('click', async () => {
  if (txProcessing) return;
  const path = await open({
    multiple: false,
    filters: [{ name: 'Video jew awdjo', extensions: TRANSCRIPTION_EXTENSIONS }],
  });
  if (path) processVideo(path);
});

try {
  const win = getCurrentWindow();
  win.onDragDropEvent(e => {
    const p = e.payload;
    if (activeTab !== 'trask') return;
    if (p.type === 'enter' || p.type === 'over') {
      if (!txProcessing) txDropZone.classList.add('drag-over');
    } else if (p.type === 'leave') {
      txDropZone.classList.remove('drag-over');
    } else if (p.type === 'drop') {
      txDropZone.classList.remove('drag-over');
      if (!txProcessing && p.paths?.length > 0) processVideo(p.paths[0]);
    }
  }).catch(() => {});
} catch (_) {}

txBtnBack.addEventListener('click', () => {
  txVideo.pause();
  txVideo.src          = '';
  txSegments.innerHTML = '';
  txVideoPath          = null;
  txSrtPath            = null;
  rawWords             = [];
  currentSegments      = [];
  txSetIdle();
  txEditorView.hidden = true;
  txDropView.hidden   = false;
});

txBtnSave.addEventListener('click', saveSrt);

txChunkSlider?.addEventListener('input', () => {
  chunkSize = parseInt(txChunkSlider.value);
  if (txChunkVal) txChunkVal.textContent = chunkSize;
  if (rawWords.length) {
    clearTimeout(_txRechunkTimer);
    _txRechunkTimer = setTimeout(() => {
      currentSegments = chunkWords(rawWords, chunkSize, maxPause);
      renderEditor(currentSegments);
    }, 180);
  }
});

txPauseSlider?.addEventListener('input', () => {
  maxPause = parseFloat(txPauseSlider.value);
  if (txPauseVal) txPauseVal.textContent = maxPause.toFixed(1) + 's';
  if (rawWords.length) {
    clearTimeout(_txRechunkTimer);
    _txRechunkTimer = setTimeout(() => {
      currentSegments = chunkWords(rawWords, chunkSize, maxPause);
      renderEditor(currentSegments);
    }, 180);
  }
});

txSegments.addEventListener('click', e => {
  const tsEl = e.target.closest('.seg-ts');
  if (!tsEl) return;
  const seg = tsEl.closest('.seg');
  if (!seg) return;
  txVideo.currentTime = parseFloat(seg.dataset.start);
  txVideo.play();
});

// ═══════════════════════════════════════════════════════════════════════════════
// YouTube downloader
// ═══════════════════════════════════════════════════════════════════════════════

const ytUrlInput     = document.getElementById('yt-url-input');
const ytOutputField  = document.getElementById('yt-output-dir');
const ytBrowseBtn    = document.getElementById('yt-browse-output');
const ytDownloadBtn  = document.getElementById('yt-download-btn');
const ytStatusEl     = document.getElementById('yt-status');
const ytProgressWrap = document.getElementById('yt-progress-wrap');
const ytProgressFill = document.getElementById('yt-progress-fill');
const ytOpenBtn      = document.getElementById('yt-open-btn');

let ytDownloading  = false;
let ytOutputDir    = '';
let ytLastFilePath = '';
let ytFormat       = 'mp4';

function ytFormatLabel() {
  return ytFormat.toUpperCase();
}

function updateYtFormatUi() {
  document.querySelectorAll('.yt-format-btn[data-yt-format]').forEach(btn => {
    btn.dataset.active = btn.dataset.ytFormat === ytFormat ? 'true' : 'false';
  });
  if (ytDownloadBtn) ytDownloadBtn.textContent = YT.download_format(ytFormatLabel());
}

function ytSetStatus(msg, cls = '') {
  if (!ytStatusEl) return;
  ytStatusEl.textContent = msg;
  ytStatusEl.className   = 'yt-status' + (cls ? ` yt-status-${cls}` : '');
}

function ytSetProgress(pct) {
  if (!ytProgressFill) return;
  ytProgressWrap.hidden      = pct == null;
  ytProgressFill.style.width = pct != null ? `${pct}%` : '0%';
}

async function ytStartDownload() {
  if (ytDownloading) return;

  const url = ytUrlInput?.value.trim();
  if (!url) { ytSetStatus(YT.no_url, 'warn'); return; }

  if (!ytOutputDir) {
    const picked = await open({ directory: true, title: YT.choose_output });
    if (!picked) return;
    ytOutputDir = picked;
    if (ytOutputField) ytOutputField.value = ytOutputDir;
  }

  ytDownloading = true;
  if (ytDownloadBtn) ytDownloadBtn.disabled = true;
  ytSetStatus(YT.downloading(ytFormatLabel()));
  ytSetProgress(0);
  if (ytOpenBtn) ytOpenBtn.hidden = true;

  try {
    await invoke('yt_download', { url, outputDir: ytOutputDir, format: ytFormat });
  } catch (e) {
    ytSetStatus(YT.error(String(e)), 'error');
    ytSetProgress(null);
  } finally {
    ytDownloading = false;
    if (ytDownloadBtn) ytDownloadBtn.disabled = false;
  }
}

safeListen('yt-update', e => {
    const p = e.payload;
    if (p.type === 'progress') {
      ytSetStatus(YT.downloading(p.format ? String(p.format).toUpperCase() : ytFormatLabel()));
      ytSetProgress(p.value ?? 0);
    } else if (p.type === 'converting') {
      ytSetStatus(YT.converting(p.format ? String(p.format).toUpperCase() : ytFormatLabel()));
      ytSetProgress(99);
    } else if (p.type === 'done') {
      ytLastFilePath = p.path ?? '';
      ytSetStatus(YT.done(p.title ?? ''), 'ok');
      ytSetProgress(null);
      if (ytOpenBtn) { ytOpenBtn.hidden = false; ytOpenBtn.textContent = YT.open_file; }
      ytDownloading = false;
      if (ytDownloadBtn) ytDownloadBtn.disabled = false;
    } else if (p.type === 'error') {
      ytSetStatus(YT.error(p.message ?? ''), 'error');
      ytSetProgress(null);
      ytDownloading = false;
      if (ytDownloadBtn) ytDownloadBtn.disabled = false;
    }
});

ytDownloadBtn?.addEventListener('click', ytStartDownload);

document.querySelectorAll('.yt-format-btn[data-yt-format]').forEach(btn => {
  btn.addEventListener('click', () => {
    ytFormat = btn.dataset.ytFormat || 'mp4';
    updateYtFormatUi();
  });
});
updateYtFormatUi();

ytUrlInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter') ytStartDownload();
});

ytBrowseBtn?.addEventListener('click', async () => {
  const picked = await open({ directory: true, title: YT.choose_output });
  if (picked) {
    ytOutputDir = picked;
    if (ytOutputField) ytOutputField.value = ytOutputDir;
  }
});

ytOpenBtn?.addEventListener('click', () => {
  if (ytLastFilePath) openPath(ytLastFilePath).catch(() => {});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mini Calendar
// ═══════════════════════════════════════════════════════════════════════════════

let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth();

const MONTH_NAMES = ['Jannar','Frar','Marzu','April','Mejju','Ġunju',
                     'Lulju','Awwissu','Settembru','Ottubru','Novembru','Diċembru'];

function renderMiniCal(year = _calYear, month = _calMonth) {
  _calYear  = year;
  _calMonth = month;

  const cal = document.getElementById('mini-cal');
  if (!cal) return;

  const lbl = document.getElementById('mini-cal-month-lbl');
  if (lbl) lbl.textContent = `${MONTH_NAMES[month]} ${year}`;

  const nextMonth = month === 11 ? 0    : month + 1;
  const nextYear  = month === 11 ? year + 1 : year;
  const sub = document.getElementById('cal-sub-range');
  if (sub) sub.textContent = `${MONTH_NAMES[month]}–${MONTH_NAMES[nextMonth]} ${nextYear}`;

  const now      = new Date();
  const todayDay = (now.getFullYear() === year && now.getMonth() === month) ? now.getDate() : -1;
  const firstDay = new Date(year, month, 1).getDay();
  const offset   = (firstDay + 6) % 7;
  const days     = new Date(year, month + 1, 0).getDate();

  const grid = document.createElement('div');
  grid.className = 'mini-cal-grid';

  for (let i = 0; i < offset; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell cal-empty';
    cell.setAttribute('aria-hidden', 'true');
    grid.appendChild(cell);
  }

  for (let d = 1; d <= days; d++) {
    const cell = document.createElement('button');
    cell.type      = 'button';
    cell.className = 'cal-cell';
    cell.textContent = d;
    cell.setAttribute('aria-label', `${d} ${MONTH_NAMES[month]} ${year}`);
    if (d === todayDay) cell.classList.add('cal-today');
    cell.addEventListener('click', () => {
      const iso     = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}T18:30`;
      const schedEl = document.getElementById('scheduled-time');
      if (schedEl) { schedEl.value = iso; scheduleAutosave(); }
    });
    grid.appendChild(cell);
  }

  cal.innerHTML = '';
  cal.appendChild(grid);
}

document.getElementById('cal-prev-btn')?.addEventListener('click', () => {
  const m = _calMonth === 0 ? 11 : _calMonth - 1;
  const y = _calMonth === 0 ? _calYear - 1 : _calYear;
  renderMiniCal(y, m);
});

document.getElementById('cal-next-btn')?.addEventListener('click', () => {
  const m = _calMonth === 11 ? 0 : _calMonth + 1;
  const y = _calMonth === 11 ? _calYear + 1 : _calYear;
  renderMiniCal(y, m);
});

// ═══════════════════════════════════════════════════════════════════════════════
// History table
// ═══════════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    currentFilter  = chip.dataset.filter;
    _archivePage   = 1;
    document.querySelectorAll('.filter-chip').forEach(c => c.dataset.active = 'false');
    chip.dataset.active = 'true';
    loadArchive();
  });
});

document.querySelectorAll('.archive-source-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    _archiveSource = tab.dataset.archiveSource || 'live';
    _archivePage   = 1;
    document.querySelectorAll('.archive-source-tab').forEach(t => t.dataset.active = String(t === tab));
    loadArchive();
  });
});

// Archive search — debounced, server-side
let _searchTimer = null;
document.getElementById('archive-search')?.addEventListener('input', e => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    _archiveSearch = e.target.value.trim();
    _archivePage   = 1;
    loadArchive();
  }, 350);
});

// Pagination
document.querySelector('.page-btn:first-of-type')?.addEventListener('click', () => {
  if (_archivePage > 1) { _archivePage--; loadArchive(); }
});
document.querySelector('.page-btn:last-of-type')?.addEventListener('click', () => {
  if (_archivePage * ARCHIVE_PER_PAGE < _archiveTotal) { _archivePage++; loadArchive(); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Platform badges
// ═══════════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.platform[data-platform]').forEach(btn => {
  btn.addEventListener('click', () => {
    const isOn = btn.dataset.on === 'true';
    btn.dataset.on = isOn ? 'false' : 'true';
    btn.setAttribute('aria-pressed', isOn ? 'false' : 'true');
    if (btn.dataset.platform === 'wp') {
      const eg = document.getElementById('expiry-group');
      if (eg) eg.style.display = !isOn ? '' : 'none';
    }
    updateInlinePreview();
    scheduleAutosave();
  });
});

function getSelectedPlatforms() {
  return [...document.querySelectorAll('.platform[data-on="true"]')].map(b => b.dataset.platform);
}

// ── Content-type selector ──────────────────────────────────────────────────────

const CT_HINTS = {
  post:  '',
  reel:  'Video wieħed meħtieġ',
  story: 'Medjum wieħed meħtieġ · Kaptjon fakultattiv',
};

document.querySelectorAll('.ct-tab[data-ct]').forEach(btn => {
  btn.addEventListener('click', () => {
    contentType = btn.dataset.ct;
    document.querySelectorAll('.ct-tab[data-ct]').forEach(b => {
      b.dataset.active = b === btn ? 'true' : 'false';
    });
    const hint = document.getElementById('ct-hint');
    if (hint) hint.textContent = CT_HINTS[contentType] || '';
    updateInlinePreview();
    scheduleAutosave();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Caption counter + autosave
// ═══════════════════════════════════════════════════════════════════════════════

function updateCaptionCount() {
  if (!captionCountEl || !captionEl) return;
  const len = captionEl.value.length;
  captionCountEl.textContent = len;
  captionCountEl.classList.toggle('caption-count-danger', len > 2000);
  captionCountEl.classList.toggle('caption-count-warn',   len > 1800 && len <= 2000);
  updateInlinePreview();
}
captionEl?.addEventListener('input', () => { updateCaptionCount(); scheduleAutosave(); });

// ── Autosave ──────────────────────────────────────────────────────────────────
const AUTOSAVE_KEY     = 'banditur_autosave';
const autosaveLabelEl  = document.getElementById('autosave-label');
const autosaveDotEl    = document.getElementById('autosave-dot');

function markUnsaved() {
  if (autosaveDotEl) autosaveDotEl.classList.add('unsaved');
  if (autosaveLabelEl) autosaveLabelEl.textContent = 'Mhux issejvjat';
}

function markSaved(time) {
  if (autosaveDotEl) autosaveDotEl.classList.remove('unsaved');
  if (autosaveLabelEl) {
    autosaveLabelEl.textContent = `Salvat ${time.toLocaleTimeString('mt', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

function scheduleAutosave() {
  markUnsaved();
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(doAutosave, 2000);
}

function doAutosave() {
  const state = collectScheduleForm();
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state));
  markSaved(new Date());
}

function loadAutosave() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
    if (!saved) return;
    if (captionEl && saved.caption) { captionEl.value = saved.caption; updateCaptionCount(); }
    const stEl = document.getElementById('scheduled-time');
    const etEl = document.getElementById('expiry-time');
    if (stEl && saved.scheduledTime) stEl.value = saved.scheduledTime;
    if (etEl && saved.expiryTime)    etEl.value = saved.expiryTime;
    if (saved.platforms?.length) {
      document.querySelectorAll('.platform[data-platform]').forEach(b => {
        const on = saved.platforms.includes(b.dataset.platform);
        b.dataset.on = on ? 'true' : 'false';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const eg = document.getElementById('expiry-group');
      if (eg) eg.style.display = saved.platforms.includes('wp') ? '' : 'none';
    }
    markSaved(new Date(saved.savedAt || Date.now()));
    updateInlinePreview();
  } catch {}
}

// Wire scheduled-time and expiry-time to autosave
document.getElementById('scheduled-time')?.addEventListener('change', scheduleAutosave);
document.getElementById('expiry-time')?.addEventListener('change', scheduleAutosave);
document.getElementById('scheduled-time')?.addEventListener('input', updateInlinePreview);
document.getElementById('expiry-time')?.addEventListener('input', updateInlinePreview);

// ═══════════════════════════════════════════════════════════════════════════════
// Profile swatch
// ═══════════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════════
// Caption toolbar
// ═══════════════════════════════════════════════════════════════════════════════

function insertAroundSelection(ta, before, after = before) {
  const start    = ta.selectionStart;
  const end      = ta.selectionEnd;
  const selected = ta.value.slice(start, end);
  ta.setRangeText(before + selected + after, start, end, 'end');
  if (selected) ta.setSelectionRange(start + before.length, start + before.length + selected.length);
  ta.focus();
  updateCaptionCount();
  scheduleAutosave();
}

document.getElementById('caption-bold')?.addEventListener('click', () => {
  const s = captionEl.selectionStart, e = captionEl.selectionEnd;
  if (s !== e) {
    const out = unicodeBold(captionEl.value.slice(s, e));
    captionEl.setRangeText(out, s, e, 'select');
    updateCaptionCount(); scheduleAutosave();
  }
  captionEl.focus();
});
document.getElementById('caption-italic')?.addEventListener('click', () => {
  const s = captionEl.selectionStart, e = captionEl.selectionEnd;
  if (s !== e) {
    const out = unicodeItalic(captionEl.value.slice(s, e));
    captionEl.setRangeText(out, s, e, 'select');
    updateCaptionCount(); scheduleAutosave();
  }
  captionEl.focus();
});
document.getElementById('caption-hashtag')?.addEventListener('click', () => {
  insertAroundSelection(captionEl, '#', '');
  captionEl.focus();
});
// L2: Replace window.prompt (unsupported in Tauri WebViews on some platforms)
// with the link-modal defined in index.html.
document.getElementById('caption-link')?.addEventListener('click', () => {
  const modal  = document.getElementById('link-modal');
  const input  = document.getElementById('link-modal-input');
  if (!modal || !input) return;
  input.value = '';
  modal.style.display = 'flex';
  input.focus();

  function close() {
    modal.style.display = 'none';
    document.getElementById('link-modal-ok')?.removeEventListener('click', onOk);
    document.getElementById('link-modal-cancel')?.removeEventListener('click', onCancel);
    input.removeEventListener('keydown', onKey);
  }
  function onOk() {
    const url = input.value.trim();
    if (url) insertAroundSelection(captionEl, '[', `](${url})`);
    close();
  }
  function onCancel() { close(); }
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); onOk(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }

  document.getElementById('link-modal-ok')?.addEventListener('click', onOk);
  document.getElementById('link-modal-cancel')?.addEventListener('click', onCancel);
  input.addEventListener('keydown', onKey);
});

// Emoji picker
const EMOJIS = ['🎉','🎶','🎺','🥁','🎸','🎼','🎊','✨','🌟','❤️','👏','🙏','📅','📍','🕗','🎰','🏆','📢','🎤','🌺','⭐','🔔','🎇','🪗','🎆'];
const emojiPickerEl  = document.getElementById('emoji-picker');
const emojiBtnEl     = document.getElementById('caption-emoji');

if (emojiPickerEl) {
  emojiPickerEl.innerHTML = EMOJIS.map(em =>
    `<button type="button" class="emoji-item" aria-label="${em}">${em}</button>`
  ).join('');
  emojiPickerEl.addEventListener('click', e => {
    const btn = e.target.closest('.emoji-item');
    if (!btn) return;
    insertAroundSelection(captionEl, btn.textContent, '');
    emojiPickerEl.hidden = true;
    emojiBtnEl?.setAttribute('aria-expanded', 'false');
  });
}

emojiBtnEl?.addEventListener('click', e => {
  e.stopPropagation();
  if (!emojiPickerEl) return;
  const open = !emojiPickerEl.hidden;
  emojiPickerEl.hidden = open;
  emojiBtnEl.setAttribute('aria-expanded', open ? 'false' : 'true');
});

document.addEventListener('click', () => {
  if (emojiPickerEl && !emojiPickerEl.hidden) {
    emojiPickerEl.hidden = true;
    emojiBtnEl?.setAttribute('aria-expanded', 'false');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════════════════════════════════════

const TMPL_KEY = 'banditur_templates';
function loadTemplates()        { try { return JSON.parse(localStorage.getItem(TMPL_KEY) || '[]'); } catch { return []; } }
function persistTemplates(list) { localStorage.setItem(TMPL_KEY, JSON.stringify(list)); }


function renderTemplateDropdown() {
  const dd   = document.getElementById('template-dropdown');
  const user = loadTemplates();
  dd.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.className   = 'dropdown-section-lbl';
  hdr.textContent = BTN.tmpl_section;
  dd.appendChild(hdr);

  for (const t of [...BUILTIN_TEMPLATES, ...user]) {
    const btn = document.createElement('button');
    btn.className   = 'dropdown-item';
    btn.textContent = t.name;
    btn.addEventListener('click', () => {
      if (captionEl) { captionEl.value = t.body; updateCaptionCount(); scheduleAutosave(); }
      dd.style.display = 'none';
    });
    dd.appendChild(btn);
  }

  const manage = document.createElement('button');
  manage.className   = 'dropdown-item dropdown-manage';
  manage.textContent = BTN.tmpl_manage;
  manage.addEventListener('click', () => { openTemplatesModal(); dd.style.display = 'none'; });
  dd.appendChild(manage);
  dd.style.display = 'block';
}

document.getElementById('insert-template-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  const dd = document.getElementById('template-dropdown');
  if (!dd) return;
  if (dd.style.display === 'block') dd.style.display = 'none'; else renderTemplateDropdown();
});

document.addEventListener('click', e => {
  const dd = document.getElementById('template-dropdown');
  if (dd && !dd.contains(e.target) && e.target.id !== 'insert-template-btn')
    dd.style.display = 'none';
});

function openTemplatesModal() {
  const list      = loadTemplates();
  const container = document.getElementById('templates-list');
  container.innerHTML = '';
  for (let i = 0; i < list.length; i++) {
    const row = document.createElement('div');
    row.className = 'template-row';
    const nameInput = document.createElement('input');
    nameInput.type        = 'text';
    nameInput.className   = 'tmpl-name';
    nameInput.value       = list[i].name;
    nameInput.placeholder = 'Isem…';
    const bodyTa = document.createElement('textarea');
    bodyTa.className   = 'tmpl-body';
    bodyTa.rows        = 3;
    bodyTa.textContent = list[i].body;
    const delBtn = document.createElement('button');
    delBtn.className   = 'btn-secondary btn-sm';
    delBtn.textContent = BTN.tmpl_del;
    delBtn.addEventListener('click', () => {
      const t = loadTemplates(); t.splice(i, 1); persistTemplates(t); openTemplatesModal();
    });
    row.append(nameInput, bodyTa, delBtn);
    container.appendChild(row);
  }
  const modal = document.getElementById('templates-modal');
  modal.style.display = 'flex';
  focusModal(modal);
}

document.getElementById('add-template-btn')?.addEventListener('click', () => {
  const list = loadTemplates();
  list.push({ name: BTN.tmpl_new(list.length + 1), body: '' });
  persistTemplates(list);
  openTemplatesModal();
});

document.getElementById('save-templates-btn')?.addEventListener('click', () => {
  const rows = [...document.querySelectorAll('#templates-list .template-row')];
  const list = rows.map(r => ({
    name: r.querySelector('.tmpl-name').value.trim(),
    body: r.querySelector('.tmpl-body').value,
  })).filter(t => t.name);
  persistTemplates(list);
  document.getElementById('templates-modal').style.display = 'none';
});

document.getElementById('close-templates-btn')?.addEventListener('click', () => {
  document.getElementById('templates-modal').style.display = 'none';
});
document.getElementById('templates-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

// ═══════════════════════════════════════════════════════════════════════════════
// Media picker
// ═══════════════════════════════════════════════════════════════════════════════

const _objectUrls = new Map();
const MEDIA_MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
};

function mediaMimeFromName(name = '') {
  const ext = String(name).split('.').pop()?.toLowerCase();
  return MEDIA_MIME_BY_EXT[ext] || '';
}

function normalizeMediaMime(type = '', name = '') {
  const mime = String(type || '').split(';')[0].trim().toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('video/')) return mime;
  return mediaMimeFromName(name);
}

function isSupportedMediaFile(file) {
  const type = normalizeMediaMime(file?.type, file?.name);
  return type.startsWith('image/') || type.startsWith('video/');
}

function renderMediaPreviews() {
  const preview = document.getElementById('media-preview');
  if (!preview) return;
  _objectUrls.forEach(u => URL.revokeObjectURL(u));
  _objectUrls.clear();
  preview.innerHTML = '';

  for (let i = 0; i < pickedMedia.length; i++) {
    const file = pickedMedia[i];
    const url  = URL.createObjectURL(file);
    _objectUrls.set(i, url);

    const item = document.createElement('div');
    item.className = 'media-item';

    if (file.type.startsWith('video/')) {
      const v = document.createElement('video');
      v.src = url; v.muted = true; v.preload = 'metadata';
      item.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = url; img.alt = file.name;
      item.appendChild(img);
    }

    const rm = document.createElement('button');
    rm.className   = 'media-item-rm';
    rm.title       = BTN.media_rm;
    rm.setAttribute('aria-label', BTN.media_rm);
    rm.textContent = '×';
    rm.addEventListener('click', () => { pickedMedia.splice(i, 1); renderMediaPreviews(); scheduleAutosave(); });
    item.appendChild(rm);
    preview.appendChild(item);
  }
  preview.style.display = pickedMedia.length ? 'flex' : 'none';
  updateInlinePreview();
}

function addMediaFiles(files) {
  for (const f of files) {
    if (isSupportedMediaFile(f)) pickedMedia.push(f);
  }
  renderMediaPreviews();
}

document.getElementById('pick-media-btn')?.addEventListener('click', () =>
  document.getElementById('media-input')?.click()
);
document.getElementById('media-input')?.addEventListener('change', e => {
  addMediaFiles(e.target.files); e.target.value = '';
});

const mediaDropArea = document.getElementById('media-drop-area');
mediaDropArea?.addEventListener('dragover',  e => { e.preventDefault(); mediaDropArea.classList.add('drag-over'); });
mediaDropArea?.addEventListener('dragleave', ()  => mediaDropArea?.classList.remove('drag-over'));
mediaDropArea?.addEventListener('drop', e => {
  e.preventDefault();
  mediaDropArea.classList.remove('drag-over');
  addMediaFiles(e.dataTransfer.files);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Drafts
// ═══════════════════════════════════════════════════════════════════════════════

const DRAFT_KEY = 'banditur_drafts';
function loadDrafts()        { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]'); } catch { return []; } }
function persistDrafts(list) { localStorage.setItem(DRAFT_KEY, JSON.stringify(list)); }

function updateDraftsBtn() {
  const list   = loadDrafts();
  const countEl = document.getElementById('drafts-count');
  const openBt  = document.getElementById('open-drafts-btn');
  if (countEl) countEl.textContent = list.length;
  if (openBt)  openBt.style.display = list.length === 0 ? 'none' : '';
}

function collectScheduleForm() {
  return {
    caption:       captionEl?.value || '',
    platforms:     getSelectedPlatforms(),
    scheduledTime: document.getElementById('scheduled-time')?.value || '',
    expiryTime:    document.getElementById('expiry-time')?.value    || '',
    savedAt:       new Date().toISOString(),
  };
}

document.getElementById('save-draft-btn')?.addEventListener('click', () => {
  const drafts = loadDrafts();
  drafts.unshift(collectScheduleForm());
  persistDrafts(drafts);
  updateDraftsBtn();
  showScheduleStatus(SCHED.draft_saved, 'ok');
  doAutosave();
});

function openDraftsModal() {
  const list      = loadDrafts();
  const container = document.getElementById('drafts-list');
  container.innerHTML = '';

  if (!list.length) {
    container.innerHTML = renderState({ tone: 'muted', title: EMPTY.no_drafts, body: 'Meta ssalva abbozz jidher hawn.' });
  } else {
    for (let i = 0; i < list.length; i++) {
      const d    = list[i];
      const item = document.createElement('div');
      item.className = 'draft-item';
      item.innerHTML = `
        <div class="draft-info">
          <span class="draft-caption">${escHtml(d.caption.slice(0,80))}${d.caption.length > 80 ? '…' : ''}</span>
          <span class="draft-meta">${escHtml((d.platforms||[]).join(', '))} · ${new Date(d.savedAt).toLocaleString()}</span>
        </div>
        <div class="draft-actions">
          <button class="btn-secondary btn-sm" data-action="load" data-i="${i}">Agħżel</button>
          <button class="btn-secondary btn-sm" data-action="del"  data-i="${i}" aria-label="Ħassar abbozz">×</button>
        </div>`;
      container.appendChild(item);
    }
  }

  // Use onclick to avoid stale listener accumulation across re-opens
  container.onclick = e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const i = parseInt(btn.dataset.i);
    if (btn.dataset.action === 'load') {
      const d = loadDrafts()[i];
      if (!d) return;
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
      document.getElementById('drafts-modal').style.display = 'none';
      updateInlinePreview();
      doAutosave();
    } else {
      const drafts = loadDrafts();
      drafts.splice(i, 1);
      persistDrafts(drafts);
      updateDraftsBtn();
      openDraftsModal();
    }
  };

  const modal = document.getElementById('drafts-modal');
  modal.style.display = 'flex';
  focusModal(modal);
}

// ── Reset form ────────────────────────────────────────────────────────────────

document.getElementById('reset-form-btn')?.addEventListener('click', async () => {
  const ok = await showConfirm(CONFIRM.reset_form);
  if (!ok) return;

  if (captionEl) { captionEl.value = ''; updateCaptionCount(); }
  contentType = 'post';
  document.querySelectorAll('.ct-tab[data-ct]').forEach(b => {
    b.dataset.active = b.dataset.ct === 'post' ? 'true' : 'false';
  });
  const hint = document.getElementById('ct-hint');
  if (hint) hint.textContent = '';
  document.querySelectorAll('.platform[data-platform]').forEach(b => {
    const on = (b.dataset.platform === 'fb' || b.dataset.platform === 'ig');
    b.dataset.on = on ? 'true' : 'false';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const stEl = document.getElementById('scheduled-time');
  const etEl = document.getElementById('expiry-time');
  const egEl = document.getElementById('expiry-group');
  const ssEl = document.getElementById('schedule-status');
  if (stEl) stEl.value = '';
  if (etEl) etEl.value = '';
  if (egEl) egEl.style.display = 'none';
  if (ssEl) ssEl.style.display = 'none';
  pickedMedia = [];
  renderMediaPreviews();
  updateInlinePreview();
  localStorage.removeItem(AUTOSAVE_KEY);
  markSaved(new Date());
});

// ── Post preview ──────────────────────────────────────────────────────────────

const PLAT_LABELS = { fb: 'Facebook', ig: 'Instagram', wp: 'WordPress' };

function buildPreviewHtml({ storeUrls = false } = {}) {
  const caption   = captionEl?.value.trim() || '';
  const platforms = getSelectedPlatforms();
  const schedTime = document.getElementById('scheduled-time')?.value;
  const profName  = selectedProfileName();
  const initials  = profName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'SK';
  const platsToShow = platforms.length ? platforms : ['fb'];
  const dt = schedTime
    ? new Date(schedTime).toLocaleString('mt', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
    : '';

  if (!caption && !pickedMedia.length) {
    return renderState({
      tone: 'muted',
      title: 'Ibda bil-kaption jew media',
      body: 'L-anteprima tintwera hawn hekk kif tibni l-post.',
    });
  }

  let mediaHtml = '';
  if (pickedMedia.length) {
    const cols = pickedMedia.length === 1 ? 1 : pickedMedia.length === 2 ? 2 : 3;
    const items = pickedMedia.slice(0, 9).map(f => {
      const url = URL.createObjectURL(f);
      if (storeUrls) _previewUrls.push(url); else _inlinePreviewUrls.push(url);
      return f.type.startsWith('video/')
        ? `<video src="${url}" muted></video>`
        : `<img src="${url}" alt="" />`;
    }).join('');
    mediaHtml = `<div class="preview-media-grid" style="grid-template-columns:repeat(${cols},1fr)">${items}</div>`;
  }

  return platsToShow.map(plat => renderPreviewCard({
    platform: PLAT_LABELS[plat] || plat,
    profileName: profName,
    initials,
    scheduledLabel: dt,
    caption,
    mediaHtml,
  })).join('');
}

function updateInlinePreview() {
  const content = document.getElementById('inline-preview-content');
  if (!content) return;
  _inlinePreviewUrls.forEach(u => URL.revokeObjectURL(u));
  _inlinePreviewUrls = [];
  content.innerHTML = buildPreviewHtml();
}

function closePreviewModal() {
  document.getElementById('preview-modal').style.display = 'none';
  _previewUrls.forEach(u => URL.revokeObjectURL(u));
  _previewUrls = [];
}

document.getElementById('preview-btn')?.addEventListener('click', () => {
  const content = document.getElementById('preview-content');
  _previewUrls.forEach(u => URL.revokeObjectURL(u));
  _previewUrls = [];
  content.innerHTML = buildPreviewHtml({ storeUrls: true });

  const modal = document.getElementById('preview-modal');
  modal.style.display = 'flex';
  focusModal(modal);
});

document.getElementById('preview-refresh-btn')?.addEventListener('click', updateInlinePreview);

document.getElementById('close-preview-btn')?.addEventListener('click', closePreviewModal);
document.getElementById('preview-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closePreviewModal();
});

document.getElementById('open-drafts-btn')?.addEventListener('click', openDraftsModal);
document.getElementById('close-drafts-btn')?.addEventListener('click', () => {
  document.getElementById('drafts-modal').style.display = 'none';
});
document.getElementById('drafts-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schedule status helper
// ═══════════════════════════════════════════════════════════════════════════════

function showScheduleStatus(msg, type = 'info') {
  const el = document.getElementById('schedule-status');
  if (!el) return;
  el.className     = `schedule-status schedule-status-${type}`;
  el.innerHTML     = renderStatus(msg, type);
  el.style.display = 'block';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Supabase upload — parallel
// ═══════════════════════════════════════════════════════════════════════════════

async function uploadToSupabase(cfg, files) {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseKey);
  return Promise.all(files.map(async file => {
    const ext  = file.name.split('.').pop();
    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await sb.storage.from('media').upload(path, file, { contentType: file.type });
    if (error) throw new Error(`Upload: ${error.message}`);
    const { data } = sb.storage.from('media').getPublicUrl(path);
    return { url: data.publicUrl, path, type: file.type };
  }));
}

async function cleanupUploadedMedia(cfg, media) {
  const paths = (media || []).map(m => m.path).filter(Boolean);
  if (!paths.length) return;

  await fetch(`${cfg.vercelUrl}/api/meta`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
    body:    JSON.stringify({ action: 'cleanup', paths }),
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════════
// Schedule submission
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById('btn-schedule')?.addEventListener('click', async () => {
  if (!navigator.onLine) {
    const drafts = loadDrafts();
    drafts.unshift(collectScheduleForm());
    persistDrafts(drafts);
    updateDraftsBtn();
    showToast(TOAST.offline, 'warn');
    return;
  }

  const cfg = loadConfig();
  if (!cfg.vercelUrl || !cfg.apiKey) {
    showScheduleStatus(ERR.vercel_config, 'error');
    return;
  }

  const caption = captionEl?.value.trim() || '';
  if (contentType === 'post' && !caption) { showScheduleStatus(ERR.no_caption, 'error'); return; }

  if (contentType !== 'post' && !pickedMedia.length) {
    showScheduleStatus(`${contentType === 'reel' ? 'Reel' : 'Storja'} teħtieġ medjum.`, 'error');
    return;
  }

  const platforms = getSelectedPlatforms();
  if (!platforms.length) { showScheduleStatus(ERR.no_platform, 'error'); return; }

  const scheduledTime = document.getElementById('scheduled-time')?.value;
  if (!scheduledTime) { showScheduleStatus(ERR.no_time, 'error'); return; }

  const schedBtn    = document.getElementById('btn-schedule');
  schedBtn.disabled = true;
  let uploadedMedia = [];

  try {
    let media = [];
    if (pickedMedia.length) {
      if (!cfg.supabaseUrl || !cfg.supabaseKey)
        throw new Error(ERR.supabase_config);
      showScheduleStatus(SCHED.uploading, 'info');
      media = await uploadToSupabase(cfg, pickedMedia);
      uploadedMedia = media;
    }

    showScheduleStatus(SCHED.scheduling, 'info');

    const profileId = selectedProfileId();
    // P0-2: datetime-local has no timezone; the webview parses it as local (Malta)
    // time. Convert to an absolute UTC ISO string so the UTC backend/Graph API
    // schedule at the intended instant instead of treating the wall time as UTC.
    const scheduledIso = new Date(scheduledTime).toISOString();
    const body      = { caption, platforms, scheduledTime: scheduledIso, media, profile_id: profileId, content_type: contentType };
    if (platforms.includes('wp')) {
      const exp = document.getElementById('expiry-time')?.value;
      if (exp) body.expiryTime = new Date(exp).toISOString();
    }

    const res = await fetch(`${cfg.vercelUrl}/api/schedule`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }

    showScheduleStatus(SCHED.scheduled, 'ok');
    showToast(TOAST.scheduled, 'ok');

    if (captionEl) captionEl.value = '';
    updateCaptionCount();
    const stEl = document.getElementById('scheduled-time');
    const etEl = document.getElementById('expiry-time');
    const egEl = document.getElementById('expiry-group');
    if (stEl) stEl.value = '';
    if (etEl) etEl.value = '';
    if (egEl) egEl.style.display = 'none';
    // Restore default platform selection (FB + IG on) rather than clearing everything
    document.querySelectorAll('.platform[data-platform]').forEach(b => {
      const on = b.dataset.platform === 'fb' || b.dataset.platform === 'ig';
      b.dataset.on = on ? 'true' : 'false';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    pickedMedia = [];
    renderMediaPreviews();
    localStorage.removeItem(AUTOSAVE_KEY);
    markSaved(new Date());

  } catch (err) {
    await cleanupUploadedMedia(cfg, uploadedMedia);
    showScheduleStatus(ERR.generic(err.message), 'error');
  } finally {
    schedBtn.disabled = false;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Archive
// ═══════════════════════════════════════════════════════════════════════════════

async function loadArchive() {
  const cfg = loadConfig();

  const tbody    = document.getElementById('history-tbody');
  const countPill = document.querySelector('.history-count-pill');
  const tableFooterSpan = document.querySelector('.table-footer > span');
  const prevBtn  = document.querySelector('.page-btn:first-of-type');
  const nextBtn  = document.querySelector('.page-btn:last-of-type');

  if (!cfg.vercelUrl || !cfg.apiKey) {
    setArchiveModeUi();
    _archiveTotal = 0;
    setArchiveSummary({
      total: 0,
      refreshedAt: null,
      footer: 'Qed turi 0 posts',
    });
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (tbody) tbody.innerHTML = renderTableState({ tone: 'error', title: ERR.vercel_config, body: 'Iftaħ is-Settings biex tgħaqqad il-backend.' });
    return;
  }

  setArchiveModeUi();
  if (tbody) tbody.innerHTML = renderTableState({ tone: 'loading', title: EMPTY.loading, body: 'Qed jinġabru l-posts.' });

  if (_archiveSource === 'live') {
    await loadLiveArchive(cfg);
    return;
  }

  await loadQueueArchive(cfg);
}

function setArchiveModeUi() {
  const live = _archiveSource === 'live';
  const note = document.getElementById('archive-source-note');
  const title = document.getElementById('archive-table-title');
  const filter = document.getElementById('archive-filter-chips');
  const sourceLabel = document.getElementById('archive-source-label');
  const thCaption = document.getElementById('archive-th-caption');
  const thDate = document.getElementById('archive-th-date');
  const thStatus = document.getElementById('archive-th-status');
  const thActions = document.getElementById('archive-th-actions');

  if (note) note.textContent = live
    ? 'Facebook u Instagram minn Graph API.'
    : 'Records interni tal-Banditur minn Supabase.';
  if (title) title.textContent = live ? 'Posts Live fuq Meta' : 'Kju tal-Banditur';
  if (filter) filter.style.display = live ? 'none' : '';
  if (sourceLabel) sourceLabel.textContent = live ? 'Meta Graph' : 'Supabase';
  if (thCaption) thCaption.textContent = live ? 'Kaption' : 'Titlu & Kaption';
  if (thDate) thDate.textContent = live ? 'Live/Scheduled' : 'Data';
  if (thStatus) thStatus.textContent = live ? 'Pjattaforma' : 'Status';
  if (thActions) thActions.textContent = live ? 'Link' : 'Azzjonijiet';
}

function setArchiveSummary({ total, refreshedAt, footer }) {
  const countPill = document.querySelector('.history-count-pill');
  const totalLabel = document.getElementById('archive-total-label');
  const refreshLabel = document.getElementById('archive-refresh-label');
  const tableFooterSpan = document.querySelector('.table-footer > span');

  if (countPill) countPill.textContent = total;
  if (totalLabel) totalLabel.textContent = total;
  if (refreshLabel) refreshLabel.textContent = refreshedAt ? new Date(refreshedAt).toLocaleString('mt') : '-';
  if (tableFooterSpan) tableFooterSpan.innerHTML = footer;
}

async function loadLiveArchive(cfg) {
  const tbody = document.getElementById('history-tbody');
  const prevBtn = document.querySelector('.page-btn:first-of-type');
  const nextBtn = document.querySelector('.page-btn:last-of-type');

  try {
    const params = new URLSearchParams({ type: 'live-posts', limit: 30, profile_id: selectedProfileId() });
    if (_archiveSearch) params.set('search', _archiveSearch);

    const res = await fetch(`${cfg.vercelUrl}/api/meta?${params}`, {
      headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    const { posts = [], total = 0, refreshed_at, errors = [] } = await res.json();
    _archiveTotal = total;
    setArchiveSummary({
      total,
      refreshedAt: refreshed_at,
      footer: `Qed turi <strong class="tnum">${posts.length}</strong> posts minn Meta`,
    });
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;

    if (!tbody) return;
    if (!posts.length) {
      const errNote = errors.length ? ` ${escHtml(errors[0].message)}` : '';
      tbody.innerHTML = renderTableState({ tone: 'muted', title: EMPTY.no_posts, body: errNote.trim() || 'Meta ma rritornat l-ebda post għal dan il-kont.' });
      return;
    }

    tbody.innerHTML = posts.map(renderLiveArchiveRow).join('');
  } catch (err) {
    if (tbody) tbody.innerHTML = renderTableState({ tone: 'error', title: EMPTY.error(err.message), body: 'Erġa prova jew iċċekkja l-konfigurazzjoni.' });
  }
}

async function loadQueueArchive(cfg) {
  const tbody = document.getElementById('history-tbody');
  const prevBtn = document.querySelector('.page-btn:first-of-type');
  const nextBtn = document.querySelector('.page-btn:last-of-type');

  try {
    const params = new URLSearchParams({
      page:   _archivePage,
      limit:  ARCHIVE_PER_PAGE,
      status: currentFilter,
      profile_id: selectedProfileId(),
    });
    if (_archiveSearch) params.set('search', _archiveSearch);

    const res = await fetch(`${cfg.vercelUrl}/api/history?${params}`, {
      headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    const { posts, total, pending } = await res.json();
    _archiveTotal = total;

    // Update pagination footer
    const showing = posts.length;
    const from    = (_archivePage - 1) * ARCHIVE_PER_PAGE + 1;
    const to      = from + showing - 1;
    setArchiveSummary({
      total,
      refreshedAt: new Date().toISOString(),
      footer: showing
        ? `Qed turi ${from}–${to} minn <strong class="tnum">${total}</strong> posts`
        : `Qed turi 0 minn <strong class="tnum">${total}</strong> posts`,
    });
    if (prevBtn) prevBtn.disabled = _archivePage <= 1;
    if (nextBtn) nextBtn.disabled = to >= total;

    if (!tbody) return;

    if (!posts.length) {
      tbody.innerHTML = renderTableState({ tone: 'muted', title: EMPTY.no_posts, body: 'Mhemmx records għall-filtri magħżula.' });
      return;
    }

    tbody.innerHTML = posts.map(renderQueueArchiveRow).join('');

  } catch (err) {
    if (tbody) tbody.innerHTML = renderTableState({ tone: 'error', title: EMPTY.error(err.message), body: 'Erġa prova jew iċċekkja l-konfigurazzjoni.' });
  }
}

function renderArchiveThumb(url) {
  return uiRenderArchiveThumb(url);
}

function renderLiveArchiveRow(p) {
  const dt = new Date(p.scheduled_time || p.created_time || Date.now()).toLocaleString('mt');
  const caption = p.caption || '(mingħajr kaption)';
  const platLabel = p.platform === 'ig' ? 'Instagram' : 'Facebook';
  const stateClass = p.state === 'scheduled' ? 'pill-pending' : 'pill-published';
  const stateLabel = p.state === 'scheduled' ? 'Skedat fuq Meta' : 'Live fuq Meta';
  const metrics = [
    p.likes_count != null ? `${p.likes_count} likes` : null,
    p.comments_count != null ? `${p.comments_count} kummenti` : null,
  ].filter(Boolean).join(' · ');

  return `<tr>
    <td>${renderArchiveThumb(p.media_url)}</td>
    <td>
      <div class="row-caption">${escHtml(caption.slice(0, 92))}${caption.length > 92 ? '...' : ''}</div>
      <div class="row-plat">${metrics ? escHtml(metrics) : escHtml(stateLabel)}</div>
    </td>
    <td class="tnum table-muted">${escHtml(dt)}</td>
    <td class="table-muted">${escHtml(p.profile_name || p.profile_id || 'main')}</td>
    <td><span class="status-pill ${stateClass}">${escHtml(platLabel)} · ${escHtml(stateLabel)}</span></td>
    <td class="table-actions">
      ${p.permalink ? `<button class="btn-link archive-open-live" data-url="${escHtml(p.permalink)}">Iftaħ</button>` : ''}
    </td>
  </tr>`;
}

function queueStatusLabel(post) {
  if (post.status === 'fb_native') return { label: 'Skedat fuq Meta', className: 'pill-pending' };
  if (post.status === 'pending') {
    const scheduledAt = new Date(post.scheduled_time).getTime();
    const in30Days = Date.now() + 30 * 24 * 60 * 60 * 1000;
    return scheduledAt > in30Days
      ? { label: 'Skedat fil-Banditur', className: 'pill-pending' }
      : { label: 'Jistenna l-pubblikazzjoni', className: 'pill-pending' };
  }
  return {
    label: STATUS_LABELS[post.status] || post.status,
    className: { published:'pill-published', processing:'pill-pending', failed:'pill-failed' }[post.status] || '',
  };
}

function renderQueueArchiveRow(p) {
  const dt   = new Date(p.scheduled_time).toLocaleString('mt');
  const plat = renderPlatformPills(p);
  const status = queueStatusLabel(p);
  const ctLabel = p.content_type && p.content_type !== 'post'
    ? `<span class="plat-pill plat-pill-type">${escHtml(p.content_type)}</span>`
    : '';
  const thumbUrl = p.media?.[0]?.url;
  return `<tr>
    <td>${renderArchiveThumb(thumbUrl)}</td>
    <td>
      <div class="row-caption">${escHtml((p.caption||'').slice(0,60))}${(p.caption||'').length>60?'...':''}</div>
      <div class="row-plat">${plat}${ctLabel}</div>
    </td>
    <td class="tnum table-muted">${escHtml(dt)}</td>
    <td class="table-muted">${escHtml(p.profile_id||'main')}</td>
    <td><span class="status-pill ${status.className}">${escHtml(status.label)}</span></td>
    <td class="table-actions">
      ${p.status==='failed'  ? `<button class="btn-link archive-retry" data-id="${escHtml(p.id)}">${BTN.retry}</button>` : ''}
      ${p.status==='pending' ? `<button class="btn-link archive-del action-danger" data-id="${escHtml(p.id)}">${BTN.delete}</button>` : ''}
    </td>
  </tr>`;
}

document.getElementById('refresh-archive-btn')?.addEventListener('click', loadArchive);

const PLATFORM_ID_FIELD = { fb: 'fb_post_id', ig: 'ig_post_id', wp: 'wp_post_id' };

function renderPlatformPills(post) {
  return (post.platforms || []).map(pl => {
    const done = !!post[PLATFORM_ID_FIELD[pl]];
    const label = `${pl.toUpperCase()}${done && post.status === 'failed' ? ' done' : ''}`;
    const doneClass = done && post.status === 'failed' ? ' plat-pill-done' : '';
    return `<span class="plat-pill${doneClass}">${escHtml(label)}</span>`;
  }).join('');
}

document.getElementById('history-tbody')?.addEventListener('click', async e => {
  const retryBtn = e.target.closest('.archive-retry');
  const delBtn   = e.target.closest('.archive-del');
  const liveBtn  = e.target.closest('.archive-open-live');
  const cfg      = loadConfig();

  if (liveBtn) {
    const url = liveBtn.dataset.url;
    if (url) openUrl(url).catch(() => {});
  }

  if (retryBtn) {
    const id = retryBtn.dataset.id;
    retryBtn.disabled = true; retryBtn.textContent = BTN.retrying;
    try {
      const r = await fetch(`${cfg.vercelUrl}/api/posts/${id}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      showToast(TOAST.retried, 'ok');
      loadArchive();
    } catch (err) {
      showToast(TOAST.error(err.message), 'error');
      retryBtn.disabled = false; retryBtn.textContent = BTN.retry;
    }
  }

  if (delBtn) {
    const ok = await showConfirm(CONFIRM.delete_post);
    if (!ok) return;
    const id = delBtn.dataset.id;
    try {
      const r = await fetch(`${cfg.vercelUrl}/api/posts/${id}`, {
        method:  'DELETE',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      loadArchive();
    } catch (err) { showToast(TOAST.error(err.message), 'error'); }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Google Drive browser
// ═══════════════════════════════════════════════════════════════════════════════

let _driveFolderStack = []; // { id, name } entries; empty = root folder
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

// Client-side listing cache so Back/re-open are instant instead of re-fetching.
const _driveListCache = new Map(); // folderId|'__root__' → { files, t }
const DRIVE_LIST_TTL  = 5 * 60 * 1000;
// Natural, numeric-aware name sort (so "2" < "10"), folders first — matches
// Google Drive's default Name ordering.
const _driveCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function sortDriveEntries(files) {
  return files.sort((a, b) => {
    const af = a.mimeType === DRIVE_FOLDER_MIME ? 0 : 1;
    const bf = b.mimeType === DRIVE_FOLDER_MIME ? 0 : 1;
    if (af !== bf) return af - bf;
    return _driveCollator.compare(a.name || '', b.name || '');
  });
}
async function fetchDriveListing(cfg, folderId) {
  const key    = folderId || '__root__';
  const cached = _driveListCache.get(key);
  if (cached && Date.now() - cached.t < DRIVE_LIST_TTL) return cached.files;

  const url = `${cfg.vercelUrl}/api/drive/posters${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${cfg.apiKey}` } });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  const files = sortDriveEntries((await res.json()).filter(isDriveMediaLike));
  _driveListCache.set(key, { files, t: Date.now() });
  return files;
}

function isDriveMediaLike(file) {
  if (file?.mimeType === DRIVE_FOLDER_MIME) return true;
  return !!normalizeMediaMime(file?.mimeType, file?.name);
}

document.getElementById('browse-drive-btn')?.addEventListener('click', () => {
  _driveFolderStack = [];
  openDriveBrowser();
});
document.getElementById('close-drive-btn')?.addEventListener('click', () => {
  document.getElementById('drive-modal').style.display = 'none';
});
document.getElementById('drive-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

async function openDriveBrowser(folderId = null) {
  const cfg  = loadConfig();
  const grid = document.getElementById('drive-grid');
  grid.innerHTML = renderState({ tone: 'loading', title: EMPTY.loading, body: 'Qed jinfetaħ Google Drive.' });

  const modal = document.getElementById('drive-modal');
  modal.style.display = 'flex';
  focusModal(modal);

  // Render breadcrumb / back button
  const hdr = document.getElementById('drive-modal-path');
  if (hdr) {
    if (_driveFolderStack.length === 0) {
      hdr.innerHTML = '';
    } else {
      const parentName = _driveFolderStack.length > 1
        ? escHtml(_driveFolderStack[_driveFolderStack.length - 2].name)
        : '—';
      hdr.innerHTML = `<button class="btn-link drive-back-btn" id="drive-back-btn">← ${parentName === '—' ? 'Lura' : parentName}</button>
        <span class="drive-path-sep">/</span>
        <span>${escHtml(_driveFolderStack[_driveFolderStack.length - 1].name)}</span>`;
      document.getElementById('drive-back-btn')?.addEventListener('click', () => {
        _driveFolderStack.pop();
        openDriveBrowser(_driveFolderStack.length ? _driveFolderStack[_driveFolderStack.length - 1].id : null);
      });
    }
  }

  if (!cfg.vercelUrl || !cfg.apiKey) {
    grid.innerHTML = renderState({ tone: 'error', title: EMPTY.settings_req, body: 'Iftaħ is-Settings u żid il-backend/API key.' });
    return;
  }

  try {
    const files = await fetchDriveListing(cfg, folderId);

    if (!files.length) {
      grid.innerHTML = renderState({ tone: 'muted', title: EMPTY.no_drive, body: 'Dan il-folder ma fihx fajls li jistgħu jintużaw.' });
      return;
    }

    grid.innerHTML = '';
    for (const file of files) {
      const isFolder = file.mimeType === DRIVE_FOLDER_MIME;
      const item = document.createElement('div');
      item.className = `drive-item${isFolder ? ' drive-item-folder' : ''}`;
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');

      if (isFolder) {
        item.innerHTML = `
          <div class="drive-item-thumb-placeholder drive-folder-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
            </svg>
          </div>
          <span class="drive-item-name">${escHtml(file.name)}</span>`;
        item.addEventListener('click', () => {
          _driveFolderStack.push({ id: file.id, name: file.name });
          openDriveBrowser(file.id);
        });
        item.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            _driveFolderStack.push({ id: file.id, name: file.name });
            openDriveBrowser(file.id);
          }
        });
      } else {
        const thumbSrc = file.thumbnailLink
          ? escHtml(file.thumbnailLink.replace(/=s\d+$/, '=s200'))
          : '';
        // L1: Use addEventListener instead of inline onerror — the CSP
        // (script-src 'self') blocks inline event handlers.
        if (thumbSrc) {
          const img = document.createElement('img');
          img.src     = thumbSrc;
          img.alt     = file.name;
          img.loading = 'lazy';
          img.addEventListener('error', () => { img.style.display = 'none'; });
          const lbl = document.createElement('span');
          lbl.className   = 'drive-item-name';
          lbl.textContent = file.name;
          item.append(img, lbl);
        } else {
          item.innerHTML = `<div class="drive-item-thumb-placeholder"></div>
             <span class="drive-item-name">${escHtml(file.name)}</span>`;
        }
        item.addEventListener('click', () => selectDriveFile(file, cfg));
        item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectDriveFile(file, cfg); }});
      }

      grid.appendChild(item);
    }
  } catch (err) {
    grid.innerHTML = renderState({ tone: 'error', title: EMPTY.error(err.message), body: 'Erġa prova jew iċċekkja l-konnessjoni.' });
  }
}

async function selectDriveFile(file, cfg) {
  document.getElementById('drive-modal').style.display = 'none';
  showScheduleStatus(SCHED.downloading, 'info');
  try {
    const res  = await fetch(`${cfg.vercelUrl}/api/drive/file/${file.id}`, { headers: { 'Authorization': `Bearer ${cfg.apiKey}` } });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    if (!blob.size) throw new Error('Il-fajl minn Drive huwa vojt.');

    const resType = res.headers.get('Content-Type') || '';
    const type = normalizeMediaMime(blob.type || resType || file.mimeType, file.name);
    if (!type) {
      throw new Error('Dan il-fajl mhux rikonoxxut bħala stampa jew video.');
    }

    const f = new File([blob], file.name, { type });
    addMediaFiles([f]);
    if (!pickedMedia.includes(f)) {
      throw new Error('Dan il-format mhux supportat għall-post.');
    }
    scheduleAutosave();
    const ss = document.getElementById('schedule-status');
    if (ss) ss.style.display = 'none';
  } catch (err) {
    showScheduleStatus(TOAST.drive_err(err.message), 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FullCalendar Google Calendar view
// ═══════════════════════════════════════════════════════════════════════════════

const CAL_LABEL_STORE = 'banditur_calendar_labels';
const CAL_UNLABELED = '__unlabeled';
const CAL_LABEL_DELETED = '__deleted';
let _fullCalendar = null;
let _calendarModalState = { mode: 'empty', id: null, recurringEventId: null };
let _calendarLabels = loadCalendarLabels();
let _calendarDeletedLabels = loadCalendarDeletedLabels();
let _calendarEvents = [];
let _calendarState = {
  mode: 'empty',
  selectedDate: new Date(),
  selectedEventId: null,
};

function loadCalendarLabels() {
  const defaults = {
    [CAL_UNLABELED]: { name: 'Bla label', color: '#8d8880', visible: true, system: true },
    Festa: { name: 'Festa', color: '#9f4638', visible: true },
    Quddiesa: { name: 'Quddiesa', color: '#4f7f62', visible: true },
    Prova: { name: 'Prova', color: '#4e6f9f', visible: true },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(CAL_LABEL_STORE) || '{}');
    const deleted = new Set(Array.isArray(saved[CAL_LABEL_DELETED]) ? saved[CAL_LABEL_DELETED] : []);
    const labels = { ...defaults };
    for (const key of deleted) {
      if (key !== CAL_UNLABELED) delete labels[key];
    }
    for (const [key, value] of Object.entries(saved)) {
      if (key === CAL_LABEL_DELETED || deleted.has(key)) continue;
      labels[key] = { ...labels[key], ...value };
    }
    labels[CAL_UNLABELED] = { ...defaults[CAL_UNLABELED], ...(saved[CAL_UNLABELED] || {}) };
    return labels;
  } catch {
    return defaults;
  }
}

function loadCalendarDeletedLabels() {
  try {
    const saved = JSON.parse(localStorage.getItem(CAL_LABEL_STORE) || '{}');
    return new Set(Array.isArray(saved[CAL_LABEL_DELETED]) ? saved[CAL_LABEL_DELETED] : []);
  } catch {
    return new Set();
  }
}

function saveCalendarLabels() {
  localStorage.setItem(CAL_LABEL_STORE, JSON.stringify({
    ..._calendarLabels,
    [CAL_LABEL_DELETED]: [..._calendarDeletedLabels],
  }));
}

function normalizeLabelName(label) {
  return String(label || '').trim();
}

function labelKey(label) {
  return normalizeLabelName(label) || CAL_UNLABELED;
}

function labelEntry(label) {
  const key = labelKey(label);
  if (_calendarDeletedLabels.has(key)) return _calendarLabels[CAL_UNLABELED];
  return _calendarLabels[key] || _calendarLabels[CAL_UNLABELED];
}

function isCalendarLabelVisible(label) {
  return labelEntry(label).visible !== false;
}

function ensureCalendarLabel(label) {
  const name = normalizeLabelName(label);
  if (!name || _calendarDeletedLabels.has(name) || _calendarLabels[name]) return;
  _calendarLabels[name] = { name, color: '#9f4638', visible: true };
  saveCalendarLabels();
}

function renderCalendarLabels() {
  const list = document.getElementById('calendar-label-list');
  const select = document.getElementById('event-label-input');
  if (!list) return;

  const entries = Object.entries(_calendarLabels).map(([key, label]) => ({ key, ...label }));
  list.innerHTML = entries.map(label => `
    <div class="calendar-label-row" data-calendar-label-row="${escHtml(label.key)}">
      <input type="checkbox" data-calendar-label="${escHtml(label.key)}" ${label.visible !== false ? 'checked' : ''} aria-label="Uri ${escHtml(label.name)}" />
      <input type="color" class="calendar-label-color" data-calendar-label-color="${escHtml(label.key)}" value="${escHtml(label.color)}" aria-label="Kulur għal ${escHtml(label.name)}" />
      <input type="text" class="calendar-label-name-input" data-calendar-label-name="${escHtml(label.key)}" value="${escHtml(label.name)}" ${label.system ? 'readonly' : ''} aria-label="Isem tal-label" />
      <button class="calendar-label-icon-btn" type="button" data-calendar-label-save="${escHtml(label.key)}" title="Issejvja l-label">✓</button>
      ${label.system ? '<span class="calendar-label-lock">Default</span>' : `<button class="calendar-label-icon-btn danger-text" type="button" data-calendar-label-delete="${escHtml(label.key)}" title="Neħħi l-label">✕</button>`}
    </div>
  `).join('');

  if (select) {
    const previous = select.value;
    const editable = entries.filter(label => !label.system);
    select.innerHTML = `<option value="">Bla label</option>` + editable
      .map(label => `<option value="${escHtml(label.key)}">${escHtml(label.name)}</option>`)
      .join('');
    select.value = editable.some(label => label.key === previous) ? previous : '';
  }
}

function refreshCalendarLabelViews() {
  saveCalendarLabels();
  renderCalendarLabels();
  renderSelectedDayAgenda();
  _fullCalendar?.refetchEvents();
}

function tintEvent(raw) {
  const label = raw.extendedProps?.label || '';
  ensureCalendarLabel(label);
  const entry = labelEntry(label);
  return {
    ...raw,
    backgroundColor: entry.color,
    borderColor: entry.color,
  };
}

function dateKey(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtCalendarDay(date) {
  return date.toLocaleDateString('mt', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fmtCalendarTime(date) {
  return date.toLocaleTimeString('mt', { hour: '2-digit', minute: '2-digit' });
}

function setCalendarStatus(tone = '', title = '', body = '') {
  const band = document.getElementById('calendar-status-band');
  if (!band) return;
  if (!title && !body) {
    band.hidden = true;
    band.innerHTML = '';
    return;
  }
  band.hidden = false;
  band.className = `calendar-status-band calendar-status-${tone || 'info'}`;
  band.innerHTML = `
    <span class="calendar-status-dot" aria-hidden="true"></span>
    <span class="calendar-status-copy">
      <strong>${escHtml(title)}</strong>
      ${body ? `<span>${escHtml(body)}</span>` : ''}
    </span>`;
}

function calendarHeaders() {
  const cfg = loadConfig();
  return { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' };
}

async function calendarRequest(path = '', options = {}) {
  const cfg = loadConfig();
  if (!cfg.vercelUrl || !cfg.apiKey) throw new Error(ERR.vercel_config);
  const res = await fetch(`${cfg.vercelUrl}/api/calendar${path}`, {
    ...options,
    headers: { ...calendarHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function calendarEventDates(ev) {
  return {
    start: ev.start instanceof Date ? ev.start : new Date(ev.start),
    end: ev.end ? (ev.end instanceof Date ? ev.end : new Date(ev.end)) : null,
    allDay: Boolean(ev.allDay),
  };
}

function eventOccursOnDate(ev, date) {
  const key = dateKey(date);
  const { start, end, allDay } = calendarEventDates(ev);
  if (!dateKey(start)) return false;
  if (!allDay) return dateKey(start) === key;

  const exclusiveEnd = end || addDays(start, 1);
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const limit = new Date(exclusiveEnd);
  limit.setHours(0, 0, 0, 0);
  while (cursor < limit) {
    if (dateKey(cursor) === key) return true;
    cursor.setDate(cursor.getDate() + 1);
  }
  return false;
}

function visibleCalendarEventsForDate(date) {
  return _calendarEvents
    .filter(ev => isCalendarLabelVisible(ev.extendedProps?.label) && eventOccursOnDate(ev, date))
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return new Date(a.start || 0) - new Date(b.start || 0);
    });
}

function renderSelectedDayAgenda() {
  const title = document.getElementById('calendar-agenda-title');
  const list = document.getElementById('calendar-day-agenda-list');
  if (!title || !list) return;

  const selected = _calendarState.selectedDate || new Date();
  title.textContent = fmtCalendarDay(selected);
  const events = visibleCalendarEventsForDate(selected);
  if (!events.length) {
    list.innerHTML = `<div class="calendar-agenda-empty">Mhemmx avvenimenti f'dan il-jum.</div>`;
    return;
  }

  list.innerHTML = events.map(ev => {
    const entry = labelEntry(ev.extendedProps?.label);
    const start = ev.start ? new Date(ev.start) : null;
    const time = ev.allDay ? 'Il-jum kollu' : (start ? fmtCalendarTime(start) : '');
    const selectedClass = ev.id === _calendarState.selectedEventId ? ' is-selected' : '';
    return `
      <button class="calendar-agenda-item${selectedClass}" type="button" data-calendar-agenda-id="${escHtml(ev.id)}">
        <span class="calendar-agenda-dot" style="--label-color:${escHtml(entry.color)}"></span>
        <span class="calendar-agenda-main">
          <span class="calendar-agenda-title">${escHtml(ev.title || '(Bla Titlu)')}</span>
          <span class="calendar-agenda-meta">${escHtml(time)}${ev.extendedProps?.location ? ` · ${escHtml(ev.extendedProps.location)}` : ''}</span>
        </span>
      </button>`;
  }).join('');
}

async function fetchCalendarEvents(info, success, failure) {
  try {
    setCalendarStatus('loading', 'Qed jgħabbi l-kalendarju...', '');
    const events = await calendarRequest(`?start=${encodeURIComponent(info.startStr)}&end=${encodeURIComponent(info.endStr)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${loadConfig().apiKey}` },
    });
    _calendarEvents = events.map(tintEvent);
    const visible = _calendarEvents.filter(ev => isCalendarLabelVisible(ev.extendedProps?.label));
    renderCalendarLabels();
    renderSelectedDayAgenda();
    setCalendarStatus(events.length ? '' : 'muted', events.length ? '' : EMPTY.no_events, events.length ? '' : 'Mhemmx avvenimenti f’dan il-perijodu.');
    success(visible);
  } catch (err) {
    renderSelectedDayAgenda();
    setCalendarStatus('error', 'Ma stajniex naqraw il-kalendarju.', err.message || '');
    showToast(TOAST.error(`Kalendarju: ${err.message}`), 'error');
    failure(err);
  }
}

function renderCalendarEventContent(arg) {
  const label = arg.event.extendedProps?.label || '';
  const entry = labelEntry(label);
  const wrap = document.createElement('div');
  wrap.className = 'calendar-event-chip-inner';
  wrap.innerHTML = `
    <span class="calendar-event-dot" style="--label-color:${escHtml(entry.color)}"></span>
    ${arg.timeText ? `<span class="calendar-event-time">${escHtml(arg.timeText)}</span>` : ''}
    <span class="calendar-event-title">${escHtml(arg.event.title || '(Bla Titlu)')}</span>
    ${arg.event.extendedProps?.recurringEventId ? '<span class="calendar-event-lock" aria-label="Repeating event">↻</span>' : ''}`;
  return { domNodes: [wrap] };
}

function rerenderCalendarChrome() {
  renderSelectedDayAgenda();
  _fullCalendar?.render();
}

function initFullCalendar() {
  const el = document.getElementById('full-calendar');
  if (!el || _fullCalendar) return;

  _fullCalendar = new Calendar(el, {
    plugins: [interactionPlugin, dayGridPlugin, timeGridPlugin, listPlugin],
    initialView: 'dayGridMonth',
    firstDay: 1,
    height: '100%',
    nowIndicator: true,
    editable: true,
    selectable: true,
    eventResizableFromStart: true,
    displayEventTime: true,
    dayMaxEvents: 4,
    moreLinkClick: 'popover',
    eventOrder: 'allDay,start,title',
    slotMinTime: '06:00:00',
    slotMaxTime: '24:00:00',
    headerToolbar: {
      left: 'prev,next title',
      center: '',
      right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth',
    },
    buttonText: {
      today: 'Illum',
      month: 'Xahar',
      week: 'Ġimgħa',
      day: 'Jum',
      list: 'Agenda',
    },
    events: fetchCalendarEvents,
    eventContent: renderCalendarEventContent,
    eventClassNames: info => {
      const classes = ['calendar-event-chip'];
      if (info.event.id === _calendarState.selectedEventId) classes.push('is-selected');
      if (info.event.extendedProps?.recurringEventId) classes.push('is-recurring');
      return classes;
    },
    dayCellClassNames: info => dateKey(info.date) === dateKey(_calendarState.selectedDate) ? ['calendar-day-selected'] : [],
    dateClick: info => openCreateEventInspector(info.date, info.allDay),
    select: info => {
      openCreateEventInspector(info.start, info.allDay, info.end);
      _fullCalendar.unselect();
    },
    eventClick: info => {
      info.jsEvent.preventDefault();
      openEditEventInspector(info.event);
    },
    eventDrop: info => persistCalendarMove(info),
    eventResize: info => persistCalendarMove(info),
  });
  _fullCalendar.render();
}

function loadCalendarEvents() {
  const alreadyInitialized = Boolean(_fullCalendar);
  initFullCalendar();
  renderCalendarLabels();
  if (alreadyInitialized) _fullCalendar?.refetchEvents();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toLocalDateTimeValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function toDateValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addHours(date, hours) {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}

function calendarEventPayloadFromDates(event) {
  const label = event.extendedProps?.label || '';
  if (event.allDay) {
    return {
      title: event.title || '(Bla Titlu)',
      description: event.extendedProps?.description || '',
      location: event.extendedProps?.location || '',
      label,
      allDay: true,
      start: toDateValue(event.start),
      end: toDateValue(event.end || addDays(event.start, 1)),
    };
  }
  return {
    title: event.title || '(Bla Titlu)',
    description: event.extendedProps?.description || '',
    location: event.extendedProps?.location || '',
    label,
    allDay: false,
    start: event.start.toISOString(),
    end: (event.end || addHours(event.start, 1)).toISOString(),
  };
}

async function persistCalendarMove(info) {
  const event = info.event;
  if (event.extendedProps?.recurringEventId) {
    info.revert();
    showRecurringWarning(event);
    return;
  }
  try {
    await calendarRequest(`?id=${encodeURIComponent(event.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(calendarEventPayloadFromDates(event)),
    });
    _calendarState.selectedDate = event.start || _calendarState.selectedDate;
    _calendarState.selectedEventId = event.id;
    renderSelectedDayAgenda();
    showToast('Avveniment aġġornat.', 'ok');
  } catch (err) {
    info.revert();
    showToast(TOAST.error(`Kalendarju: ${err.message}`), 'error');
  }
}

function setEventModalAllDay(allDay) {
  document.querySelectorAll('.event-time-input').forEach(el => { el.hidden = allDay; });
  document.querySelectorAll('.event-date-input').forEach(el => { el.hidden = !allDay; });
}

function setInspectorFormDisabled(disabled) {
  document.querySelectorAll('#event-modal-form input, #event-modal-form select, #event-modal-form textarea')
    .forEach(el => { el.disabled = disabled; });
}

function setInspectorVisible(mode) {
  const empty = document.getElementById('calendar-inspector-empty');
  const form = document.getElementById('event-modal-form');
  const actions = document.getElementById('calendar-inspector-actions');
  if (empty) empty.hidden = mode !== 'empty' && mode !== 'day';
  if (form) form.hidden = mode === 'empty' || mode === 'day';
  if (actions) actions.hidden = mode === 'empty' || mode === 'day';
}

function populateEventInspector({
  mode,
  id = null,
  title = '',
  label = '',
  allDay = false,
  start,
  end,
  location = '',
  description = '',
  htmlLink = '',
  recurringEventId = null,
}) {
  _calendarModalState = { mode, id, recurringEventId };
  _calendarState.mode = recurringEventId ? 'recurring' : mode;
  _calendarState.selectedEventId = id;
  _calendarState.selectedDate = start || _calendarState.selectedDate || new Date();
  ensureCalendarLabel(label);
  renderCalendarLabels();
  setInspectorVisible(mode);

  document.getElementById('calendar-inspector-kicker').textContent = mode === 'create' ? 'Ġdid' : 'Dettalji';
  document.getElementById('event-modal-title').textContent = mode === 'create' ? 'Avveniment Ġdid' : 'Editja Avveniment';
  document.getElementById('event-title-input').value = title;
  document.getElementById('event-label-input').value = label;
  document.getElementById('event-all-day-input').checked = allDay;
  document.getElementById('event-location-input').value = location;
  document.getElementById('event-description-input').value = description;

  setEventModalAllDay(allDay);
  if (allDay) {
    document.getElementById('event-start-date-input').value = toDateValue(start);
    document.getElementById('event-end-date-input').value = toDateValue(end || addDays(start, 1));
  } else {
    document.getElementById('event-start-input').value = toLocalDateTimeValue(start);
    document.getElementById('event-end-input').value = toLocalDateTimeValue(end || addHours(start, 1));
  }

  const recurring = Boolean(recurringEventId);
  const warning = document.getElementById('event-recurring-warning');
  const saveBtn = document.getElementById('event-save-btn');
  const deleteBtn = document.getElementById('event-delete-btn');
  const link = document.getElementById('event-google-link');
  warning.hidden = !recurring;
  saveBtn.hidden = recurring;
  deleteBtn.hidden = mode !== 'edit' || recurring;
  setInspectorFormDisabled(recurring);
  if (htmlLink) {
    link.hidden = false;
    link.href = htmlLink;
  } else {
    link.hidden = true;
    link.removeAttribute('href');
  }

  renderSelectedDayAgenda();
  rerenderCalendarChrome();
  requestAnimationFrame(() => document.getElementById('event-title-input')?.focus());
}

function openCreateEventInspector(start, allDay, end = null) {
  populateEventInspector({
    mode: 'create',
    start,
    end: end || (allDay ? addDays(start, 1) : addHours(start, 1)),
    allDay,
  });
}

function openEditEventInspector(event) {
  populateEventInspector({
    mode: 'edit',
    id: event.id,
    title: event.title,
    label: event.extendedProps?.label || '',
    allDay: event.allDay,
    start: event.start,
    end: event.end || (event.allDay ? addDays(event.start, 1) : addHours(event.start, 1)),
    location: event.extendedProps?.location || '',
    description: event.extendedProps?.description || '',
    htmlLink: event.extendedProps?.htmlLink || '',
    recurringEventId: event.extendedProps?.recurringEventId || null,
  });
}

function showRecurringWarning(event) {
  openEditEventInspector(event);
  showToast('This is part of a repeating series. Edit it in Google Calendar.', 'error');
}

function clearCalendarInspector() {
  _calendarModalState = { mode: 'day', id: null, recurringEventId: null };
  _calendarState.mode = 'day';
  _calendarState.selectedEventId = null;
  setInspectorVisible('day');
  setInspectorFormDisabled(false);
  document.getElementById('calendar-inspector-kicker').textContent = 'Avveniment';
  document.getElementById('event-modal-title').textContent = 'Agħżel avveniment';
  document.getElementById('event-recurring-warning').hidden = true;
  document.getElementById('calendar-inspector-empty').textContent = 'Ikklikkja ġurnata biex toħloq avveniment, jew avveniment biex teditjah.';
  rerenderCalendarChrome();
}

function readEventModalPayload() {
  const allDay = document.getElementById('event-all-day-input').checked;
  const title = document.getElementById('event-title-input').value.trim();
  const label = document.getElementById('event-label-input').value.trim();
  const location = document.getElementById('event-location-input').value.trim();
  const description = document.getElementById('event-description-input').value.trim();

  if (!title) throw new Error('It-titlu huwa meħtieġ.');
  if (allDay) {
    const start = document.getElementById('event-start-date-input').value;
    const end = document.getElementById('event-end-date-input').value;
    if (!start || !end || end <= start) throw new Error('Agħżel dati validi.');
    return { title, label, location, description, allDay, start, end };
  }

  const start = document.getElementById('event-start-input').value;
  const end = document.getElementById('event-end-input').value;
  if (!start || !end || new Date(end) <= new Date(start)) throw new Error('Agħżel ħinijiet validi.');
  return {
    title,
    label,
    location,
    description,
    allDay,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
}

document.getElementById('refresh-events-btn')?.addEventListener('click', loadCalendarEvents);
document.getElementById('calendar-today-btn')?.addEventListener('click', () => {
  initFullCalendar();
  _fullCalendar?.today();
  _calendarState.selectedDate = new Date();
  clearCalendarInspector();
});
document.getElementById('calendar-clear-selection-btn')?.addEventListener('click', clearCalendarInspector);
document.getElementById('calendar-new-event-btn')?.addEventListener('click', () => {
  const d = _calendarState.selectedDate || new Date();
  openCreateEventInspector(d, true, addDays(d, 1));
});
document.getElementById('calendar-day-agenda-list')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-calendar-agenda-id]');
  if (!btn) return;
  const event = _fullCalendar?.getEventById(btn.dataset.calendarAgendaId);
  if (event) openEditEventInspector(event);
});
document.getElementById('event-all-day-input')?.addEventListener('change', e => setEventModalAllDay(e.target.checked));
document.getElementById('event-modal-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!_calendarModalState || _calendarModalState.recurringEventId) return;
  try {
    const payload = readEventModalPayload();
    const mode = _calendarModalState.mode;
    const path = mode === 'edit' ? `?id=${encodeURIComponent(_calendarModalState.id)}` : '';
    const method = mode === 'edit' ? 'PATCH' : 'POST';
    const saved = await calendarRequest(path, { method, body: JSON.stringify(payload) });
    const savedStart = saved?.start ? new Date(saved.start) : _calendarState.selectedDate;
    _calendarState.selectedDate = savedStart;
    _calendarState.selectedEventId = saved?.id || _calendarState.selectedEventId;
    if (saved) populateEventInspector({
      mode: 'edit',
      id: saved.id,
      title: saved.title,
      label: saved.extendedProps?.label || '',
      allDay: saved.allDay,
      start: savedStart,
      end: saved.end ? new Date(saved.end) : (saved.allDay ? addDays(savedStart, 1) : addHours(savedStart, 1)),
      location: saved.extendedProps?.location || '',
      description: saved.extendedProps?.description || '',
      htmlLink: saved.extendedProps?.htmlLink || '',
      recurringEventId: saved.extendedProps?.recurringEventId || null,
    });
    _fullCalendar?.refetchEvents();
    showToast(mode === 'edit' ? 'Avveniment issejvjat.' : 'Avveniment miżjud.', 'ok');
  } catch (err) {
    showToast(TOAST.error(`Kalendarju: ${err.message}`), 'error');
  }
});
document.getElementById('event-delete-btn')?.addEventListener('click', async () => {
  if (!_calendarModalState?.id || _calendarModalState.recurringEventId) return;
  if (!await showConfirm('Trid tħassar dan l-avveniment?')) return;
  try {
    await calendarRequest(`?id=${encodeURIComponent(_calendarModalState.id)}`, { method: 'DELETE' });
    clearCalendarInspector();
    _fullCalendar?.refetchEvents();
    showToast('Avveniment imħassar.', 'ok');
  } catch (err) {
    showToast(TOAST.error(`Kalendarju: ${err.message}`), 'error');
  }
});
document.getElementById('calendar-label-list')?.addEventListener('change', e => {
  const input = e.target.closest('[data-calendar-label]');
  if (!input) return;
  const key = input.dataset.calendarLabel;
  if (!_calendarLabels[key]) return;
  _calendarLabels[key].visible = input.checked;
  refreshCalendarLabelViews();
});
document.getElementById('calendar-label-list')?.addEventListener('click', async e => {
  const saveBtn = e.target.closest('[data-calendar-label-save]');
  const deleteBtn = e.target.closest('[data-calendar-label-delete]');

  if (saveBtn) {
    const key = saveBtn.dataset.calendarLabelSave;
    const label = _calendarLabels[key];
    if (!label) return;
    const name = normalizeLabelName(document.querySelector(`[data-calendar-label-name="${CSS.escape(key)}"]`)?.value);
    const color = document.querySelector(`[data-calendar-label-color="${CSS.escape(key)}"]`)?.value || label.color;
    if (!name) {
      showToast(TOAST.error('Isem tal-label huwa meħtieġ.'), 'error');
      return;
    }
    label.name = label.system ? label.name : name;
    label.color = color;
    refreshCalendarLabelViews();
    showToast('Label issejvjata.', 'ok');
  }

  if (deleteBtn) {
    const key = deleteBtn.dataset.calendarLabelDelete;
    const label = _calendarLabels[key];
    if (!label || label.system) return;
    if (!await showConfirm(`Trid tneħħi l-label "${label.name}"?`)) return;
    delete _calendarLabels[key];
    _calendarDeletedLabels.add(key);
    if (document.getElementById('event-label-input')?.value === key) {
      document.getElementById('event-label-input').value = '';
    }
    refreshCalendarLabelViews();
    showToast('Label imneħħija.', 'ok');
  }
});
document.getElementById('calendar-label-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const nameEl = document.getElementById('calendar-label-name');
  const colorEl = document.getElementById('calendar-label-color');
  const name = normalizeLabelName(nameEl.value);
  if (!name) return;
  _calendarDeletedLabels.delete(name);
  _calendarLabels[name] = { name, color: colorEl.value || '#9f4638', visible: true };
  nameEl.value = '';
  refreshCalendarLabelViews();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Report generator
// ═══════════════════════════════════════════════════════════════════════════════

function initReportDates() {
  const fEl = document.getElementById('rpt-from');
  const tEl = document.getElementById('rpt-to');
  if (!fEl || !tEl) return;
  if (fEl.value && tEl.value) return;
  const now = new Date();
  fEl.value = new Date(now.getFullYear(), now.getMonth(),     1).toISOString().slice(0, 10);
  tEl.value = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
}

// Sync visual checkboxes in report panel
document.querySelectorAll('.check-item input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', () => {
    const box = cb.closest('.check-item')?.querySelector('.check-box');
    if (box) box.classList.toggle('checked', cb.checked);
  });
});

document.getElementById('do-generate-report-btn')?.addEventListener('click', async () => {
  const cfg = loadConfig();
  if (!cfg.vercelUrl || !cfg.apiKey) { showToast(ERR.settings_first, 'error'); return; }

  const from = document.getElementById('rpt-from')?.value;
  const to   = document.getElementById('rpt-to')?.value;
  if (!from || !to) { showToast(ERR.pick_period, 'warn'); return; }

  const sections = {
    posts:     document.getElementById('rpt-posts')?.checked,
    engage:    document.getElementById('rpt-engage')?.checked,
    followers: document.getElementById('rpt-followers')?.checked,
    reach:     document.getElementById('rpt-reach')?.checked,
    list:      document.getElementById('rpt-list')?.checked,
  };

  const btn = document.getElementById('do-generate-report-btn');
  btn.disabled = true; btn.textContent = BTN.report_busy;

  try {
    const res = await fetch(`${cfg.vercelUrl}/api/reports/monthly?from=${from}&to=${to}`, {
      headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) throw new Error(res.statusText);
    printReport(await res.json(), sections, from, to);
  } catch (err) {
    showToast(TOAST.error(err.message), 'error');
  } finally {
    btn.disabled = false; btn.textContent = BTN.report_gen;
  }
});

function printReport(data, sections, from, to) {
  const fmtDate = d => new Date(d).toLocaleDateString('mt', { day:'numeric', month:'long', year:'numeric' });

  let html = `
    <div class="rpt-letterhead">
      <div class="rpt-star">★</div>
      <div>
        <div class="rpt-org">${REPORT.org}</div>
        <div class="rpt-dept">${REPORT.dept}</div>
      </div>
    </div>
    <h1 class="rpt-title">${REPORT.title}</h1>
    <p class="rpt-period">${REPORT.period(fmtDate(from), fmtDate(to))}</p>
    <hr class="rpt-divider" />`;

  if (sections.posts && data.summary) {
    const s      = data.summary;
    const byPlat = Object.entries(s.by_platform||{}).map(([k,v]) => `<tr><td>→ ${escHtml(k)}</td><td>${v}</td></tr>`).join('');
    const byProf = Object.entries(s.by_profile ||{}).map(([k,v]) => `<tr><td>→ ${escHtml(k)}</td><td>${v}</td></tr>`).join('');
    html += `<section class="rpt-section"><h2>${REPORT.sec_posts}</h2><table class="rpt-table">
      <tr><td><strong>${REPORT.total_pub}</strong></td><td><strong>${escHtml(String(s.total_published))}</strong></td></tr>
      <tr><td>${REPORT.total_pend}</td><td>${escHtml(String(s.total_pending))}</td></tr>
      <tr><td>${REPORT.total_fail}</td><td>${escHtml(String(s.total_failed))}</td></tr>
      ${byPlat}${byProf}</table></section>`;
  }

  if (sections.engage && data.engagement) {
    html += `<section class="rpt-section"><h2>${REPORT.sec_engage}</h2><table class="rpt-table">
      <tr><td>${REPORT.total_likes}</td><td><strong>${escHtml(String(data.engagement.total_likes))}</strong></td></tr>
      <tr><td>${REPORT.total_comm}</td><td><strong>${escHtml(String(data.engagement.total_comments))}</strong></td></tr>
      </table></section>`;
  }

  if ((sections.followers || sections.reach) && data.page_insights) {
    const pi  = data.page_insights;
    let rows  = '';
    if (sections.followers) {
      rows += `<tr><td>${REPORT.fb_followers}</td><td>${pi.fb_followers??'—'}</td></tr>`;
      rows += `<tr><td>${REPORT.ig_followers}</td><td>${pi.ig_followers??'—'}</td></tr>`;
    }
    if (sections.reach) rows += `<tr><td>${REPORT.fb_impr}</td><td>${pi.fb_impressions??'—'}</td></tr>`;
    if (rows) html += `<section class="rpt-section"><h2>${REPORT.sec_reach}</h2><table class="rpt-table">${rows}</table></section>`;
  }

  if (sections.list && data.posts?.length) {
    const rows = data.posts.map(p => `
      <tr>
        <td>${new Date(p.scheduled_time).toLocaleDateString('mt')}</td>
        <td>${escHtml((p.caption||'').slice(0,55))}${(p.caption||'').length>55?'…':''}</td>
        <td>${escHtml((p.platforms||[]).join(', '))}</td>
        <td>${escHtml(p.profile_id||'main')}</td>
        <td>${escHtml(STATUS_LABELS[p.status]||p.status)}</td>
        <td>${p.likes_count||0}</td><td>${p.comments_count||0}</td>
      </tr>`).join('');
    html += `<section class="rpt-section"><h2>${REPORT.sec_list(data.posts.length)}</h2>
      <table class="rpt-table rpt-table-full">
        <thead><tr><th>Data</th><th>Kaptjon</th><th>Pjattaformi</th><th>Profil</th><th>Status</th><th>👍</th><th>💬</th></tr></thead>
        <tbody>${rows}</tbody></table></section>`;
  }

  html += `<p class="rpt-footer">${REPORT.footer(new Date().toLocaleString('mt'))}</p>`;

  const area = document.getElementById('report-print-area');
  area.innerHTML      = html;
  area.style.display  = 'block';
  window.print();
  area.style.display  = 'none';
  area.innerHTML      = '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Modal accessibility — Escape to close + focus trap (applies to every overlay)
// ═══════════════════════════════════════════════════════════════════════════════
function topmostOpenModal() {
  const open = [...document.querySelectorAll('.modal-overlay')]
    .filter(m => m.style.display !== 'none' && m.offsetParent !== null);
  return open.length ? open[open.length - 1] : null;
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' && e.key !== 'Tab') return;
  const modal = topmostOpenModal();
  if (!modal) return;
  // link-modal manages its own Enter/Escape lifecycle.
  if (modal.id === 'link-modal') return;

  if (e.key === 'Escape') {
    e.preventDefault();
    // Click a real close/cancel control so any cleanup (e.g. confirm() resolving
    // false, object-URL revocation) runs, instead of just hiding the element.
    const closeBtn = modal.querySelector('.modal-close, [id^="close-"], [id$="-cancel"], #confirm-no');
    if (closeBtn) closeBtn.click();
    else modal.style.display = 'none';
    return;
  }

  // Tab → keep focus inside the modal.
  const focusable = [...modal.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(el => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
});

// Default the publish time to tomorrow 18:30 local when nothing was restored —
// avoids shipping a fixed past date that would silently backdate a post.
function defaultScheduledTime() {
  const stEl = document.getElementById('scheduled-time');
  if (!stEl || stEl.value) return;
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 30, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  stEl.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════════
// Wrapped in an async function (instead of top-level await) so the module also
// evaluates on engines without top-level await support.
async function init() {
  await initConfig();
  await loadProfiles();

  // Hide WP expiry group on load (WP badge starts off)
  const egEl = document.getElementById('expiry-group');
  if (egEl) egEl.style.display = 'none';

  showToolTab('marka');
  showView(localStorage.getItem('banditur_view') || 'skeda');
  renderMiniCal();
  updateDraftsBtn();
  updateCaptionCount();
  refreshPhotographers();
  loadAutosave();
  defaultScheduledTime();
  updateSetupBanner();
  checkBackendCompatibility();
}

init().catch(err => console.error('Init failed:', err));
