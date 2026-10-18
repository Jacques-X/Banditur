import assert from 'node:assert/strict';
import { nameFromPath, orientationOf, ratioOk, groupWatermarks, slugOf } from './wm-bulk.js';

assert.equal(nameFromPath('/x/Jacques Xuereb portrait.png'), 'Jacques Xuereb');
assert.equal(nameFromPath('/x/jacques-xuereb_landscape.png'), 'Jacques Xuereb');
assert.equal(nameFromPath('/x/Sebio Audio Visuals - Landscape.PNG'), 'Sebio Audio Visuals');
assert.equal(nameFromPath('/x/Celine Debono/portrait.png'), 'Celine Debono', 'folder name when the file only says portrait');
assert.equal(nameFromPath('C:\\wm\\Kurt Borġ\\landscape.png'), 'Kurt Borġ');
assert.equal(slugOf('Kurt Borġ'), 'kurt-borg');
assert.equal(orientationOf(4000, 6000), 'portrait');
assert.equal(orientationOf(6000, 4000), 'landscape');
assert.equal(orientationOf(10, 10), null);
assert.ok(ratioOk(6000, 4000) && ratioOk(4000, 6000) && !ratioOk(6000, 3375));

const rows = groupWatermarks([
  { path: '/a/Jacques Xuereb portrait.png', w: 4000, h: 6000 },
  { path: '/a/Jacques Xuereb landscape.png', w: 6000, h: 4000 },
  { path: '/a/Celine Debono landscape.png', w: 6000, h: 3375 },
  { path: '/a/celine-debono-2 portrait.png', w: 4000, h: 6000 },
  { path: '/b/Jacques Xuereb/portrait.png', w: 4000, h: 6000 },
]);
assert.equal(rows.length, 3, 'Celine, Celine 2 and Jacques');
assert.ok(rows.find(r => r.name === 'Jacques Xuereb').notes.some(n => n.includes('żewġ fajls tal-portrett')), 'a second portrait file is flagged');
const j = rows.find(r => r.name === 'Jacques Xuereb');
assert.ok(j.portrait && j.landscape);
const c = rows.find(r => r.name === 'Celine Debono');
assert.ok(c.notes.some(n => n.includes('3:2')), 'a wrong ratio is flagged');
console.log('✓ watermark bulk helper tests passed');
