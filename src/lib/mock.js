// Dev-only sample data so every screen can be opened in a plain browser:
//   npm run dev → http://127.0.0.1:5173/?mock
// Never imported by the production build (see main.js).

import { setMock } from './tauri.js';
import { setMockFetch } from './api.js';

const now = Date.now();
const H = 3600e3, D = 24 * H;
const at = (days, h, m = 0) => { const d = new Date(now + days * D); d.setHours(h, m, 0, 0); return d.toISOString(); };

const caps = [
  "Festa Santa Katarina 2026 — il-programm tal-lejla. Purċissjoni fis-19:30, segwita minn kunċert mill-banda fil-pjazza.",
  'Reel: ħruġ tal-istatwa mill-knisja',
  'Laqgħa ġenerali tal-membri nhar il-Ħamis fis-każin',
  'Awguri lill-kappillan tagħna għal għeluq sninu!',
  'Grazzi lil kull min attenda l-kunċert tal-Ħadd',
  'Ritratti mill-purċissjoni (10)',
  'Storja: il-banda waslet fil-pjazza',
  'Programm tal-ġimgħa tal-festa',
  "Kondoljanzi lill-familja ta' membru tagħna",
  'Reel: lejla tal-armar',
  'Prova ġenerali tal-banda — ejjew ismgħu',
  'Tombla fis-sala tal-każin nhar is-Sibt',
];
const posts = [
  { d: 1, h: 9, s: 'pending', t: 'reel', c: 1 },
  { d: 0, h: 20, s: 'pending', t: 'post', c: 0 },
  { d: 0, h: 18, m: 30, s: 'fb_native', t: 'post', c: 2 },
  { d: 2, h: 12, s: 'failed', t: 'post', c: 3, err: "Instagram ma aċċettax ir-ritratt (aspect ratio). Qassmu għal 4:5 jew 1:1." },
  { d: 5, h: 19, s: 'pending', t: 'post', c: 10 },
  { d: -3, h: 10, s: 'published', t: 'post', c: 4, l: 412, k: 37 },
  { d: -4, h: 21, m: 15, s: 'published', t: 'post', c: 5, l: 1210, k: 88 },
  { d: -4, h: 19, m: 40, s: 'published', t: 'story', c: 6 },
  { d: -5, h: 9, s: 'published', t: 'post', c: 7, l: 356, k: 21 },
  { d: -8, h: 16, s: 'published', t: 'post', c: 8, l: 204, k: 51, p: ['fb'] },
  { d: -10, h: 20, s: 'published', t: 'reel', c: 9, l: 2400, k: 63 },
  { d: -13, h: 18, s: 'published', t: 'post', c: 11, l: 280, k: 19 },
].map((p, i) => ({
  id: `p${i + 1}`,revision:0,deliveries:p.s==='failed'?{fb:{state:'published',id:'fb1'},ig:{state:'failed',error:p.err}}:{}, caption: caps[p.c], platforms: p.p || (p.t === 'story' ? ['ig'] : ['fb', 'ig']), content_type: p.t,
  media: [{ url: '', type: 'image/jpeg' }], scheduled_time: at(p.d, p.h, p.m || 0), status: p.s, error_message: p.err || null,
  profile_id: 'main', published_at: p.s === 'published' ? at(p.d, p.h, p.m || 0) : null,
  fb_post_id: p.s === 'published' ? 'fb1' : null, ig_post_id: p.s === 'published' ? 'ig1' : null,
  likes_count: p.l || 0, comments_count: p.k || 0,
}));

