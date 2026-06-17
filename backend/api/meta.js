/**
 * /api/meta — consolidated utility endpoint
 *
 * GET  /api/meta?type=version   → backend/desktop version info
 * GET  /api/meta?type=profiles  → committee profile list (id + name only)
 * GET  /api/meta?type=calendar  → next 10 Google Calendar events (5-min cache)
 * POST /api/meta                → { action: 'cleanup', paths: [...] } — remove Supabase Storage objects
 */

import { createClient } from '@supabase/supabase-js';
import { google }       from 'googleapis';
import { cors }         from './cors.js';
import { bearerMatches } from './auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

// ── Calendar cache (per warm invocation) ─────────────────────────────────────
let _calCache     = null;
let _calCacheTime = 0;
const CAL_TTL     = 5 * 60 * 1000; // 5 minutes

function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  return google.calendar({ version: 'v3', auth });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

function handleVersion(req, res) {
  return res.status(200).json({
    backend_version:         process.env.BACKEND_VERSION         || '1.0.0',
    minimum_desktop_version: process.env.MIN_DESKTOP_VERSION     || '1.0.0',
    latest_desktop_version:  process.env.UPDATE_VERSION          || null,
    updates_configured:      Boolean(
      process.env.UPDATE_VERSION && process.env.UPDATE_URL && process.env.UPDATE_SIGNATURE
    ),
  });
}

function handleProfiles(req, res) {
  let profiles = [];
  try {
    const raw = JSON.parse(process.env.COMMITTEE_PROFILES || '[]');
    profiles = raw.map(p => ({ id: p.id, name: p.name }));
  } catch {}
  if (!profiles.length) profiles = [{ id: 'main', name: 'Kumitat Ċentrali' }];
  return res.status(200).json(profiles);
}

async function handleCalendar(req, res) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || !process.env.GOOGLE_CALENDAR_ID)
    return res.status(503).json({ error: 'Google Calendar not configured' });

  if (_calCache && Date.now() - _calCacheTime < CAL_TTL) {
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(_calCache);
  }

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
      id:          ev.id,
      summary:     ev.summary,
      description: ev.description,
      location:    ev.location,
      start:       ev.start,
      end:         ev.end,
      htmlLink:    ev.htmlLink,
    }));

    _calCache     = events;
    _calCacheTime = Date.now();
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(events);
  } catch (err) {
    // M4: Don't expose service-account emails or Google API internals.
    console.error(JSON.stringify({ event: 'calendar_error', message: err.message }));
    return res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
}

async function handleCleanup(req, res) {
  function validUploadPath(path) {
    return typeof path === 'string' && path.startsWith('uploads/') && !path.includes('..');
  }

  const paths = Array.isArray(req.body?.paths)
    ? req.body.paths.filter(validUploadPath).slice(0, 100)
    : [];

  if (!paths.length) return res.status(200).json({ removed: 0 });

  const { data, error } = await sb.storage.from('media').remove(paths);
  if (error) {
    console.error(JSON.stringify({ event: 'cleanup_error', message: error.message }));
    return res.status(500).json({ error: 'Failed to remove media' });
  }
  return res.status(200).json({ removed: data?.length ?? paths.length });
}

// ── Router ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (cors(req, res)) return;

  const auth = req.headers.authorization || '';
  if (!bearerMatches(auth, process.env.API_KEY)) return res.status(401).end();

  // POST — action-based operations
  if (req.method === 'POST') {
    const { action } = req.body || {};
    if (action === 'cleanup') return handleCleanup(req, res);
    return res.status(400).json({ error: 'Unknown action' });
  }

  // GET — type-based reads
  if (req.method === 'GET') {
    const { type } = req.query;
    if (type === 'version')  return handleVersion(req, res);
    if (type === 'profiles') return handleProfiles(req, res);
    if (type === 'calendar') return handleCalendar(req, res);
    return res.status(400).json({ error: 'type must be version | profiles | calendar' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
