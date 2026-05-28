import { google } from 'googleapis';
import { cors } from '../../cors.js';

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

async function isFileAllowed(drive, fileId, rootId) {
  let current = fileId;
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

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || !process.env.DRIVE_FOLDER_ID)
    return res.status(503).json({ error: 'Google Drive not configured' });

  try {
    const drive = getDriveClient();

    if (!await isFileAllowed(drive, id, process.env.DRIVE_FOLDER_ID))
      return res.status(403).json({ error: 'File is outside the configured Drive root' });

    const meta = await drive.files.get({ fileId: id, fields: 'name,mimeType', supportsAllDrives: true });
    const mime = meta.data.mimeType || 'application/octet-stream';

    const file = await drive.files.get(
      { fileId: id, alt: 'media', supportsAllDrives: true },
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
