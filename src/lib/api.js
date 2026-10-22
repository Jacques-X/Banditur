// Calls to the Banditur cloud backend (backend/api/*, on Vercel).

import { app, configured } from './app.svelte.js';
import { isMock } from './tauri.js';
import { friendlyError, ERR } from '../strings.js';

let mockFetch = null;
export function setMockFetch(fn) { mockFetch = fn; }

/**
 * api('/api/history', { query, method, body, raw }) → parsed JSON (or Response with raw).
 * Throws an Error whose message is already readable Maltese.
 */
export async function api(path, { query, method = 'GET', body, raw = false, headers = {} } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  if (isMock() && mockFetch) return mockFetch(path + qs, { method, body });
  if (!configured()) throw new Error(ERR.vercel_config);
  let res;
  try {
    res = await fetch(`${app.config.vercelUrl}${path}${qs}`, {
      method,
      headers: {
        Authorization: `Bearer ${app.config.apiKey}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(friendlyError(e?.message || e));
  }
  if (raw) {
    if (!res.ok) throw new Error(friendlyError(await errorText(res)));
    return res;
  }
  if (!res.ok) throw new Error(friendlyError(await errorText(res)));
  if (res.status === 204) return null;
  return res.json();
}

async function errorText(res) {
  try { const j = await res.json(); return j.error || `${res.status} ${res.statusText}`; }
  catch { return `${res.status} ${res.statusText}`; }
}

/** Profiles (committee accounts) from the backend. */
export async function fetchProfiles() {
  const list = await api('/api/meta', { query: { type: 'profiles' } });
  return Array.isArray(list) ? list : [];
}
