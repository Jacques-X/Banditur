// App-wide state: where the user is, settings, profiles, theme, toasts and the
// confirm dialog. Views read and write `app` directly.

import { invoke } from './tauri.js';

const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  json(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } },
};
export { ls };

export const VIEWS = ['skeda', 'kalendarju', 'arkivju', 'rapporti', 'studio', 'settings'];
export const TOOLS = [
  { id: 'traskrittura', label: 'Traskrittura', desc: 'Video → subtitles, stil u export', icon: 'captions', key: '5' },
  { id: 'posts', label: 'Posts', desc: 'Awguri, kondoljanzi u oħrajn minn template', icon: 'template', key: '6' },
  { id: 'marka', label: 'Marka & Ssortja', desc: 'Marka tal-fotografu fuq folder ritratti', icon: 'drop', key: '7' },
  { id: 'raw', label: 'RAW → JPG', desc: 'ARW, CR3, NEF u oħrajn għal JPG', icon: 'camera', key: '8' },
  { id: 'youtube', label: 'YouTube', desc: 'Niżżel bħala MP4 jew MP3', icon: 'download', key: '9' },
];
/** Studio tools drawn on a dark stage when "Studio dejjem skur" is on. */
const DARK_TOOLS = ['traskrittura', 'posts'];

const savedView = ls.get('banditur_view', 'skeda');
const savedTool = ls.get('banditur_tool', null);

export const app = $state({
  view: VIEWS.includes(savedView) ? savedView : 'skeda',
  tool: TOOLS.some(t => t.id === savedTool) ? savedTool : null,   // null = Studio home
  settingsSection: 'sistema',
  config: {},
  configSource: 'none',          // 'app' (baked in) | 'local' (Settings) | 'none'
  profiles: [{ id: 'main', name: 'Kumitat' }],
  profileId: ls.get('banditur_profile_id', 'main'),
  theme: ls.get('banditur_theme', 'system'),          // system | light | dark
  studioDark: ls.get('banditur_studio_dark', '1') === '1',
  systemDark: false,
  pending: 0,
  failed: 0,
  health: 'unknown',             // unknown | ok | warn | error
  healthNote: '',
  version: '',
  busy: { photos: false, transcribe: false, export: false, youtube: false },
  composerTick: 0,               // bumped when another view hands media to Skeda
});

// ── Navigation ─────────────────────────────────────────────────────────────
export function go(view) {
  if (!VIEWS.includes(view)) return;
  app.view = view;
  if (view !== 'settings') ls.set('banditur_view', view);
}
export function openTool(id) {
  app.tool = id;
  app.view = 'studio';
  ls.set('banditur_view', 'studio');
  if (id) ls.set('banditur_tool', id);
}
export function openSettings(section) {
  if (section) app.settingsSection = section;
  app.view = 'settings';
}

// ── Theme ──────────────────────────────────────────────────────────────────
export function effectiveTheme() {
  if (app.studioDark && app.view === 'studio' && DARK_TOOLS.includes(app.tool)) return 'dark';
  if (app.theme === 'system') return app.systemDark ? 'dark' : 'light';
  return app.theme;
}
export function setTheme(t) { app.theme = t; ls.set('banditur_theme', t); }
export function setStudioDark(on) { app.studioDark = on; ls.set('banditur_studio_dark', on ? '1' : '0'); }

// ── Config + profiles ──────────────────────────────────────────────────────
export async function initConfig() {
  let baked = {};
  try { baked = (await invoke('get_config')) || {}; } catch { /* browser or no baked config */ }
  const local = ls.json('banditur_config', {});
  const hasLocal = !!(local.vercelUrl || local.apiKey);
  app.config = hasLocal ? { ...baked, ...stripEmpty(local) } : baked;
  app.configSource = hasLocal ? 'local' : (baked.vercelUrl ? 'app' : 'none');
}
const stripEmpty = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v));

export function saveConfig(cfg) {
  ls.set('banditur_config', JSON.stringify(cfg));
  return initConfig();
}
export const configured = () => !!(app.config.vercelUrl && app.config.apiKey);

export function setProfile(id) {
  app.profileId = id;
  ls.set('banditur_profile_id', id);
}
export const profileName = (id = app.profileId) => app.profiles.find(p => p.id === id)?.name || id;

// ── Toasts ─────────────────────────────────────────────────────────────────
export const toasts = $state([]);
let toastId = 0;
/** toast(msg, type = info|ok|warn|error, action?: { label, onClick }) */
export function toast(msg, type = 'info', action = null) {
  const id = ++toastId;
  toasts.push({ id, msg: String(msg), type, action });
  return id;
}
export function dismissToast(id) {
  const i = toasts.findIndex(t => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

// ── Confirm dialog ─────────────────────────────────────────────────────────
export const confirmState = $state({ open: false, message: '', yes: 'Iva', no: 'Le', danger: false, resolve: null });
export function confirm(message, { yes = 'Iva', no = 'Le', danger = false } = {}) {
  return new Promise(resolve => {
    Object.assign(confirmState, { open: true, message, yes, no, danger, resolve });
  });
}
export function answerConfirm(v) {
  const r = confirmState.resolve;
  Object.assign(confirmState, { open: false, resolve: null });
  r?.(v);
}

// ── Recent Studio work (shown on the Studio home) ──────────────────────────
const JOBS_KEY = 'banditur_jobs';
export const jobs = $state(ls.json(JOBS_KEY, []));
/** logJob({ tool, name, status, tone: ok|warn|error, path? }) */
export function logJob(entry) {
  jobs.unshift({ ...entry, at: Date.now() });
  jobs.splice(30);
  ls.set(JOBS_KEY, JSON.stringify(jobs));
}
export function clearJobs() { jobs.splice(0); ls.set(JOBS_KEY, '[]'); }
