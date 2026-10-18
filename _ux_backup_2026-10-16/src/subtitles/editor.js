// Traskrittura subtitle editor: cue list, timeline, keyboard editing, styles,
// names / articles, re-splitting and export. Tauri APIs are injected so the
// module also runs in a plain browser (see the test harness notes in AGENTS.md).

import {
  SubtitleDoc, wordsFromSidecar, buildCues, flattenWords, cueIndexAt, wordIndexAt,
  splitAt, joinNext, trimIn, trimOut, rollIn, rollOut, moveFirstWordToPrev,
  moveLastWordToNext, deleteCue, setCueText, toggleKeyword, setCueStyle, nextUnsure,
  findNameVariants, replaceVariants, replaceText, buildSrt, cueText, clone,
  mergeArticlesInCues, setWordText, joinWordWithNext, cueIssues, nextIssueCue,
  suggestKeywords, markKeywords, LOW_CONFIDENCE, setWordStart,
} from './model.js';
import { findArticleIssues } from './maltese.js';
import { nameList, findCaseFixes, applyCaseFixes } from './names.js';
import {
  PUNCH, PRESETS, PRESET_BY_ID, FONTS, ENTRIES, WORD_EFFECTS, EMPHASES, DEFAULT_LOOK,
  normalizeLook, lookFromPreset, restoreLook, DEFAULT_PRESET, buildAss, layoutFor, cueCharBudget, formatOf,
} from './styles.js';
import { createPreview, createTiles } from './preview.js';
import { createTimeline } from './timeline.js';
import { escapeHtml } from '../ui.js';

const SESSION_PREFIX = 'banditur_subs:';
const PEAKS_PREFIX = 'banditur_peaks:';
const LOOK_KEY = 'banditur_sub_look';
const LOOKS_KEY = 'banditur_sub_looks';
const LOGO_KEY = 'banditur_sub_logo';
const ENDCARD_KEY = 'banditur_sub_endcard';   // { text, seconds }: a closing card after the video
const SPLIT_KEY = 'banditur_sub_split';
const EXPORT_DIR_KEY = 'banditur_sub_exportdir';   // folder of the last export
const NAMES_KEY = 'banditur_sub_names';   // the user's own names list

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } },
  keys(prefix) { try { return Object.keys(localStorage).filter(k => k.startsWith(prefix)); } catch { return []; } },
};

