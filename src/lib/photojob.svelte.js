// Marka & Ssortja and RAW → JPG share the same Rust events (log, progress,
// done / raw-done), so only one of them runs at a time. This keeps that one
// job's state for whichever screen is showing it.

import { updateStudioJob } from './studio-jobs.svelte.js';
import { app, toast, logJob, ls } from './app.svelte.js';
import { invoke, listen, baseName } from './tauri.js';
import { ERR, TOOLS as T } from '../strings.js';
import { plural } from './format.js';

export const photoTasks = $state(
  ls
    .json('banditur_photo_tasks', [])
    .map((t) => ({ ...t, state: ['queued', 'running'].includes(t.state) ? 'interrupted' : t.state })),
);
let activeId = null;
function persistTasks() {
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
    persistTasks();
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
    const { processed, failed, duplicates = 0, output_dir } = e.payload;
    finish(
      {
        tone: failed ? 'warn' : 'ok',
        title: T.done_wm(processed, failed, duplicates),
        detail: failed
          ? `${plural(failed, 'ritratt ma ġiex ipproċessat', 'ritratti ma ġewx ipproċessati')}. Ara l-log.`
          : duplicates
            ? `${plural(duplicates, 'duplikat tqabbeż', 'duplikati tqabbżu')}.`
            : '',
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
  logJob({
    tool: job.kind === 'raw' ? 'RAW → JPG' : 'Marka',
    name: job.name,
    status: result.title,
    tone: result.tone,
    path: outputDir,
  });
  if (result.tone !== 'ok') toast(result.title + (result.detail ? ` ${result.detail}` : ''), 'warn');
}

/** Native photo events are serial; the lane prevents cross-job attribution. */
export function start(kind, cmd, args) {
  wire();
  const task = {
    id: crypto.randomUUID(),
    kind,
    cmd,
    args: JSON.parse(JSON.stringify(args)),
    state: 'queued',
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
  start(task.kind, task.cmd, {
    ...task.args,
    includeFiles: [...files],
    ...(task.kind === 'marka' ? { skipDuplicates: false } : {}),
  });
  task.state = 'retried';
  persistTasks();
}
export function ensureListening() {
  wire();
}
