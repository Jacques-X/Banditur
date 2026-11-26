// Updates from GitHub (see src-tauri/src/source_update.rs and scripts/update.mjs).
// `checkUpdates()` asks the app how far this Mac's clone is behind its upstream; `startUpdate()` pulls it and
// either builds in the background (no quit) or hands over to a helper that quits, builds and reopens the app.
// The pure decisions are in updates.js.
import { app, confirm, toast, openSettings } from './app.svelte.js';
import { arch } from './archive.svelte.js';
import { invoke, listen, isTauri, isMock } from './tauri.js';
import { everyVisible } from './visible.js';
import { friendlyError, UPD } from '../strings.js';
import { CHECK_EVERY_MS, busyReason, nextStep, resultNotice } from './updates.js';

export const upd = $state({
  status: null,     // update_status, or null before the first answer / outside the app
  checking: false,
  running: false,   // an update started from here is in progress
  progress: '',
  error: null,      // { msg, detail } of the last failure, shown in Settings
});

let plan = null;        // what the running update touches (update_pull)
let shownLast = false;  // the previous run's result is shown once per launch

const available = () => isTauri || isMock();

export const busyNow = () => busyReason(app.busy, arch.jobs);

export async function checkUpdates() {
  if (!available() || upd.checking || upd.running) return;
  upd.checking = true;
  try {
    upd.status = await invoke('update_status');
    if (!shownLast) { shownLast = true; await showLastResult(upd.status); }
  } catch (e) {
    // Not fatal: the card keeps what it had. A failed check is not worth a toast.
    console.warn('update_status', e);
  } finally {
    upd.checking = false;
  }
}

/** The result left by the previous update (e.g. before a restart): shown once, then forgotten. */
async function showLastResult(status) {
  const n = resultNotice(status?.lastResult);
  if (!n || status.building) return;
  if (n.type === 'ok') toast(n.msg, 'ok');
  else {
    upd.error = { msg: n.msg, detail: n.detail };
    toast(n.msg, 'error', { label: 'Ara', onClick: () => openSettings('aggornamenti') });
  }
  try { await invoke('update_clear_result'); } catch { /* it is shown; leaving the file is harmless */ }
}

async function onDone(result) {
  const ui = !!plan?.ui;
  const n = resultNotice(result, { ui });
  upd.running = false;
  upd.progress = '';
  if (n?.type === 'ok') {
    if (ui) {
      // The new interface shows after the reload; the result file stays so it says so once (showLastResult).
      try { await invoke('reload_interface'); if (!isMock()) return; } catch { /* fall through: say it here */ }
    }
    toast(n.msg, 'ok');
  } else {
    const msg = n?.msg || UPD.done_bad('?');
    upd.error = { msg, detail: n?.detail || '' };
    toast(msg, 'error', { label: 'Ara', onClick: () => openSettings('aggornamenti') });
  }
  try { await invoke('update_clear_result'); } catch { /* ignore */ }
  plan = null;
  await checkUpdates();
}

export async function startUpdate() {
  if (!available() || upd.running) return;
  const reason = busyNow();
  if (reason) { toast(reason, 'warn'); return; }
  upd.error = null;
  upd.running = true;
  upd.progress = UPD.updating;
  try {
    plan = await invoke('update_pull');
    const step = nextStep(plan);
    if (step === 'none') {
      upd.running = false; upd.progress = '';
      toast(UPD.up_to_date_toast, 'ok');
      upd.checking = false;
      await checkUpdates();
      return;
    }
    if (step === 'restart') {
      if (!await confirm(UPD.confirm_core, { yes: UPD.confirm_yes, no: UPD.confirm_no, danger: true })) {
        upd.running = false; upd.progress = '';
        await checkUpdates(); // the code is pulled: the card now says "built but not installed"
        return;
      }
      upd.progress = UPD.restarting;
      await invoke('update_and_restart'); // the app quits a moment later; `running` stays on
      return;
    }
    await invoke('update_run_background'); // update://done reports the end
  } catch (e) {
    upd.running = false; upd.progress = '';
    const msg = friendlyError(e?.message || e);
    upd.error = { msg, detail: '' };
    toast(msg, 'error');
  }
}

/** Start checking: now, and every 3 hours while the window is visible. Listens for the end of a background update. → stop() */
export function startUpdateChecks() {
  if (!available()) return () => {};
  let unlisten = () => {};
  let stopped = false;
  listen('update://done', (e) => onDone(e.payload)).then((u) => { if (stopped) u(); else unlisten = u; }).catch(() => {});
  checkUpdates();
  const stopTimer = everyVisible(checkUpdates, CHECK_EVERY_MS);
  return () => { stopped = true; unlisten(); stopTimer(); };
}
