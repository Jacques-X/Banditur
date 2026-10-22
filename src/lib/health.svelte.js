// System checks shown in Settings → Sistema and summarised in the toolbar.

import { app, configured } from './app.svelte.js';
import { api, fetchProfiles } from './api.js';
import { getVersion, isTauri, isMock } from './tauri.js';

export const health = $state({ checks: [], at: 0, running: false });

function compareSemver(a, b) {
  const pa = String(a || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}

const until = (ms, p) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('Dam wisq biex jirrispondi.')), ms))]);

export async function runHealth() {
  if (health.running) return;
  health.running = true;
  const checks = [];
  const add = c => checks.push(c);
  app.version = await getVersion().catch(() => '');

  if (!configured() && !isMock()) {
    add({ id: 'backend', name: 'Backend', tone: 'error', detail: 'Mhux ikkonfigurat. Daħħal il-Backend URL u l-API Key.', fix: 'konnessjoni' });
  } else {
    // Backend + version compatibility
    const t0 = performance.now();
    try {
      const info = await until(10000, api('/api/meta', { query: { type: 'version' } }));
      const ms = Math.round(performance.now() - t0);
      const tooOld = info?.minimum_desktop_version && app.version && compareSemver(app.version, info.minimum_desktop_version) < 0;
      add({
        id: 'backend', name: 'Backend (Vercel)',
        tone: tooOld ? 'warn' : 'ok',
        detail: tooOld ? `Din il-version tal-app hija antika. Meħtieġa ${info.minimum_desktop_version} jew aktar ġdida.` : `Konness · wieġeb f'${ms} ms`,
        ver: info?.version || info?.backend_version || '',
        fix: tooOld ? 'aggornamenti' : '',
      });
    } catch (e) {
      add({ id: 'backend', name: 'Backend (Vercel)', tone: 'error', detail: e.message, fix: 'konnessjoni' });
    }

    // Profiles (Facebook / Instagram accounts live in the backend)
    try {
      const list = await until(10000, fetchProfiles());
      if (list.length) {
        app.profiles = list;
        if (!list.some(p => p.id === app.profileId)) app.profileId = list[0].id;
      }
      add({ id: 'profiles', name: 'Profiles (Facebook u Instagram)', tone: list.length ? 'ok' : 'warn', detail: list.length ? list.map(p => p.name || p.id).join(' · ') : 'Il-backend ma tax profili.' });
    } catch (e) {
      add({ id: 'profiles', name: 'Profiles (Facebook u Instagram)', tone: 'error', detail: e.message });
    }

    // Google Calendar (a one-day read)
    try {
      const s = new Date(); s.setHours(0, 0, 0, 0);
      const e = new Date(s); e.setDate(e.getDate() + 1);
      await until(10000, api('/api/calendar', { query: { start: s.toISOString(), end: e.toISOString() } }));
      add({ id: 'calendar', name: 'Google Calendar', tone: 'ok', detail: 'Il-kalendarju jinqara' });
    } catch (e) {
      add({ id: 'calendar', name: 'Google Calendar', tone: 'warn', detail: e.message });
    }

    // Google Drive
    try {
      await until(10000, api('/api/drive/posters'));
      add({ id: 'drive', name: 'Google Drive', tone: 'ok', detail: 'Il-folder tail-media jinfetaħ' });
    } catch (e) {
      add({ id: 'drive', name: 'Google Drive', tone: 'warn', detail: e.message });
    }
  }

  const sb = app.config.supabaseUrl && app.config.supabaseKey;
  add({ id: 'media', name: 'Upload tail-media (Supabase)', tone: sb || isMock() ? 'ok' : 'warn', detail: sb || isMock() ? 'Ikkonfigurat' : 'Mingħajr Supabase ma tistax tiskeda posts bir-ritratti.', fix: sb || isMock() ? '' : 'konnessjoni' });
  add({ id: 'app', name: 'App tad-desktop', tone: 'ok', detail: isTauri ? 'Banditur għall-Mac' : 'Qed taħdem fil-browser (preview)', ver: app.version ? `v${app.version}` : '' });

  health.checks = checks;
  health.at = Date.now();
  health.running = false;
  const worst = checks.some(c => c.tone === 'error') ? 'error' : checks.some(c => c.tone === 'warn') ? 'warn' : 'ok';
  app.health = worst;
  app.healthNote = checks.filter(c => c.tone !== 'ok').map(c => `${c.name}: ${c.detail}`).join('\n');
}
