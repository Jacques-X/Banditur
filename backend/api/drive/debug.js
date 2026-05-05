import { google } from 'googleapis';
import { cors } from '../cors.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  const out = {
    env: {
      hasCredentials: !!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS,
      hasFolderId:    !!process.env.DRIVE_FOLDER_ID,
      folderId:       process.env.DRIVE_FOLDER_ID || null,
      serviceAccount: null,
    },
    aboutMe:      null,
    folderMeta:   null,
    listRaw:      null,
    listAllDrives: null,
    errors:       [],
  };

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS) {
    return res.status(200).json(out);
  }

  let creds;
  try {
    creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);
    out.env.serviceAccount = creds.client_email || '(no client_email)';
  } catch (e) {
    out.errors.push(`Credential parse error: ${e.message}`);
    return res.status(200).json(out);
  }

  const googleAuth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth: googleAuth });

  // 1. Who am I?
  try {
    const about = await drive.about.get({ fields: 'user' });
    out.aboutMe = about.data.user;
  } catch (e) {
    out.errors.push(`about.get: ${e.message}`);
  }

  // 2. Can we see the folder itself?
  if (process.env.DRIVE_FOLDER_ID) {
    try {
      const folder = await drive.files.get({
        fileId:           process.env.DRIVE_FOLDER_ID,
        fields:           'id,name,mimeType,driveId,parents',
        supportsAllDrives: true,
      });
      out.folderMeta = folder.data;
    } catch (e) {
      out.errors.push(`files.get(folder): ${e.message}`);
    }

    // 3. List with current query (supportsAllDrives=true)
    try {
      const r = await drive.files.list({
        q:                         `'${process.env.DRIVE_FOLDER_ID}' in parents and mimeType contains 'image/' and trashed = false`,
        fields:                    'files(id,name,mimeType)',
        pageSize:                  10,
        supportsAllDrives:         true,
        includeItemsFromAllDrives: true,
      });
      out.listRaw = { count: (r.data.files || []).length, files: r.data.files || [] };
    } catch (e) {
      out.errors.push(`files.list (images): ${e.message}`);
    }

    // 4. List ALL file types in the folder (no mimeType filter) to see what's actually there
    try {
      const r = await drive.files.list({
        q:                         `'${process.env.DRIVE_FOLDER_ID}' in parents and trashed = false`,
        fields:                    'files(id,name,mimeType)',
        pageSize:                  10,
        supportsAllDrives:         true,
        includeItemsFromAllDrives: true,
      });
      out.listAllDrives = { count: (r.data.files || []).length, files: r.data.files || [] };
    } catch (e) {
      out.errors.push(`files.list (all types): ${e.message}`);
    }
  }

  return res.status(200).json(out);
}
