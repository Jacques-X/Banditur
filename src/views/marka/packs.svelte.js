// Installed watermark packs (see src-tauri/src/wm_pack.rs). A selection is
// "<pack-id>/<watermark-id>" and is remembered on this computer.

import { invoke } from '../../lib/tauri.js';
import { ls, toast } from '../../lib/app.svelte.js';
import { WM } from '../../strings.js';

const KEY = 'banditur_watermark';
export const marks = $state({ packs: [], selected: ls.get(KEY, ''), loaded: false });

export async function refreshPacks() {
  try {
    marks.packs = (await invoke('list_watermark_packs')) || [];
    const values = marks.packs.flatMap(p => p.watermarks.map(w => `${p.id}/${w.id}`));
    if (!values.includes(marks.selected)) marks.selected = values[0] || '';
  } catch (e) {
    console.error('list_watermark_packs failed:', e);
    toast(WM.load_failed, 'warn');
  }
  marks.loaded = true;
}

export function select(value) {
  marks.selected = value;
  ls.set(KEY, value);
}

export const markCount = () => marks.packs.reduce((n, p) => n + p.watermarks.length, 0);
