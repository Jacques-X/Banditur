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
  id: `p${i + 1}`, caption: caps[p.c], platforms: p.p || (p.t === 'story' ? ['ig'] : ['fb', 'ig']), content_type: p.t,
  media: [{ url: '', type: 'image/jpeg' }], scheduled_time: at(p.d, p.h, p.m || 0), status: p.s, error_message: p.err || null,
  profile_id: 'main', published_at: p.s === 'published' ? at(p.d, p.h, p.m || 0) : null,
  fb_post_id: p.s === 'published' ? 'fb1' : null, ig_post_id: p.s === 'published' ? 'ig1' : null,
  likes_count: p.l || 0, comments_count: p.k || 0,
}));

function history(q) {
  let list = [...posts];
  const status = q.get('status') || 'all';
  if (status !== 'all') list = list.filter(p => p.status === status);
  const search = (q.get('search') || '').toLowerCase();
  if (search) list = list.filter(p => p.caption.toLowerCase().includes(search));
  if (q.get('from')) list = list.filter(p => p.scheduled_time >= q.get('from'));
  if (q.get('to')) list = list.filter(p => p.scheduled_time < q.get('to'));
  list.sort((a, b) => b.scheduled_time.localeCompare(a.scheduled_time));
  const page = +(q.get('page') || 1), limit = +(q.get('limit') || 50);
  return { posts: list.slice((page - 1) * limit, page * limit), total: list.length, pending: posts.filter(p => p.status === 'pending').length };
}

function calendar(q) {
  const s = new Date(q.get('start')), e = new Date(q.get('end'));
  const out = [];
  const add = (date, h, title, label, opts = {}) => {
    if (date < s || date >= e) return;
    const start = new Date(date); start.setHours(h, 0, 0, 0);
    const end = new Date(start); end.setHours(h + (opts.len || 1));
    out.push({ id: `e${out.length}-${date.getTime()}`, title, start: start.toISOString(), end: end.toISOString(), allDay: false,
      extendedProps: { label, location: opts.loc || '', description: '', htmlLink: 'https://calendar.google.com', recurringEventId: opts.rec || null } });
  };
  for (let d = new Date(s); d < e; d = new Date(d.getTime() + D)) {
    if (d.getDay() === 3) add(d, 20, 'Prova tal-banda', 'Prova', { rec: 'r1', len: 2, loc: 'Każin' });
    const rel = Math.round((d.setHours(12) - now) / D);
    if (rel === 0) add(d, 19, 'Laqgħa tal-kumitat', 'Festa', { loc: 'Każin', len: 1.5 });
    if (rel === 3) add(d, 9, 'Quddiesa solenni', 'Quddiesa', { loc: 'Knisja parrokkjali', len: 2 });
    if (rel === -6) add(d, 10, 'Ġbir tal-fondi', 'Festa');
    if (rel === 8) add(d, 18, 'Ħarġa tal-membri', 'Festa', { len: 4 });
  }
  return out;
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

async function mockFetch(url, { method }) {
  await delay(180);
  const u = new URL(url, 'http://mock');
  const q = u.searchParams;
  const path = u.pathname;
  if (path === '/api/meta' && q.get('type') === 'version') return { backend_version: '1.0.1', minimum_desktop_version: '1.0.0' };
  if (path === '/api/meta' && q.get('type') === 'profiles') return [{ id: 'main', name: 'Santa Katarina' }, { id: 'banda', name: 'Banda Santa Katarina' }];
  if (path === '/api/meta' && q.get('type') === 'live-posts') return { posts: posts.filter(p => p.status === 'published').map(p => ({ ...p, platform: 'fb', state: 'published', permalink: 'https://facebook.com', created_time: p.scheduled_time })), total: 8, errors: [], refreshed_at: new Date().toISOString() };
  if (path === '/api/meta' && method === 'POST') return { ok: true };
  if (path === '/api/history') return history(q);
  if (path === '/api/calendar' && method === 'GET') return calendar(q);
  if (path === '/api/calendar') return { id: 'new', title: 'Avveniment', start: new Date().toISOString(), allDay: false, extendedProps: {} };
  if (path === '/api/drive/posters') return q.get('folderId')
    ? [1, 2, 3, 4, 5, 6].map(i => ({ id: `f${i}`, name: `poster-${i}.jpg`, mimeType: 'image/jpeg' }))
    : [{ id: 'd1', name: 'Festa 2026', mimeType: 'application/vnd.google-apps.folder' }, { id: 'd2', name: 'Kunċerti', mimeType: 'application/vnd.google-apps.folder' }, { id: 'f9', name: 'logo.png', mimeType: 'image/png' }];
  if (path === '/api/reports/monthly') return report();
  if (path.startsWith('/api/posts/')) return { ok: true };
  if (path === '/api/schedule') return { id: 'new' };
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

async function invoke(cmd, args) {
  await delay(60);
  switch (cmd) {
    case 'get_config': return {};
    case 'list_watermark_packs': return packs;
    case 'preload_transcribe': return null;
    case 'list_post_templates': return [{ id: 'awguri', name: 'Awguri', zones: [{ id: 'z1', label: 'Isem', x: 80, y: 1090, w: 920, h: 120, maxSize: 96, minSize: 40, case: 'upper', color: '#FFFFFF' }, { id: 'z2', label: 'Linja 2', x: 80, y: 1220, w: 920, h: 70, maxSize: 44, minSize: 24, color: '#C9A34E', optional: true }] }];
    case 'get_post_template_overlay': return overlayDataUrl();
    case 'process_images': return fakeRun('done', { processed: 212, failed: 2, duplicates: 0, output_dir: args.outputDir, elapsed_ms: 9000 });
    case 'convert_raw_batch': return fakeRun('raw-done', { converted: 96, skipped: 2, output_dir: args.outputDir, elapsed_ms: 4000 });
    case 'yt_download': return fakeYt(args);
    case 'process_video': return fakeTranscribe();
    case 'audio_peaks': return { rate: 50, peaks: Array.from({ length: 1100 }, (_, i) => Math.round(Math.abs(Math.sin(i / 9) * Math.cos(i / 31)) * 200 + 20)) };
    default: console.info('[mock] invoke', cmd, args); return null;
  }
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
async function fakeTranscribe() {
  const text = "Il-lejla nifirħu flimkien mal-Kumitat tal-Festa għall-festa ta' Santa Katarina. Il-purċissjoni toħroġ fis-sebgħa u nofs, u wara l-banda fil-pjazza. Grazzi lil kull min għen.";
  for (let i = 0; i <= 100; i += 20) { await delay(250); emit('transcribe-update', { type: 'progress', value: i || -1 }); }
  let t = 0.2;
  const words = text.split(' ').map((w, i) => { const s = t; t += 0.32 + (w.length * 0.03); return { word: w, start: s, end: t - 0.05, probability: i === 1 || i === 17 ? 0.4 : 0.95 }; });
  emit('transcribe-update', { type: 'done', all_words: words, srt_path: '/tmp/x.srt', peaks: [], peaks_rate: 50 });
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
    openDialog: async opts => (opts?.directory ? '/Users/jacques/Pictures/Purċissjoni 2026' : '/Users/jacques/Movies/festa-2026-intervista.mp4'),
    saveDialog: async () => '/Users/jacques/Desktop/out.jpg',
    fileSrc: () => '',
  });
}
