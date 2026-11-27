// Dev-only sample data so every screen can be opened in a plain browser:
//   npm run dev → http://127.0.0.1:5173/?mock
// Never imported by the production build (see main.js).

import { setMock } from './tauri.js';

const delay = ms => new Promise(r => setTimeout(r, ms));


// ── Tauri commands + events ────────────────────────────────────────────────
const listeners = new Map();
const emit = (ev, payload) => (listeners.get(ev) || []).forEach(h => h({ payload }));

const packs = [
  { id: 'kumitat', name: 'Pack tal-kumitat', version: 3, watermarks: [
    { id: 'fotografu-1', name: 'Fotografu 1', portrait: true, landscape: true },
    { id: 'fotografu-2', name: 'Fotografu 2', portrait: true, landscape: true },
  ] },
];

function overlayDataUrl() {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(31,44,69,0.92)'; g.fillRect(0, 1050, 1080, 300);
  g.fillRect(0, 0, 1080, 130);
  g.fillStyle = '#C9A34E'; g.fillRect(0, 130, 1080, 6); g.fillRect(0, 1044, 1080, 6);
  return c.toDataURL('image/png');
}

async function invoke(cmd, args) {
  await delay(60);
  switch (cmd) {
    case 'list_media_files': return Array.from({ length: 24 }, (_, i) => `${args?.path}/DSC0${100 + i}.${i % 2 ? 'JPG' : 'ARW'}`);
    case 'cancel_photo_job':return null;
    case 'list_watermark_packs': return packs;
    case 'preload_transcribe': return null;
    case 'components_status': return { dir: '~/Library/Application Support/app.banditur.desktop/components', installed: { engine: 3, model: 1, ui: '5' }, engine: 'installed', model: 'installed', coreApi: 1, ui: '5', uiBad: [] };
    case 'interface_ready': return null;
    case 'reload_interface': return '5';
    case 'update_status': return mockUpdateStatus();
    case 'update_pull': return { work: true, core: new URLSearchParams(location.search).has('core'), ui: true, engine: false, model: false };
    case 'update_run_background': fakeUpdate(); return null;
    case 'update_and_restart': console.info('[mock] the app would quit, rebuild and reopen'); return null;
    case 'update_clear_result': mockUpdate.lastResult = null; return null;
    case 'list_post_templates': return [{ id: 'awguri', name: 'Awguri', zones: [{ id: 'z1', label: 'Isem', x: 80, y: 1090, w: 920, h: 120, maxSize: 96, minSize: 40, case: 'upper', color: '#FFFFFF' }, { id: 'z2', label: 'Linja 2', x: 80, y: 1220, w: 920, h: 70, maxSize: 44, minSize: 24, color: '#C9A34E', optional: true }] }];
    case 'get_post_template_overlay': return overlayDataUrl();
    case 'process_images': return fakeRun('done', { processed: 212, failed: 2, duplicates: 0, output_dir: args.outputDir, elapsed_ms: 9000 });
    case 'convert_raw_batch': return fakeRun('raw-done', { converted: 96, skipped: 2, output_dir: args.outputDir, elapsed_ms: 4000 });
    case 'yt_download': return fakeYt(args);
    case 'process_video': fakeTranscribe(args?.requestId); return args?.requestId || 'req-mock';
    case 'cancel_transcribe': return null;
    case 'fireworks_fingerprint': return { size: 4_200_000_000, mtimeMs: 1_700_000_000_000 };
    case 'analyse_fireworks': fakeAnalyse(args?.requestId); return null;
    case 'fireworks_thumbs': setTimeout(() => emit('fireworks-update', { type: 'done', files: (args?.times || []).map(() => null), id: args?.requestId }), 150); return null;
    case 'render_fireworks': fakeFireworksRender(args); return null;
    case 'cancel_fireworks': return null;
    case 'read_lut': return mockCube();
    case 'audio_peaks': return { rate: 50, peaks: Array.from({ length: 1100 }, (_, i) => Math.round(Math.abs(Math.sin(i / 9) * Math.cos(i / 31)) * 200 + 20)) };
    default: console.info('[mock] invoke', cmd, args); return null;
  }
}

// Updates from GitHub: three commits waiting until the fake update has run (`&core` makes it ask to restart).
const mockUpdate = { behind: 3, lastResult: null };
function mockUpdateStatus() {
  const commits = [['a1b2c3d', 'Kalendarju: uri l-avvenimenti tal-gurnata'], ['4e5f6a7', 'Posts: iktar spazju taħt il-caption'], ['9c8d7e6', 'Fix: l-export tar-rapport']].slice(0, mockUpdate.behind);
  return {
    configured: true, root: '/Users/x/Banditur', branch: 'stable', upstream: 'origin/stable', head: 'f00ba12',
    behind: mockUpdate.behind, ahead: 0, commits: commits.map(([hash, subject]) => ({ hash, subject })),
    dirty: false, pending: false, building: false, lastResult: mockUpdate.lastResult, fetchError: null, error: null,
  };
}
async function fakeUpdate() {
  await delay(2500);
  mockUpdate.behind = 0;
  mockUpdate.lastResult = { ok: true, at: new Date().toISOString(), head: '9c8d7e6' };
  emit('update://done', mockUpdate.lastResult);
}

