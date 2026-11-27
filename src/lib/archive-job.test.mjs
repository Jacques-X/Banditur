import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEvents, buildItems, jobStats, safeToFormat, countKinds, splitPoints, mimeOf, destLabel, chunks, takeGroup, nowLabel, sessionBody, finishBody, applySession, applyFinish, stopReason, PARALLEL, folderItems, putError, MAX_DEPTH } from './archive-job.js';
import { groupByGap } from '../../backend/api/_lib/archive-rules.js';

const t0 = Date.UTC(2026, 7, 15, 9) / 1000;
const f = (name, off, kind = 'photo', size = 10) => ({ path: `/Volumes/X/${name}`, name, size, kind, taken: t0 + off });

test('matchEvents: same day and near the time of day', () => {
  const [g] = groupByGap([f('a.jpg', 0), f('b.jpg', 600)]);
  const occ = [
    { event: { id: 'e1', title: 'Festa' }, start: '2026-08-15T10:00', end: '2026-08-15T12:00', allDay: false, first: '2026-08-15', last: '2026-08-15' },
    { event: { id: 'e2', title: 'Tombla' }, start: '2026-08-15T21:00', end: '2026-08-15T23:00', allDay: false, first: '2026-08-15', last: '2026-08-15' },
    { event: { id: 'e3', title: 'Jum il-Festa' }, start: '2026-08-15T00:00', end: '2026-08-16T00:00', allDay: true, first: '2026-08-15', last: '2026-08-15' },
    { event: { id: 'e4', title: 'Ieħor' }, start: '2026-08-16T10:00', end: '2026-08-16T11:00', allDay: false, first: '2026-08-16', last: '2026-08-16' },
  ];
  assert.deepEqual(matchEvents(g, occ).map((m) => m.id), ['e1', 'e3']);
});

test('buildItems: needs names, skips files already on Drive and left-out groups', () => {
  const groups = groupByGap([f('a.jpg', 0), f('b.arw', 60), f('c.mp4', 120, 'video'), f('d.jpg', 5 * 3600)]);
  groups[0].event = 'Festa'; groups[0].fotografu = 'Joe'; groups[0].vidjografu = 'Ann';
  groups[0].files[0].onDrive = true;
  groups[1].skip = true;
  const items = buildItems(groups);
  assert.deepEqual(items.map((i) => i.name), ['b.arw', 'c.mp4']);
  assert.deepEqual(items[0].dest, ['2026', '2026-08-15 Festa', 'Ritratti', 'Joe']);
  assert.equal(items[1].rel, '2026-08-15 Festa/Footage/Ann/c.mp4');
  assert.equal(items[1].mime, 'video/mp4');
  assert.equal(buildItems(groupByGap([f('x.jpg', 0)])).length, 0); // no name yet
});

test('job stats and safe-to-format', () => {
  const job = { items: [{ size: 5, state: 'done' }, { size: 5, state: 'skipped' }, { size: 5, state: 'pending' }] };
  assert.deepEqual(jobStats(job), { total: 3, done: 1, skipped: 1, failed: 0, bytes: 15, bytesDone: 10 });
  assert.equal(safeToFormat(job), false);
  job.items[2].state = 'done';
  assert.equal(safeToFormat(job), true);
  assert.equal(safeToFormat({ ...job, leftOut: true }), false);
  assert.equal(safeToFormat({ items: [] }), false);
});

test('misc: counts, split points, labels', () => {
  assert.deepEqual(countKinds([f('a.jpg', 0), { ...f('b.mp4', 1, 'video', 90), onDrive: true }]), { photo: 1, raw: 0, video: 1, bytes: 100, onDrive: 1 });
  const [g] = groupByGap([f('a.jpg', 0), f('b.jpg', 3 * 3600), f('c.jpg', 3 * 3600 + 60), f('d.jpg', 9 * 3600)], 600);
  assert.deepEqual(splitPoints(g).map((p) => p.index), [1, 3]);
  assert.equal(mimeOf('x.CR3'), 'application/octet-stream');
  const gg = { ...g, event: 'Festa', fotografu: 'Joe' };
  assert.equal(destLabel(gg, 'Ritratti'), 'Arkivju/2026/2026-08-15 Festa/Ritratti/Joe');
  assert.equal(destLabel(gg, 'Footage'), '');
});

test('a camera-clock fix does not change the fingerprint', async () => {
  const { shiftTaken, fingerprintOf } = await import('../../backend/api/_lib/archive-rules.js');
  const a = f('a.jpg', 0);
  const [moved] = shiftTaken([a], 3600);
  assert.notEqual(moved.taken, a.taken);
  assert.equal(fingerprintOf(moved), fingerprintOf(a));
  assert.equal(fingerprintOf(shiftTaken([moved], 60)[0]), fingerprintOf(a));
});

