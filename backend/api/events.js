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
// Campaign planning (same rules as the Mac, _lib/event-rules.js):
//   POST   /api/events?type=campaign|slot { profile_id, id?, request_id?, …fields } → create (idempotent)
//   PATCH  /api/events?type=campaign|slot&id=… { revision?, …fields }               → edit (409 + current)
//   DELETE /api/events?type=campaign|slot&id=…  → a campaign's events and slots keep existing, unlinked
// GET also returns { campaigns, slots }; an import may carry them too.
//
// Event times are Malta wall-clock strings (see _lib/event-rules.js); the server never
// converts them.
import { createClient } from '@supabase/supabase-js';
import { cors } from './_lib/cors.js';
import { requireAuth } from './_lib/auth.js';
import { knownProfileIds } from './_lib/profiles.js';
import { cleanEvent, cleanLabels, cleanCampaign, cleanSlot, DEFAULT_LABELS, MAX_EVENTS, MAX_CAMPAIGNS, MAX_SLOTS, validUuid } from './_lib/event-rules.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE);

const EVENTS = 'calendar_events';
const SETTINGS = 'calendar_settings';
const CAMPAIGNS = 'calendar_campaigns';
const SLOTS = 'calendar_slots';
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
  campaign: r.campaign_id || '',
  revision: r.revision ?? 0, created_at: r.created_at, updated_at: r.updated_at,
});
const toRow = (e) => ({
  title: e.title, label: e.label, all_day: e.allDay, start_wall: e.start, end_wall: e.end,
  location: e.location, description: e.description, repeat: e.repeat, poster: e.poster, campaign_id: e.campaign || null,
});

// Campaigns and slots: the app's shape ↔ the row, and their rules, for the shared handlers below.
const meta = (r) => ({ id: r.id, profile_id: r.profile_id, request_id: r.request_id ?? null, revision: r.revision ?? 0, created_at: r.created_at, updated_at: r.updated_at });
export const KINDS = {
  campaign: {
    table: CAMPAIGNS, max: MAX_CAMPAIGNS, many: 'kampanji', gone: 'Il-kampanja tneħħiet.',
    clean: (b) => { const r = cleanCampaign(b); return { item: r.campaign, error: r.error }; },
    toApp: (r) => ({ ...meta(r), name: r.name, color: r.color, from: r.from_day, to: r.to_day, goal: r.goal || '', target: r.target ?? 0, notes: r.notes || '' }),
    toRow: (c) => ({ name: c.name, color: c.color, from_day: c.from, to_day: c.to, goal: c.goal, target: c.target, notes: c.notes }),
    order: 'from_day',
  },
  slot: {
    table: SLOTS, max: MAX_SLOTS, many: 'posts ippjanati', gone: 'Il-post ippjanat tneħħa.',
    clean: (b) => { const r = cleanSlot(b); return { item: r.slot, error: r.error }; },
    toApp: (r) => ({ ...meta(r), title: r.title, day: r.day, time: r.time || '', platforms: r.platforms || [], status: r.status, campaign: r.campaign_id || '', event: r.event_id || '', notes: r.notes || '', post_id: r.post_id || '', owner: r.owner || '', due: r.due || '', category: r.category || '' }),
    toRow: (s) => ({ title: s.title, day: s.day, time: s.time, platforms: s.platforms, status: s.status, campaign_id: s.campaign || null, event_id: s.event || null, notes: s.notes, post_id: s.post_id, owner: s.owner, due: s.due, category: s.category }),
    order: 'day',
  },
};