function history(q) {
  let list = [...posts];
  const status = q.get('status') || 'all';
  if (status === 'summary') {
    const by = (a, b) => a.scheduled_time.localeCompare(b.scheduled_time);
    const failed = list.filter(p => p.status === 'failed').sort((a, b) => by(b, a));
    return { upcoming: list.filter(p => ['pending', 'fb_native', 'processing'].includes(p.status)).sort(by).slice(0, 4), pending: list.filter(p => p.status === 'pending').length, failed: failed.length, latestFailed: failed[0] || null };
  }
  if(status==='active') list=list.filter(p=>['pending','fb_native','processing'].includes(p.status));else if (status !== 'all') list = list.filter(p => p.status === status);
  const search = (q.get('search') || '').toLowerCase();
  if (search) list = list.filter(p => p.caption.toLowerCase().includes(search));
  if (q.get('from')) list = list.filter(p => p.scheduled_time >= q.get('from'));
  if (q.get('to')) list = list.filter(p => p.scheduled_time < q.get('to'));
  if(q.get('event_id'))list=list.filter(p=>p.event_id===q.get('event_id'));
  list.sort((a, b) => (q.get('ascending')==='true'?1:-1)*a.scheduled_time.localeCompare(b.scheduled_time));
  const page = +(q.get('page') || 1), limit = +(q.get('limit') || 50);
  return { posts: list.slice((page - 1) * limit, page * limit), total: list.length, pending: posts.filter(p => p.status === 'pending').length };
}

