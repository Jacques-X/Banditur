import { invoke }           from '@tauri-apps/api/core';
import { convertFileSrc }   from '@tauri-apps/api/core';
import { listen }           from '@tauri-apps/api/event';
import { open }             from '@tauri-apps/plugin-dialog';
import { openPath }         from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  STATUS_LABELS, ERR, TOOLS, TX, SCHED, TOAST, EMPTY, CONFIRM, BTN, ABOUT, REPORT,
  BUILTIN_TEMPLATES,
} from './strings.js';

// ── Utilities ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const layer = document.getElementById('toast-layer');
  const card  = document.createElement('div');
  card.className   = `toast-card toast-${type}`;
  card.textContent = msg;
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
let _autosaveTimer    = null;
let _previewUrls      = [];
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

  if (name === 'arkivju') { loadArchive(); initReportDates(); }
  if (name === 'skeda')   { loadCalendarEvents(); updateSetupBanner(); }
}

document.querySelectorAll('.nav-item[data-nav]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.nav));
});

function updateSetupBanner() {
  const cfg    = loadConfig();
  const banner = document.getElementById('setup-banner');
  if (!banner) return;
  banner.style.display = (!cfg.vercelUrl || !cfg.apiKey) ? '' : 'none';
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

  const toolContent  = document.getElementById('tool-content');
  const sharedBottom = document.getElementById('shared-bottom');
  const appFooter    = document.getElementById('app-footer');
  const isTrask      = tab === 'trask';

  toolContent.classList.toggle('tx-mode', isTrask);
  sharedBottom.style.display = isTrask ? 'none' : '';
  appFooter.style.display    = isTrask ? 'none' : '';

  if (!isTrask) {
    runBtn.textContent      = tab === 'marka' ? TOOLS.run_watermark : TOOLS.run_arw;
    statusLabel.textContent = TOOLS.ready;
    progressBar.style.width = '0%';
    openBtn.disabled        = true;
    resolvedOutputDir       = null;
  } else {
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
    if (e.key === '3') { showView('arkivju'); return; }
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
  if (activeView === 'skeda')   { loadCalendarEvents(); }
  if (activeView === 'arkivju') loadArchive();
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
await listen('log', e => appendLog(e.payload.tag, e.payload.msg));

await listen('progress', e => {
  const pct = Math.round(e.payload.fraction * 100);
  progressBar.style.width = `${pct}%`;
  statusLabel.textContent = TOOLS.progress(pct);
});

await listen('done', e => {
  const { portrett, pajsagg, imqabbla, output_dir } = e.payload;
  resolvedOutputDir       = output_dir;
  runBtn.disabled         = false;
  runBtn.textContent      = TOOLS.run_watermark;
  openBtn.disabled        = false;
  statusLabel.textContent = TOOLS.done_wm(portrett, pajsagg, imqabbla);
});

await listen('raw-done', e => {
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
  } else {
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
      `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n[${s.speaker}]: ${s.text.trim()}`
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

async function processVideo(path) {
  if (txProcessing) return;
  const lower = path.toLowerCase();
  if (!lower.endsWith('.mp4') && !lower.endsWith('.mov')) {
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
  const path = await open({ multiple: false, filters: [{ name: 'Video', extensions: ['mp4', 'mov'] }] });
  if (path) processVideo(path);
});

const win = getCurrentWindow();
await win.onDragDropEvent(e => {
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
});

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
  } catch {}
}

// Wire scheduled-time and expiry-time to autosave
document.getElementById('scheduled-time')?.addEventListener('change', scheduleAutosave);
document.getElementById('expiry-time')?.addEventListener('change', scheduleAutosave);

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
document.getElementById('caption-link')?.addEventListener('click', () => {
  const url = prompt('URL:');
  if (url) insertAroundSelection(captionEl, '[', `](${url})`);
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
}

function addMediaFiles(files) {
  for (const f of files) {
    if (f.type.startsWith('image/') || f.type.startsWith('video/')) pickedMedia.push(f);
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
    container.innerHTML = `<p class="empty-state">${EMPTY.no_drafts}</p>`;
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
  localStorage.removeItem(AUTOSAVE_KEY);
  markSaved(new Date());
});

// ── Post preview ──────────────────────────────────────────────────────────────

const PLAT_LABELS = { fb: 'Facebook', ig: 'Instagram', wp: 'WordPress' };

function closePreviewModal() {
  document.getElementById('preview-modal').style.display = 'none';
  _previewUrls.forEach(u => URL.revokeObjectURL(u));
  _previewUrls = [];
}

document.getElementById('preview-btn')?.addEventListener('click', () => {
  const caption   = captionEl?.value.trim() || '';
  const platforms = getSelectedPlatforms();
  const schedTime = document.getElementById('scheduled-time')?.value;
  const profName  = 'Il-Kumitat Ċentrali';
  const colors    = { bg: '#A81D1D' };

  const content = document.getElementById('preview-content');
  content.innerHTML = '';
  // Revoke any previous preview URLs before creating new ones
  _previewUrls.forEach(u => URL.revokeObjectURL(u));
  _previewUrls = [];

  if (!caption && !pickedMedia.length) {
    content.innerHTML = `<p class="preview-empty">Iktibb xi ħaġa l-ewwel.</p>`;
    const modal = document.getElementById('preview-modal');
    modal.style.display = 'flex';
    focusModal(modal);
    return;
  }

  const platsToShow = platforms.length ? platforms : ['fb'];
  for (const plat of platsToShow) {
    const card = document.createElement('div');
    card.className = 'preview-card';

    const initials = profName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'SK';

    let mediaHtml = '';
    if (pickedMedia.length) {
      const cols = pickedMedia.length === 1 ? 1 : pickedMedia.length === 2 ? 2 : 3;
      const items = pickedMedia.slice(0, 9).map(f => {
        const url = URL.createObjectURL(f);
        _previewUrls.push(url);
        return f.type.startsWith('video/')
          ? `<video src="${url}" muted></video>`
          : `<img src="${url}" alt="" />`;
      }).join('');
      mediaHtml = `<div class="preview-media-grid" style="grid-template-columns:repeat(${cols},1fr)">${items}</div>`;
    }

    const dt = schedTime
      ? new Date(schedTime).toLocaleString('mt', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
      : '';

    card.innerHTML = `
      <div class="preview-card-hdr">
        <div class="preview-avatar" style="background:${escHtml(colors.bg)}">${escHtml(initials)}</div>
        <div>
          <div class="preview-page-name">${escHtml(profName || 'Profil')}</div>
          <div class="preview-plat-lbl">${escHtml(PLAT_LABELS[plat] || plat)}${dt ? ' · ' + escHtml(dt) : ''}</div>
        </div>
      </div>
      <div class="preview-caption">${escHtml(caption)}</div>
      ${mediaHtml}`;
    content.appendChild(card);
  }

  const modal = document.getElementById('preview-modal');
  modal.style.display = 'flex';
  focusModal(modal);
});

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
  el.textContent   = msg;
  el.className     = `schedule-status schedule-status-${type}`;
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

  await fetch(`${cfg.vercelUrl}/api/media/cleanup`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
    body:    JSON.stringify({ paths }),
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

    const profileId = 'main';
    const body      = { caption, platforms, scheduledTime, media, profile_id: profileId, content_type: contentType };
    if (platforms.includes('wp')) {
      const exp = document.getElementById('expiry-time')?.value;
      if (exp) body.expiryTime = exp;
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

    // Trigger cron immediately so FB posts get native-scheduled without waiting
    fetch(`${cfg.vercelUrl}/api/cron/process`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
    }).catch(() => {});

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
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:#C0392B">${ERR.vercel_config}</td></tr>`;
    return;
  }

  if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-muted)">${EMPTY.loading}</td></tr>`;

  try {
    const params = new URLSearchParams({
      page:   _archivePage,
      limit:  ARCHIVE_PER_PAGE,
      status: currentFilter,
    });
    if (_archiveSearch) params.set('search', _archiveSearch);

    const res = await fetch(`${cfg.vercelUrl}/api/history?${params}`, {
      headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    const { posts, total, pending } = await res.json();
    _archiveTotal = total;

    // Update count pill
    if (countPill) countPill.textContent = total;

    // Update pagination footer
    const showing = posts.length;
    const from    = (_archivePage - 1) * ARCHIVE_PER_PAGE + 1;
    const to      = from + showing - 1;
    if (tableFooterSpan) {
      tableFooterSpan.innerHTML = `Qed turi ${from}–${to} minn <strong class="tnum">${total}</strong> posts`;
    }
    if (prevBtn) prevBtn.disabled = _archivePage <= 1;
    if (nextBtn) nextBtn.disabled = to >= total;

    if (!tbody) return;

    if (!posts.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:#6b6770">${EMPTY.no_posts}</td></tr>`;
      return;
    }

    tbody.innerHTML = posts.map(p => {
      const dt   = new Date(p.scheduled_time).toLocaleString('mt');
      const plat = renderPlatformPills(p);
      const sc   = { published:'pill-published', pending:'pill-pending', failed:'pill-failed' }[p.status] || '';
      const ctLabel = p.content_type && p.content_type !== 'post'
        ? `<span class="plat-pill" style="background:#f0f4ff;color:#4f46e5;border-color:#c7d2fe">${escHtml(p.content_type)}</span>`
        : '';
      const thumbUrl = p.media?.[0]?.url;
      return `<tr>
        <td>${thumbUrl
          ? `<img src="${escHtml(thumbUrl)}" class="thumb-img" alt="" loading="lazy" />`
          : `<div class="thumb-placeholder"></div>`
        }</td>
        <td>
          <div class="row-caption">${escHtml((p.caption||'').slice(0,60))}${(p.caption||'').length>60?'…':''}</div>
          <div class="row-plat">${plat}${ctLabel}</div>
        </td>
        <td class="tnum" style="color:#6b6770;font-size:12px">${escHtml(dt)}</td>
        <td style="font-size:12px;color:#6b6770">${escHtml(p.profile_id||'main')}</td>
        <td><span class="status-pill ${sc}">${escHtml(STATUS_LABELS[p.status]||p.status)}</span></td>
        <td style="text-align:right;white-space:nowrap">
          ${p.status==='failed'  ? `<button class="btn-link archive-retry" data-id="${escHtml(p.id)}" style="font-size:11px">${BTN.retry}</button>` : ''}
          ${p.status==='pending' ? `<button class="btn-link archive-del"   data-id="${escHtml(p.id)}" style="font-size:11px;color:#C0392B">${BTN.delete}</button>` : ''}
        </td>
      </tr>`;
    }).join('');

  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:#6b6770">${escHtml(EMPTY.error(err.message))}</td></tr>`;
  }
}

document.getElementById('refresh-archive-btn')?.addEventListener('click', loadArchive);

const PLATFORM_ID_FIELD = { fb: 'fb_post_id', ig: 'ig_post_id', wp: 'wp_post_id' };

function renderPlatformPills(post) {
  return (post.platforms || []).map(pl => {
    const done = !!post[PLATFORM_ID_FIELD[pl]];
    const label = `${pl.toUpperCase()}${done && post.status === 'failed' ? ' done' : ''}`;
    const style = done && post.status === 'failed'
      ? ' style="background:#ecfdf5;color:#047857;border-color:#a7f3d0"'
      : '';
    return `<span class="plat-pill"${style}>${escHtml(label)}</span>`;
  }).join('');
}

document.getElementById('history-tbody')?.addEventListener('click', async e => {
  const retryBtn = e.target.closest('.archive-retry');
  const delBtn   = e.target.closest('.archive-del');
  const cfg      = loadConfig();

  if (retryBtn) {
    const id = retryBtn.dataset.id;
    retryBtn.disabled = true; retryBtn.textContent = BTN.retrying;
    try {
      const r = await fetch(`${cfg.vercelUrl}/api/retry`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
        body:    JSON.stringify({ post_id: id }),
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
  grid.innerHTML = `<p class="empty-state">${EMPTY.loading}</p>`;

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
    grid.innerHTML = `<p class="empty-state">${EMPTY.settings_req}</p>`;
    return;
  }

  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  try {
    const url = `${cfg.vercelUrl}/api/drive/posters${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${cfg.apiKey}` } });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      throw new Error(msg);
    }
    const files = await res.json();

    if (!files.length) { grid.innerHTML = `<p class="empty-state">${EMPTY.no_drive}</p>`; return; }

    grid.innerHTML = '';
    for (const file of files) {
      const isFolder = file.mimeType === FOLDER_MIME;
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
        item.innerHTML = thumbSrc
          ? `<img src="${thumbSrc}" alt="${escHtml(file.name)}" loading="lazy" onerror="this.style.display='none'" />
             <span class="drive-item-name">${escHtml(file.name)}</span>`
          : `<div class="drive-item-thumb-placeholder"></div>
             <span class="drive-item-name">${escHtml(file.name)}</span>`;
        item.addEventListener('click', () => selectDriveFile(file, cfg));
        item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectDriveFile(file, cfg); }});
      }

      grid.appendChild(item);
    }
  } catch (err) {
    grid.innerHTML = `<p class="empty-state">${escHtml(EMPTY.error(err.message))}</p>`;
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
    const f    = new File([blob], file.name, { type: blob.type || file.mimeType || 'image/jpeg' });
    pickedMedia.push(f);
    renderMediaPreviews();
    const ss = document.getElementById('schedule-status');
    if (ss) ss.style.display = 'none';
  } catch (err) {
    showScheduleStatus(TOAST.drive_err(err.message), 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Calendar events
// ═══════════════════════════════════════════════════════════════════════════════

document.getElementById('refresh-events-btn')?.addEventListener('click', loadCalendarEvents);

async function loadCalendarEvents() {
  const cfg  = loadConfig();
  const list = document.getElementById('events-list');
  if (!list) return;

  if (!cfg.vercelUrl || !cfg.apiKey) {
    list.innerHTML = `<p class="empty-state">${ERR.vercel_config}</p>`;
    return;
  }

  try {
    const res = await fetch(`${cfg.vercelUrl}/api/calendar/events`, { headers: { 'Authorization': `Bearer ${cfg.apiKey}` } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const events = await res.json();

    list.innerHTML = '';
    if (!events.length) {
      list.innerHTML = `<p class="empty-state">${EMPTY.no_events}</p>`;
      return;
    }

    for (const ev of events) {
      const dtRaw  = ev.start?.dateTime || ev.start?.date;
      const dtFmt  = dtRaw ? new Date(dtRaw).toLocaleDateString('mt', {
        weekday: 'short', month: 'short', day: 'numeric',
        ...(ev.start?.dateTime ? { hour: '2-digit', minute: '2-digit' } : {}),
      }) : '';
      const item = document.createElement('div');
      item.className = 'event-card';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', `${ev.summary || '—'} — ${dtFmt}`);
      item.innerHTML = `
        <span class="event-rail" aria-hidden="true"></span>
        <div class="event-card-inner">
          <div class="event-card-left">
            <div class="event-title">${escHtml(ev.summary || '—')}</div>
            <div class="event-meta">
              <span class="tnum">${escHtml(dtFmt)}</span>
              ${ev.location ? `<span class="event-sep" aria-hidden="true">·</span><span>${escHtml(ev.location)}</span>` : ''}
            </div>
          </div>
          <svg class="event-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </div>`;
      item.addEventListener('click', () => openEventModal(ev));
      item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEventModal(ev); } });
      list.appendChild(item);
    }
  } catch (err) { showToast(TOAST.error(`Kalendarju: ${err.message}`), 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Event detail modal
// ═══════════════════════════════════════════════════════════════════════════════

let _currentEventForDate = null;

function fmtDateRange(ev) {
  const startRaw = ev.start?.dateTime || ev.start?.date;
  const endRaw   = ev.end?.dateTime   || ev.end?.date;
  const hasTime  = !!ev.start?.dateTime;
  const opts     = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                     ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}) };
  const start    = startRaw ? new Date(startRaw).toLocaleString('mt', opts) : '';

  if (!endRaw) return start;

  // All-day events: end date from Google is exclusive, subtract one day for display
  const endDate  = new Date(endRaw);
  if (!hasTime) endDate.setDate(endDate.getDate() - 1);
  const end = endDate.toLocaleString('mt', opts);

  return start === end ? start : `${start} – ${end}`;
}

function openEventModal(ev) {
  _currentEventForDate = ev;

  const titleEl = document.getElementById('event-modal-title');
  const bodyEl  = document.getElementById('event-modal-body');
  if (!titleEl || !bodyEl) return;

  titleEl.textContent = ev.summary || '—';
  bodyEl.innerHTML    = '';

  function row(iconPath, content, extraClass = '') {
    const div  = document.createElement('div');
    div.className = 'event-detail-row';
    div.innerHTML = `
      <svg class="event-detail-icon" width="15" height="15" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="${iconPath}"/>
      </svg>
      <div class="event-detail-text ${extraClass}"></div>`;
    div.querySelector('.event-detail-text').textContent = content;
    bodyEl.appendChild(div);
  }

  // Date / time
  const dateStr = fmtDateRange(ev);
  if (dateStr) row('M8 7V3m8 4V3m-9 8h10M3 21h18a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z', dateStr);

  // Location
  if (ev.location) row('M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z', ev.location);

  // Description
  if (ev.description?.trim()) {
    const descDiv = document.createElement('div');
    descDiv.className   = 'event-detail-desc';
    descDiv.textContent = ev.description.trim();
    bodyEl.appendChild(descDiv);
  }

  // Show/hide "Use date" button — only when a specific time exists
  const useDateBtn = document.getElementById('event-use-date-btn');
  if (useDateBtn) useDateBtn.style.display = ev.start?.dateTime ? '' : 'none';

  const modal = document.getElementById('event-modal');
  modal.style.display = 'flex';
  focusModal(modal);
}

function closeEventModal() {
  document.getElementById('event-modal').style.display = 'none';
  _currentEventForDate = null;
}

document.getElementById('close-event-btn')?.addEventListener('click', closeEventModal);
document.getElementById('event-modal-close-btn')?.addEventListener('click', closeEventModal);
document.getElementById('event-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeEventModal();
});

document.getElementById('event-use-date-btn')?.addEventListener('click', () => {
  const ev = _currentEventForDate;
  if (!ev?.start?.dateTime) return;
  // Format as YYYY-MM-DDTHH:MM for the datetime-local input
  const d   = new Date(ev.start.dateTime);
  const pad = n => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const schedEl = document.getElementById('scheduled-time');
  if (schedEl) { schedEl.value = iso; scheduleAutosave(); }
  closeEventModal();
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
// Init
// ═══════════════════════════════════════════════════════════════════════════════

await initConfig();

// Hide WP expiry group on load (WP badge starts off)
const _egEl = document.getElementById('expiry-group');
if (_egEl) _egEl.style.display = 'none';

showToolTab('marka');
showView(localStorage.getItem('banditur_view') || 'skeda');
renderMiniCal();
updateDraftsBtn();
updateCaptionCount();
refreshPhotographers();
loadAutosave();
updateSetupBanner();
