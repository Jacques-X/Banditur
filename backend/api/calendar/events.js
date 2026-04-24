import { google } from 'googleapis';

function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  return google.calendar({ version: 'v3', auth });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.API_KEY}`) return res.status(401).end();

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || !process.env.GOOGLE_CALENDAR_ID)
    return res.status(503).json({ error: 'Google Calendar not configured' });

  try {
    const calendar = getCalendarClient();
    const result   = await calendar.events.list({
      calendarId:   process.env.GOOGLE_CALENDAR_ID,
      timeMin:      new Date().toISOString(),
      maxResults:   10,
      singleEvents: true,
      orderBy:      'startTime',
    });

    const events = (result.data.items || []).map(ev => ({
      id:       ev.id,
      summary:  ev.summary,
      location: ev.location,
      start:    ev.start,
      end:      ev.end,
    }));

    return res.status(200).json(events);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
