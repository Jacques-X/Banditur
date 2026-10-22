// Marka & Ssortja and RAW → JPG share the same Rust events (log, progress,
// done / raw-done), so only one of them runs at a time. This keeps that one
// job's state for whichever screen is showing it.

import { app, toast, logJob } from './app.svelte.js';
import { invoke, listen, baseName } from './tauri.js';
import { ERR, TOOLS as T } from '../strings.js';
import { plural } from './format.js';

export const job = $state({
  kind: null,          // 'marka' | 'raw'
  running: false,
  fraction: 0,
  log: [],             // { tag, msg }
  status: '',
  outputDir: '',
  result: null,        // { tone, title, detail }
  name: '',
});

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  listen('log', e => { job.log.push(e.payload); if (job.log.length > 2000) job.log.splice(0, 500); });
  listen('progress', e => { job.fraction = e.payload.fraction; job.status = T.progress(Math.round(e.payload.fraction * 100)); });
  listen('done', e => {
    const { processed, failed, duplicates = 0, output_dir } = e.payload;
    finish({
      tone: failed ? 'warn' : 'ok',
      title: T.done_wm(processed, failed, duplicates),
      detail: failed ? `${plural(failed, 'ritratt ma ġiex ipproċessat', 'ritratti ma ġewx ipproċessati')}. Ara l-log.` : duplicates ? `${plural(duplicates, 'duplikat tqabbeż', 'duplikati tqabbżu')}.` : '',
    }, output_dir);
  });
  listen('raw-done', e => {
    const { converted, skipped, output_dir } = e.payload;
    finish({
      tone: skipped ? 'warn' : 'ok',
      title: T.done_arw(converted, skipped),
      detail: skipped ? `${plural(skipped, 'file ġie mqabbeż', 'files ġew mqabbża')} — ara l-log.` : '',
    }, output_dir);
  });
}

function finish(result, outputDir) {
  job.running = false;
  app.busy.photos = false;
  job.fraction = 1;
  job.outputDir = outputDir;
  job.result = result;
  job.status = result.title;
  logJob({ tool: job.kind === 'raw' ? 'RAW → JPG' : 'Marka', name: job.name, status: result.title, tone: result.tone, path: outputDir });
  if (result.tone !== 'ok') toast(result.title + (result.detail ? ` ${result.detail}` : ''), 'warn');
}

/** Start a run. `cmd` is the Tauri command, `args` its arguments. */
export async function start(kind, cmd, args) {
  wire();
  if (job.running) { toast('Diġà hemm xogħol għaddej. Stenna li jispiċċa.', 'warn'); return; }
  Object.assign(job, { kind, running: true, fraction: 0, log: [], status: T.starting, outputDir: '', result: null, name: baseName(args.inputDir) });
  app.busy.photos = true;
  try {
    await invoke(cmd, args);
  } catch (e) {
    job.running = false;
    app.busy.photos = false;
    job.log.push({ tag: 'error', msg: ERR.fatal(e) });
    job.result = { tone: 'error', title: 'Ma rnexxiex.', detail: String(e) };
    job.status = T.error_log;
  }
}

export function ensureListening() { wire(); }