// Peaks are stored compactly (base64 bytes) next to the session.
const packPeaks = p => {
  if (!p?.peaks?.length) return null;
  let s = '';
  for (const v of p.peaks) s += String.fromCharCode(Math.max(0, Math.min(255, v | 0)));
  return { rate: p.rate || 50, b64: btoa(s) };
};
const unpackPeaks = p => {
  if (!p?.b64) return null;
  const s = atob(p.b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return { rate: p.rate || 50, peaks: out };
};

/** Saved editing session for a media file, if any (cues, look, split settings). */
export function loadSavedSession(videoPath) {
  const s = store.get(SESSION_PREFIX + videoPath);
  return s && Array.isArray(s.cues) && s.cues.length ? s : null;
}

/** Forget the saved edits (and waveform) for one file. The video itself is untouched. */
export function deleteSavedSession(videoPath) {
  try {
    localStorage.removeItem(SESSION_PREFIX + videoPath);
    localStorage.removeItem(PEAKS_PREFIX + videoPath);
  } catch { /* storage unavailable */ }
}

/** Forget every saved session. */
export function clearSavedSessions() {
  for (const k of store.keys(SESSION_PREFIX)) deleteSavedSession(k.slice(SESSION_PREFIX.length));
}

/** Most recently edited sessions → [{ path, name, savedAt, cues }] */
export function listRecentSessions(n = 4) {
  return store.keys(SESSION_PREFIX)
    .map(k => {
      const s = store.get(k);
      const path = k.slice(SESSION_PREFIX.length);
      return s?.cues?.length ? { path, name: baseName(path), savedAt: s.savedAt || 0, cues: s.cues.length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, n);
}

const baseName = p => String(p).split(/[\\/]/).pop();
const stripExt = p => String(p).replace(/\.[^./\\]+$/, '');
const clock = s => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
const clockTenths = s => `${clock(s)}.${Math.floor(((s || 0) % 1) * 10)}`;

export function createSubtitleEditor({ root, video, invoke, saveDialog, openDialog, openPath, fileSrc, listen, toast, S }) {
  const $ = sel => root.querySelector(sel);
  const $$ = sel => [...root.querySelectorAll(sel)];
  const list = $('#tx-segments');
  const preview = createPreview({ stage: $('#sub-stage'), video, overlay: $('#sub-overlay') });

  let doc = new SubtitleDoc([]);
  let look = restoreLook(store.get(LOOK_KEY));
  let split = { maxWords: 6, maxPause: 0.8, keepArticles: true, ...(store.get(SPLIT_KEY) || {}) };
  let logo = store.get(LOGO_KEY);
  let endCard = { text: '', seconds: 3, ...(store.get(ENDCARD_KEY) || {}) };
  let savedLooks = store.get(LOOKS_KEY) || [];
  let videoPath = null;
  let srtPath = null;
  let open = false;
  let sel = { i: -1, k: -1 };
  let target = -1;
  let capFixes = [];
  let myNames = (store.get(NAMES_KEY) || []).filter(n => typeof n === 'string');
  const capOff = new Set();   // names the user unticked this session
  let editing = -1;
  let scope = 'all';
  let activeIdx = -1;
  let activeWord = -1;
  let raf = 0;
  let saveTimer = 0;
  let exporting = false;
  let exportUnlisten = null;
  let lastExportPath = null;
  let peaks = null;

  const frame = () => ({ w: video.videoWidth || 1920, h: video.videoHeight || 1080 });
  const lookOpts = () => ({ maxChars: layoutFor(look, frame().w, frame().h).maxChars, maxLines: look.maxLines === 1 ? 1 : 2 });

  // ── Timeline ───────────────────────────────────────────────────────────────

  const timeline = createTimeline({
    root: $('#sub-tl'),
    video,
    getDoc: () => doc,
    getSel: () => sel.i,
    getTarget: () => target,
    onSelect: (i, o) => select(i, -1, { seek: o?.seek, scroll: true }),
    getLookOpts: lookOpts,
    labels: { trimIn: S.l_trimIn, trimOut: S.l_trimOut, rollIn: S.l_roll, rollOut: S.l_roll, move: S.l_move, word: S.l_wordtime },
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** The video's size, waiting briefly for its metadata (audio files have none). */
  function videoSize() {
    if (video.videoWidth) return Promise.resolve(frame());
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); video.removeEventListener('loadedmetadata', done); resolve(frame()); };
      const timer = setTimeout(done, 2000);
      video.addEventListener('loadedmetadata', done);
    });
  }

  async function load({ words, cues, videoPath: vp, srtPath: sp, session, peaks: pk }) {
    videoPath = vp;
    srtPath = sp || (vp ? `${stripExt(vp)}.srt` : null);
    if (session?.split) split = { ...split, ...session.split };
    if (session?.look) look = restoreLook(session.look);
    if (session && 'logo' in session) logo = session.logo;
    if (session?.endCard) endCard = { text: '', seconds: 3, ...session.endCard };
    let initial;
    if (cues) initial = clone(cues);
    else {
      const { w, h } = await videoSize();
      initial = buildCues(wordsFromSidecar(words), { maxWords: split.maxWords, maxPause: split.maxPause, maxChars: cueCharBudget(look, w, h) });
    }
    if (split.keepArticles) mergeArticlesInCues(initial);
    doc = new SubtitleDoc(initial);
    doc.onChange(changed);
    sel = { i: initial.length ? 0 : -1, k: -1 };
    editing = -1;
    open = true;
    $('#sub-file-name').textContent = vp ? baseName(vp) : '';
    peaks = pk?.peaks?.length ? pk : unpackPeaks(store.get(PEAKS_PREFIX + vp));
    timeline.setPeaks(peaks);
    if (!peaks && vp) fetchPeaks(vp);
    else if (pk?.peaks?.length) store.set(PEAKS_PREFIX + vp, packPeaks(pk));
    syncControls();
    renderAll();
    preview.setLook(look);
    preview.setLogo(logoForPreview());
    preview.setCues(doc.cues);
    showDrawer(false);
    persist();
    if (video.videoWidth) onVideoReady();
    else video.addEventListener('loadedmetadata', onVideoReady, { once: true });
  }

  function onVideoReady() {
    updateExportAvailability();
    // tiles are 16:9, or 4:5 for vertical video (see .sub-tile-stage)
    const { w, h } = frame();
    if (formatOf(w, h) === 'wide') tiles?.setFrame(1920, 1080); else tiles?.setFrame(1080, 1350);
    renderAll();
  }

  async function fetchPeaks(vp) {
    try {
      const p = await invoke('audio_peaks', { mediaPath: vp });
      if (vp !== videoPath || !p?.peaks?.length) return;
      peaks = p;
      timeline.setPeaks(p);
      store.set(PEAKS_PREFIX + vp, packPeaks(p));
    } catch { /* the timeline works without a waveform */ }
  }

  function clear() {
    open = false;
    cancelAnimationFrame(raf);
    raf = 0;
    list.innerHTML = '';
    preview.setCues([]);
    tiles?.stop();
    doc = new SubtitleDoc([]);
    videoPath = srtPath = null;
    closeMenus();
  }

  function changed(kind, label) {
    if (sel.i >= doc.cues.length) sel = { i: doc.cues.length - 1, k: -1 };
    if (kind === 'live') {
      preview.setCues(doc.cues);
      updateRows([sel.i - 1, sel.i, sel.i + 1]);
      return;
    }
    renderAll();
    preview.setCues(doc.cues);
    if (drawerTab() === 'names' && drawerOpen()) renderNames();
    persist();
    if (kind === 'undo' && label) toast(S.undone(label), 'info');
    if (kind === 'redo' && label) toast(S.redone(label), 'info');
  }

  function persist() {
    if (!videoPath) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      store.set(SESSION_PREFIX + videoPath, { v: 2, savedAt: Date.now(), cues: doc.cues, look, split, logo, endCard });
    }, 400);
  }

  // ── Cue list (one line per cue) ───────────────────────────────────────────

  const speakers = () => new Set(doc.cues.map(c => c.speaker)).size > 1;

  function rowHtml(c, i, showSpk, opts) {
    const dur = Math.max(0.01, c.end - c.start);
    const issues = cueIssues(c, opts);
    const presetName = c.style === PUNCH ? S.big_line : c.style ? (PRESET_BY_ID.get(c.style)?.name || c.style) : '';
    const last = c.words.length - 1;
    const words = c.words
      .map((w, k) => {
        const cls = ['w'];
        if (w.prob < LOW_CONFIDENCE) cls.push('lc');
        if (w.kw) cls.push('kw');
        if (sel.i === i && sel.k === k) cls.push('is-sel');
        const drag = (k === 0 && i > 0) || (k === last && i < doc.cues.length - 1) ? ' draggable="true"' : '';
        const title = w.prob < LOW_CONFIDENCE ? ` title="${Math.round(w.prob * 100)}%"` : '';
        return `<span class="${cls.join(' ')}" data-k="${k}"${drag}${title}>${escapeHtml(w.text)}</span>`;
      })
      .join(' ');
    const badges = issues.map(x => `<span class="sub-badge warn" title="${escapeHtml(S[`issue_${x}_t`])}">${escapeHtml(S[`issue_${x}`])}</span>`).join('');
    const cls = ['sub-row'];
    if (sel.i === i) cls.push('is-sel');
    if (target === i) cls.push('is-target');
    if (activeIdx === i) cls.push('is-active');
    return `<div class="${cls.join(' ')}" data-i="${i}">
      <span class="sub-row-n">${i + 1}</span>
      <button type="button" class="sub-row-t" data-seek title="${escapeHtml(S.seek_hint)}">${clockTenths(c.start)}</button>
      <div class="sub-row-text">${showSpk ? `<span class="sub-spk">${escapeHtml(c.speaker)}</span> ` : ''}${words}</div>
      <span class="sub-row-meta">${presetName ? `<span class="sub-badge" title="${escapeHtml(S.style_override)}">${escapeHtml(presetName)}</span>` : ''}${badges}<span class="sub-row-dur">${dur.toFixed(1)}s</span></span>
      <span class="sub-row-tools">
        <button type="button" data-row="big" class="${c.style === PUNCH ? 'is-on' : ''}" title="${escapeHtml(S.t_big)}" aria-label="${escapeHtml(S.t_big)}" aria-pressed="${c.style === PUNCH}">A</button>
        <button type="button" data-row="edit" title="${escapeHtml(S.t_edit)}" aria-label="${escapeHtml(S.t_edit)}">✎</button>
        <button type="button" data-row="wordPrev" title="${escapeHtml(S.t_wordPrev)}" aria-label="${escapeHtml(S.t_wordPrev)}"${i === 0 ? ' disabled' : ''}>⇤</button>
        <button type="button" data-row="wordNext" title="${escapeHtml(S.t_wordNext)}" aria-label="${escapeHtml(S.t_wordNext)}"${i === doc.cues.length - 1 ? ' disabled' : ''}>⇥</button>
        <button type="button" data-row="delete" title="${escapeHtml(S.t_delete)}" aria-label="${escapeHtml(S.t_delete)}">✕</button>
      </span>
    </div>`;
  }

  function renderAll() {
    renderList();
    timeline.render();
    updateTarget(true);
    updateMeta();
    updateAvailability();
    renderPresets();
  }

  function renderList() {
    const showSpk = speakers();
    const opts = lookOpts();
    list.innerHTML = doc.cues.map((c, i) => rowHtml(c, i, showSpk, opts)).join('');
    activeWord = -1;
    highlightPlayback(true);
  }

  function updateRows(indices) {
    const showSpk = speakers();
    const opts = lookOpts();
    for (const i of indices) {
      const el = rowEl(i);
      if (el && doc.cues[i]) el.outerHTML = rowHtml(doc.cues[i], i, showSpk, opts);
    }
  }

  function updateMeta() {
    const unsure = doc.cues.reduce((n, c) => n + c.words.filter(w => w.prob < LOW_CONFIDENCE).length, 0);
    const opts = lookOpts();
    const problems = doc.cues.filter(c => cueIssues(c, opts).length).length;
    $('#sub-file-meta').textContent = S.cue_count(doc.cues.length);
    capFixes = findCaseFixes(doc.cues, nameList(myNames));
    const capsBtn = $('#sub-caps-btn');
    capsBtn.hidden = !capFixes.length;
    capsBtn.textContent = capFixes.length ? S.caps_badge(capFixes.length) : '';
    const u = $('#sub-next-unsure');
    u.textContent = S.unsure_btn(unsure);
    u.disabled = !unsure;
    const p = $('#sub-next-issue');
    p.textContent = S.issue_btn(problems);
    p.disabled = !problems;
  }

  const rowEl = i => list.querySelector(`.sub-row[data-i="${i}"]`);

  function select(i, k = -1, { seek = false, scroll = true } = {}) {
    if (i < 0 || i >= doc.cues.length) return;
    rowEl(sel.i)?.classList.remove('is-sel');
    list.querySelector('.w.is-sel')?.classList.remove('is-sel');
    sel = { i, k };
    const row = rowEl(i);
    row?.classList.add('is-sel');
    if (k >= 0) row?.querySelector(`.w[data-k="${k}"]`)?.classList.add('is-sel');
    if (scroll && row) {
      // centre rows that are off-screen (jumps from U / E), leave visible ones alone
      const lr = list.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      if (rr.top < lr.top || rr.bottom > lr.bottom) row.scrollIntoView({ block: 'center' });
    }
    if (seek) {
      const c = doc.cues[i];
      // Land a moment into the word so pop/bounce effects show the settled word
      // instead of their first (tiny) frame.
      const w = k >= 0 ? c.words[k] : null;
      video.currentTime = w ? w.start + Math.min(0.18, Math.max(0, (w.end - w.start) / 2)) : c.start;
    }
    timeline.reveal(i);
    updateTarget(true);
    renderPresets();
  }

  list.addEventListener('click', e => {
    if (editing >= 0) return;
    const row = e.target.closest('.sub-row');
    if (!row) return;
    const i = Number(row.dataset.i);
    const tool = e.target.closest('[data-row]');
    if (tool) {
      e.stopPropagation();
      select(i, -1, { scroll: false });
      return rowAction(tool.dataset.row, i);
    }
    if (e.target.closest('[data-seek]')) {
      select(i, -1, { seek: true, scroll: false });
      return;
    }
    const w = e.target.closest('.w');
    select(i, w ? Number(w.dataset.k) : -1, { seek: true, scroll: false });
  });

  list.addEventListener('dblclick', e => {
    const row = e.target.closest('.sub-row');
    const w = e.target.closest('.w');
    if (row && e.target.closest('.sub-row-text')) startEdit(Number(row.dataset.i), w ? Number(w.dataset.k) : -1);
  });

  function rowAction(name, i) {
    if (name === 'edit') return startEdit(i);
    if (name === 'delete') return runAt('delete', i);
    if (name === 'big') return toggleBig(i);
    if (name === 'wordPrev' || name === 'wordNext') return runAt(name, i);
  }

  // Drag the first/last word of a cue onto the neighbouring cue.
  let wordDrag = null;
  list.addEventListener('dragstart', e => {
    const w = e.target.closest('.w');
    const row = e.target.closest('.sub-row');
    if (!w || !row) return;
    const i = Number(row.dataset.i);
    const k = Number(w.dataset.k);
    const dest = k === 0 ? i - 1 : i + 1;
    wordDrag = { i, k, dest };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', w.textContent);
    rowEl(dest)?.classList.add('is-drop');
  });
  list.addEventListener('dragover', e => {
    const row = e.target.closest('.sub-row');
    if (wordDrag && row && Number(row.dataset.i) === wordDrag.dest) e.preventDefault();
  });
  list.addEventListener('drop', e => {
    e.preventDefault();
    if (!wordDrag) return;
    const { i, k } = wordDrag;
    wordDrag = null;
    runAt(k === 0 ? 'wordPrev' : 'wordNext', i);
  });
  list.addEventListener('dragend', () => {
    wordDrag = null;
    list.querySelectorAll('.is-drop').forEach(el => el.classList.remove('is-drop'));
  });

  // ── Inline text editing ────────────────────────────────────────────────────

  function startEdit(i, k = -1) {
    const row = rowEl(i);
    if (!row) return;
    select(i, k, { scroll: false });
    editing = i;
    video.pause();
    const box = row.querySelector('.sub-row-text');
    row.classList.add('is-editing');
    box.textContent = cueText(doc.cues[i]);
    box.contentEditable = 'plaintext-only';
    box.title = S.edit_hint;
    box.focus();
    const range = document.createRange();
    range.selectNodeContents(box);
    // With a word selected, select just that word so typing replaces it.
    const words = doc.cues[i].words;
    if (k >= 0 && k < words.length && box.firstChild) {
      const from = words.slice(0, k).reduce((n, w) => n + w.text.length + 1, 0);
      if (box.textContent.substr(from, words[k].text.length) === words[k].text) {
        range.setStart(box.firstChild, from);
        range.setEnd(box.firstChild, from + words[k].text.length);
      }
    }
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);

    const finish = commit => {
      box.removeEventListener('keydown', onKey);
      box.removeEventListener('blur', onBlur);
      const text = box.textContent;
      editing = -1;
      box.contentEditable = 'false';
      if (!(commit && doc.apply(c => setCueText(c, i, text, { keepArticles: split.keepArticles }), S.l_edit))) renderAll();
      list.focus({ preventScroll: true });
    };
    const onKey = e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    box.addEventListener('keydown', onKey);
    box.addEventListener('blur', onBlur);
  }

  // ── Playback highlighting and the target cue ──────────────────────────────

  /** The cue an action applies to: the one under the playhead, else the selected one. */
  function computeTarget() {
    const i = cueIndexAt(doc.cues, video.currentTime);
    return i >= 0 ? i : sel.i;
  }

  // Button availability depends on the playhead too (split needs it on a
  // word), so refresh it as time moves — throttled, it's cheap but not free.
  let availAt = 0;
  function updateTarget(force = false) {
    const t = computeTarget();
    const now = performance.now();
    if (t !== target || force) {
      rowEl(target)?.classList.remove('is-target');
      target = t;
      rowEl(target)?.classList.add('is-target');
      timeline.mark();
    } else if (now - availAt < 150) return;
    availAt = now;
    updateAvailability();
  }

  function highlightPlayback(force = false) {
    if (!open) return;
    const t = video.currentTime;
    const i = cueIndexAt(doc.cues, t);
    if (i !== activeIdx || force) {
      rowEl(activeIdx)?.classList.remove('is-active');
      activeIdx = i;
      const row = rowEl(i);
      row?.classList.add('is-active');
      if (row && !video.paused) row.scrollIntoView({ block: 'nearest' });
      activeWord = -1;
    }
    const k = i >= 0 ? wordIndexAt(doc.cues[i], t) : -1;
    if (k !== activeWord) {
      list.querySelector('.w.is-cur')?.classList.remove('is-cur');
      if (i >= 0 && k >= 0) rowEl(i)?.querySelector(`.w[data-k="${k}"]`)?.classList.add('is-cur');
      activeWord = k;
    }
  }
  const tick = () => {
    highlightPlayback();
    updateTarget();
    syncTransport();
    raf = video.paused ? 0 : requestAnimationFrame(tick);
  };
  video.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(tick); });
  for (const ev of ['seeked', 'pause', 'timeupdate']) video.addEventListener(ev, () => { highlightPlayback(); updateTarget(); });

  // ── Transport (in the timeline header) ────────────────────────────────────

  const playBtn = $('#sub-play');
  const timeEl = $('#sub-time');
  function syncTransport() {
    timeEl.textContent = `${clockTenths(video.currentTime || 0)} / ${clock(video.duration || 0)}`;
    playBtn.textContent = video.paused ? '▶' : '❚❚';
    playBtn.setAttribute('aria-label', video.paused ? S.play : S.pause);
  }
  for (const ev of ['timeupdate', 'play', 'pause', 'seeked', 'loadedmetadata', 'durationchange']) video.addEventListener(ev, syncTransport);
  playBtn.addEventListener('click', () => actions.playPause());
  video.addEventListener('click', () => actions.playPause());
  $('#sub-tl-zoom-in').addEventListener('click', () => timeline.zoomBy(1.5));
  $('#sub-tl-zoom-out').addEventListener('click', () => timeline.zoomBy(1 / 1.5));
  $('#sub-tl-fit').addEventListener('click', () => timeline.zoomFit());
  $('#sub-tl-toggle').addEventListener('click', () => actions.timeline());

  // ── Actions, availability and reasons ─────────────────────────────────────

  // Run an op on a throw-away copy of the cues around i to see if it would work.
  function wouldWork(fn, i) {
    if (i < 0 || !doc.cues[i]) return false;
    const lo = Math.max(0, i - 1);
    const win = clone(doc.cues.slice(lo, i + 2));
    return !!fn(win, i - lo);
  }

  const OPS = {
    split: (c, i, t) => splitAt(c, i, t),
    join: (c, i) => joinNext(c, i),
    trimIn: (c, i, t) => trimIn(c, i, t),
    trimOut: (c, i, t) => trimOut(c, i, t),
    rollIn: (c, i, t) => rollIn(c, i, t),
    rollOut: (c, i, t) => rollOut(c, i, t),
    wordPrev: (c, i) => moveFirstWordToPrev(c, i),
    wordNext: (c, i) => moveLastWordToNext(c, i),
    delete: (c, i) => deleteCue(c, i),
  };
  const LABEL = {
    split: () => S.l_split, join: () => S.l_join, trimIn: () => S.l_trimIn, trimOut: () => S.l_trimOut,
    rollIn: () => S.l_roll, rollOut: () => S.l_roll, wordPrev: () => S.l_word, wordNext: () => S.l_word,
    delete: () => S.l_delete,
  };
  // trim acts on the selected cue (so you can park the playhead outside it)
  const targetFor = name => ((name === 'trimIn' || name === 'trimOut') && sel.i >= 0 ? sel.i : target);

  /** Why an action can't run right now, or null. */
  function reason(name) {
    const i = targetFor(name);
    const c = doc.cues[i];
    const t = video.currentTime;
    if (name === 'undo') return doc.canUndo ? null : S.undo_empty;
    if (name === 'redo') return doc.canRedo ? null : S.redo_empty;
    if (name === 'keyword') {
      if (sel.i >= 0 && sel.k >= 0) return null;
      const ci = cueIndexAt(doc.cues, t);
      return ci >= 0 && wordIndexAt(doc.cues[ci], t) >= 0 ? null : S.no_word;
    }
    if (!OPS[name]) return null;
    if (!c) return S.no_cue;
    if (name === 'split' && c.words.length < 2) return S.r_one_word;
    if ((name === 'join' || name === 'rollOut' || name === 'wordNext') && !doc.cues[i + 1]) return S.r_no_next;
    if ((name === 'rollIn' || name === 'wordPrev') && !doc.cues[i - 1]) return S.r_no_prev;
    if (!wouldWork((w, j) => OPS[name](w, j, t), i)) {
      if (name === 'split') return S.r_split_pos;
      if (name === 'trimIn' || name === 'trimOut' || name === 'rollIn' || name === 'rollOut') return S.r_playhead;
      return S.cant;
    }
    return null;
  }

  function updateAvailability() {
    for (const b of $$('[data-act]')) {
      const name = b.dataset.act;
      if (!(name in OPS) && !['undo', 'redo', 'keyword'].includes(name)) continue;
      const why = reason(name);
      b.disabled = !!why;
      const base = b.dataset.title || (b.dataset.title = b.title);
      b.title = why ? `${base} — ${why}` : base;
    }
  }

  function runAt(name, i) {
    const t = video.currentTime;
    const ok = doc.apply(c => OPS[name](c, i, t), LABEL[name]());
    if (!ok) { toast(reason(name) || S.cant, 'warn'); return false; }
    if (name === 'split') select(i + 1, -1, { scroll: true });
    else if (name === 'join' || name === 'wordPrev' || name === 'wordNext' || name === 'delete') select(Math.min(i, doc.cues.length - 1), -1);
    return true;
  }

  function run(name) {
    const why = reason(name);
    if (why) return toast(why, 'warn');
    return runAt(name, targetFor(name));
  }

  const actions = {
    split: () => run('split'),
    join: () => run('join'),
    trimIn: () => run('trimIn'),
    trimOut: () => run('trimOut'),
    rollIn: () => run('rollIn'),
    rollOut: () => run('rollOut'),
    wordPrev: () => run('wordPrev'),
    wordNext: () => run('wordNext'),
    delete() {
      if (sel.i < 0) return toast(S.no_cue, 'warn');
      runAt('delete', sel.i);
    },
    keyword() {
      let { i, k } = sel;
      if (i < 0 || k < 0) {
        i = cueIndexAt(doc.cues, video.currentTime);
        k = i >= 0 ? wordIndexAt(doc.cues[i], video.currentTime) : -1;
      }
      if (i < 0 || k < 0) return toast(S.no_word, 'warn');
      if (doc.apply(c => toggleKeyword(c, i, k), S.l_keyword)) select(i, k, { scroll: false });
    },
    // Big line: this caption becomes a large, slanted, upper-case phrase in the middle of the frame.
    bigLine() {
      const i = sel.i >= 0 ? sel.i : cueIndexAt(doc.cues, video.currentTime);
      if (i < 0) return toast(S.no_cue, 'warn');
      toggleBig(i);
    },
    // Retime the selected word's highlight; a short run-up plays so you can hear it.
    wordEarlier() { nudgeWord(-0.05); },
    wordLater() { nudgeWord(0.05); },
    wordEarlierFine() { nudgeWord(-0.01); },
    wordLaterFine() { nudgeWord(0.01); },
    undo() { if (doc.undo() == null) toast(S.undo_empty, 'info'); },
    redo() { if (doc.redo() == null) toast(S.redo_empty, 'info'); },
    edit() { if (sel.i >= 0) startEdit(sel.i, sel.k); },
    nextUnsure() {
      const hit = nextUnsure(doc.cues, sel.i, sel.k);
      if (!hit) return toast(S.no_unsure, 'info');
      video.pause();
      select(hit[0], hit[1], { seek: true });
    },
    nextIssue() {
      const j = nextIssueCue(doc.cues, sel.i, lookOpts());
      if (j < 0) return toast(S.no_issues, 'info');
      video.pause();
      select(j, -1, { seek: true });
    },
    prevCue() { const i = Math.max(0, (sel.i >= 0 ? sel.i : target) - 1); select(i, -1, { seek: true }); },
    nextCue() { const i = Math.min(doc.cues.length - 1, (sel.i >= 0 ? sel.i : target) + 1); select(i, -1, { seek: true }); },
    playPause() { if (video.paused) video.play().catch(() => {}); else video.pause(); },
    back() { video.currentTime = Math.max(0, video.currentTime - 1); },
    fwd() { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 1); },
    drawer() { showDrawer(!drawerOpen()); },
    help() { showHelp(!helpOpen()); },
    timeline() { const c = timeline.toggleCollapsed(); $('#sub-tl-toggle').setAttribute('aria-pressed', String(!c)); },
    guides() { preview.setGuides(!preview.guides); toast(preview.guides ? S.guides_on : S.guides_off, 'info'); },
    zoomIn() { timeline.zoomBy(1.5); },
    zoomOut() { timeline.zoomBy(1 / 1.5); },
    exportMenu() { toggleExportMenu(); },
  };

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && root.contains(b) && !b.disabled) actions[b.dataset.act]?.();
  });
  $('#sub-next-unsure').addEventListener('click', () => actions.nextUnsure());
  $('#sub-next-issue').addEventListener('click', () => actions.nextIssue());

  function toggleBig(i) {
    const on = doc.cues[i]?.style === PUNCH;
    doc.apply(c => setCueStyle(c, i, on ? null : PUNCH), S.l_big);
    if (!on) {
      select(i, -1, { scroll: false });
      const c = doc.cues[i];
      if (video.paused) video.currentTime = c.start + Math.min(0.5, (c.end - c.start) / 2);   // past the entry fade, so the result is visible
    }
  }

  function nudgeWord(dt) {
    const { i, k } = sel;
    if (i < 0 || k < 0) return toast(S.no_word, 'warn');
    if (k < 1) return toast(S.word_first, 'info');
    const w = doc.cues[i]?.words[k];
    if (!w) return;
    const target = w.start + dt;
    if (!doc.apply(c => setWordStart(c, i, k, target), S.l_wordtime)) return toast(S.word_limit, 'info');
    select(i, k, { scroll: false });
    video.currentTime = Math.max(0, doc.cues[i].words[k].start - 0.25);
    video.play().catch(() => {});
    clearTimeout(nudgeStop);
    nudgeStop = setTimeout(() => video.pause(), 650);
  }
  let nudgeStop = 0;

  const KEYS = {
    b: 'split', p: 'bigLine', j: 'join', i: 'trimIn', o: 'trimOut', q: 'rollIn', w: 'rollOut',
    '[': 'wordEarlier', ']': 'wordLater', '{': 'wordEarlierFine', '}': 'wordLaterFine',
    1: 'wordPrev', 2: 'wordNext', k: 'keyword', u: 'nextUnsure', e: 'nextIssue',
    s: 'drawer', '?': 'help', t: 'timeline', g: 'guides', '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut',
    Backspace: 'delete', Delete: 'delete', Enter: 'edit', ' ': 'playPause',
    ArrowUp: 'prevCue', ArrowDown: 'nextCue', ArrowLeft: 'back', ArrowRight: 'fwd',
  };

  // Capture phase so these win over the app's global 1–4 view shortcuts.
  document.addEventListener('keydown', e => {
    if (!open || !root.offsetParent || editing >= 0) return;
    const t = e.target;
    const inField = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.key === 'Escape') {
      if (timeline.cancelDrag() || closeMenus()) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if (mod && key === 'z' && !inField) {
      e.preventDefault(); e.stopImmediatePropagation();
      return e.shiftKey ? actions.redo() : actions.undo();
    }
    if (mod && key === 'y' && !inField) { e.preventDefault(); e.stopImmediatePropagation(); return actions.redo(); }
    if (mod && key === 's') { e.preventDefault(); e.stopImmediatePropagation(); return saveSrt(); }
    if (mod || e.altKey || inField) return;
    const name = KEYS[e.key] || KEYS[key];
    if (!name) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    actions[name]();
  }, true);

  // ── Overlays: drawer, help, export menu ───────────────────────────────────

  const drawer = $('#sub-drawer');
  const drawerOpen = () => !drawer.hidden;
  const drawerTab = () => $('.sub-dtab[aria-selected="true"]')?.dataset.dtab || 'style';
  let tiles = null;

  function showDrawer(on, tab) {
    drawer.hidden = !on;
    $('#sub-drawer-btn').setAttribute('aria-pressed', String(on));
    root.classList.toggle('drawer-open', on);
    if (on) {
      showTab(tab || drawerTab());
      tiles?.start();
      showSomeCaption();
    } else {
      tiles?.stop();
      preview.setTempLook(null);
    }
  }
  // Styling with no caption on screen shows nothing, so when paused between
  // captions, move to the selected caption (or the next one).
  function showSomeCaption() {
    if (!video.paused || !doc.cues.length || cueIndexAt(doc.cues, video.currentTime) >= 0) return;
    let i = sel.i;
    if (i < 0) {
      i = doc.cues.findIndex(c => c.start >= video.currentTime);
      if (i < 0) i = doc.cues.length - 1;
    }
    const c = doc.cues[i];
    video.currentTime = c.start + Math.min(0.6, (c.end - c.start) / 2);
  }
  function showTab(name) {
    $$('.sub-dtab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.dtab === name)));
    $$('.sub-dpanel').forEach(p => { p.hidden = p.dataset.dpanel !== name; });
    if (name === 'names') renderNames();
    if (name === 'style') tiles?.start(); else tiles?.stop();
  }
  $$('.sub-dtab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.dtab)));
  $('#sub-drawer-close').addEventListener('click', () => showDrawer(false));

  const help = $('#sub-help');
  const helpOpen = () => !help.hidden;
  function showHelp(on) {
    help.hidden = !on;
    if (on) help.querySelector('button')?.focus();
  }
  help.addEventListener('click', e => { if (e.target === help || e.target.closest('[data-close]')) showHelp(false); });

  const menu = $('#sub-export-menu');
  function toggleExportMenu(force) {
    const on = force ?? menu.hidden;
    menu.hidden = !on;
    $('#sub-export-btn').setAttribute('aria-expanded', String(on));
    if (on) menu.querySelector('button:not(:disabled)')?.focus();
  }
  $('#sub-export-btn').addEventListener('click', e => { e.stopPropagation(); toggleExportMenu(); });
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.sub-export-wrap')) toggleExportMenu(false); });
  menu.addEventListener('keydown', e => {
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
  });

  /** Close whichever overlay is open (Esc). Returns true if one was closed. */
  function closeMenus() {
    if (!menu.hidden) { toggleExportMenu(false); $('#sub-export-btn').focus(); return true; }
    if (helpOpen()) { showHelp(false); return true; }
    if (drawerOpen()) { showDrawer(false); return true; }
    return false;
  }

  // ── Style: presets, tiles, saved looks ─────────────────────────────────────

  const tileLooks = () => {
    const out = {};
    for (const p of PRESETS) out[`p:${p.id}`] = lookFromPreset(p.id);
    for (const s of savedLooks) out[`s:${s.id}`] = normalizeLook(s.look);
    return out;
  };
  tiles = createTiles({ container: $('#sub-presets'), getLooks: tileLooks, frame: { w: 1920, h: 1080 } });

  function renderPresets() {
    const sampleCue = doc.cues[sel.i >= 0 ? sel.i : target];
    tiles?.setSample(sampleCue ? sampleCue.words.map(w => w.text) : []);
    const cueStyle = sel.i >= 0 ? doc.cues[sel.i]?.style : null;
    const isOn = id => (scope === 'all' ? look.preset === id : (cueStyle || '') === id);
    const tile = (key, name, hint, on, extra = '') => `
      <button type="button" class="sub-tile${on ? ' is-on' : ''}" data-tile="${key}" title="${escapeHtml(hint)}">
        <span class="sub-tile-stage"></span><span class="sub-tile-name">${escapeHtml(name)}</span>${extra}
      </button>`;
    let html = PRESETS.map(p => tile(`p:${p.id}`, p.name, p.hint, isOn(p.id))).join('');
    if (scope === 'all' && savedLooks.length) {
      html += `<p class="sub-tiles-sub">${escapeHtml(S.yours)}</p>`;
      html += savedLooks.map(s => tile(`s:${s.id}`, s.name, s.name, look.preset === `saved:${s.id}`,
        `<span class="sub-tile-del" data-del="${escapeHtml(s.id)}" role="button" aria-label="${escapeHtml(S.delete_look)}" title="${escapeHtml(S.delete_look)}">✕</span>`)).join('');
    }
    if (scope === 'cue' && cueStyle) {
      html += `<button type="button" class="sub-tile-reset" data-tile="reset">${escapeHtml(S.reset_cue_style)}</button>`;
    }
    const box = $('#sub-presets');
    box.innerHTML = html;
    box.classList.toggle('is-cue-scope', scope === 'cue');
    tiles?.refresh();
  }

  $('#sub-presets').addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      savedLooks = savedLooks.filter(s => s.id !== del.dataset.del);
      store.set(LOOKS_KEY, savedLooks);
      return renderPresets();
    }
    const b = e.target.closest('[data-tile]');
    if (!b) return;
    const key = b.dataset.tile;
    preview.setTempLook(null);
    if (key === 'reset') {
      const i = sel.i;
      return doc.apply(c => setCueStyle(c, i, null), S.l_style);
    }
    const [kind, id] = key.split(':');
    if (scope === 'cue') {
      if (kind !== 'p') return;
      if (sel.i < 0) return toast(S.no_cue, 'warn');
      const i = sel.i;
      doc.apply(c => setCueStyle(c, i, id === look.preset ? null : id), S.l_style);
      return;
    }
    if (kind === 'p') { setLook(lookFromPreset(id), true); offerResplit(PRESET_BY_ID.get(id)); }
    else {
      const s = savedLooks.find(x => x.id === id);
      if (s) setLook({ ...normalizeLook(s.look), preset: `saved:${s.id}` }, true);
    }
  });
  $('#sub-presets').addEventListener('mouseover', e => {
    const b = e.target.closest('[data-tile]');
    if (!b || scope !== 'all' || b.dataset.tile === 'reset') return;
    const l = tileLooks()[b.dataset.tile];
    if (l) preview.setTempLook(l);
  });
  $('#sub-presets').addEventListener('mouseleave', () => preview.setTempLook(null));

  $$('.sub-scope-btn').forEach(b => b.addEventListener('click', () => {
    scope = b.dataset.scope;
    $$('.sub-scope-btn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderPresets();
  }));

  $('#sub-save-look').addEventListener('click', () => {
    const row = $('#sub-save-look-row');
    row.hidden = false;
    $('#sub-save-look-name').value = '';
    $('#sub-save-look-name').focus();
  });
  $('#sub-save-look-cancel').addEventListener('click', () => { $('#sub-save-look-row').hidden = true; });
  $('#sub-save-look-ok').addEventListener('click', saveCurrentLook);
  $('#sub-save-look-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveCurrentLook(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); $('#sub-save-look-row').hidden = true; }
  });
  function saveCurrentLook() {
    const name = $('#sub-save-look-name').value.trim();
    if (!name) return;
    const id = `${Date.now().toString(36)}`;
    const { preset, ...rest } = look;
    savedLooks = [...savedLooks.filter(s => s.name !== name), { id, name, look: rest }];
    store.set(LOOKS_KEY, savedLooks);
    look = { ...look, preset: `saved:${id}` };
    $('#sub-save-look-row').hidden = true;
    renderPresets();
    toast(S.look_saved(name), 'ok');
  }

  $('#sub-export-look').addEventListener('click', async () => {
    const name = savedLooks.find(s => `saved:${s.id}` === look.preset)?.name || PRESET_BY_ID.get(look.preset)?.name || 'Style';
    let p = await saveDialog({ defaultPath: `${name}.bstyle`, filters: [{ name: 'Banditur style', extensions: ['bstyle'] }] });
    if (!p) return;
    if (!p.toLowerCase().endsWith('.bstyle')) p += '.bstyle';
    const { preset, ...rest } = look;
    const body = JSON.stringify({ format: 'banditur-subtitle-style', formatVersion: 1, name, look: rest }, null, 2);
    await saveText(p, body);
  });

  $('#sub-import-look').addEventListener('click', async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: 'Banditur style', extensions: ['bstyle'] }] });
    if (!p) return;
    try {
      const data = JSON.parse(await invoke('load_style_file', { path: p }));
      if (data?.format !== 'banditur-subtitle-style' || typeof data.look !== 'object') throw new Error(S.bad_style);
      const name = String(data.name || baseName(p).replace(/\.bstyle$/i, '')).slice(0, 60);
      const id = `${Date.now().toString(36)}`;
      const clean = normalizeLook(data.look);
      delete clean.preset;
      savedLooks = [...savedLooks.filter(s => s.name !== name), { id, name, look: clean }];
      store.set(LOOKS_KEY, savedLooks);
      setLook({ ...clean, preset: `saved:${id}` }, true);
      toast(S.look_imported(name), 'ok');
    } catch (err) {
      toast(S.save_err(String(err?.message || err)), 'error');
    }
  });

  // ── Style controls ─────────────────────────────────────────────────────────

  const fontSel = $('#sub-font');
  fontSel.innerHTML = FONTS.map(f => `<option value="${escapeHtml(f.family)}">${escapeHtml(f.family.replace(/^Montserrat /, ''))}</option>`).join('');
  const fillSelect = (el, items) => { el.innerHTML = items.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join(''); };
  fillSelect($('#sub-entry'), ENTRIES);
  fillSelect($('#sub-word'), WORD_EFFECTS);
  fillSelect($('#sub-emphasis'), EMPHASES);

  function fmtVal(key, v) {
    if (key === 'sizePct' || key === 'marginPct' || key === 'outlinePct') return `${v}%`;
    if (key === 'boxOpacity') return `${Math.round(v * 100)}%`;
    if (key === 'logoWidth' || key === 'logoOpacity') return `${Math.round(v)}%`;
    return String(v);
  }

  function syncControls() {
    $$('[data-look]').forEach(el => {
      const key = el.dataset.look;
      if (el.type === 'checkbox') el.checked = !!look[key];
      else el.value = look[key];
    });
    $$('[data-val]').forEach(el => { el.textContent = fmtVal(el.dataset.val, look[el.dataset.val]); });
    $$('[data-boxonly]').forEach(el => { el.hidden = !look.box; });
    $$('[data-pillonly]').forEach(el => { el.hidden = look.word !== 'pill'; });
    $$('[data-outlineonly]').forEach(el => { el.hidden = look.box; });
    $('#sub-end-text').value = endCard.text;
    $('#sub-end-sec').value = endCard.seconds;
    $('[data-val="endSec"]').textContent = `${endCard.seconds}s`;
    $$('[data-endonly]').forEach(el => { el.hidden = !endCard.text.trim(); });
    $('#sub-maxwords').value = split.maxWords;
    $('#sub-maxpause').value = split.maxPause;
    $('#sub-keep-articles').checked = !!split.keepArticles;
    $('#sub-maxwords-val').textContent = split.maxWords;
    $('#sub-maxpause-val').textContent = `${Number(split.maxPause).toFixed(1)}s`;
    // logo
    $('#sub-logo-name').textContent = logo?.path ? baseName(logo.path) : S.no_logo;
    $$('[data-logoonly]').forEach(el => { el.hidden = !logo?.path; });
    if (logo) {
      $('#sub-logo-corner').value = logo.corner || 'tr';
      $('#sub-logo-width').value = logo.widthPct ?? 12;
      $('#sub-logo-opacity').value = Math.round((logo.opacity ?? 1) * 100);
      $('[data-val="logoWidth"]').textContent = fmtVal('logoWidth', logo.widthPct ?? 12);
      $('[data-val="logoOpacity"]').textContent = fmtVal('logoOpacity', Math.round((logo.opacity ?? 1) * 100));
    }
  }

  function setLook(patch, replace = false) {
    const keepPreset = !replace && !('preset' in patch);
    look = normalizeLook(replace ? patch : { ...look, ...patch, preset: keepPreset ? 'custom' : patch.preset });
    store.set(LOOK_KEY, look);
    syncControls();
    renderPresets();
    preview.setLook(look);
    renderList();
    timeline.render();
    updateMeta();
    persist();
  }

  $$('[data-look]').forEach(el => el.addEventListener('input', () => {
    const key = el.dataset.look;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'range') v = Number(v);
    setLook({ [key]: v });
  }));

  $('#sub-suggest-kw').addEventListener('click', () => {
    const pairs = suggestKeywords(doc.cues);
    if (doc.apply(c => markKeywords(c, pairs), S.l_keywords)) toast(S.keywords_marked(pairs.length), 'ok');
    else toast(S.keywords_none, 'info');
  });

  // Logo
  const logoForPreview = () => (logo?.path ? { ...logo, src: fileSrc ? fileSrc(logo.path) : logo.path } : null);
  function setLogo(next) {
    logo = next;
    store.set(LOGO_KEY, logo);
    syncControls();
    preview.setLogo(logoForPreview());
    persist();
  }
  $('#sub-logo-pick').addEventListener('click', async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (p) setLogo({ corner: 'tr', widthPct: 12, opacity: 0.9, marginPct: 4, ...(logo || {}), path: p });
  });
  $('#sub-logo-remove').addEventListener('click', () => setLogo(null));
  $('#sub-logo-corner').addEventListener('input', e => setLogo({ ...logo, corner: e.target.value }));
  $('#sub-logo-width').addEventListener('input', e => setLogo({ ...logo, widthPct: Number(e.target.value) }));
  $('#sub-logo-opacity').addEventListener('input', e => setLogo({ ...logo, opacity: Number(e.target.value) / 100 }));

  // End card: closing text on a plain frame after the video
  function setEndCard(next) {
    endCard = { ...endCard, ...next };
    store.set(ENDCARD_KEY, endCard);
    syncControls();
    persist();
  }
  $('#sub-end-text').addEventListener('input', e => {
    endCard = { ...endCard, text: e.target.value };
    store.set(ENDCARD_KEY, endCard);
    $$('[data-endonly]').forEach(el => { el.hidden = !endCard.text.trim(); });
    persist();
  });
  $('#sub-end-sec').addEventListener('input', e => setEndCard({ seconds: Number(e.target.value) }));

  // A preset designed for shorter cues (Ħoss: 3 words) offers to re-split.
  let pendingWords = 0;
  function offerResplit(preset) {
    const bar = $('#sub-resplit-hint');
    const opts = lookOpts();
    const tooLong = doc.cues.filter(c => cueIssues(c, opts).includes('lines')).length;
    const wants = preset?.words || 0;
    const longer = wants && doc.cues.some(c => c.words.length > wants);
    if (!longer && !tooLong) { bar.hidden = true; return; }
    pendingWords = wants || split.maxWords;
    $('#sub-resplit-hint-text').textContent = S.resplit_offer(preset?.name || '', pendingWords, tooLong);
    bar.hidden = false;
  }
  $('#sub-resplit-hint-no').addEventListener('click', () => { $('#sub-resplit-hint').hidden = true; });
  $('#sub-resplit-hint-yes').addEventListener('click', () => {
    $('#sub-resplit-hint').hidden = true;
    split.maxWords = pendingWords;
    saveSplit();
    syncControls();
    resplit();
  });

  // ── Re-split ───────────────────────────────────────────────────────────────

  const saveSplit = () => store.set(SPLIT_KEY, split);
  $('#sub-maxwords').addEventListener('input', e => {
    split.maxWords = Number(e.target.value);
    $('#sub-maxwords-val').textContent = split.maxWords;
    saveSplit();
  });
  // let go of the slider → split straight away (no extra button press)
  $('#sub-maxwords').addEventListener('change', () => resplit());
  $('#sub-maxpause').addEventListener('input', e => {
    split.maxPause = Number(e.target.value);
    $('#sub-maxpause-val').textContent = `${split.maxPause.toFixed(1)}s`;
    saveSplit();
  });
  $('#sub-keep-articles').addEventListener('change', e => {
    split.keepArticles = e.target.checked;
    saveSplit();
    if (split.keepArticles && doc.apply(c => mergeArticlesInCues(c), S.l_articles)) toast(S.articles_merged, 'ok');
  });
  $('#sub-resplit-btn').addEventListener('click', () => resplit());
  function resplit() {
    const { w, h } = frame();
    // the slider is explicit: no character cap, the word count decides
    const next = buildCues(flattenWords(doc.cues), { maxWords: split.maxWords, maxPause: split.maxPause, maxChars: 999 });
    if (split.keepArticles) mergeArticlesInCues(next);
    if (doc.replace(next, S.l_resplit)) {
      select(0, -1);
      toast(S.resplit_done, 'ok');
    }
  }

  // ── Names & articles ───────────────────────────────────────────────────────

  let nameGroups = [];
  let articleIssues = [];

  function renderCaps() {
    capFixes = findCaseFixes(doc.cues, nameList(myNames));
    const box = $('#sub-caps');
    const on = capFixes.filter(g => !capOff.has(g.to)).length;
    box.innerHTML = capFixes.length
      ? capFixes.map((g, gi) => `
        <label class="sub-cap" data-c="${gi}">
          <input type="checkbox" ${capOff.has(g.to) ? '' : 'checked'} />
          <span class="sub-cap-from">${escapeHtml(g.from)}</span>
          <span class="sub-cap-to">${escapeHtml(g.to)}</span>
          <span class="sub-cap-n">×${g.count}</span>
        </label>`).join('') + `
        <div class="sub-caps-actions"><button type="button" class="btn-primary sub-mini" id="sub-caps-apply" ${on ? '' : 'disabled'}>${escapeHtml(S.caps_apply(on))}</button></div>`
      : `<p class="sub-empty">${escapeHtml(S.caps_none)}</p>`;
    $('#sub-mynames').innerHTML = myNames.map((n, ni) => `
      <span class="sub-chip sub-myname">${escapeHtml(n)}<button type="button" data-rm="${ni}" aria-label="${escapeHtml(S.myname_remove(n))}" title="${escapeHtml(S.myname_remove(n))}">×</button></span>`).join('');
  }

  $('#sub-caps').addEventListener('change', e => {
    const row = e.target.closest('.sub-cap');
    const g = row && capFixes[Number(row.dataset.c)];
    if (!g) return;
    if (e.target.checked) capOff.delete(g.to); else capOff.add(g.to);
    renderCaps();
  });
  $('#sub-caps').addEventListener('click', e => {
    if (!e.target.closest('#sub-caps-apply')) return;
    const pick = capFixes.filter(g => !capOff.has(g.to));
    let n = 0;
    if (doc.apply(c => (n = applyCaseFixes(c, pick)) > 0, S.l_caps)) toast(S.caps_done(n), 'ok');
  });
  function addMyName() {
    const input = $('#sub-myname');
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (!myNames.some(n => n.toLocaleLowerCase('mt') === name.toLocaleLowerCase('mt'))) {
      myNames = [name, ...myNames].slice(0, 200);
      store.set(NAMES_KEY, myNames);
    }
    input.value = '';
    capOff.delete(name);
    renderCaps();
    updateMeta();
  }
  $('#sub-myname-add').addEventListener('click', addMyName);
  $('#sub-myname').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addMyName(); } });
  $('#sub-mynames').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    myNames.splice(Number(b.dataset.rm), 1);
    store.set(NAMES_KEY, myNames);
    renderCaps();
    updateMeta();
  });
  $('#sub-caps-btn').addEventListener('click', () => showDrawer(true, 'names'));

  function renderNames() {
    renderCaps();
    nameGroups = findNameVariants(doc.cues);
    articleIssues = findArticleIssues(doc.cues);
    const nb = $('#sub-names');
    nb.innerHTML = nameGroups.length
      ? nameGroups.map((g, gi) => `
        <div class="sub-name" data-g="${gi}">
          <div class="sub-name-variants">
            ${g.variants.map((v, vi) => `<button type="button" class="sub-chip${vi === 0 ? ' is-on' : ''}" data-v="${escapeHtml(v.text)}">${escapeHtml(v.text)} <span>${v.count}</span></button>`).join('')}
          </div>
          <div class="sub-name-row">
            <input type="text" class="form-input sub-name-input" value="${escapeHtml(g.variants[0].text)}" aria-label="${escapeHtml(S.name_correct)}" />
            <button type="button" class="btn-secondary sub-name-apply">${escapeHtml(S.replace_all)}</button>
          </div>
        </div>`).join('')
      : `<p class="sub-empty">${escapeHtml(S.names_none)}</p>`;
    const ab = $('#sub-articles');
    ab.innerHTML = articleIssues.length
      ? articleIssues.map((a, ai) => `
        <div class="sub-article" data-a="${ai}">
          <button type="button" class="sub-article-word" data-goto title="${escapeHtml(S.seek_hint)}">${escapeHtml(a.word)}</button>
          <span class="sub-article-kind">${escapeHtml(a.kind === 'dangling' ? S.art_dangling : a.kind === 'contraction' ? S.art_contraction : S.art_assim)}</span>
          ${a.fix ? `<button type="button" class="btn-secondary sub-mini" data-fix>→ ${escapeHtml(a.fix)}</button>` : ''}
        </div>`).join('')
      : `<p class="sub-empty">${escapeHtml(S.articles_none)}</p>`;
  }

  $('#sub-names').addEventListener('click', e => {
    const card = e.target.closest('.sub-name');
    if (!card) return;
    const input = card.querySelector('.sub-name-input');
    const chip = e.target.closest('.sub-chip');
    if (chip) {
      card.querySelectorAll('.sub-chip').forEach(c => c.classList.toggle('is-on', c === chip));
      input.value = chip.dataset.v;
      return;
    }
    if (e.target.closest('.sub-name-apply')) {
      const g = nameGroups[Number(card.dataset.g)];
      const to = input.value.trim();
      if (!to) return;
      const n = g.variants.filter(v => v.text !== to).reduce((s, v) => s + v.count, 0);
      if (doc.apply(c => replaceVariants(c, g.variants.map(v => v.text), to), S.l_names)) toast(S.names_applied(n, to), 'ok');
    }
  });

  $('#sub-articles').addEventListener('click', e => {
    const row = e.target.closest('.sub-article');
    if (!row) return;
    const a = articleIssues[Number(row.dataset.a)];
    if (!a) return;
    if (e.target.closest('[data-goto]')) return select(a.i, a.k, { seek: true });
    if (e.target.closest('[data-fix]')) {
      const ok = a.kind === 'dangling'
        ? doc.apply(c => joinWordWithNext(c, a.i, a.k), S.l_articles)
        : doc.apply(c => setWordText(c, a.i, a.k, a.fix), S.l_articles);
      if (ok) renderNames();
    }
  });

  $('#sub-replace-btn').addEventListener('click', () => {
    const find = $('#sub-find').value;
    const repl = $('#sub-repl').value;
    const matchCase = $('#sub-matchcase').checked;
    let n = 0;
    doc.apply(c => (n = replaceText(c, find, repl, { matchCase })) > 0, S.l_replace);
    toast(S.replaced(n), n ? 'ok' : 'info');
  });

  // ── Export ─────────────────────────────────────────────────────────────────

  const hasPicture = () => video.videoWidth > 0 && video.videoHeight > 0;

  function updateExportAvailability() {
    const ok = hasPicture();
    $$('[data-export="burn"], [data-export="alpha"]').forEach(b => {
      b.disabled = !ok || exporting;
      b.title = ok ? '' : S.no_video;
    });
  }

  const endSeconds = () => (endCard.text.trim() ? Math.max(1, Math.min(8, Number(endCard.seconds) || 3)) : 0);

  function assFor() {
    const { w, h } = frame();
    const secs = endSeconds();
    const dur = video.duration || 0;
    return buildAss(doc.cues, look, {
      width: w, height: h, title: videoPath ? baseName(videoPath) : 'Banditur',
      endCard: secs && dur ? { text: endCard.text.trim(), start: dur, end: dur + secs } : null,
    });
  }

  async function saveText(path, content) {
    try {
      await invoke('save_srt', { path, content });
      toast(S.saved_file(baseName(path)), 'ok');
      return true;
    } catch (e) {
      toast(S.save_err(String(e)), 'error');
      return false;
    }
  }

  async function saveSrt() {
    if (!open || !srtPath) return false;
    try {
      await invoke('save_srt', { path: srtPath, content: buildSrt(doc.cues, { maxChars: lookOpts().maxChars }) });
      toast(S.saved_file(baseName(srtPath)), 'ok');
      return true;
    } catch (e) {
      toast(S.save_err(String(e)), 'error');
      return false;
    }
  }

  async function pickPath(ext, suffix, filterName) {
    const base = videoPath ? stripExt(videoPath) : 'captions';
    // start in the folder of the last export, so repeated exports go to one place
    const lastDir = store.get(EXPORT_DIR_KEY);
    const startAt = lastDir && videoPath ? `${lastDir}/${baseName(base)}${suffix}.${ext}` : `${base}${suffix}.${ext}`;
    let p = await saveDialog({ defaultPath: startAt, filters: [{ name: filterName, extensions: [ext] }] });
    if (!p) return null;
    if (!p.toLowerCase().endsWith(`.${ext}`)) p += `.${ext}`;
    const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    if (cut > 0) store.set(EXPORT_DIR_KEY, p.slice(0, cut));
    return p;
  }

  function exportStatus(msg, pct = null, { busy = false, done = false, error = false } = {}) {
    const box = $('#sub-export-status');
    box.hidden = false;
    box.classList.toggle('is-error', error);
    box.classList.toggle('is-done', done);
    $('#sub-export-msg').textContent = msg;
    $('#sub-export-fill').style.width = pct == null ? '0%' : `${pct}%`;
    $('#sub-export-cancel').hidden = !busy;
    $('#sub-export-open').hidden = !done;
    $('#sub-export-dismiss').hidden = busy;
  }

  function endExport() {
    exporting = false;
    exportUnlisten?.();
    exportUnlisten = null;
    updateExportAvailability();
  }

  async function exportVideo(mode) {
    if (exporting) return toast(S.export_busy, 'warn');
    if (!hasPicture() || !videoPath) return toast(S.no_video, 'warn');
    const out = mode === 'burn'
      ? await pickPath('mp4', '-kaptjins', 'MP4')
      : await pickPath('mov', '-kaptjins-trasparenti', 'MOV (ProRes 4444)');
    if (!out) return;
    exporting = true;
    lastExportPath = out;
    updateExportAvailability();
    exportStatus(S.exporting, 0, { busy: true });
    exportUnlisten = await listen('render-update', e => {
      const d = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
      if (d.type === 'progress') exportStatus(S.export_pct(d.value), d.value, { busy: true });
      else if (d.type === 'status') exportStatus(d.message, null, { busy: true });
      else if (d.type === 'done') {
        const used = (d.fonts || []).map(f => f.name || f.file).filter(Boolean);
        const bad = used.length && !used.some(n => /montserrat/i.test(n));
        const tail = used.length ? ` · ${bad ? 'WRONG FONT USED' : 'Font'}: ${used.join(', ')}` : '';
        exportStatus(S.export_done(baseName(d.path)) + tail, 100, bad ? { error: true } : { done: true });
        endExport();
      }
      else if (d.type === 'cancelled') { exportStatus(S.export_cancel); endExport(); }
      else if (d.type === 'error') { exportStatus(S.export_err(d.message), null, { error: true }); endExport(); }
    });
    try {
      const lg = logo?.path ? { path: logo.path, corner: logo.corner || 'tr', widthPct: logo.widthPct ?? 12, opacity: logo.opacity ?? 1, marginPct: logo.marginPct ?? 4 } : null;
      await invoke('render_subtitles', { videoPath, ass: assFor(), outputPath: out, mode, fonts: [look.font], logo: lg, endCardSeconds: endSeconds() });
    } catch (e) {
      exportStatus(S.export_err(String(e)), null, { error: true });
      endExport();
    }
  }

  menu.addEventListener('click', async e => {
    const b = e.target.closest('[data-export]');
    if (!b || b.disabled) return;
    toggleExportMenu(false);
    const kind = b.dataset.export;
    if (kind === 'burn' || kind === 'alpha') return exportVideo(kind);
    if (kind === 'srt-here') return saveSrt();
    if (kind === 'ass') {
      const p = await pickPath('ass', '', 'ASS');
      if (p) saveText(p, assFor());
    }
    if (kind === 'srt') {
      const p = await pickPath('srt', '', 'SRT');
      if (p) saveText(p, buildSrt(doc.cues, { maxChars: lookOpts().maxChars }));
    }
  });
  $('#sub-export-cancel').addEventListener('click', () => invoke('cancel_render').catch(() => {}));
  $('#sub-export-open').addEventListener('click', () => { if (lastExportPath) openPath(lastExportPath).catch(() => {}); });
  $('#sub-export-dismiss').addEventListener('click', () => { $('#sub-export-status').hidden = true; });

  // ── Layout: give vertical videos the side of the screen ───────────────────

  const main = $('.sub-main');
  function fitStage() {
    const { w, h } = frame();
    const portrait = formatOf(w, h) !== 'wide';
    root.classList.toggle('is-portrait', portrait);
  }
  video.addEventListener('loadedmetadata', fitStage);
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => preview.redraw()).observe(main);

  return {
    load,
    clear,
    saveSrt,
    isOpen: () => open,
    // for tests
    get doc() { return doc; },
    get look() { return look; },
    actions,
  };
}
