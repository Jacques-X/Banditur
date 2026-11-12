// Calls to the Banditur cloud backend (backend/api/*, on Vercel).

import { app, configured } from './app.svelte.js';
import { isMock } from './tauri.js';
import { friendlyError, ERR } from '../strings.js';

let mockFetch = null;
export function setMockFetch(fn) { mockFetch = fn; }

/** A request that gets no answer is given up after this long, so no screen waits for ever. */
const TIMEOUT_MS = 90000;

async function failure(res) {
  const error = new Error(friendlyError(await errorText(res)));
  error.status = res.status;
  return error;
}

/**
 * api('/api/history', { query, method, body, raw, timeout }) → parsed JSON (or Response with raw).
 * Throws an Error whose message is already readable Maltese; `error.status` is the
 * HTTP status when the server answered, and missing when it did not (offline, timed out).
 */
export async function api(path, { query, method = 'GET', body, raw = false, headers = {}, timeout = TIMEOUT_MS } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  if (isMock() && mockFetch) return mockFetch(path + qs, { method, body });
  if (!configured()) throw new Error(ERR.vercel_config);
  const controller = new AbortController();
  const timer = timeout ? setTimeout(() => controller.abort(), timeout) : 0;
  try {
    let res;
    try {
      res = await fetch(`${app.config.vercelUrl}${path}${qs}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${app.config.apiKey}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error(friendlyError(controller.signal.aborted ? 'Request timed out' : e?.message || e));
    }
    if (!res.ok) throw await failure(res);
    // A raw response is read by the caller (a file download): the time limit covers only the wait for it.
    if (raw) return res;
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch {
      // Not JSON: usually a wrong Backend URL answering with a web page, or a cut-off reply.
      throw new Error(friendlyError(controller.signal.aborted ? 'Request timed out' : 'Is-server bagħat tweġiba li ma tinqarax. Iċċekkja l-Backend URL fis-Settings.'));
    }
  } finally {
    clearTimeout(timer);
  }
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