function report() {
  const pub = posts.filter(p => p.status === 'published');
  const likes = pub.reduce((n, p) => n + p.likes_count, 0), comments = pub.reduce((n, p) => n + p.comments_count, 0);
  return {
    summary: { total_published: pub.length, total_pending: 3, total_failed: 1, by_platform: { fb: pub.length, ig: pub.length - 1 }, by_profile: { main: pub.length }, posts_per_week: 4.1 },
    engagement: { total_likes: likes, total_comments: comments, avg_per_post: Math.round((likes + comments) / pub.length) },
    page_insights: { fb_followers: 4812, ig_followers: 2960, fb_impressions: 58300, fb_follower_change: 38 },
    posts: pub,
    previous: {
      summary: { total_published: 13, total_pending: 0, total_failed: 2, by_platform: { fb: 13, ig: 11 }, posts_per_week: 2.9 },
      engagement: { total_likes: 3810, total_comments: 290, avg_per_post: 315 },
      range: { from: '2026-09-01', to: '2026-09-30' },
      page_insights: { fb_impressions: 60700, fb_follower_change: 21 },
    },
  };
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function mockFetch(url, { method, body }) {
  await delay(180);
  const u = new URL(url, 'http://mock');
  const q = u.searchParams;
  const path = u.pathname;
  if (path === '/api/meta' && q.get('type') === 'version') return { backend_version: '1.0.1', minimum_desktop_version: '1.0.0' };
  if (path === '/api/meta' && q.get('type') === 'profiles') return [{ id: 'main', name: 'Santa Katarina' }, { id: 'banda', name: 'Banda Santa Katarina' }];
  if (path === '/api/meta' && q.get('type') === 'live-posts') return { posts: posts.filter(p => p.status === 'published').map(p => ({ ...p, platform: 'fb', state: 'published', permalink: 'https://facebook.com', created_time: p.scheduled_time })), total: 8, errors: [], refreshed_at: new Date().toISOString() };
  if (path === '/api/meta' && method === 'POST') return { ok: true };
  if (path === '/api/history') return history(q);
  if (path === '/api/drive/find') return [{ id: 'f1', name: `${q.get('date').slice(8)}:${q.get('date').slice(5, 7)}:${q.get('date').slice(2, 4)} Festa.jpg`, mimeType: 'image/jpeg' }];
  if (path === '/api/drive/posters') return q.get('folderId')
    ? [1, 2, 3, 4, 5, 6].map(i => ({ id: `f${i}`, name: `poster-${i}.jpg`, mimeType: 'image/jpeg' }))
    : [{ id: 'd1', name: 'Festa 2026', mimeType: 'application/vnd.google-apps.folder' }, { id: 'd2', name: 'Kunċerti', mimeType: 'application/vnd.google-apps.folder' }, { id: 'f9', name: 'logo.png', mimeType: 'image/png' }];
  if (path.startsWith('/api/drive/archive/')) {
    const op = path.split('/').pop();
    if (op === 'check') return { found: { [body.fingerprints?.[0]]: 'x' } };
    if (op === 'ls') return { folders: body.path?.[2] === 'Footage' ? ['Marija'] : ['Joe Borg', 'Anna Camilleri'] };
    if (op === 'count') return { ritratti: 214, footage: 9, people: [] };
    if (op === 'session') return { sessionUrl: 'mock://session', name: body.name };
    if (op === 'finish') return { ok: true, id: 'd1' };
    if (op === 'sessions') return { results: (body.items || []).map(i => ({ sessionUrl: 'mock://session', name: i.name })) };
    if (op === 'finishMany') return { results: (body.items || []).map(() => ({ ok: true, id: 'd1' })) };
    return { id: 'd1' };
  }
  if (path === '/api/reports/monthly') return report();
  if(path.startsWith('/api/posts/')) {const id=path.split('/').pop(),p=posts.find(p=>p.id===id);if(method==='GET')return p;if(method==='DELETE'){const i=posts.indexOf(p);if(i>=0)posts.splice(i,1);}if(method==='PATCH' && p)Object.assign(p,{caption:body.caption ?? p.caption,scheduled_time:body.scheduledTime || p.scheduled_time,revision:(p.revision || 0)+1});return {ok:true};}
  if(path==='/api/schedule'){const id=crypto.randomUUID();posts.unshift({id,revision:0,...body,scheduled_time:body.scheduledTime,status:'pending',deliveries:{}});return {id};}
  if (path === '/api/media') return q.get('action') === 'check' ? { results: [] } : { path: 'x', token: 't', publicUrl: 'mock://x' };
  throw new Error(`mock: ${method} ${path}`);
}

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

let mockCard = typeof location !== 'undefined' && /[?&]card/.test(location.search);
const clock = (d, h, m) => Date.UTC(2026, 7, d, h, m) / 1000;
function mockScan() {
  const files = [];
  for (let i = 0; i < 40; i++) files.push({ path: `/Volumes/EOS_DIGITAL/DCIM/100CANON/IMG_${1000 + i}.CR3`, name: `IMG_${1000 + i}.CR3`, size: 28e6, kind: 'raw', taken: clock(15, 9, 5 + i * 3), src: 'exif' });
  for (let i = 0; i < 6; i++) files.push({ path: `/Volumes/EOS_DIGITAL/DCIM/100CANON/MVI_${i}.MP4`, name: `MVI_${i}.MP4`, size: 640e6, kind: 'video', taken: clock(15, 9, 20 + i * 9), src: 'mtime' });
  for (let i = 0; i < 70; i++) files.push({ path: `/Volumes/EOS_DIGITAL/DCIM/101CANON/IMG_${2000 + i}.JPG`, name: `IMG_${2000 + i}.JPG`, size: 9e6, kind: 'photo', taken: clock(15, 19, 30 + i), src: 'exif' });
  for (let i = 0; i < 25; i++) files.push({ path: `/Volumes/EOS_DIGITAL/DCIM/102CANON/IMG_${3000 + i}.JPG`, name: `IMG_${3000 + i}.JPG`, size: 9e6, kind: 'photo', taken: clock(16, 10, 2 + i * 4), src: 'exif' });
  return files;
}

async function invoke(cmd, args) {
  await delay(60);
  switch (cmd) {
    case 'get_config': return {};
    case 'list_media_files': return Array.from({ length: 24 }, (_, i) => `${args?.path}/DSC0${100 + i}.${i % 2 ? 'JPG' : 'ARW'}`);
    case 'cancel_photo_job':return null;
    case 'archive_volumes': return mockCard ? [{ path: '/Volumes/EOS_DIGITAL', name: 'EOS_DIGITAL' }] : [];
    case 'archive_scan': return mockScan();
    case 'archive_cancel': case 'archive_eject': case 'archive_copy': return null;
    case 'archive_put': {
      for (let i = 1; i <= 4; i++) { await delay(120); emit('archive://progress', { id: args.id, sent: Math.round(args.size * i / 4), size: args.size }); }
      return { file_id: 'd1', md5: 'x' };
    }
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
  const rms = new Array(n), transient = new Array(n), low = new Array(n);
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
  const peaks = Array.from({ length: duration * 50 }, (_, i) => Math.min(255, Math.round(rms[Math.min(n - 1, i / 5 | 0)] * (0.4 + 0.6 * rnd()))));
  return { rms, transient, low, peaks };
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
  setMockFetch(mockFetch);
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
