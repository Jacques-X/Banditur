// Small cached index; native JSON records are the durable source of truth.
import { invoke, isTauri, openDialog, saveDialog } from './tauri.js';
export const projects = $state({ items: [], loaded: false, error: '' });
let pending = Promise.resolve();
export async function loadProjects() {
  try {
    projects.items = isTauri
      ? await invoke('list_projects')
      : JSON.parse(localStorage.getItem('banditur_projects') || '[]');
    projects.loaded = true;
    projects.error = '';
  } catch (e) {
    projects.error = String(e);
  }
}
export function saveProject(project) {
  const record = JSON.parse(JSON.stringify({ ...project, version: 1, savedAt: Date.now() }));
  // Serialise disk writes so an older autosave cannot win a race with a new one.
  const write = pending
    .catch(() => {})
    .then(async () => {
      if (isTauri) await invoke('save_project', { project: record });
      const items = [record, ...projects.items.filter((p) => p.id !== record.id)];
      if (!isTauri) localStorage.setItem('banditur_projects', JSON.stringify(items));
      projects.items = items;
      projects.error = '';
      return record;
    });
  pending = write;
  return write.catch((e) => {
    projects.error = String(e);
    throw e;
  });
}
export async function removeProject(id) {
  await pending.catch(() => {});
  if (isTauri) await invoke('delete_project', { id });
  projects.items = projects.items.filter((p) => p.id !== id);
  if (!isTauri) localStorage.setItem('banditur_projects', JSON.stringify(projects.items));
}
export async function exportProject(project, includeMedia = false) {
  await pending;
  const path = await saveDialog({
    defaultPath: `${project.name || 'Proġett'}.banditur`,
    filters: [{ name: 'Banditur', extensions: ['banditur'] }],
  });
  if (path)
    await invoke('export_project', { project: JSON.parse(JSON.stringify(project)), path, includeMedia });
}
export async function importProject() {
  const path = await openDialog({ filters: [{ name: 'Banditur', extensions: ['banditur'] }] });
  if (!path) return null;
  const project = await invoke('import_project', { path });
  await loadProjects();
  return project;
}
export const eventWork = $state({ id: '', name: '' });
export function useEvent(id, name = '') {
  eventWork.id = id || '';
  eventWork.name = name;
}
