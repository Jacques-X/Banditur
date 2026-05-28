import { google } from 'googleapis';
import { cors } from '../cors.js';

// Module-level cache — persists across warm Lambda invocations (per folderId).
const _cache = new Map(); // folderId -> { data, t }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

async function isFolderAllowed(drive, folderId, rootId) {
  if (folderId === rootId) return true;

  let current = folderId;
  const seen = new Set();
  for (let depth = 0; depth < 20; depth++) {
    if (!current || seen.has(current)) return false;
    seen.add(current);

    const meta = await drive.files.get({
      fileId: current,
      fields: 'parents',
      supportsAllDrives: true,
    });
    const parents = meta.data.parents || [];
    if (parents.includes(rootId)) return true;
    current = parents[0];
  }

  return false;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`) return res.status(401).end();

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || !process.env.DRIVE_FOLDER_ID)
    return res.status(503).json({ error: 'Google Drive not configured' });

  const folderId = req.query.folderId || process.env.DRIVE_FOLDER_ID;

  const hit = _cache.get(folderId);
  if (hit && Date.now() - hit.t < CACHE_TTL) {
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(hit.data);
  }

  try {
    const drive  = getDriveClient();
    if (!await isFolderAllowed(drive, folderId, process.env.DRIVE_FOLDER_ID))
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
    _cache.set(folderId, { data: files, t: Date.now() });
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(files);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
