// Google API clients for the service account in GOOGLE_SERVICE_ACCOUNT_CREDENTIALS.
import { google } from 'googleapis';

function auth(scope) {
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS),
    scopes: [scope],
  });
}

/** Read/write client for the shared Google Calendar. */
export const calendarClient = () =>
  google.calendar({ version: 'v3', auth: auth('https://www.googleapis.com/auth/calendar') });

/** Read-only Drive client (browsing and streaming files under DRIVE_FOLDER_ID). */
export const driveClient = () =>
  google.drive({ version: 'v3', auth: auth('https://www.googleapis.com/auth/drive.readonly') });