export function createEventsHandler(client = sb) {
  const sb = client;
  const byId = (id) => run(sb.from(EVENTS).select('*').eq('id', id).maybeSingle());

  async function labels() {
    const row = await run(sb.from(SETTINGS).select('*').eq('id', 1).maybeSingle());
    return Array.isArray(row?.labels) ? row.labels : DEFAULT_LABELS;
  }
  async function list(profile) {
    const [rows, l, campaigns, slots] = await Promise.all([
      run(sb.from(EVENTS).select('*').eq('profile_id', profile).order('start_wall', { ascending: true })),
      labels(),
      run(sb.from(CAMPAIGNS).select('*').eq('profile_id', profile).order('from_day', { ascending: true })),
      run(sb.from(SLOTS).select('*').eq('profile_id', profile).order('day', { ascending: true })),
    ]);
    return { events: rows.map(toEvent), labels: l, campaigns: campaigns.map(KINDS.campaign.toApp), slots: slots.map(KINDS.slot.toApp) };
  }

  // ── Campaigns and slots ──
  const kindById = (K, id) => run(sb.from(K.table).select('*').eq('id', id).maybeSingle());
  /** A link to a campaign/event that is not there (deleted meanwhile) is dropped instead of failing. */
  async function existingLinks(item) {
    const out = { ...item };
    if (out.campaign && !(await kindById(KINDS.campaign, out.campaign))) out.campaign = '';
    if ('event' in out && out.event && !(await byId(out.event))) out.event = '';
    return out;
  }
  async function createKind(K, body) {
    const profile = profileOf(body.profile_id);
    if (body.id !== undefined && !validUuid(body.id)) throw new HttpError(400, 'id mhux validu.');
    const again = async () => {
      const r = body.request_id ? await run(sb.from(K.table).select('*').eq('request_id', String(body.request_id)).maybeSingle()) : null;
      return r || (body.id ? await kindById(K, body.id) : null);
    };
    const same = await again();
    if (same) return [200, K.toApp(same)];
    const { item, error } = K.clean(body);
    if (error) throw new HttpError(400, error);
    if ((await run(sb.from(K.table).select('id').eq('profile_id', profile))).length >= K.max) throw new HttpError(400, `Massimu ${K.max} ${K.many}.`);
    const insert = { ...K.toRow(await existingLinks(item)), profile_id: profile, request_id: body.request_id ? String(body.request_id) : null };
    if (body.id) insert.id = body.id;
    const { data, error: e } = await sb.from(K.table).insert(insert).select().single();
    if (e?.code === '23505') { const r = await again(); if (r) return [200, K.toApp(r)]; }
    if (e) throw Object.assign(new Error(e.message), { db: e });
    return [201, K.toApp(data)];
  }
  async function editKind(K, id, body) {
    const row = await kindById(K, id);
    if (!row) throw new HttpError(404, K.gone);
    const cur = K.toApp(row);
    const changed = 'Inbidel minn xi ħadd ieħor. Erġa’ għabbi l-aħħar verżjoni.';
    if (body.revision !== undefined && body.revision !== null && Number(body.revision) !== cur.revision) throw new HttpError(409, changed, { current: cur });
    const { item, error } = K.clean({ ...cur, ...body });
    if (error) throw new HttpError(400, error);
    let query = sb.from(K.table).update(K.toRow(await existingLinks(item))).eq('id', id);
    if (body.revision !== undefined && body.revision !== null) query = query.eq('revision', cur.revision);
    const saved = await run(query.select().maybeSingle());
    if (!saved) throw new HttpError(409, changed, { current: K.toApp(await kindById(K, id)) });
    return K.toApp(saved);
  }
  async function removeKind(K, id) {
    if (K.table === CAMPAIGNS) {
      // The foreign keys also do this (on delete set null); done here too so it never depends on them.
      await run(sb.from(EVENTS).update({ campaign_id: null }).eq('campaign_id', id));
      await run(sb.from(SLOTS).update({ campaign_id: null }).eq('campaign_id', id));
    }
    await run(sb.from(K.table).delete().eq('id', id));
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
    const insert = { ...toRow(await existingLinks(event)), profile_id: profile, request_id: body.request_id ? String(body.request_id) : null, tz: 'Europe/Malta' };
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
    // Campaigns first (events and slots point at them), slots last (they point at events).
    const importKind = async (K, list, name) => {
      for (const input of (Array.isArray(list) ? list : []).slice(0, K.max)) {
        if (!validUuid(input?.id)) { bad.push(String(input?.[name] || '?')); continue; }
        const { item, error } = K.clean(input);
        if (error) { bad.push(`${input[name] || '?'}: ${error}`); continue; }
        if (await kindById(K, input.id)) { skipped++; continue; }
        const { error: e } = await sb.from(K.table).insert({ ...K.toRow(await existingLinks(item)), id: input.id, profile_id: profile, request_id: null });
        if (e?.code === '23505') { skipped++; continue; }
        if (e) throw Object.assign(new Error(e.message), { db: e });
        imported++;
      }
    };
    await importKind(KINDS.campaign, body.campaigns, 'name');
    for (const input of events) {
      if (!validUuid(input?.id)) { bad.push(String(input?.title || '?')); continue; }
      const { event, error } = cleanEvent(input);
      if (error) { bad.push(`${input.title || '?'}: ${error}`); continue; }
      if (await byId(input.id)) { skipped++; continue; }
      const { error: e } = await sb.from(EVENTS).insert({ ...toRow(await existingLinks(event)), id: input.id, profile_id: profile, request_id: null, tz: 'Europe/Malta' });
      if (e?.code === '23505') { skipped++; continue; }
      if (e) throw Object.assign(new Error(e.message), { db: e });
      imported++;
    }
    await importKind(KINDS.slot, body.slots, 'title');
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
    let query = sb.from(EVENTS).update(toRow(await existingLinks(event))).eq('id', id);
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
      if (q.type === 'campaign' || q.type === 'slot') {
        const K = KINDS[q.type];
        if (req.method === 'POST') {
          const [code, row] = await createKind(K, body);
          return res.status(code).json(row);
        }
        if (!q.id) return res.status(400).json({ error: 'id required' });
        if (req.method === 'PATCH') return res.status(200).json(await editKind(K, String(q.id), body));
        if (req.method === 'DELETE') { await removeKind(K, String(q.id)); return res.status(200).json({ ok: true }); }
        return res.status(405).json({ error: 'Method not allowed' });
      }
      if (req.method === 'POST') {
        const [code, row] = await create(body);
        return res.status(code).json(row);
      }
      if (!q.id) return res.status(400).json({ error: 'id required' });
      if (req.method === 'PATCH') return res.status(200).json(await edit(String(q.id), body));
      if (req.method === 'DELETE') {
        await run(sb.from(SLOTS).update({ event_id: null }).eq('event_id', String(q.id)));
        await run(sb.from(EVENTS).delete().eq('id', String(q.id)));
        return res.status(200).json({ ok: true });
      }
      return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.code).json({ error: e.message, ...e.extra });
      if (['PGRST205', '42P01', '42703', 'PGRST204'].includes(e.db?.code) || /calendar_(events|settings|campaigns|slots).*(does not exist|schema cache)|could not find the (table|'campaign_id' column)[^']*'?[^']*calendar_|campaign_id/i.test(e.message || ''))
        return res.status(503).json({ error: 'Il-kalendarju għadu mhux lest fuq is-server: applika l-migrations 20261122_sharing.sql u 20261127_campaigns.sql fuq Supabase.' });
      console.error('[events]', e);
      return res.status(500).json({ error: e.message || 'Server error' });
    }
  };
}

export default createEventsHandler();
