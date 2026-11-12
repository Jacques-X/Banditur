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
