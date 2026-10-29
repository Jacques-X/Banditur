// The post being written in Skeda: form state, media, autosave, drafts and
// the schedule flow (upload → reachability check → POST /api/schedule).

import { matchesSubmission } from '../../../backend/api/_lib/post-rules.js';
import { app, configured, ls, toast, confirm } from '../../lib/app.svelte.js';
import { api } from '../../lib/api.js';
import { isMock } from '../../lib/tauri.js';
import { refreshCounts } from '../../lib/queue.svelte.js';
import { maltaInstant, schedulePreset } from '../../lib/malta-time.js';
import { eventWork } from '../../lib/projects.svelte.js';
import { toLocalInput } from '../../lib/format.js';
import { platformById, defaultPlatformIds, captionLimitFor, platformProblem } from '../../platforms.js';
import { saveMedia, loadMedia, deleteMedia } from '../../media-store.js';
import { ERR, SCHED, TOAST, CONFIRM } from '../../strings.js';

export const MAX_POST_MEDIA = 10;
const AUTOSAVE_KEY = 'banditur_autosave';
const DRAFT_KEY = 'banditur_drafts';

function defaultTime() {
  return schedulePreset('pm');
}

export const post = $state({
  caption: '',
  contentType: 'post', // post | reel | story
  platforms: defaultPlatformIds(),
  scheduledTime: defaultTime(), // datetime-local value (Malta time)
  expiryTime: '',
  media: [], // File[]
  requestId: crypto.randomUUID(),
  editId: '',
  revision: 0,
  remoteMedia: [],
  eventId: '',
  category: '',
  retentionDays: 30,
  pinned: false,
  pendingBody: null,
});

export const ui = $state({
  status: null, // { msg, tone: info|ok|warn|error }
  busy: false,
  savedAt: null, // Date of last autosave
  dirty: false,
  drafts: ls.json(DRAFT_KEY, []),
  lastScheduled: null, // { form, files } for "Erġa' uża dan il-post"
});

export const captionLimit = () => captionLimitFor(post.platforms);
const typeName = (t) => (t === 'reel' ? 'Reel' : t === 'story' ? 'Story' : 'Post');

