import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesFromCsv, nameLines, packJson, templatesFromPack, starterManifest } from './production.js';

test('CSV names: first column, quotes, header and BOM', () => {
  assert.equal(namesFromCsv('﻿isem,età\nĠużeppi,40\n"Camilleri, Marija",3\n\n"Pawlu ""Il-Kbir""",1'),
    'Ġużeppi\nCamilleri, Marija\nPawlu "Il-Kbir"');
  assert.equal(namesFromCsv('Ġorġ\nName'), 'Ġorġ\nName');
  assert.deepEqual(nameLines('  Anna \n\n Ġorġ\n'), ['Anna', 'Ġorġ']);
});

const png = 'data:image/png;base64,' + btoa('\x89PNG fake');
const tpl = { id: 'awguri', name: 'Awguri', width: 1080, height: 1350, zones: [{ id: 'z1', label: 'Isem', x: 80, y: 1000, w: 900, h: 120 }] };

test('a template pack round-trips with fresh ids', () => {
  const pack = JSON.parse(packJson([{ manifest: tpl, overlay: png }, { manifest: tpl, overlay: png }]));
  const out = templatesFromPack(pack, ['awguri']);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].manifest.id, 'awguri');
  assert.notEqual(out[0].manifest.id, out[1].manifest.id);
  assert.deepEqual(out[0].overlayBytes.slice(0, 4), [0x89, 0x50, 0x4e, 0x47]);
});

test('bad packs are refused', () => {
  assert.throws(() => templatesFromPack({ format: 'x', version: 1, templates: [] }), /Pack mhux validu/);
  assert.throws(() => templatesFromPack({ format: 'banditur-templates', version: 1, templates: [{ manifest: tpl, overlay: 'data:image/jpeg;base64,AA' }] }), /overlay/);
  assert.throws(() => templatesFromPack(null), /Pack mhux validu/);
});

test('starter template fits the chosen format', () => {
  const m = starterManifest({ height: 1920, caption: '', takenIds: ['awguri'] });
  assert.equal(m.height, 1920);
  assert.notEqual(m.id, 'awguri');
  assert.equal(m.caption, 'Awguri [ISEM]!');
  assert.equal(m.zones[0].y, Math.round(1920 * 0.8));
});
