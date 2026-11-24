// Whether Xogħol and Kalendarju are kept on this Mac (the default) or shared with the committee
// through the backend (api/tasks.js, api/events.js). Switched in Settings → Sharing. Turning
// sharing on can first copy this Mac's boards or events up (they keep their ids); turning it off
// goes back to the Mac's own copy, which sharing never changes.
import { ls } from './app.svelte.js';

const KEYS = { xoghol: 'banditur_share_xoghol', calendar: 'banditur_share_calendar' };

export const sharing = $state({
  xoghol: ls.get(KEYS.xoghol, '') === '1',
  calendar: ls.get(KEYS.calendar, '') === '1',
});

export function setSharing(kind, on) {
  sharing[kind] = !!on;
  ls.set(KEYS[kind], on ? '1' : '0');
}