// ── Media ──────────────────────────────────────────────────────────────────
const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
};
export function normalizeMime(type = '', name = '') {
  const m = String(type || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (m.startsWith('image/') || m.startsWith('video/')) return m;
  return MIME_BY_EXT[String(name).split('.').pop()?.toLowerCase()] || '';
}
const withMime = (f) => {
  const type = normalizeMime(f.type, f.name);
  return type && type !== f.type ? new File([f], f.name, { type }) : f;
};

/** Add files, respecting what the content type allows. Returns how many were added. */
export function addMedia(files) {
  const limit = post.contentType === 'post' ? MAX_POST_MEDIA : 1;
  let bad = 0,
    over = 0,
    notVideo = 0,
    added = 0;
  for (const raw of files) {
    const f = withMime(raw);
    if (!normalizeMime(f.type, f.name)) {
      bad++;
      continue;
    }
    if (post.contentType === 'reel' && !f.type.startsWith('video/')) {
      notVideo++;
      continue;
    }
    if (post.media.length + post.remoteMedia.length >= limit) {
      over++;
      continue;
    }
    post.media.push(f);
    added++;
  }
  const notes = [];
  if (bad)
    notes.push(
      `${bad} ${bad === 1 ? 'file mhux supportat' : 'files mhux supportati'} (JPG, PNG jew MP4 biss)`,
    );
  if (notVideo) notes.push("Reel jaqbel ma' video biss");
  if (over)
    notes.push(
      post.contentType === 'post'
        ? `l-massimu huwa ${limit} ritratti`
        : `${typeName(post.contentType)} tiħu file wieħed biss`,
    );
  if (notes.length) toast(`Ma żdidx kollox: ${notes.join('; ')}.`, 'warn');
  if (added) changed();
  return added;
}
export function removeMedia(i) {
  post.media.splice(i, 1);
  changed();
}
export function moveMedia(from, to) {
  if (to < 0 || to >= post.media.length) return;
  const [f] = post.media.splice(from, 1);
  post.media.splice(to, 0, f);
  changed();
}

/** Why the media doesn't fit the content type ('' if fine). */
export function mediaProblem() {
  const all = [...post.media, ...post.remoteMedia];
  const n = all.length;
  if (post.contentType === 'reel' && n && (n !== 1 || !all[0].type.startsWith('video/')))
    return 'Reel jeħtieġ video wieħed biss. Neħħi l-bqija tal-media.';
  if (post.contentType === 'story' && n > 1) return 'Story tiħu medjum wieħed biss. Neħħi l-bqija tal-media.';
  if (post.contentType === 'post' && n > MAX_POST_MEDIA)
    return `Post jiħu sa ${MAX_POST_MEDIA} ritratti. Neħħi ${n - MAX_POST_MEDIA}.`;
  return '';
}
export const problems = () =>
  mediaProblem() || platformProblem(post.platforms, post.contentType, [...post.media, ...post.remoteMedia]);

export function togglePlatform(id) {
  if (!platformById(id)?.available) return;
  const i = post.platforms.indexOf(id);
  if (i >= 0) post.platforms.splice(i, 1);
  else post.platforms.push(id);
  changed();
}
export const needsExpiry = () => post.platforms.some((id) => platformById(id)?.fields?.includes('expiry'));

// ── Autosave + drafts ──────────────────────────────────────────────────────
let timer = 0;
export function changed() {
  ui.dirty = true;
  clearTimeout(timer);
  timer = setTimeout(autosave, 1500);
}
let saveGeneration = 0;
let saving = Promise.resolve();
export function autosave() {
  clearTimeout(timer);
  const generation = ++saveGeneration,
    form = formState(),
    files = [...post.media];
  saving = saving
    .catch(() => {})
    .then(async () => {
      const ok = await saveMedia('autosave', files);
      if (!ok) throw new Error('Il-media ma ġietx issejvjata. Żomm l-app miftuħa u erġa’ pprova.');
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(form));
      if (generation === saveGeneration) {
        ui.savedAt = new Date();
        ui.dirty = false;
      }
      return true;
    })
    .catch((e) => {
      ui.dirty = true;
      setStatus(e.message, 'error');
      return false;
    });
  return saving;
}
export function formState() {
  return {
    pendingBody: post.pendingBody,
    requestId: post.requestId,
    editId: post.editId,
    revision: post.revision,
    remoteMedia: [...post.remoteMedia],
    eventId: post.eventId,
    category: post.category,
    retentionDays: post.retentionDays,
    pinned: post.pinned,
    caption: post.caption,
    contentType: post.contentType,
    profileId: app.profileId,
    platforms: [...post.platforms],
    scheduledTime: post.scheduledTime,
    expiryTime: post.expiryTime,
    savedAt: new Date().toISOString(),
  };
}
export function applyState(d, files = []) {
  post.pendingBody = d.pendingBody || null;
  post.requestId = d.requestId || crypto.randomUUID();
  post.editId = d.editId || '';
  post.revision = d.revision || 0;
  post.remoteMedia = d.remoteMedia || [];
  post.eventId = d.eventId || '';
  post.category = d.category || '';
  post.retentionDays = d.retentionDays || 30;
  post.pinned = !!d.pinned;
  post.caption = d.caption || '';
  post.contentType = d.contentType || 'post';
  post.platforms = (d.platforms || []).filter((id) => platformById(id)?.available);
  post.scheduledTime = d.scheduledTime || defaultTime();
  post.expiryTime = d.expiryTime || '';
  if (d.profileId && app.profiles.some((p) => p.id === d.profileId)) app.profileId = d.profileId;
  post.media = [...files];
}
export async function restoreAutosave() {
  const saved = ls.json(AUTOSAVE_KEY, null);
  if (!saved) return;
  applyState(saved, []);
  ui.savedAt = saved.savedAt ? new Date(saved.savedAt) : null;
  const files = await loadMedia('autosave');
  if (files.length && !post.media.length) post.media = files;
}
export function reset() {
  clearTimeout(timer);
  saveGeneration++;
  post.pendingBody = null;
  post.requestId = crypto.randomUUID();
  post.editId = '';
  post.revision = 0;
  post.remoteMedia = [];
  post.eventId = eventWork.id;
  post.category = '';
  post.retentionDays = 30;
  post.pinned = false;
  post.caption = '';
  post.contentType = 'post';
  post.platforms = defaultPlatformIds();
  post.scheduledTime = defaultTime();
  post.expiryTime = '';
  post.media = [];
  ui.status = null;
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
  saving = saving
    .catch(() => {})
    .then(async () => {
      localStorage.removeItem(AUTOSAVE_KEY);
      await deleteMedia('autosave');
    });
  ui.savedAt = new Date();
  ui.dirty = false;
}
export async function confirmReset() {
  if (await confirm(CONFIRM.reset_form, { yes: 'Ibda mill-ġdid', no: 'Ikkanċella', danger: true })) reset();
}

