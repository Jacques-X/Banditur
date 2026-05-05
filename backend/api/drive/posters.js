import { google } from 'googleapis';
import { cors } from '../cors.js';

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`) return res.status(401).end();

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || !process.env.DRIVE_FOLDER_ID)
    return res.status(503).json({ error: 'Google Drive not configured' });

  try {
    const drive  = getDriveClient();
    const result = await drive.files.list({
      q:        `'${process.env.DRIVE_FOLDER_ID}' in parents and mimeType contains 'image/' and trashed = false`,
      fields:   'files(id,name,thumbnailLink,mimeType,modifiedTime)',
      orderBy:  'modifiedTime desc',
      pageSize: 50,
    });

    return res.status(200).json(result.data.files || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
