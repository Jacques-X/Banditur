// Pure helpers for the in-app update (lib/updates.svelte.js holds the state, views/Settings.svelte the card).
// `status` is what the Rust command `update_status` returns (src-tauri/src/source_update.rs).
import { UPD } from '../strings.js';

/** Re-check GitHub this often while the app is open. */
export const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;

/** Why an update must not start now ('' when it may): work in a tool lane or an Arkivju upload is running. */
export function busyReason(busy = {}, jobs = []) {
  if (Object.values(busy).some(Boolean)) return UPD.busy_work;
  if (jobs.some((j) => j?.state === 'running')) return UPD.busy_work;
  return '';
}

/** Is there something to tell the user about (dot on the Settings button)? */
export function needsAttention(status) {
  if (!status?.configured || status.building) return false;
  return (status.behind || 0) > 0 || !!status.pending;
}

/**
 * The one state the card shows, most important first:
 * unconfigured | running | building | error | dirty | diverged | behind | pending | current
 */
export function updateState(status, { running = false } = {}) {
  if (running) return 'running';
  if (!status?.configured) return 'unconfigured';
  if (status.building) return 'building';
  if (status.error) return 'error';
  if (status.dirty) return 'dirty';
  if ((status.ahead || 0) > 0 && (status.behind || 0) > 0) return 'diverged';
  if ((status.behind || 0) > 0) return 'behind';
  if (status.pending) return 'pending';
  return 'current';
}

/** The state line, plus a second line when GitHub could not be reached. → string[] */
export function stateLines(status, { running = false } = {}) {
  const st = updateState(status, { running });
  const main = {
    unconfigured: UPD.not_set_up,
    running: UPD.building,
    building: UPD.building,
    error: status?.error || UPD.no_upstream,
    dirty: UPD.dirty,
    diverged: UPD.diverged,
    behind: UPD.changes(status?.behind || 0),
    pending: UPD.pending,
    current: UPD.up_to_date,
  }[st];
  const out = [main];
  if (status?.configured && status.fetchError) out.push(UPD.offline);
  return out;
}

/** The Aġġorna button: { label, disabled, reason }. A reason is shown beside a disabled button. */
export function buttonState(status, { running = false, checking = false, busy = '' } = {}) {
  const st = updateState(status, { running });
  const label = running ? UPD.updating : UPD.update;
  if (running) return { label, disabled: true, reason: '' };
  if (checking) return { label, disabled: true, reason: '' };
  if (st === 'unconfigured' || st === 'error') return { label, disabled: true, reason: '' };
  if (st === 'building') return { label, disabled: true, reason: UPD.busy_update };
  if (st === 'dirty') return { label, disabled: true, reason: UPD.dirty };
  if (st === 'diverged') return { label, disabled: true, reason: UPD.diverged };
  if (busy) return { label, disabled: true, reason: busy };
  // With nothing waiting the button still works: it pulls and says "already up to date".
  return { label, disabled: false, reason: '' };
}

/** `update-result.json` / the update://done payload → { type: 'ok' | 'error', msg, detail } for a toast or notice. */
export function resultNotice(result, { ui = false } = {}) {
  if (!result || typeof result !== 'object') return null;
  if (result.ok) return { type: 'ok', msg: (ui ? UPD.done_ok_ui : UPD.done_ok)(result.head || ''), detail: '' };
  return { type: 'error', msg: UPD.done_bad(String(result.error || '?')), detail: String(result.logTail || '') };
}

/** One waiting commit as a line: "a1b2c3d  Fix the calendar". */
export const commitLine = (c) => `${c?.hash ?? ''}  ${c?.subject ?? ''}`.trim();

/** What the app does after `update_pull` says which pieces changed: 'none' | 'restart' | 'background'. */
export function nextStep(plan) {
  if (!plan || !plan.work) return 'none';
  return plan.core ? 'restart' : 'background';
}
