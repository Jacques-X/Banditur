/**
 * /api/meta — consolidated utility endpoint
 *
 * GET  /api/meta?type=version   → backend/desktop version info
 * GET  /api/meta?type=profiles  → committee profile list (id + name only)
 * GET  /api/meta?type=calendar  → next 10 Google Calendar events (5-min cache)
 * GET  /api/meta?type=live-posts → live Facebook/Instagram posts from Graph API
 * POST /api/meta                → { action: 'cleanup', paths: [...] } — remove Supabase Storage objects
 */

import { createClient } from '@supabase/supabase-js';
import { google }       from 'googleapis';
import { cors }         from './cors.js';
import { bearerMatches } from './auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);
const GRAPH_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

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

function configuredProfiles() {
  try {
    const profiles = JSON.parse(process.env.COMMITTEE_PROFILES || '[]');
    return Array.isArray(profiles) ? profiles : [];
  } catch {
    return [];
  }
}

async function graphJson(path, params, token) {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  url.searchParams.set('access_token', token);

  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Graph request failed: ${res.status}`);
  }
  return json;
}

function mediaFromAttachment(item) {
  const data = item.attachments?.data?.[0];
  return item.full_picture || data?.media?.image?.src || data?.media?.source || null;
}

function normalizeFbPost(item, profile, state) {
  return {
    id: item.id,
    platform: 'fb',
    profile_id: profile.id || 'main',
    profile_name: profile.name || profile.id || 'Main',
    state,
    caption: item.message || item.story || '',
    created_time: item.created_time || null,
    scheduled_time: item.scheduled_publish_time ? new Date(item.scheduled_publish_time * 1000).toISOString() : null,
    permalink: item.permalink_url || null,
    media_url: mediaFromAttachment(item),
    media_type: item.attachments?.data?.[0]?.type || 'post',
    likes_count: item.likes?.summary?.total_count ?? null,
    comments_count: item.comments?.summary?.total_count ?? null,
  };
}

function normalizeIgMedia(item, profile) {
  return {
    id: item.id,
    platform: 'ig',
    profile_id: profile.id || 'main',
    profile_name: profile.name || profile.id || 'Main',
    state: 'published',
    caption: item.caption || '',
    created_time: item.timestamp || null,
    scheduled_time: null,
    permalink: item.permalink || null,
    media_url: item.thumbnail_url || item.media_url || null,
    media_type: item.media_type || 'media',
    likes_count: item.like_count ?? null,
    comments_count: item.comments_count ?? null,
  };
}

async function fetchLiveForProfile(profile, limit) {
  const fbToken = profile.fb_access_token || process.env.FB_ACCESS_TOKEN;
  const fbPageId = profile.fb_page_id || process.env.FB_PAGE_ID;
  const igUserId = profile.ig_user_id || process.env.IG_USER_ID;
  const posts = [];
  const errors = [];

  if (fbToken && fbPageId) {
    const fbBaseFields = 'id,message,story,created_time,scheduled_publish_time,permalink_url,full_picture,attachments{media,type,url}';
    const fbPublishedFields = `${fbBaseFields},likes.summary(true).limit(0),comments.summary(true).limit(0)`;
    await Promise.all([
      graphJson(`${fbPageId}/published_posts`, { fields: fbPublishedFields, limit }, fbToken)
        .then(json => posts.push(...(json.data || []).map(item => normalizeFbPost(item, profile, 'published'))))
        .catch(err => errors.push({ platform: 'fb', state: 'published', message: err.message })),
      graphJson(`${fbPageId}/scheduled_posts`, { fields: fbBaseFields, limit }, fbToken)
        .then(json => posts.push(...(json.data || []).map(item => normalizeFbPost(item, profile, 'scheduled'))))
        .catch(err => errors.push({ platform: 'fb', state: 'scheduled', message: err.message })),
    ]);
  }

  if (fbToken && igUserId) {
    const igFields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
    await graphJson(`${igUserId}/media`, { fields: igFields, limit }, fbToken)
      .then(json => posts.push(...(json.data || []).map(item => normalizeIgMedia(item, profile))))
      .catch(err => errors.push({ platform: 'ig', state: 'published', message: err.message }));
  }

  return { posts, errors };
}

async function handleLivePosts(req, res) {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '25', 10) || 25));
  const search = String(req.query.search || '').trim().toLowerCase();
  const profileId = String(req.query.profile_id || '').trim();
  const profiles = configuredProfiles();
  const fallbackProfile = {
    id: 'main',
    name: 'Main',
    fb_page_id: process.env.FB_PAGE_ID,
    fb_access_token: process.env.FB_ACCESS_TOKEN,
    ig_user_id: process.env.IG_USER_ID,
  };
  const allProfiles = profiles.length ? profiles : [fallbackProfile];
  const activeProfiles = profileId && profileId !== 'all'
    ? allProfiles.filter(profile => profile.id === profileId)
    : allProfiles;

  const results = await Promise.all(activeProfiles.map(profile => fetchLiveForProfile(profile, limit)));
  let posts = results.flatMap(result => result.posts);
  const errors = results.flatMap(result => result.errors);

  if (search) {
    posts = posts.filter(post =>
      [post.caption, post.profile_name, post.platform, post.state]
        .some(value => String(value || '').toLowerCase().includes(search))
    );
  }

  posts.sort((a, b) => {
    const aTime = new Date(a.scheduled_time || a.created_time || 0).getTime();
    const bTime = new Date(b.scheduled_time || b.created_time || 0).getTime();
    return bTime - aTime;
  });

  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.status(200).json({
    posts,
    total: posts.length,
    errors,
    source: 'meta_graph',
    refreshed_at: new Date().toISOString(),
  });
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
    if (type === 'live-posts') return handleLivePosts(req, res);
    return res.status(400).json({ error: 'type must be version | profiles | calendar | live-posts' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
