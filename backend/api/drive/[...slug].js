/**
 * /api/drive/[...slug] — consolidated Google Drive proxy
 *
 * GET /api/drive/posters[?folderId=...]  → list files in a Drive folder
 * GET /api/drive/find?date=YYYY-MM-DD    → poster files named with that date (DD:MM:YY)
 * GET /api/drive/file/:id                → download/stream a single Drive file
 *
 * POST /api/drive/archive/<op>        → SD-card archive helpers (see _lib/archive.js)
 *
 * Both endpoints require Authorization: Bearer <API_KEY>.
 * Access is restricted to files/folders under DRIVE_FOLDER_ID.
 */

import { driveClient, driveWriteClient, driveWriteToken } from '../_lib/google.js';
import { createArchive, ArchiveError } from '../_lib/archive.js';
import { cors }          from '../_lib/cors.js';
import { requireAuth }   from '../_lib/auth.js';
import { nameHasDate, posterNameVariants } from '../_lib/poster-date.js';

function routeParts(req) {
  const rawSlug = req.query.slug ?? req.query['...slug'];
  if (Array.isArray(rawSlug)) return rawSlug;
  if (rawSlug) return String(rawSlug).split('/').filter(Boolean);

  const path = new URL(req.url || '/', 'https://banditur.local').pathname;
  return path.replace(/^\/api\/drive\/?/, '').split('/').filter(Boolean);
}

// ── Security helpers ──────────────────────────────────────────────────────────

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// IDs already proven to live under the root. Populated whenever we list a folder
// (every child returned is, by definition, under root) or after a successful
// parent-chain walk. Lets normal navigation skip the serial drive.files.get
// chain entirely — that walk was the main per-folder latency source.
//
// Bounded with a TTL + max-size cap so a long-lived warm lambda can't accumulate
// every visited ID forever. Entries are id → insertion timestamp.
const _verifiedUnderRoot = new Map();
const VERIFIED_TTL  = 30 * 60 * 1000; // 30 minutes
const VERIFIED_MAX  = 5000;

function markVerified(id) {
  // Evict the oldest entry when at capacity (Map preserves insertion order).
  if (_verifiedUnderRoot.size >= VERIFIED_MAX) {
    const oldest = _verifiedUnderRoot.keys().next().value;
    if (oldest !== undefined) _verifiedUnderRoot.delete(oldest);
  }
  _verifiedUnderRoot.set(id, Date.now());
}

function isVerified(id) {
  const t = _verifiedUnderRoot.get(id);
  if (t === undefined) return false;
  if (Date.now() - t > VERIFIED_TTL) {
    _verifiedUnderRoot.delete(id);
    return false;
  }
  return true;
}

async function isUnderRoot(drive, targetId, rootId) {
  if (targetId === rootId) return true;
  if (isVerified(targetId)) return true;
  let current = targetId;
  const seen  = new Set();
  for (let depth = 0; depth < 20; depth++) {
    if (!current || seen.has(current)) return false;
    seen.add(current);
    const meta    = await drive.files.get({ fileId: current, fields: 'parents', supportsAllDrives: true });
    const parents = meta.data.parents || [];
    if (parents.includes(rootId)) { markVerified(targetId); return true; }
    current = parents[0];
  }
  return false;
}

// ── Folder listing (posters) ──────────────────────────────────────────────────

const _folderCache = new Map(); // folderId → { data, t }
const CACHE_TTL    = 5 * 60 * 1000;

async function handlePosters(req, res) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || !process.env.DRIVE_FOLDER_ID)
    return res.status(503).json({ error: 'Google Drive not configured' });

  const folderId = req.query.folderId || process.env.DRIVE_FOLDER_ID;
  const hit      = _folderCache.get(folderId);
  if (hit && Date.now() - hit.t < CACHE_TTL) {
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(hit.data);
  }

  try {
    const drive = driveClient();
    if (!await isUnderRoot(drive, folderId, process.env.DRIVE_FOLDER_ID))
      return res.status(403).json({ error: 'Folder is outside the configured Drive root' });

    const result = await drive.files.list({
      q:                         `'${folderId}' in parents and trashed = false`,
      fields:                    'files(id,name,thumbnailLink,mimeType,modifiedTime)',
      orderBy:                   'folder,name_natural',
      pageSize:                  100,
      supportsAllDrives:         true,
      includeItemsFromAllDrives: true,
    });

    const files = result.data.files || [];
    // Every child of an authorized folder is under root — remember subfolders so
    // descending into them skips the parent-chain walk.
    for (const file of files) {
      if (file.mimeType === FOLDER_MIME) markVerified(file.id);
    }
    _folderCache.set(folderId, { data: files, t: Date.now() });
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(files);
  } catch (err) {
    // M4: Don't expose service-account emails, project IDs, or quota details.
    console.error(JSON.stringify({ event: 'drive_list_error', message: err.message }));
    return res.status(500).json({ error: 'Failed to list Drive folder' });
  }
}

