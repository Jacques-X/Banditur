// media-store.js — keeps the photos/videos of a draft in IndexedDB, because
// localStorage cannot hold files. Every call fails soft: if IndexedDB is not
// available saveMedia returns false; the composer surfaces that failure.

const DB_NAME = 'banditur_media';
const STORE   = 'files';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function run(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(out && 'result' in out ? out.result : undefined); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

/** Save the files of one draft under `key` (replaces anything stored there). */
export async function saveMedia(key, files) {
  try {
    await run('readwrite', store => { store.put(files.map(f => ({ blob: f, name: f.name, type: f.type })), key); return null; });
    return true;
  } catch { return false; }
}

/** Load the files of one draft as File objects ([] if none/unavailable). */
export async function loadMedia(key) {
  try {
    const rows = await run('readonly', store => store.get(key));
    return (rows || []).map(r => new File([r.blob], r.name, { type: r.type }));
  } catch { return []; }
}

export async function deleteMedia(key) {
  try { await run('readwrite', store => { store.delete(key); return null; }); } catch { /* ignore */ }
}

/** Remove every stored entry whose key is not in `keepKeys`. */
export async function pruneMedia(keepKeys) {
  try {
    const keep = new Set(keepKeys);
    const db = await openDb();
    await new Promise(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.getAllKeys();
      req.onsuccess = () => { for (const k of req.result) if (!keep.has(k)) store.delete(k); };
      tx.oncomplete = tx.onerror = tx.onabort = () => { db.close(); resolve(); };
    });
  } catch { /* ignore */ }
}
