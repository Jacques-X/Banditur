// Profiles: the named sets of Xogħol boards and Kalendarju data. They are kept on this Mac only
// (localStorage), because both stores are per profile id. Existing ids never change: a first start
// after the server was dropped rebuilds the list from the ids found in the stored data.

export const PROFILES_KEY = 'banditur_profiles';
export const DEFAULT_PROFILE = { id: 'main', name: 'Banditur' };

const readJson = (storage, key) => { try { return JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; } };

const clean = (list) => {
  const seen = new Set(), out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const id = typeof p?.id === 'string' ? p.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(p.name || '').trim() || id });
  }
  return out;
};

/** Profile ids that the stored Xogħol, Kalendarju and projects data already use. */
export function idsInStorage(storage) {
  const ids = new Set();
  const xoghol = readJson(storage, 'banditur_xoghol') || {};
  const calendar = readJson(storage, 'banditur_calendar') || {};
  for (const list of [xoghol.boards, xoghol.columns, xoghol.tasks, calendar.events, calendar.campaigns, calendar.slots])
    for (const row of Array.isArray(list) ? list : []) if (typeof row?.profile_id === 'string' && row.profile_id) ids.add(row.profile_id);
  const projects = readJson(storage, 'banditur_projects');
  for (const p of Array.isArray(projects) ? projects : []) if (typeof p?.data?.profileId === 'string' && p.data.profileId) ids.add(p.data.profileId);
  return [...ids];
}

/**
 * The profile list at start-up → { list, current }.
 * Saved list first; otherwise one profile per id found in the stored data, plus the last chosen
 * one, plus `main`. A seeded list is saved at once so it stays the same on the next start.
 */
export function seedProfiles(storage) {
  let list = clean(readJson(storage, PROFILES_KEY));
  const last = (() => { try { return storage?.getItem('banditur_profile_id') || ''; } catch { return ''; } })();
  if (!list.length) {
    const ids = idsInStorage(storage);
    if (last) ids.push(last);
    if (!ids.includes('main')) ids.unshift('main');
    list = clean([...new Set(ids)].map((id) => ({ id, name: id === 'main' ? DEFAULT_PROFILE.name : id })));
    try { storage?.setItem(PROFILES_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  }
  const current = list.some((p) => p.id === last) ? last : list[0].id;
  return { list, current };
}

const slug = (name) => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ħ/g, 'h').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'profil';

/** Adds a profile named `name`; the id comes from the name and is made unique. → { list, id } */
export function addProfile(list, name) {
  const title = String(name || '').trim().slice(0, 60);
  if (!title) return { list, id: '' };
  const base = slug(title);
  let id = base, n = 2;
  while (list.some((p) => p.id === id)) id = `${base}-${n++}`;
  return { list: [...list, { id, name: title }], id };
}

export function renameProfile(list, id, name) {
  const title = String(name || '').trim().slice(0, 60);
  return title ? list.map((p) => (p.id === id ? { ...p, name: title } : p)) : list;
}

/** Removes a profile. The last one cannot be removed. */
export function removeProfile(list, id) {
  return list.length > 1 ? list.filter((p) => p.id !== id) : list;
}
