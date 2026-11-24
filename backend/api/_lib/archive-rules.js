// Rules for the SD-card → Drive archive, shared by the backend and the app (like event-rules.js).
// Pure functions only: folder names, fingerprints and grouping a card's files into events.

export const KINDS = { photo: 'Ritratti', raw: 'Ritratti', video: 'Footage' };
export const PHOTO_EXT = ['jpg', 'jpeg', 'png', 'heic', 'tif', 'tiff'];
export const RAW_EXT = ['arw', 'cr2', 'cr3', 'nef', 'nrw', 'raf', 'rw2', 'orf', 'dng', 'pef', 'srw', 'raw'];
export const VIDEO_EXT = ['mp4', 'mov', 'mxf', 'mts', 'm2ts', 'avi', 'mkv', 'm4v', 'crm', 'braw'];

export const extOf = (name) => String(name).split('.').pop().toLowerCase();

/** 'photo' | 'raw' | 'video' | null — null files (thumbnails, XML sidecars, ...) are not archived. */
export function kindOf(name) {
  const e = extOf(name);
  if (PHOTO_EXT.includes(e)) return 'photo';
  if (RAW_EXT.includes(e)) return 'raw';
  if (VIDEO_EXT.includes(e)) return 'video';
  return null;
}

/** A Drive-safe single folder or file name: no slashes or control characters, no leading dots, at most 80 chars. */
export function cleanName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** '2026-08-15 Festa ta’ Santa Marija' */
export function eventFolderName(date, name) {
  if (!DATE.test(String(date))) return '';
  const n = cleanName(name);
  return n ? `${date} ${n}` : '';
}

/** Folder path below the archive root, or null when something required is missing. */
export function destPath({ date, event, kind, person }) {
  const top = KINDS[kind];
  const folder = eventFolderName(date, event);
  const who = cleanName(person);
  if (!top || !folder || !who) return null;
  return [date.slice(0, 4), folder, top, who];
}

/** Same file everywhere: name + size + capture time. Survives a different Mac, a different card reader, a rename of the folder. */
export const fingerprint = ({ name, size, taken }) => `${String(name).toLowerCase()}|${size}|${taken}`;

/** Drive appProperties values are limited to 124 bytes, so a long fingerprint is stored as a short hash. */
export function fpKey(fp) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < fp.length; i++) {
    const c = fp.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return `${h1.toString(36)}${h2.toString(36)}${fp.length.toString(36)}`;
}

const pad = (n) => String(n).padStart(2, '0');
/** `taken` is "naive local" seconds (the camera's wall clock, as if UTC). */
export function dayOf(taken) {
  const d = new Date(taken * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const clockOf = (taken) => {
  const d = new Date(taken * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/**
 * Group a card's files into events: sorted by capture time, a gap longer than `gapMin` starts a new group.
 * Files from before 05:00 belong to the previous evening's group only if the gap is small — gaps decide, not midnight.
 * → [{ id, from, to, date, files: [...] }] with `date` the day the group starts.
 */
export function groupByGap(files, gapMin = 120) {
  const sorted = files.filter((f) => Number.isFinite(f.taken)).sort((a, b) => a.taken - b.taken || a.name.localeCompare(b.name));
  const groups = [];
  for (const f of sorted) {
    const g = groups[groups.length - 1];
    if (g && f.taken - g.to <= gapMin * 60) { g.files.push(f); g.to = f.taken; }
    else groups.push({ id: `g${groups.length + 1}`, from: f.taken, to: f.taken, files: [f] });
  }
  for (const g of groups) g.date = dayOf(g.from);
  return groups;
}

/** Merge groups b into a (by ids), keeping time order. */
export function mergeGroups(groups, aId, bId) {
  const a = groups.find((g) => g.id === aId), b = groups.find((g) => g.id === bId);
  if (!a || !b || a === b) return groups;
  const files = [...a.files, ...b.files].sort((x, y) => x.taken - y.taken);
  const merged = { ...a, files, from: files[0].taken, to: files[files.length - 1].taken, date: dayOf(files[0].taken) };
  return groups.filter((g) => g !== b).map((g) => (g === a ? merged : g));
}

/** Split a group before the file at `index` (>0). */
export function splitGroup(groups, id, index) {
  const i = groups.findIndex((g) => g.id === id);
  const g = groups[i];
  if (!g || index <= 0 || index >= g.files.length) return groups;
  const mk = (suffix, files) => ({ ...g, id: `${g.id}${suffix}`, files, from: files[0].taken, to: files[files.length - 1].taken, date: dayOf(files[0].taken), event: g.event || '' });
  return [...groups.slice(0, i), mk('a', g.files.slice(0, index)), mk('b', g.files.slice(index)), ...groups.slice(i + 1)];
}

/** Camera clock was wrong: add `seconds` to every file's capture time. */
export const shiftTaken = (files, seconds) => files.map((f) => ({ ...f, taken0: f.taken0 ?? f.taken, taken: (f.taken0 ?? f.taken) + seconds }));

/** The fingerprint always uses the time the camera wrote, never a corrected one, so a clock fix cannot break duplicate detection. */
export const fingerprintOf = (f) => fingerprint({ name: f.name, size: f.size, taken: f.taken0 ?? f.taken });

/** Which kinds a group holds → which person names are required. */
export function needs(group) {
  const kinds = new Set(group.files.map((f) => KINDS[f.kind]).filter(Boolean));
  return { Ritratti: kinds.has('Ritratti'), Footage: kinds.has('Footage') };
}

/** A group is ready to upload when it has a name, a date and the required person names. */
export function groupProblem(group) {
  if (group.skip) return null;
  if (!eventFolderName(group.date, group.event)) return 'name';
  const n = needs(group);
  if (n.Ritratti && !cleanName(group.fotografu)) return 'fotografu';
  if (n.Footage && !cleanName(group.vidjografu)) return 'vidjografu';
  return null;
}

/** The upload plan for one group: [{ file, path }] (skipped files and kinds nobody archives are left out). */
export function planGroup(group) {
  if (group.skip || groupProblem(group)) return [];
  return group.files.map((file) => ({
    file,
    path: destPath({ date: group.date, event: group.event, kind: file.kind, person: file.kind === 'video' ? group.vidjografu : group.fotografu }),
  }));
}
