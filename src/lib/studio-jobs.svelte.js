// Common activity index for the native lanes; command owners keep their own UI.
import { eventWork } from './projects.svelte.js';
import { ls } from './app.svelte.js';
export const studioJobs = $state(
  ls
    .json('banditur_studio_jobs', [])
    .map((j) => ({ ...j, state: ['running', 'queued'].includes(j.state) ? 'interrupted' : j.state })),
);
export function updateStudioJob(id, patch) {
  let j = studioJobs.find((j) => j.id === id);
  if (j) Object.assign(j, patch);
  else studioJobs.unshift({ id, at: Date.now(), eventId: eventWork.id, ...patch });
  studioJobs.splice(40);
  ls.set('banditur_studio_jobs', JSON.stringify(studioJobs));
}
