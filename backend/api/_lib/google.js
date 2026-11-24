// Google API clients for the service account in GOOGLE_SERVICE_ACCOUNT_CREDENTIALS.
import { google } from 'googleapis';

function auth(scope) {
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS),
    scopes: [scope],
  });
}

/** Read-only Drive client (browsing and streaming files under DRIVE_FOLDER_ID). */
export const driveClient = () =>
  google.drive({ version: 'v3', auth: auth('https://www.googleapis.com/auth/drive.readonly') });

/** Read-write Drive client for the SD-card archive (the service account must be Content manager on the Shared Drive). */
export const driveWriteClient = () =>
  google.drive({ version: 'v3', auth: auth('https://www.googleapis.com/auth/drive') });

/** A short-lived access token for opening resumable upload sessions. */
export async function driveWriteToken() {
  const client = await auth('https://www.googleapis.com/auth/drive').getClient();
  const t = await client.getAccessToken();
  return typeof t === 'string' ? t : t.token;
}
