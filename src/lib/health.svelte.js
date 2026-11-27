// System checks shown in Settings → Sistema and summarised in the toolbar.

import { app } from './app.svelte.js';
import { getVersion, isTauri } from './tauri.js';

const runtimeErrors = new Map();
export function reportHealth(id,message) {
  if(message) runtimeErrors.set(id,message); else runtimeErrors.delete(id);
  summarize();
}
function summarize() {
  const errors=[...health.checks.filter(c=>c.tone!=='ok').map(c=>`${c.name}: ${c.detail}`),...runtimeErrors.values()];
  app.health=runtimeErrors.size || health.checks.some(c=>c.tone==='error') ? 'error' : errors.length ? 'warn' : health.at ? 'ok' : 'unknown';
  app.healthNote=errors.join('\n');
}
export const health = $state({ checks: [], at: 0, running: false });

export async function runHealth() {
  if (health.running) return;
  health.running = true;
  try {
    await check();
  } finally {
    // Whatever happens, the next check can run and the toolbar dot is up to date.
    health.running = false;
    summarize();
  }
}

async function check() {
  const checks = [];
  const add = c => checks.push(c);
  app.version = await getVersion().catch(() => '');

  add({ id: 'app', name: 'App tad-desktop', tone: 'ok', detail: isTauri ? 'Banditur għall-Mac' : 'Qed taħdem fil-browser (preview)', ver: app.version ? `v${app.version}` : '' });

  health.checks = checks;
  health.at = Date.now();
}
