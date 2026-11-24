// Kalendarju, shared: the committee's events per profile, and one label list for everyone.
// Same requests and rules as the desktop's local store (src/views/kalendarju/local-store.js),
// so the app switches between the two without changing anything else.
//
//   GET    /api/events?profile_id=…                 → { events, labels }
//   POST   /api/events  { profile_id, id?, request_id?, …event }      → create (idempotent)
//   POST   /api/events?type=import { profile_id, events, labels? }    → copy a Mac's calendar up,
//          keeping each event's id (posts and projects point at it); ids already there are skipped
//   PATCH  /api/events?id=…  { revision?, …fields }   → edit; a stale revision gets 409 + current
//   DELETE /api/events?id=…                           → deleting twice is fine
//   PUT    /api/events?type=labels { labels }         → replace the labels; events lose vanished ones
//
// Event times are Malta wall-clock strings (see _lib/event-rules.js); the server never
// converts them.
import { createClient } from '@supabase/supabase-js';
import { cors } from './_lib/cors.js';
import { requireAuth } from './_lib/auth.js';
import { knownProfileIds } from './_lib/profiles.js';
import { cleanEvent, cleanLabels, DEFAULT_LABELS, MAX_EVENTS, validUuid } from './_lib/event-rules.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

const EVENTS = 'calendar_events';
const SETTINGS = 'calendar_settings';
const CHANGED = 'L-avveniment inbidel minn xi ħadd ieħor. Erġa’ għabbi l-aħħar verżjoni.';

class HttpError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

async function run(query) {
  const { data, error } = await query;
  if (error) throw Object.assign(new Error(error.message || 'Database error'), { db: error });
  return data;
}

function profileOf(value) {
  const id = String(value || 'main');
  const known = knownProfileIds();
  if (known.size && !known.has(id)) throw new HttpError(400, 'invalid profile_id');
  return id;
}

/** Database row → the shape the app uses (the local store's shape). */
export const toEvent = (r) => ({
  id: r.id, profile_id: r.profile_id, request_id: r.request_id ?? null, tz: r.tz || 'Europe/Malta',
  title: r.title, label: r.label || '', allDay: !!r.all_day, start: r.start_wall, end: r.end_wall,
  location: r.location || '', description: r.description || '', repeat: r.repeat ?? null, poster: r.poster ?? null,
  revision: r.revision ?? 0, created_at: r.created_at, updated_at: r.updated_at,
});
const toRow = (e) => ({
  title: e.title, label: e.label, all_day: e.allDay, start_wall: e.start, end_wall: e.end,
  location: e.location, description: e.description, repeat: e.repeat, poster: e.poster,
});

