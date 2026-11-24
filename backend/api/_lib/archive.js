// SD-card archive on a Shared Drive: folders, duplicate checks, resumable upload sessions, verification.
// The app sends file bytes straight to Google; this code only prepares and checks.
import { cleanName, fpKey } from './archive-rules.js';

const FOLDER = 'application/vnd.google-apps.folder';
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class ArchiveError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * createArchive({ drive, token, root, fetchFn }) → { folder, ls, check, session, sessions, finish, finishMany, count }
 *  drive: googleapis Drive v3 client with write access; token: async () => access token;
 *  root: the archive root folder id on the Shared Drive.
 */
export function createArchive({ drive, token, root, fetchFn = fetch }) {
  const folderIds = new Map(); // 'a/b/c' → id, per warm instance

  async function all(q, fields) {
    const out = [];
    let pageToken;
    do {
      const r = await drive.files.list({ q, fields: `nextPageToken,files(${fields})`, pageSize: 200, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true, orderBy: 'createdTime,name' });
      out.push(...(r.data.files || []));
      pageToken = r.data.nextPageToken;
    } while (pageToken);
    return out;
  }

  const childFolders = (parent, name) =>
    all(`'${parent}' in parents and name = '${esc(name)}' and mimeType = '${FOLDER}' and trashed = false`, 'id,createdTime');

  async function ensureOne(parent, name) {
    let found = await childFolders(parent, name);
    if (!found.length) {
      await drive.files.create({ requestBody: { name, mimeType: FOLDER, parents: [parent] }, fields: 'id', supportsAllDrives: true });
      found = await childFolders(parent, name);
    }
    const keeper = found[0];
    // Two Macs made the same folder at once: move the newer one's files into the oldest, then bin it.
    for (const extra of found.slice(1)) {
      for (const c of await all(`'${extra.id}' in parents and trashed = false`, 'id')) {
        await drive.files.update({ fileId: c.id, addParents: keeper.id, removeParents: extra.id, supportsAllDrives: true, fields: 'id' });
      }
      await drive.files.update({ fileId: extra.id, requestBody: { trashed: true }, supportsAllDrives: true, fields: 'id' });
    }
    return keeper.id;
  }

  function cleanPath(path) {
    if (!Array.isArray(path) || !path.length || path.length > 6) throw new ArchiveError(400, 'path must be 1-6 folder names');
    const names = path.map(cleanName);
    if (names.some((n) => !n)) throw new ArchiveError(400, 'empty folder name');
    return names;
  }

  async function folder(path, { create = true } = {}) {
    const names = cleanPath(path);
    let parent = root, key = '';
    for (const n of names) {
      key += `/${n}`;
      let id = folderIds.get(key);
      if (!id) {
        if (create) id = await ensureOne(parent, n);
        else id = (await childFolders(parent, n))[0]?.id;
        if (!id) return null;
        folderIds.set(key, id);
      }
      parent = id;
    }
    return parent;
  }

  const MAX_BATCH = 25;
  async function each(items, fn) {
    if (!Array.isArray(items) || !items.length || items.length > MAX_BATCH) throw new ArchiveError(400, `items must be 1-${MAX_BATCH} entries`);
    const results = [];
    for (const item of items) {
      try { results.push(await fn(item)); }
      catch (err) {
        if (!(err instanceof ArchiveError)) throw err;
        results.push({ error: err.message });
      }
    }
    return results;
  }

  return {
    async folder({ path }) { return { id: await folder(path) }; },

    /** Names of the folders directly below path (never creates anything). */
    async ls({ path }) {
      const id = path?.length ? await folder(path, { create: false }) : root;
      if (!id) return { folders: [] };
      const list = await all(`'${id}' in parents and mimeType = '${FOLDER}' and trashed = false`, 'name');
      return { folders: list.map((f) => f.name) };
    },

    /** Which of these fingerprints are already on Drive? → { found: { fingerprint: fileId } } */
    async check({ fingerprints }) {
      const found = {};
      const list = [...new Set(Array.isArray(fingerprints) ? fingerprints : [])].slice(0, 400);
      for (let i = 0; i < list.length; i += 15) {
        const batch = list.slice(i, i + 15);
        const q = `(${batch.map((fp) => `appProperties has { key='fp' and value='${esc(fpKey(fp))}' }`).join(' or ')}) and trashed = false`;
        const files = await all(q, 'id,appProperties');
        for (const f of files) {
          const fp = batch.find((b) => fpKey(b) === f.appProperties?.fp);
          if (fp && !found[fp]) found[fp] = f.id;
        }
      }
      return { found };
    },

    /** Open a resumable upload session — or say the file is already there. */
    async session({ path, name, size, mime, fingerprint: fp }) {
      const fileName = cleanName(name);
      if (!fileName || !fp || !Number.isFinite(size) || size < 0) throw new ArchiveError(400, 'name, size and fingerprint required');
      const already = (await this.check({ fingerprints: [fp] })).found[fp];
      if (already) return { exists: true, id: already };
      const parent = await folder(path);
      const same = await all(`'${parent}' in parents and trashed = false and name = '${esc(fileName)}'`, 'id,size,appProperties');
      // Added by hand (no fingerprint) with the same name and size: treat as the same file.
      const hand = same.find((f) => Number(f.size) === size && !f.appProperties?.fp);
      if (hand) return { exists: true, id: hand.id, byName: true };
      let finalName = fileName;
      if (same.length) {
        const dot = fileName.lastIndexOf('.');
        const [base, ext] = dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot)] : [fileName, ''];
        const taken = new Set((await all(`'${parent}' in parents and trashed = false and name contains '${esc(base)}'`, 'name')).map((f) => f.name));
        for (let n = 2; n < 1000; n++) if (!taken.has(`${base} (${n})${ext}`)) { finalName = `${base} (${n})${ext}`; break; }
      }
      const res = await fetchFn('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await token()}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mime || 'application/octet-stream',
          'X-Upload-Content-Length': String(size),
        },
        body: JSON.stringify({ name: finalName, parents: [parent], appProperties: { fp: fpKey(fp) } }),
      });
      const url = res.headers.get('location');
      if (!res.ok || !url) throw new ArchiveError(502, 'Drive refused the upload session');
      return { sessionUrl: url, name: finalName };
    },

    /** `session()` for several files in one request (sequential, so folder creation cannot race). One result per item, in order; a failing item becomes { error }. */
    async sessions({ items }) { return { results: await each(items, (item) => this.session(item || {})) }; },

    /** After the last byte: check size and md5 on Drive, and bin our copy if another Mac uploaded the same file first. */
    async finish({ fileId, md5, size, fingerprint: fp }) {
      const r = await drive.files.get({ fileId, fields: 'id,size,md5Checksum,createdTime', supportsAllDrives: true });
      const f = r.data;
      if (Number(f.size) !== Number(size) || (md5 && f.md5Checksum && f.md5Checksum !== md5)) return { ok: false, reason: 'mismatch' };
      if (fp) {
        const same = await all(`appProperties has { key='fp' and value='${esc(fpKey(fp))}' } and trashed = false`, 'id,createdTime');
        if (same.length > 1 && same[0].id !== fileId) {
          await drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true, fields: 'id' });
          return { ok: true, duplicate: true, id: same[0].id };
        }
      }
      return { ok: true, id: fileId };
    },

    /** `finish()` for several files in one request. Same rules as `sessions()`. */
    async finishMany({ items }) { return { results: await each(items, (item) => this.finish(item || {})) }; },

    /** How many files are archived for an event folder (Ritratti / Footage, all people). */
    async count({ path }) {
      const id = await folder(path, { create: false });
      const out = { ritratti: 0, footage: 0, people: [] };
      if (!id) return out;
      for (const top of await all(`'${id}' in parents and mimeType = '${FOLDER}' and trashed = false`, 'id,name')) {
        const key = top.name === 'Ritratti' ? 'ritratti' : top.name === 'Footage' ? 'footage' : null;
        if (!key) continue;
        for (const person of await all(`'${top.id}' in parents and mimeType = '${FOLDER}' and trashed = false`, 'id,name')) {
          const files = await all(`'${person.id}' in parents and mimeType != '${FOLDER}' and trashed = false`, 'id');
          out[key] += files.length;
          out.people.push(`${top.name}/${person.name}`);
        }
      }
      return out;
    },
  };
}