async function fakeRun(doneEvent, payload) {
  for (let i = 1; i <= 20; i++) {
    await delay(150);
    emit('progress', { fraction: i / 20 });
    emit('log', { tag: i === 14 ? 'error' : 'ok', msg: i === 14 ? `✕ DSC_01${i}.jpg — il-fajl huwa bil-ħsara` : `✓ DSC_01${String(i).padStart(2, '0')}.jpg` });
  }
  emit(doneEvent, payload);
}
async function fakeYt({ format }) {
  for (let i = 0; i <= 100; i += 10) { await delay(200); emit('yt-update', { type: 'progress', value: i, format }); }
  emit('yt-update', { type: 'converting', format });
  await delay(400);
  emit('yt-update', { type: 'done', title: 'Marċ funebri — banda', path: '/Users/x/Downloads/marc.mp3' });
}
async function fakeTranscribe(id) {
  const text = "Il-lejla nifirħu flimkien mal-Kumitat tal-Festa għall-festa ta' Santa Katarina. Il-purċissjoni toħroġ fis-sebgħa u nofs, u wara l-banda fil-pjazza. Grazzi lil kull min għen.";
  for (let i = 0; i <= 100; i += 20) { await delay(250); emit('transcribe-update', { type: 'progress', value: i || -1, id }); }
  let t = 0.2;
  const words = text.split(' ').map((w, i) => { const s = t; t += 0.32 + (w.length * 0.03); return { word: w, start: s, end: t - 0.05, probability: i === 1 || i === 17 ? 0.4 : 0.95 }; });
  emit('transcribe-update', { type: 'done', all_words: words, srt_path: '/tmp/x.srt', peaks: [], peaks_rate: 50, id });
}

// A 6-minute show with 9 displays, deterministic: [start s, length s, strength 0-1].
const FW_SHOW = [[22, 14, 0.7], [58, 9, 0.5], [95, 20, 0.95], [140, 6, 0.4], [171, 16, 0.8], [215, 12, 0.6], [250, 8, 0.45], [288, 18, 0.9], [330, 10, 0.55]];
function fwCurves(duration = 360) {
  const n = duration * 10;
  const rms = new Array(n), transient = new Array(n), low = new Array(n), light = new Array(n).fill(0);
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) { rms[i] = 20 + rnd() * 15; transient[i] = rnd() * 12; low[i] = 30 + rnd() * 20; }
  for (const [t0, len, k] of FW_SHOW) {
    for (let j = 0; j < len * 10; j++) {
      const i = Math.round((t0 + 3) * 10) + j;
      if (i >= n) break;
      const fade = Math.exp(-j / (len * 5));
      const crack = rnd() < 0.5 ? 1 : 0.35;
      transient[i] = Math.round(Math.min(255, (60 + 195 * k) * fade * crack + rnd() * 20));
      low[i] = Math.round(Math.min(255, 90 + 140 * k * fade));
      rms[i] = Math.round(Math.min(255, 110 + 120 * k * fade));
    }
  }
  // light: flashes just before the sound of each display (the sound arrives ~2-3 s late)
  for (const [t0, len, k] of FW_SHOW) {
    for (let j = 0; j < len * 10; j += 2) {
      const i = Math.round((t0 + 0.5) * 10) + j;
      if (i < n && rnd() < 0.7) light[i] = Math.round(Math.min(255, 90 + 165 * k * rnd()));
    }
  }
  // wind on the microphone: loud and impulsive, but nothing lights up
  for (const t0 of [44, 120, 200, 270]) for (let j = 0; j < 20; j++) { transient[t0 * 10 + j] = 200 + Math.round(rnd() * 55); low[t0 * 10 + j] = 220; rms[t0 * 10 + j] = 200; }
  const peaks = Array.from({ length: duration * 50 }, (_, i) => Math.min(255, Math.round(rms[Math.min(n - 1, i / 5 | 0)] * (0.4 + 0.6 * rnd()))));
  return { rms, transient, low, light, peaks };
}
// A small warm "log → Rec.709"-like LUT for clicking through the LUT controls.
function mockCube(n = 9) {
  let out = 'TITLE "Mock S-Log3 to 709"\nLUT_3D_SIZE ' + n + '\n';
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const c = (v) => Math.min(1, Math.max(0, (v / (n - 1) - 0.1) * 1.35));
    out += `${c(r).toFixed(5)} ${c(g).toFixed(5)} ${(c(b) * 0.9).toFixed(5)}\n`;
  }
  return out;
}
async function fakeAnalyse(id) {
  emit('fireworks-update', { type: 'status', message: 'Qed naqra l-ħoss…', id });
  for (let i = 0; i <= 100; i += 25) { await delay(200); emit('fireworks-update', { type: 'progress', value: i, id }); }
  emit('fireworks-update', { type: 'done', duration: 360, fps: 30, width: 1920, height: 1080, rate: 10, peaks_rate: 50, ...fwCurves(), id });
}
async function fakeFireworksRender(args) {
  const id = args?.requestId;
  for (let i = 0; i <= 100; i += 20) { await delay(250); emit('fireworks-update', { type: 'progress', value: i, id }); }
  emit('fireworks-update', { type: 'done', path: args?.job?.output, id });
}

export function installMock() {
  setMock({
    invoke,
    listen: async (ev, h) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(h);
      return () => listeners.set(ev, listeners.get(ev).filter(x => x !== h));
    },
    openDialog: async opts => {
      if (opts?.directory) return '/Users/jacques/Pictures/Purċissjoni 2026';
      // Photo pickers get the app icon (served from public/), so image flows can run in the preview.
      if (opts?.filters?.some(f => f.extensions?.includes('jpg'))) return opts.multiple ? ['/icon.png', '/icon.png'] : '/icon.png';
      return '/Users/jacques/Movies/festa-2026-intervista.mp4';
    },
    saveDialog: async () => '/Users/jacques/Desktop/out.jpg',
    fileSrc: path => (String(path).startsWith('/icon') ? path : ''),
  });
}
