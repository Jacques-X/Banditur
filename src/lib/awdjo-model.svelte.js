// The Awdjo model (NVIDIA RE-USE weights) on this Mac: is it downloaded, download it, remove it.
// One shared state for the Awdjo screen and Settings → Components; the files and the download are native (src-tauri/src/awdjo.rs).
import { invoke, listen } from './tauri.js';
import { friendlyError } from '../strings.js';

export const awdjoModel = $state({ known: false, installed: false, bytes: 0, dir: '', downloading: false, pct: 0, error: '' });

export async function refreshAwdjoModel() {
  try {
    const s = await invoke('awdjo_model_status');
    Object.assign(awdjoModel, { known: true, installed: !!s?.installed, bytes: s?.bytes || 0, dir: s?.dir || '' });
  } catch { awdjoModel.known = true; }
}

let listening = false;
function listenOnce() {
  if (listening) return;
  listening = true;
  listen('awdjo-model', (e) => {
    const d = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
    if (d?.type === 'progress') awdjoModel.pct = Math.round(d.value);
  });
}

/** Download the model. Resolves true when it is installed, false (with `awdjoModel.error`) when not. */
export async function downloadAwdjoModel() {
  if (awdjoModel.downloading) return false;
  listenOnce();
  Object.assign(awdjoModel, { downloading: true, pct: 0, error: '' });
  try {
    await invoke('awdjo_model_download');
    await refreshAwdjoModel();
    return awdjoModel.installed;
  } catch (e) {
    awdjoModel.error = friendlyError(String(e?.message || e));
    return false;
  } finally {
    awdjoModel.downloading = false;
  }
}

export async function removeAwdjoModel() {
  try {
    await invoke('awdjo_model_remove');
    await refreshAwdjoModel();
    return true;
  } catch (e) {
    awdjoModel.error = friendlyError(String(e?.message || e));
    return false;
  }
}

export const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
