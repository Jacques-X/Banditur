import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArchive } from '../api/_lib/archive.js';
import { groupByGap, mergeGroups, splitGroup, planGroup, groupProblem, cleanName, destPath, fingerprint, fpKey, kindOf, shiftTaken } from '../api/_lib/archive-rules.js';

// Tiny in-memory Drive: files with parents, appProperties, size; supports the queries archive.js makes.
function fakeDrive() {
  const files = [{ id: 'root', name: 'Arkivju', mimeType: 'application/vnd.google-apps.folder', parents: [] }];
  let n = 0;
  const match = (f, q) => {
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    if (parent && !f.parents.includes(parent)) return false;
    const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
    if (name !== undefined && f.name !== name) return false;
    const contains = /name contains '((?:[^'\\]|\\.)*)'/.exec(q)?.[1];
    if (contains && !f.name.includes(contains)) return false;
    if (q.includes("mimeType = 'application/vnd.google-apps.folder'") && f.mimeType !== 'application/vnd.google-apps.folder') return false;
    if (q.includes("mimeType != 'application/vnd.google-apps.folder'") && f.mimeType === 'application/vnd.google-apps.folder') return false;
    const fps = [...q.matchAll(/key='fp' and value='([^']+)'/g)].map((m) => m[1]);
    if (fps.length && !fps.includes(f.appProperties?.fp)) return false;
    return !f.trashed;
  };
  return {
    files,
    files_: {
      list: async ({ q }) => ({ data: { files: files.filter((f) => match(f, q)).map((f) => ({ ...f })) } }),
      create: async ({ requestBody }) => { const f = { id: `f${++n}`, createdTime: String(1000 + n), ...requestBody }; files.push(f); return { data: f }; },
      update: async ({ fileId, addParents, removeParents, requestBody }) => {
        const f = files.find((x) => x.id === fileId);
        if (addParents) f.parents = f.parents.filter((p) => p !== removeParents).concat(addParents);
        Object.assign(f, requestBody || {});
        return { data: f };
      },
      get: async ({ fileId }) => ({ data: files.find((x) => x.id === fileId) }),
    },
  };
}
const setup = () => {
  const db = fakeDrive();
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return { ok: true, headers: { get: () => 'https://upload.example/session1' } }; };
  const archive = createArchive({ drive: { files: db.files_ }, token: async () => 'tok', root: 'root', fetchFn });
  return { db, archive, calls };
};

test('rules: kinds, names, paths', () => {
  assert.equal(kindOf('DSC0001.ARW'), 'raw');
  assert.equal(kindOf('C0001.MP4'), 'video');
  assert.equal(kindOf('C0001M01.XML'), null);
  assert.equal(cleanName('  a/b:c*  '), 'a b c');
  assert.deepEqual(destPath({ date: '2026-08-15', event: 'Festa', kind: 'video', person: 'Joe' }), ['2026', '2026-08-15 Festa', 'Footage', 'Joe']);
  assert.equal(destPath({ date: '2026-08-15', event: 'Festa', kind: 'raw', person: '' }), null);
  assert.ok(fpKey(fingerprint({ name: 'A.jpg', size: 1, taken: 2 })).length < 124);
});

