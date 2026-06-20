/**
 * /api/calendar — Google Calendar CRUD endpoint
 *
 * GET    /api/calendar?start=ISO&end=ISO  → FullCalendar events in range
 * POST   /api/calendar                    → create a single event
 * PATCH  /api/calendar?id=...             → update/move/resize a single event
 * DELETE /api/calendar?id=...             → delete a single event
 */

import { google }        from 'googleapis';
import { cors }          from './cors.js';
import { bearerMatches } from './auth.js';

const LABEL_KEY = 'banditurLabel';

function configured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS && process.env.GOOGLE_CALENDAR_ID);
}

function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

function safeMessage(err, fallback) {
  console.error(JSON.stringify({ event: 'calendar_api_error', message: err.message }));
  return fallback;
}

function calendarClientError(err) {
  const status = err.status || err.code || 500;
  if (status === 403) {
    return {
      status,
      code: 'calendar_forbidden',
      error: 'Google Calendar write access denied. Share GOOGLE_CALENDAR_ID with the service account and allow it to make changes to events.',
    };
  }
  if (status === 404) {
    return { status, code: 'calendar_not_found', error: 'Google Calendar event not found' };
  }
  return null;
}

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeEvent(ev) {
  const allDay = Boolean(ev.start?.date);
  const label = ev.extendedProperties?.private?.[LABEL_KEY] || '';

  return {
    id: ev.id,
    title: ev.summary || '(Bla Titlu)',
    start: ev.start?.dateTime || ev.start?.date || null,
    end: ev.end?.dateTime || ev.end?.date || null,
    allDay,
    description: ev.description || '',
    location: ev.location || '',
    htmlLink: ev.htmlLink || '',
    recurringEventId: ev.recurringEventId || null,
    extendedProps: {
      label,
      description: ev.description || '',
      location: ev.location || '',
      htmlLink: ev.htmlLink || '',
      recurringEventId: ev.recurringEventId || null,
    },
  };
}

function eventResource(body, existingPrivate = {}) {
  const title = String(body.title ?? body.summary ?? '').trim();
  if (!title) throw Object.assign(new Error('Title required'), { status: 400 });

  const description = String(body.description ?? '');
  const location = String(body.location ?? '');
  const label = String(body.label ?? '').trim();
  const allDay = Boolean(body.allDay);

  let start;
  let end;
  if (allDay) {
    if (!validDay(body.start) || !validDay(body.end)) {
      throw Object.assign(new Error('All-day start/end must be YYYY-MM-DD'), { status: 400 });
    }
    start = { date: body.start };
    end = { date: body.end };
  } else {
    if (!validDate(body.start) || !validDate(body.end)) {
      throw Object.assign(new Error('Timed start/end must be ISO dates'), { status: 400 });
    }
    start = { dateTime: new Date(body.start).toISOString() };
    end = { dateTime: new Date(body.end).toISOString() };
  }

  const privateProps = { ...existingPrivate };
  if (label) privateProps[LABEL_KEY] = label;
  else delete privateProps[LABEL_KEY];

  return {
    summary: title,
    description,
    location,
    start,
    end,
    extendedProperties: { private: privateProps },
  };
}

async function getEventOr404(calendar, id) {
  if (!id) throw Object.assign(new Error('id required'), { status: 400 });
  try {
    const result = await calendar.events.get({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      eventId: id,
    });
    return result.data;
  } catch (err) {
    if (err.code === 404) throw Object.assign(new Error('Event not found'), { status: 404 });
    throw err;
  }
}

function blockRecurring(ev) {
  if (!ev.recurringEventId) return;
  throw Object.assign(
    new Error('This is part of a repeating series. Edit it in Google Calendar.'),
    { status: 409, code: 'recurring_instance' }
  );
}

async function handleGet(req, res, calendar) {
  const { start, end } = req.query || {};
  if (!validDate(start) || !validDate(end)) {
    return res.status(400).json({ error: 'start and end ISO dates required' });
  }

  const result = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    timeMin: new Date(start).toISOString(),
    timeMax: new Date(end).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  res.setHeader('Cache-Control', 'private, max-age=30');
  return res.status(200).json((result.data.items || []).map(normalizeEvent));
}

async function handlePost(req, res, calendar) {
  const resource = eventResource(req.body || {});
  const result = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    requestBody: resource,
  });
  return res.status(201).json(normalizeEvent(result.data));
}

async function handlePatch(req, res, calendar) {
  const ev = await getEventOr404(calendar, req.query?.id);
  blockRecurring(ev);

  const existingPrivate = ev.extendedProperties?.private || {};
  const resource = eventResource(req.body || {}, existingPrivate);
  const result = await calendar.events.patch({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    eventId: ev.id,
    requestBody: resource,
  });
  return res.status(200).json(normalizeEvent(result.data));
}

async function handleDelete(req, res, calendar) {
  const ev = await getEventOr404(calendar, req.query?.id);
  blockRecurring(ev);

  await calendar.events.delete({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    eventId: ev.id,
  });
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;

  const auth = req.headers.authorization || '';
  if (!bearerMatches(auth, process.env.API_KEY)) return res.status(401).end();
  if (!configured()) return res.status(503).json({ error: 'Google Calendar not configured' });

  try {
    const calendar = getCalendarClient();
    if (req.method === 'GET') return await handleGet(req, res, calendar);
    if (req.method === 'POST') return await handlePost(req, res, calendar);
    if (req.method === 'PATCH') return await handlePatch(req, res, calendar);
    if (req.method === 'DELETE') return await handleDelete(req, res, calendar);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const clientErr = calendarClientError(err);
    if (clientErr) {
      return res.status(clientErr.status).json({ error: clientErr.error, code: clientErr.code });
    }
    const status = err.status || err.code || 500;
    if (status >= 400 && status < 500 && err.message) {
      return res.status(status).json({ error: err.message, code: err.code });
    }
    return res.status(500).json({ error: safeMessage(err, 'Failed to update Google Calendar') });
  }
}
