// App-wide state: where the user is, settings, profiles, theme, toasts and the
// confirm dialog. Views read and write `app` directly.

import { PROFILES_KEY, seedProfiles, addProfile, renameProfile, removeProfile } from './profiles.js';
import { VIDEO_PARTS, resolveTool, restoreTool, isVideoPart } from './video-parts.js';

const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  json(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } },
  /** A stored list. Anything else (damaged or old data) reads as an empty list. */
  list(k) { const v = ls.json(k, []); return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []; },
  /** A stored plain object. Anything else reads as an empty object. */
  object(k) { const v = ls.json(k, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; },
};
export { ls };

const initialProfiles = seedProfiles(globalThis.localStorage);

export const VIEWS = ['home', 'kalendarju', 'xoghol', 'studio', 'settings'];
export const TOOLS = [
  { id: 'video', label: 'Video', desc: 'Traskrittura (subtitles) · Murtali (murtali → Reel) · Awdjo (vuċi nadifa)', icon: 'video', key: '3' }, // three screens: VIDEO_PARTS
  { id: 'posts', label: 'Posts', desc: 'Awguri, kondoljanzi u oħrajn minn template', icon: 'template', key: '4' },
  { id: 'ritratti', label: 'Ritratti', desc: 'RAW → JPG, watermark, daqs u duplikati', icon: 'camera', key: '5' },
  { id: 'youtube', label: 'YouTube', desc: 'Niżżel bħala MP4 jew MP3', icon: 'download', key: '6' },
];
/** Studio tools drawn on a dark stage when "Studio dejjem skur" is on. */
const DARK_TOOLS = ['traskrittura', 'murtali', 'awdjo', 'posts'];

// Marka and RAW → JPG became Ritratti (2026-11-22).
const savedTool = { marka: 'ritratti', raw: 'ritratti' }[ls.get('banditur_tool', '')] || ls.get('banditur_tool', null);
const savedVideoPart = isVideoPart(ls.get('banditur_video_part', '')) ? ls.get('banditur_video_part', '') : 'traskrittura';

export const app = $state({
  view: 'home',                  // the app always opens on the Home screen
  tool: restoreTool(savedTool, TOOLS.map(t => t.id), savedVideoPart),   // the screen open in Studio (a VIDEO_PARTS id, never 'video'); null = no tool open
  videoPart: savedVideoPart,     // the Video tab's last part
  settingsSection: 'sistema',
  palette: false, // the ⌘K box
  profiles: initialProfiles.list,
  profileId: initialProfiles.current,
  theme: ls.get('banditur_theme', 'system'),          // system | light | dark
  studioDark: ls.get('banditur_studio_dark', '1') === '1',
  systemDark: false,
  health: 'unknown',             // unknown | ok | warn | error
  healthNote: '',
  version: '',
  busy: { photos: false, transcribe: false, export: false, youtube: false },
});

/** The Video tab's parts: Traskrittura, Murtali and Awdjo (components/VideoTabs.svelte). */
export { VIDEO_PARTS };

// ── Navigation ─────────────────────────────────────────────────────────────
export function go(view) {
  if (!VIEWS.includes(view)) return;
  app.view = view;
}
/** Open a Studio screen. 'video' (the toolbar button, ⌘5) opens the Video part used last; 'traskrittura', 'murtali' and 'awdjo' open that part. */
export function openTool(id) {
  const screen = resolveTool(id, app.videoPart);
  app.tool = screen;
  app.view = screen ? 'studio' : 'home';
  if (isVideoPart(screen)) { app.videoPart = screen; ls.set('banditur_video_part', screen); }
  if (screen) ls.set('banditur_tool', screen);
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

// ── Profiles (kept on this Mac, see profiles.js) ───────────────────────────
function persistProfiles() { ls.set(PROFILES_KEY, JSON.stringify($state.snapshot(app.profiles))); }
export function setProfile(id) {
  app.profileId = id;
  ls.set('banditur_profile_id', id);
}
export const profileName = (id = app.profileId) => app.profiles.find(p => p.id === id)?.name || id;
export function createProfile(name) {
  const { list, id } = addProfile(app.profiles, name);
  app.profiles = list; persistProfiles();
  return id;
}
export function renameProfileTo(id, name) { app.profiles = renameProfile(app.profiles, id, name); persistProfiles(); }
/** Takes the profile out of the list. Its Xogħol and Kalendarju data stays stored; adding the same id back shows it again. */
export function deleteProfile(id) {
  app.profiles = removeProfile(app.profiles, id); persistProfiles();
  if (app.profileId === id) setProfile(app.profiles[0].id);
}

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

// The recent-work history (banditur_jobs) is no longer kept; drop what an older version saved.
try { localStorage.removeItem('banditur_jobs'); } catch { /* storage unavailable */ }
// Left over from the Supabase/Vercel versions (2.2.0 dropped them): the saved connection (it held an API
// key), the sharing switches, Skeda's last tab and the "show posts" calendar layer. Nothing reads them now.
for (const k of ['banditur_config', 'banditur_share_xoghol', 'banditur_share_calendar', 'banditur_skeda_part', 'banditur_cal_posts']) {
  try { localStorage.removeItem(k); } catch { /* storage unavailable */ }
}