const it = (id, state = 'pending') => ({ id, name: `${id}.jpg`, size: 5, mime: 'image/jpeg', fp: `fp${id}`, dest: ['2026'], state, sessionUrl: '' });

test('chunks and takeGroup: groups of three, finished files are passed over', () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(PARALLEL, 3);
  const items = [it('a', 'done'), it('b'), it('c', 'skipped'), it('d'), it('e', 'failed'), it('f'), it('g')];
  const first = takeGroup(items, 0);
  assert.deepEqual(first.group.map((i) => i.id), ['b', 'd', 'e']);
  const second = takeGroup(items, first.next);
  assert.deepEqual(second.group.map((i) => i.id), ['f', 'g']);
  assert.equal(takeGroup(items, second.next).group.length, 0);
  assert.equal(nowLabel(first.group), 'b.jpg · d.jpg · e.jpg');
});

test('results are mapped back onto the items', () => {
  const a = it('a'), b = it('b'), c = it('c');
  assert.equal(applySession(a, { sessionUrl: 'u1' }), 'ready');
  assert.equal(a.sessionUrl, 'u1');
  assert.equal(applySession(b, { exists: true, id: 'x' }), 'skipped');
  assert.equal(b.state, 'skipped');
  assert.equal(applySession(c, { error: 'nope' }), 'error');
  assert.equal(c.sessionUrl, '');
  assert.deepEqual(sessionBody(a), { path: ['2026'], name: 'a.jpg', size: 5, mime: 'image/jpeg', fingerprint: 'fpa' });
  assert.deepEqual(finishBody(a, { file_id: 'F', md5: 'M' }), { fileId: 'F', md5: 'M', size: 5, fingerprint: 'fpa' });
  assert.equal(applyFinish(a, { ok: true, id: 'F' }), '');
  assert.equal(a.state, 'done');
  assert.equal(applyFinish(b, { ok: true, duplicate: true }), '');
  assert.equal(b.state, 'skipped');
  c.sessionUrl = 'old';
  assert.match(applyFinish(c, { ok: false, reason: 'mismatch' }), /ma wasalx/);
  assert.equal(c.sessionUrl, '');
  assert.equal(applyFinish(c, { error: 'bad' }), 'bad');
  assert.ok(applyFinish(c, undefined));
});

test('stopReason: cancel wins, then a missing card, then no connection; plain failures do not stop', () => {
  const http = Object.assign(new Error('Drive wieġeb 403.'), { status: 403 });
  assert.equal(stopReason([http, 'cancelled']), 'paused');
  assert.equal(stopReason([http, 'Ma nstabx il-fajl fuq il-card.']), 'card');
  assert.equal(stopReason([http, new Error('Failed to fetch')]), 'offline');
  assert.equal(stopReason([http]), '');
  assert.equal(stopReason([]), '');
});

test('folderItems: subfolders kept below the chosen Drive folder; too deep or no destination is left out', () => {
  const files = [
    { path: '/x/Festa/a.jpg', name: 'a.jpg', rel: 'a.jpg', size: 10, kind: 'photo', taken: 100 },
    { path: '/x/Festa/Day 2/b.pdf', name: 'b.pdf', rel: 'Day 2/b.pdf', size: 20, kind: 'other', taken: 200 },
    { path: '/x/Festa/1/2/3/4/5/c.mov', name: 'c.mov', rel: '1/2/3/4/5/c.mov', size: 30, kind: 'video', taken: 300 },
  ];
  const { items, tooDeep } = folderItems(files, ['Uploads', 'Festa']);
  assert.equal(tooDeep, 1);
  assert.deepEqual(items.map((i) => i.dest), [['Uploads', 'Festa'], ['Uploads', 'Festa', 'Day 2']]);
  assert.deepEqual(items.map((i) => i.rel), ['a.jpg', 'Day 2/b.pdf']);
  assert.equal(items[1].mime, 'application/pdf');
  assert.equal(items[0].fp, 'a.jpg|10|100');
  assert.ok(items.every((i) => i.state === 'pending' && i.dest.length <= MAX_DEPTH));
  assert.equal(folderItems(files, []).items.length, 0, 'the archive root itself is not a destination');
});

test('putError: a Drive refusal fails the file; card and connection errors still stop the job', () => {
  const refused = putError('Drive wieġeb 403.');
  assert.equal(refused.status, 403);
  assert.equal(stopReason([refused]), '');
  assert.equal(putError('Drive ma kkonfermax li l-fajl wasal.').status, 502);
  assert.equal(stopReason([putError('retry:Connection refused')]), 'offline');
  assert.equal(stopReason([putError('Ma tqrax mill-card (inħarġet?).')]), 'card');
  assert.equal(stopReason([putError('cancelled')]), 'paused');
});