test('rules: grouping by gap, merge, split, plan, clock shift', () => {
  const h = 3600;
  const t0 = Date.UTC(2026, 7, 15, 9) / 1000;
  const f = (name, taken, kind = 'photo') => ({ name, taken, kind, size: 1 });
  const files = [f('a', t0), f('b', t0 + 600), f('c', t0 + 5 * h), f('d', t0 + 5 * h + 60, 'video'), f('x', t0 + 30 * h)];
  let groups = groupByGap(files, 120);
  assert.deepEqual(groups.map((g) => g.files.length), [2, 2, 1]);
  assert.equal(groups[0].date, '2026-08-15');
  assert.equal(groups[2].date, '2026-08-16');
  assert.equal(groupByGap(files, 1800).length, 1);
  groups = mergeGroups(groups, 'g1', 'g2');
  assert.equal(groups.length, 2);
  groups = splitGroup(groups, 'g1', 2);
  assert.equal(groups.length, 3);
  const g = { ...groups[1], event: 'Festa', date: '2026-08-15' };
  assert.equal(groupProblem(g), 'fotografu');
  assert.equal(groupProblem({ ...g, fotografu: 'Joe' }), 'vidjografu');
  const ready = { ...g, fotografu: 'Joe', vidjografu: 'Ann' };
  assert.equal(groupProblem(ready), null);
  assert.deepEqual(planGroup(ready).map((p) => p.path[2]), ['Ritratti', 'Footage']);
  assert.equal(planGroup({ ...ready, skip: true }).length, 0);
  assert.equal(shiftTaken([f('a', 10)], 5)[0].taken, 15);
});

test('folder: creates the path once and reuses it', async () => {
  const { db, archive } = setup();
  const a = await archive.folder({ path: ['2026', '2026-08-15 Festa', 'Ritratti', 'Joe'] });
  const b = await archive.folder({ path: ['2026', '2026-08-15 Festa', 'Ritratti', 'Joe'] });
  assert.equal(a.id, b.id);
  assert.equal(db.files.length, 5);
  assert.deepEqual((await archive.ls({ path: ['2026', '2026-08-15 Festa', 'Ritratti'] })).folders, ['Joe']);
  assert.deepEqual((await archive.ls({ path: ['2099'] })).folders, []);
  await assert.rejects(() => archive.folder({ path: ['a', ''] }));
});

test('folder: duplicate folders from two Macs are merged', async () => {
  const { db, archive } = setup();
  db.files.push({ id: 'd1', name: '2026', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], createdTime: '1' });
  db.files.push({ id: 'd2', name: '2026', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], createdTime: '2' });
  db.files.push({ id: 'k', name: 'x.jpg', mimeType: 'image/jpeg', parents: ['d2'] });
  const { id } = await archive.folder({ path: ['2026'] });
  assert.equal(id, 'd1');
  assert.deepEqual(db.files.find((f) => f.id === 'k').parents, ['d1']);
  assert.equal(db.files.find((f) => f.id === 'd2').trashed, true);
});

test('session: new file opens an upload; same fingerprint or hand-added copy is skipped', async () => {
  const { db, archive, calls } = setup();
  const path = ['2026', 'E', 'Ritratti', 'Joe'];
  const fp = fingerprint({ name: 'A.jpg', size: 10, taken: 5 });
  const s = await archive.session({ path, name: 'A.jpg', size: 10, mime: 'image/jpeg', fingerprint: fp });
  assert.equal(s.sessionUrl, 'https://upload.example/session1');
  assert.equal(calls[0].init.headers['X-Upload-Content-Length'], '10');
  assert.equal(JSON.parse(calls[0].init.body).appProperties.fp, fpKey(fp));
  // pretend it uploaded
  const parent = (await archive.folder({ path })).id;
  db.files.push({ id: 'up', name: 'A.jpg', size: '10', mimeType: 'image/jpeg', parents: [parent], appProperties: { fp: fpKey(fp) }, createdTime: '9' });
  assert.equal((await archive.session({ path, name: 'A.jpg', size: 10, fingerprint: fp })).exists, true);
  assert.deepEqual((await archive.check({ fingerprints: [fp, 'nope'] })).found, { [fp]: 'up' });
  // a hand-added file with the same name and size
  db.files.push({ id: 'hand', name: 'B.jpg', size: '20', mimeType: 'image/jpeg', parents: [parent] });
  const hand = await archive.session({ path, name: 'B.jpg', size: 20, fingerprint: 'b|20|1' });
  assert.deepEqual([hand.exists, hand.byName], [true, true]);
  // same name, different file → renamed
  const other = await archive.session({ path, name: 'A.jpg', size: 99, fingerprint: 'a|99|7' });
  assert.equal(other.name, 'A (2).jpg');
});

