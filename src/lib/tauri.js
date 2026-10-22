// Thin wrappers around the Tauri APIs. Outside Tauri (a plain browser, e.g.
// `npm run dev` + http://127.0.0.1:5173/?mock) the calls go to the dev mock in
// lib/mock.js instead, so every screen can be opened and checked in a browser.

import { invoke as tInvoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen as tListen } from '@tauri-apps/api/event';
import { open as tOpen, save as tSave } from '@tauri-apps/plugin-dialog';
import { openPath as tOpenPath, openUrl as tOpenUrl } from '@tauri-apps/plugin-opener';
import { getVersion as tGetVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let mock = null;
/** Installed by lib/mock.js in dev builds only. */
export function setMock(m) { mock = m; }
export const isMock = () => !!mock;

export async function invoke(cmd, args) {
  if (isTauri) return tInvoke(cmd, args);
  if (mock) return mock.invoke(cmd, args);
  throw new Error(`"${cmd}" jaħdem biss fl-app tal-Banditur.`);
}

/** listen(event, handler) → Promise<unlisten> */
export async function listen(event, handler) {
  if (isTauri) return tListen(event, handler);
  if (mock) return mock.listen(event, handler);
  return () => {};
}

export const fileSrc = path => (isTauri ? convertFileSrc(path) : (mock?.fileSrc?.(path) ?? path));

export async function openDialog(opts) {
  if (isTauri) return tOpen(opts);
  return mock?.openDialog?.(opts) ?? null;
}
export async function saveDialog(opts) {
  if (isTauri) return tSave(opts);
  return mock?.saveDialog?.(opts) ?? null;
}
export async function openPath(path) {
  if (isTauri) return tOpenPath(path);
  console.info('[mock] openPath', path);
}
export async function openUrl(url) {
  if (isTauri) return tOpenUrl(url);
  window.open(url, '_blank', 'noopener');
}
export async function getVersion() {
  if (isTauri) return tGetVersion();
  return mock ? '1.0.1' : '0.0.0';
}

/** Desktop updater (only in Tauri). */
export async function checkForUpdate(opts) {
  if (!isTauri) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  return check(opts);
}

/** Native file drag & drop over the window: handler({ type, paths }). */
export function onDragDrop(handler) {
  if (!isTauri) return () => {};
  let un = () => {};
  try {
    getCurrentWindow().onDragDropEvent(e => handler(e.payload)).then(u => { un = u; }).catch(() => {});
  } catch { /* not available */ }
  return () => un();
}

/** Ask before the window closes while `busy()` is true. */
export function guardClose(busy, ask) {
  if (!isTauri) return;
  try {
    const win = getCurrentWindow();
    win.onCloseRequested(async ev => {
      if (!busy()) return;
      ev.preventDefault();
      if (await ask()) await win.destroy();
    });
  } catch { /* not available */ }
}

/** Read a local file (picked or dropped) into a File object. */
export async function fileFromPath(path, type = '') {
  const res = await fetch(fileSrc(path));
  if (!res.ok) throw new Error(`Ma stajtx naqra ${baseName(path)}`);
  const blob = await res.blob();
  return new File([blob], baseName(path), { type: type || blob.type });
}

export const baseName = p => String(p || '').split(/[\\/]/).pop();