// ── Posters named after a date (for the calendar) ─────────────────────────────

async function handleFind(req, res) {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || !process.env.DRIVE_FOLDER_ID)
    return res.status(503).json({ error: 'Google Drive not configured' });

  try {
    const drive = driveClient();
    const result = await drive.files.list({
      q:                         `(${posterNameVariants(date).map((v) => `name contains '${v}'`).join(' or ')}) and trashed = false and mimeType != '${FOLDER_MIME}'`,
      fields:                    'files(id,name,thumbnailLink,mimeType)',
      orderBy:                   'name_natural',
      pageSize:                  50,
      supportsAllDrives:         true,
      includeItemsFromAllDrives: true,
    });
    const out = [];
    for (const f of result.data.files || []) {
      if (!nameHasDate(f.name, date)) continue; // Drive matches loosely; keep exact date matches
      if (await isUnderRoot(drive, f.id, process.env.DRIVE_FOLDER_ID)) out.push(f);
      if (out.length >= 12) break;
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(out);
  } catch (err) {
    console.error(JSON.stringify({ event: 'drive_find_error', message: err.message }));
    return res.status(500).json({ error: 'Failed to search Drive' });
  }
}

// ── Single file download ──────────────────────────────────────────────────────

async function handleFile(fileId, req, res) {
  if (!fileId) return res.status(400).json({ error: 'id required' });
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || !process.env.DRIVE_FOLDER_ID)
    return res.status(503).json({ error: 'Google Drive not configured' });

  try {
    const drive = driveClient();
    if (!await isUnderRoot(drive, fileId, process.env.DRIVE_FOLDER_ID))
      return res.status(403).json({ error: 'File is outside the configured Drive root' });

    const meta = await drive.files.get({ fileId, fields: 'name,mimeType', supportsAllDrives: true });
    const mime = meta.data.mimeType || 'application/octet-stream';

    const file = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );

    res.setHeader('Content-Type', mime);
    // P2-9: a Drive filename can contain quotes/newlines; use RFC 5987 filename*
    // with a sanitised ASCII fallback so it can't break or inject header content.
    const safeName = String(meta.data.name || 'file').replace(/[\r\n"\\]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(meta.data.name || 'file')}`
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).send(Buffer.from(file.data));
  } catch (err) {
    console.error(JSON.stringify({ event: 'drive_file_error', fileId, message: err.message }));
    return res.status(500).json({ error: 'Failed to retrieve Drive file' });
  }
}

// ── SD-card archive (POST /api/drive/archive/{folder|ls|check|session|sessions|finish|finishMany|count}) ──

const ARCHIVE_ACTIONS = ['folder', 'ls', 'check', 'session', 'sessions', 'finish', 'finishMany', 'count'];
let _archive = null;

async function handleArchive(op, req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ARCHIVE_ACTIONS.includes(op)) return res.status(404).json({ error: 'Unknown archive route' });
  const root = process.env.ARCHIVE_FOLDER_ID || process.env.DRIVE_FOLDER_ID;
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || !root)
    return res.status(503).json({ error: 'Google Drive not configured' });
  try {
    _archive ??= createArchive({ drive: driveWriteClient(), token: driveWriteToken, root });
    return res.status(200).json(await _archive[op](req.body || {}));
  } catch (err) {
    if (err instanceof ArchiveError) return res.status(err.code).json({ error: err.message });
    console.error(JSON.stringify({ event: 'drive_archive_error', op, message: err.message }));
    return res.status(500).json({ error: 'Archive request failed' });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (requireAuth(req, res)) return;
  const [action, id] = routeParts(req);

  if (action === 'archive') return handleArchive(id, req, res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (action === 'posters')        return handlePosters(req, res);
  if (action === 'find')           return handleFind(req, res);
  if (action === 'file' && id)     return handleFile(id, req, res);

  return res.status(404).json({ error: 'Unknown drive route' });
}