export async function saveDraft() {
  const d = formState();
  d.id = `d-${crypto.randomUUID()}`;
  const ok = await saveMedia(`draft:${d.id}`, [...post.media]);
  if (!ok) throw new Error('Id-draft ma setax iżomm il-media. Erġa’ pprova.');
  d.mediaCount = post.media.length;
  const drafts = [d, ...ui.drafts];
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  } catch (e) {
    await deleteMedia(`draft:${d.id}`);
    throw e;
  }
  ui.drafts = drafts;
  return d;
}
export async function openDraft(d) {
  const files = d.id && d.mediaCount ? await loadMedia(`draft:${d.id}`) : [];
  applyState(d, files);
  autosave();
  if (d.mediaCount && !files.length)
    toast("Il-media ta' dan id-draft ma setgħetx tinġieb. Erġa' żidha.", 'warn');
}
export function deleteDraft(d) {
  const i = ui.drafts.findIndex((x) => x === d || (x.id && x.id === d.id));
  if (i < 0) return;
  ui.drafts.splice(i, 1);
  if (d.id) deleteMedia(`draft:${d.id}`);
  localStorage.setItem(DRAFT_KEY, JSON.stringify(ui.drafts));
}

// ── Schedule ───────────────────────────────────────────────────────────────
const setStatus = (msg, tone = 'info') => {
  ui.status = msg ? { msg, tone } : null;
};

async function upload(files) {
  if (isMock()) return files.map((f, i) => ({ url: `mock://${f.name}`, path: `mock/${i}`, type: f.type }));
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(app.config.supabaseUrl, app.config.supabaseKey);
  // A path-scoped signed-upload token from the backend (see backend/api/media.js).
  async function one(file) {
    const { path, token, publicUrl } = await api('/api/media', {
      method: 'POST',
      query: { action: 'sign-upload' },
      body: { contentType: file.type },
    });
    const { error } = await sb.storage
      .from('media')
      .uploadToSignedUrl(path, token, file, { contentType: file.type });
    if (error) throw new Error(`Upload: ${error.message}`);
    return { url: publicUrl, path, type: file.type };
  }
  const settled = await Promise.allSettled(files.map(one));
  const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = settled.find((r) => r.status === 'rejected');
  if (failed) {
    const err = new Error(failed.reason?.message || 'Upload falla.');
    err.partial = ok;
    throw err;
  }
  return ok;
}

async function unreachable(media) {
  const urls = media.map((m) => m.url).filter(Boolean);
  if (!urls.length || isMock()) return [];
  try {
    const { results } = await api('/api/media', {
      method: 'POST',
      query: { action: 'check' },
      body: { urls },
    });
    return (results || []).filter((r) => !r.ok).map((r) => r.url);
  } catch {
    return [];
  } // the check is a best-effort early warning
}

async function cleanup(media) {
  const paths = media.map((m) => m.path).filter(Boolean);
  if (!paths.length || isMock()) return;
  await api('/api/meta', { method: 'POST', body: { action: 'cleanup', paths } }).catch(() => {});
}

