// Delete now, offer Undo in the toast, instead of asking first.
// For data kept in one localStorage key: the key's value before the change is put back,
// but only if nothing else changed it since (otherwise Undo would also throw that away).
import { toast } from './app.svelte.js';

export async function withUndo(key, message, change, reload) {
  let before;
  try { before = localStorage.getItem(key); } catch { return change(); }
  await change();
  const after = localStorage.getItem(key);
  if (after === before) return;
  toast(message, 'ok', {
    label: 'Undo',
    onClick: async () => {
      try {
        if (localStorage.getItem(key) !== after) { toast("Saru bidliet oħra wara, għalhekk ma jistax jerġa' lura.", 'warn'); return; }
        localStorage.setItem(key, before);
        await reload?.();
      } catch (e) { toast(e.message, 'error'); }
    },
  });
}
