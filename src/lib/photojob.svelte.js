// Ritratti's two native steps (process_images for watermarks and sizes, convert_raw_batch for
// RAW → JPG) share the same Rust events (log, progress, done / raw-done), so only one runs at a
// time. A task can carry `next` steps (RAW → JPG, then the watermark) that start when it ends well.

import { updateStudioJob } from './studio-jobs.svelte.js';
import { app, toast, ls } from './app.svelte.js';
import { invoke, listen, baseName, notify } from './tauri.js';
import { ERR, TOOLS as T } from '../strings.js';
import { plural } from './format.js';

export const photoTasks = $state(
  ls.list('banditur_photo_tasks').map((t) => ({
    ...t,
    // Saved tasks are retried from these lists, so they must always be lists.
    completed: Array.isArray(t.completed) ? t.completed : [],
    failed: Array.isArray(t.failed) ? t.failed : [],
    state: ['queued', 'running'].includes(t.state) ? 'interrupted' : t.state,
  })),
);
let activeId = null;
let saveTimer = 0;
let lastSave = 0;
/** Writes the lane and the activity index now. Called on every state change (start, finish, cancel, retry). */
function persistTasks() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  lastSave = Date.now();
  for (const t of photoTasks)
    updateStudioJob(t.id, {
      kind: t.kind,
      name: t.name,
      state: t.state,
      path: t.outputDir || '',
      error: t.error || '',
    });
  ls.set('banditur_photo_tasks', JSON.stringify(photoTasks.slice(0, 30)));
}
/**
 * One `photo-file` event arrives per photo, and each save rewrites two lists
 * including every finished path. During a run, save at most once a second; the
 * end of the run saves for certain, and so does closing the window.
 */
function persistSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(persistTasks, Math.max(0, 1000 - (Date.now() - lastSave)));
}
if (typeof addEventListener === 'function') addEventListener('pagehide', () => saveTimer && persistTasks());
export const job = $state({
  kind: null, // 'marka' | 'raw'
  running: false,
  fraction: 0,
  log: [], // { tag, msg }
  status: '',
  outputDir: '',
  result: null, // { tone, title, detail }
  name: '',
});

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  listen('photo-file', (e) => {
    const t = photoTasks.find((t) => t.id === e.payload.id);
    if (!t) return;
    if (e.payload.ok) t.completed.push(e.payload.path);
    else t.failed.push(e.payload.path);
    persistSoon();
  });
  listen('log', (e) => {
    job.log.push(e.payload);
    if (job.log.length > 2000) job.log.splice(0, 500);
  });
  listen('progress', (e) => {
    job.fraction = e.payload.fraction;
    job.status = T.progress(Math.round(e.payload.fraction * 100));
  });
  listen('done', (e) => {
    const { processed, failed, duplicates = 0, blurry = 0, output_dir } = e.payload;
    finish(
      {
        tone: failed ? 'warn' : 'ok',
        title: T.done_wm(processed, failed, duplicates, blurry),
        detail: failed
          ? `${plural(failed, 'ritratt ma ġiex ipproċessat', 'ritratti ma ġewx ipproċessati')}. Ara l-log.`
          : [duplicates && plural(duplicates, 'duplikat tqabbeż', 'duplikati tqabbżu'), blurry && plural(blurry, 'ritratt mċajpar tqabbeż', 'ritratti mċajpra tqabbżu')].filter(Boolean).join(' · ') + (duplicates || blurry ? '.' : ''),
      },
      output_dir,
    );
  });
  listen('raw-done', (e) => {
    const { converted, skipped, output_dir } = e.payload;
    finish(
      {
        tone: skipped ? 'warn' : 'ok',
        title: T.done_arw(converted, skipped),
        detail: skipped ? `${plural(skipped, 'file ġie mqabbeż', 'files ġew mqabbża')} — ara l-log.` : '',
      },
      output_dir,
    );
  });
}

function finish(result, outputDir) {
  job.running = false;
  app.busy.photos = false;
  job.fraction = 1;
  job.outputDir = outputDir;
  job.result = result;
  job.status = result.title;
  notify(result.title, job.name);
  if (result.tone !== 'ok') toast(result.title + (result.detail ? ` ${result.detail}` : ''), 'warn');
}

/** Native photo events are serial; the lane prevents cross-job attribution. */
export function start(kind, cmd, args, next = []) {
  wire();
  const task = {
    id: crypto.randomUUID(),
    kind,
    cmd,
    args: JSON.parse(JSON.stringify(args)),
    state: 'queued',
    next: JSON.parse(JSON.stringify(next || [])),
    name: baseName(args.inputDir),
    completed: [],
    failed: [],
    at: Date.now(),
  };
  photoTasks.unshift(task);
  persistTasks();
  pump();
  return task.id;
}
async function pump() {
  if (activeId) return;
  const task = [...photoTasks].reverse().find((t) => t.state === 'queued');
  if (!task) return;
  activeId = task.id;
  task.state = 'running';
  persistTasks();
  Object.assign(job, {
    kind: task.kind,
    running: true,
    fraction: 0,
    log: [],
    status: T.starting,
    outputDir: '',
    result: null,
    name: task.name,
  });
  app.busy.photos = true;
  try {
    await invoke(task.cmd, { ...task.args, jobId: task.id });
    task.state = task.cancelled ? 'cancelled' : task.failed.length ? 'failed' : 'done';
    task.outputDir = job.outputDir;
    if (task.cancelled) {
      job.result = { tone: 'warn', title: 'Ikkanċellat · ir-riżultati lesti nżammu.' };
      job.status = job.result.title;
    }
  } catch (e) {
    task.state = 'failed';
    task.error = String(e);
    job.result = { tone: 'error', title: 'Ma rnexxiex.', detail: String(e) };
    toast(String(e), 'error');
  } finally {
    job.running = false;
    app.busy.photos = false;
    activeId = null;
    // The next step of the same run (e.g. watermark the JPGs just made from RAW).
    if (task.state === 'done' && task.next?.length) {
      const [n, ...rest] = task.next;
      task.next = [];
      start(n.kind, n.cmd, n.args, rest);
    }
    persistTasks();
    pump();
  }
}
export async function cancelTask(task) {
  if (task.state === 'queued') {
    task.state = 'cancelled';
    persistTasks();
    return;
  }
  if (task.id === activeId) {
    await invoke('cancel_photo_job', { id: task.id });
    task.cancelled = true;
  }
}
export async function retryTask(task) {
  let files = task.failed;
  if (task.state === 'interrupted' || task.state === 'cancelled' || (!files.length && task.error)) {
    const all = await invoke('list_media_files', { path: task.args.inputDir });
    files = all.filter((p) => !task.completed.includes(p));
  }
  if (!files.length) {
    toast('Ma hemmx files li jridu jerġgħu jiġu pproċessati.', 'info');
    return;
  }
  // Old persisted tasks may still carry the removed review lists; drop them.
  const { keepFiles, skipFiles, blurryFiles, ...args } = task.args;
  start(task.kind, task.cmd, {
    ...args,
    includeFiles: [...files],
    ...(task.kind === 'marka' ? { skipDuplicates: false, minSharpness: null } : {}),
  });
  task.state = 'retried';
  persistTasks();
}
export function ensureListening() {
  wire();
}
