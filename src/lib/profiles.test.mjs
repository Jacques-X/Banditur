import test from 'node:test';
import assert from 'node:assert/strict';
import { seedProfiles, addProfile, renameProfile, removeProfile, idsInStorage, PROFILES_KEY } from './profiles.js';

const mem = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };

test('empty storage seeds one profile "main" called Banditur', () => {
  const st = mem();
  const r = seedProfiles(st);
  assert.deepEqual(r, { list: [{ id: 'main', name: 'Banditur' }], current: 'main' });
  assert.ok(JSON.parse(st.m[PROFILES_KEY]).length === 1);
});
test('seeding keeps every id the stored data uses, and the last chosen one', () => {
  const st = mem({
    banditur_xoghol: JSON.stringify({ boards: [{ profile_id: 'fb-page' }], columns: [], tasks: [{ profile_id: 'other' }] }),
    banditur_calendar: JSON.stringify({ events: [{ profile_id: 'main' }], slots: [{ profile_id: 'fb-page' }] }),
    banditur_profile_id: 'other',
  });
  const r = seedProfiles(st);
  assert.deepEqual(r.list.map((p) => p.id).sort(), ['fb-page', 'main', 'other']);
  assert.equal(r.current, 'other');
  assert.equal(r.list.find((p) => p.id === 'main').name, 'Banditur');
});
test('a saved list wins and a stale current id falls back to the first', () => {
  const st = mem({ [PROFILES_KEY]: JSON.stringify([{ id: 'a', name: 'A' }, { id: 'a', name: 'dup' }, { id: 'b' }]), banditur_profile_id: 'zzz' });
  const r = seedProfiles(st);
  assert.deepEqual(r.list, [{ id: 'a', name: 'A' }, { id: 'b', name: 'b' }]);
  assert.equal(r.current, 'a');
});
test('damaged data does not break seeding', () => {
  assert.equal(seedProfiles(mem({ banditur_xoghol: '{', [PROFILES_KEY]: 'x' })).current, 'main');
  assert.deepEqual(idsInStorage(mem({ banditur_calendar: '[]' })), []);
});
test('add, rename, remove', () => {
  let list = [{ id: 'main', name: 'Banditur' }];
  let r = addProfile(list, ' Żgħażagħ ');
  assert.equal(r.id, 'zghazagh'); list = r.list;
  r = addProfile(list, 'zghazagh'); assert.equal(r.id, 'zghazagh-2'); list = r.list;
  assert.equal(addProfile(list, '  ').list, list);
  list = renameProfile(list, 'main', 'Kumitat');
  assert.equal(list[0].name, 'Kumitat');
  assert.equal(renameProfile(list, 'main', ' ').length, 3);
  assert.equal(removeProfile(list, 'zghazagh').length, 2);
  assert.equal(removeProfile([{ id: 'x', name: 'x' }], 'x').length, 1);
});