export function createEventsHandler(client = sb) {
  const sb = client;
  const byId = (id) => run(sb.from(EVENTS).select('*').eq('id', id).maybeSingle());

  async function labels() {
    const row = await run(sb.from(SETTINGS).select('*').eq('id', 1).maybeSingle());
    return Array.isArray(row?.labels) ? row.labels : DEFAULT_LABELS;
  }
  async function list(profile) {
    const [rows, l] = await Promise.all([
      run(sb.from(EVENTS).select('*').eq('profile_id', profile).order('start_wall', { ascending: true })),
      labels(),
    ]);
    return { events: rows.map(toEvent), labels: l };
  }

  async function count(profile) {
    return (await run(sb.from(EVENTS).select('id').eq('profile_id', profile))).length;
  }

  async function create(body) {
    const profile = profileOf(body.profile_id);
    if (body.id !== undefined && !validUuid(body.id)) throw new HttpError(400, 'id mhux validu.');
    if (body.request_id) {
      const same = await run(sb.from(EVENTS).select('*').eq('request_id', String(body.request_id)).maybeSingle());
      if (same) return [200, toEvent(same)];
    }
    if (body.id) {
      const same = await byId(body.id);
      if (same) return [200, toEvent(same)];
    }
    const { event, error } = cleanEvent(body);
    if (error) throw new HttpError(400, error);
    if ((await count(profile)) >= MAX_EVENTS) throw new HttpError(400, `Massimu ${MAX_EVENTS} avvenimenti.`);
    const insert = { ...toRow(event), profile_id: profile, request_id: body.request_id ? String(body.request_id) : null, tz: 'Europe/Malta' };
    if (body.id) insert.id = body.id;
    const { data, error: e } = await sb.from(EVENTS).insert(insert).select().single();
    if (e?.code === '23505') {
      const again = body.request_id ? await run(sb.from(EVENTS).select('*').eq('request_id', String(body.request_id)).maybeSingle()) : await byId(body.id);
      if (again) return [200, toEvent(again)];
    }
    if (e) throw Object.assign(new Error(e.message), { db: e });
    return [201, toEvent(data)];
  }

  async function importAll(body) {
    const profile = profileOf(body.profile_id);
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length > MAX_EVENTS) throw new HttpError(400, `Massimu ${MAX_EVENTS} avvenimenti.`);
    let imported = 0, skipped = 0;
    const bad = [];
    for (const input of events) {
      if (!validUuid(input?.id)) { bad.push(String(input?.title || '?')); continue; }
      const { event, error } = cleanEvent(input);
      if (error) { bad.push(`${input.title || '?'}: ${error}`); continue; }
      if (await byId(input.id)) { skipped++; continue; }
      const { error: e } = await sb.from(EVENTS).insert({ ...toRow(event), id: input.id, profile_id: profile, request_id: null, tz: 'Europe/Malta' });
      if (e?.code === '23505') { skipped++; continue; }
      if (e) throw Object.assign(new Error(e.message), { db: e });
      imported++;
    }
    if (Array.isArray(body.labels)) await saveLabels(body.labels, { merge: true });
    return { imported, skipped, bad };
  }

  async function edit(id, body) {
    const row = await byId(id);
    if (!row) throw new HttpError(404, 'L-avveniment tneħħa.');
    const cur = toEvent(row);
    if (body.revision !== undefined && body.revision !== null && Number(body.revision) !== cur.revision)
      throw new HttpError(409, CHANGED, { current: cur });
    const { event, error } = cleanEvent({ ...cur, ...body });
    if (error) throw new HttpError(400, error);
    let query = sb.from(EVENTS).update(toRow(event)).eq('id', id);
    if (body.revision !== undefined && body.revision !== null) query = query.eq('revision', cur.revision);
    const saved = await run(query.select().maybeSingle());
    if (!saved) throw new HttpError(409, CHANGED, { current: toEvent(await byId(id)) });
    return toEvent(saved);
  }

  async function saveLabels(input, { merge = false } = {}) {
    // An import adds the Mac's labels to the server's (same name, any case, keeps the server's).
    const key = (l) => String(l?.name ?? '').trim().toLowerCase();
    const list = merge
      ? [...(await labels()), ...(Array.isArray(input) ? input : [])].filter((l, i, all) => key(l) && all.findIndex((x) => key(x) === key(l)) === i)
      : input;
    const { labels: clean, error } = cleanLabels(list);
    if (error) throw new HttpError(400, error);
    await run(sb.from(SETTINGS).upsert({ id: 1, labels: clean }));
    if (!merge) {
      const names = new Set(clean.map((l) => l.name));
      const stale = (await run(sb.from(EVENTS).select('id,label').neq('label', ''))).filter((r) => r.label && !names.has(r.label));
      if (stale.length) await run(sb.from(EVENTS).update({ label: '' }).in('id', stale.map((r) => r.id)));
    }
    return clean;
  }

  return async function handler(req, res) {
    if (cors(req, res) || requireAuth(req, res)) return;
    const q = req.query || {};
    const body = req.body || {};
    try {
      if (req.method === 'GET') return res.status(200).json(await list(profileOf(q.profile_id)));
      if (req.method === 'PUT' && q.type === 'labels') return res.status(200).json(await saveLabels(body.labels));
      if (req.method === 'POST' && q.type === 'import') return res.status(200).json(await importAll(body));
      if (req.method === 'POST') {
        const [code, row] = await create(body);
        return res.status(code).json(row);
      }
      if (!q.id) return res.status(400).json({ error: 'id required' });
      if (req.method === 'PATCH') return res.status(200).json(await edit(String(q.id), body));
      if (req.method === 'DELETE') {
        await run(sb.from(EVENTS).delete().eq('id', String(q.id)));
        return res.status(200).json({ ok: true });
      }
      return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.code).json({ error: e.message, ...e.extra });
      if (['PGRST205', '42P01'].includes(e.db?.code) || /calendar_(events|settings).*(does not exist|schema cache)|could not find the table '[^']*calendar_/i.test(e.message || ''))
        return res.status(503).json({ error: 'Il-kalendarju għadu mhux lest fuq is-server: applika l-migration 20261122_sharing.sql fuq Supabase.' });
      console.error('[events]', e);
      return res.status(500).json({ error: e.message || 'Server error' });
    }
  };
}

export default createEventsHandler();