test('finish: verifies size/md5 and drops the newer copy of a duplicate', async () => {
  const { db, archive } = setup();
  const fp = 'a|1|1';
  db.files.push({ id: 'one', name: 'a', size: '5', md5Checksum: 'abc', parents: ['root'], appProperties: { fp: fpKey(fp) }, createdTime: '1', mimeType: 'x' });
  db.files.push({ id: 'two', name: 'a', size: '5', md5Checksum: 'abc', parents: ['root'], appProperties: { fp: fpKey(fp) }, createdTime: '2', mimeType: 'x' });
  assert.deepEqual(await archive.finish({ fileId: 'one', md5: 'abc', size: 5, fingerprint: fp }), { ok: true, id: 'one' });
  assert.equal((await archive.finish({ fileId: 'one', md5: 'zzz', size: 5, fingerprint: fp })).ok, false);
  assert.equal((await archive.finish({ fileId: 'one', md5: 'abc', size: 6 })).ok, false);
  const dup = await archive.finish({ fileId: 'two', md5: 'abc', size: 5, fingerprint: fp });
  assert.deepEqual([dup.ok, dup.duplicate, dup.id], [true, true, 'one']);
  assert.equal(db.files.find((f) => f.id === 'two').trashed, true);
});

test('count: files per kind for an event', async () => {
  const { db, archive } = setup();
  const ritr = (await archive.folder({ path: ['2026', 'E', 'Ritratti', 'Joe'] })).id;
  const foot = (await archive.folder({ path: ['2026', 'E', 'Footage', 'Ann'] })).id;
  for (const [id, p] of [['1', ritr], ['2', ritr], ['3', foot]]) db.files.push({ id, name: id, mimeType: 'x', parents: [p] });
  const c = await archive.count({ path: ['2026', 'E'] });
  assert.deepEqual([c.ritratti, c.footage], [2, 1]);
});

test('sessions: one result per item in order; a bad item does not sink the rest', async () => {
  const { archive } = setup();
  const path = ['2026', 'E', 'Ritratti', 'Joe'];
  const item = (name, size) => ({ path, name, size, mime: 'image/jpeg', fingerprint: fingerprint({ name, size, taken: 5 }) });
  const { results } = await archive.sessions({ items: [item('A.jpg', 10), { path, name: '', size: 1 }, item('B.jpg', 20)] });
  assert.equal(results.length, 3);
  assert.equal(results[0].sessionUrl, 'https://upload.example/session1');
  assert.match(results[1].error, /required/);
  assert.equal(results[2].name, 'B.jpg');
});

test('finishMany: verifies each file; a failing item becomes an error entry', async () => {
  const { db, archive } = setup();
  db.files.push({ id: 'one', name: 'a', size: '5', md5Checksum: 'abc', parents: ['root'], createdTime: '1', mimeType: 'x' });
  const { results } = await archive.finishMany({ items: [{ fileId: 'one', md5: 'abc', size: 5 }, { fileId: 'one', md5: 'zzz', size: 5 }] });
  assert.deepEqual(results, [{ ok: true, id: 'one' }, { ok: false, reason: 'mismatch' }]);
});

test('batches are capped at 25 items and must not be empty', async () => {
  const { archive } = setup();
  const items = Array.from({ length: 26 }, () => ({}));
  await assert.rejects(archive.sessions({ items }), (e) => e.code === 400);
  await assert.rejects(archive.finishMany({ items }), (e) => e.code === 400);
  await assert.rejects(archive.sessions({ items: [] }), (e) => e.code === 400);
  await assert.rejects(archive.sessions({}), (e) => e.code === 400);
  // 25 is fine (every item fails validation but the batch itself is accepted)
  assert.equal((await archive.sessions({ items: items.slice(0, 25) })).results.length, 25);
});
