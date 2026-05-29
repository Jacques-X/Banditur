/**
 * /api/drive/[...slug] — consolidated Google Drive proxy
 *
 * GET /api/drive/posters[?folderId=...]  → list files in a Drive folder
 * GET /api/drive/file/:id                → download/stream a single Drive file
 *
 * Both endpoints require Authorization: Bearer <API_KEY>.
 * Access is restricted to files/folders under DRIVE_FOLDER_ID.
 */

import { google } from 'googleapis';
import { cors }   from '../cors.js';

// ── Drive client ──────────────────────────────────────────────────────────────

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

// ── Security helpers ──────────────────────────────────────────────────────────

async function isUnderRoot(drive, targetId, rootId) {
  if (targetId === rootId) return true;
  let current = targetId;
  const seen  = new Set();
  for (let depth = 0; depth < 20; depth++) {
    if (!current || seen.has(current)) return false;
    seen.add(current);
    const meta    = await drive.files.get({ fileId: current, fields: 'parents', supportsAllDrives: true });
    const parents = meta.data.parents || [];
    if (parents.includes(rootId)) return true;
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
    const drive = getDriveClient();
    if (!await isUnderRoot(drive, folderId, process.env.DRIVE_FOLDER_ID))
      return res.status(403).json({ error: 'Folder is outside the configured Drive root' });

    const result = await drive.files.list({
      q:                         `'${folderId}' in parents and trashed = false`,
      fields:                    'files(id,name,thumbnailLink,mimeType,modifiedTime)',
      orderBy:                   'folder,modifiedTime desc',
      pageSize:                  100,
      supportsAllDrives:         true,
      includeItemsFromAllDrives: true,
    });

    const files = result.data.files || [];
    _folderCache.set(folderId, { data: files, t: Date.now() });
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(files);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Single file download ──────────────────────────────────────────────────────

async function handleFile(fileId, req, res) {
  if (!fileId) return res.status(400).json({ error: 'id required' });
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || !process.env.DRIVE_FOLDER_ID)
    return res.status(503).json({ error: 'Google Drive not configured' });

  try {
    const drive = getDriveClient();
    if (!await isUnderRoot(drive, fileId, process.env.DRIVE_FOLDER_ID))
      return res.status(403).json({ error: 'File is outside the configured Drive root' });

    const meta = await drive.files.get({ fileId, fields: 'name,mimeType', supportsAllDrives: true });
    const mime = meta.data.mimeType || 'application/octet-stream';

    const file = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${meta.data.name}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).send(Buffer.from(file.data));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`) return res.status(401).end();

  const [action, id] = (req.query.slug || []);

  if (action === 'posters')        return handlePosters(req, res);
  if (action === 'file' && id)     return handleFile(id, req, res);

  return res.status(404).json({ error: 'Unknown drive route' });
}