/** Validate and schedule. Returns true on success. */
export async function schedule() {
  if (ui.busy) return false;
  if (!navigator.onLine) {
    try {
      await saveDraft();
    } catch (e) {
      setStatus(e.message, 'error');
      return false;
    }
    setStatus(TOAST.offline, 'warn');
    return false;
  }
  if (!configured() && !isMock()) {
    setStatus(ERR.vercel_config, 'error');
    return false;
  }

  const caption = post.caption.trim();
  if (post.contentType === 'post' && !caption && !post.media.length && !post.remoteMedia.length) {
    setStatus(ERR.no_caption, 'error');
    return false;
  }
  const limit = captionLimit();
  if (caption.length > limit) {
    setStatus(ERR.caption_too_long(limit), 'error');
    return false;
  }
  if (post.contentType !== 'post' && !post.media.length && !post.remoteMedia.length) {
    setStatus(`${typeName(post.contentType)} teħtieġ medjum.`, 'error');
    return false;
  }
  const fit = mediaProblem();
  if (fit) {
    setStatus(fit, 'error');
    return false;
  }
  if (!post.platforms.length) {
    setStatus(ERR.no_platform, 'error');
    return false;
  }
  const plat = platformProblem(post.platforms, post.contentType, [...post.media, ...post.remoteMedia]);
  if (plat) {
    setStatus(plat, 'error');
    return false;
  }
  if (!post.scheduledTime) {
    setStatus(ERR.no_time, 'error');
    return false;
  }
  let scheduledISO;
  try {
    scheduledISO = maltaInstant(post.scheduledTime);
  } catch (e) {
    setStatus(e.message, 'error');
    return false;
  }
  if (new Date(scheduledISO).getTime() < Date.now() - 60000) {
    const go = await confirm(CONFIRM.past_time, { yes: 'Ippubblika issa', no: 'Biddel il-ħin' });
    if (!go) return false;
  }

  const profileId = app.profileId;
  ui.busy = true;
  let submitted = false;
  let uploaded = [];
  try {
    let media = [...post.remoteMedia];
    if (post.media.length) {
      if (!isMock() && (!app.config.supabaseUrl || !app.config.supabaseKey))
        throw new Error(ERR.supabase_config);
      setStatus(SCHED.uploading);
      try {
        uploaded = await upload(post.media);
        media.push(...uploaded);
      } catch (e) {
        uploaded = e.partial || [];
        throw e;
      }

      setStatus(SCHED.checking_media);
      const broken = await unreachable(media);
      if (broken.length) throw new Error(ERR.broken_media(broken.length));
    }
    setStatus(SCHED.scheduling);
    // datetime-local is Malta wall time; the backend wants an absolute UTC instant.
    const body = post.pendingBody || {
      request_id: post.requestId,
      event_id: post.eventId,
      category: post.category,
      media_retention_days: post.retentionDays,
      media_pinned: post.pinned,
      caption,
      platforms: [...post.platforms],
      media,
      profile_id: profileId,
      content_type: post.contentType,
      scheduledTime: scheduledISO,
    };
    if (needsExpiry() && post.expiryTime) body.expiryTime = maltaInstant(post.expiryTime);
    const verifying = !!post.pendingBody;
    post.pendingBody = body;
    if (!(await autosave())) {
      post.pendingBody = null;
      throw new Error('Is-sottomissjoni ma setgħetx tinżamm. Erġa’ pprova.');
    }
    submitted = true;
    if (post.editId) {
      const current = verifying ? await api(`/api/posts/${post.editId}`) : null;
      if (!current || !matchesSubmission(current, body))
        await api(`/api/posts/${post.editId}`, {
          method: 'PATCH',
          body: { ...body, revision: post.revision },
        });
    } else await api('/api/schedule', { method: 'POST', body });

    ui.lastScheduled = { form: formState(), files: [...post.media] };
    reset();
    setStatus(SCHED.scheduled, 'ok');
    refreshCounts();
    return true;
  } catch (e) {
    // An interrupted response may already have scheduled the post. Keep its
    // media and request ID until the same request can be retried safely.
    if (!submitted || (e.status && e.status < 500)) await cleanup(uploaded);
    else {
      setStatus('It-talba tista’ tkun waslet. Erġa’ pprova biex tivverifika l-istess sottomissjoni.', 'warn');
      post.remoteMedia = [...post.remoteMedia, ...uploaded];
      post.media = [];
      await autosave();
    }
    if (!submitted || (e.status && e.status < 500)) post.pendingBody = null;
    setStatus(
      ERR.generic(e.message) +
        (post.pendingBody ? ' · L-istess talba se tiġi vverifikata meta terġa’ tipprova.' : ''),
      'error',
    );
    return false;
  } finally {
    ui.busy = false;
  }
}

export function reuseLast() {
  if (!ui.lastScheduled) return;
  applyState(ui.lastScheduled.form, ui.lastScheduled.files);
  ui.status = null;
  autosave();
}

export async function openQueued(p, duplicate = false) {
  if (
    (post.caption.trim() || post.media.length || post.remoteMedia.length) &&
    !(await confirm('Iżżomm il-post attwali bħala draft qabel tiftaħ ieħor?', {
      yes: 'Żomm draft',
      no: 'Ibqa’ hawn',
    }))
  )
    return false;
  if (post.caption.trim() || post.media.length || post.remoteMedia.length) await saveDraft();
  applyState(
    {
      caption: p.caption,
      platforms: p.platforms,
      contentType: p.content_type,
      profileId: p.profile_id,
      scheduledTime: duplicate ? defaultTime() : toLocalInput(new Date(p.scheduled_time)),
      remoteMedia: p.media,
      eventId: p.event_id,
      category: p.category,
      editId: duplicate ? '' : p.id,
      revision: p.revision,
      retentionDays: p.media_retention_days,
      pinned: p.media_pinned,
    },
    [],
  );
  await autosave();
  return true;
}
