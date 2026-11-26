import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCube, sample, textureBytes, lutName, lutJob } from './lut.js';

function cube(n, fn, extra = '') {
  let s = `TITLE "Test look"\n# c\n${extra}LUT_3D_SIZE ${n}\n`;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    s += fn(r / (n - 1), g / (n - 1), b / (n - 1)).map((v) => v.toFixed(6)).join(' ') + '\n';
  }
  return s;
}

test('parses a 3D cube, red fastest', () => {
  const l = parseCube(cube(3, (r, g, b) => [r, g, b]));
  assert.equal(l.size, 3);
  assert.equal(l.title, 'Test look');
  assert.equal(l.data.length, 81);
  assert.deepEqual([...l.data.slice(3, 6)], [0.5, 0, 0]);
});

test('rejects 1D, wrong counts and garbage', () => {
  assert.throws(() => parseCube('LUT_1D_SIZE 4\n0 0 0\n'), /lut-1d/);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n'), /lut-invalid/);
  assert.throws(() => parseCube('hello'), /lut-invalid/);
  assert.throws(() => parseCube(cube(2, () => [0, 0, 0], 'DOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n')), /lut-invalid/);
});

test('identity samples to itself; strength mixes', () => {
  const id = parseCube(cube(5, (r, g, b) => [r, g, b]));
  const c = sample(id, [0.3, 0.62, 0.9]);
  c.forEach((v, i) => assert.ok(Math.abs(v - [0.3, 0.62, 0.9][i]) < 1e-6));
  const inv = parseCube(cube(5, (r, g, b) => [1 - r, 1 - g, 1 - b]));
  const full = sample(inv, [0.2, 0.2, 0.2]);
  assert.ok(Math.abs(full[0] - 0.8) < 1e-6);
  const half = sample(inv, [0.2, 0.2, 0.2], 0.5);
  assert.ok(Math.abs(half[0] - 0.5) < 1e-6);
  const none = sample(inv, [0.2, 0.2, 0.2], 0);
  assert.ok(Math.abs(none[0] - 0.2) < 1e-6);
});

test('domain is respected and inputs are clamped', () => {
  const l = parseCube(cube(2, (r, g, b) => [r, g, b], 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n'));
  assert.ok(Math.abs(sample(l, [1, 1, 1])[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(sample(l, [5, 5, 5])[0] - 1) < 1e-6);
});

test('texture bytes are RGBA8, clamped', () => {
  const l = parseCube(cube(2, (r) => [r * 2 - 0.5, 0.5, 1]));
  const t = textureBytes(l);
  assert.equal(t.length, 32);
  assert.deepEqual([...t.slice(0, 4)], [0, 128, 255, 255]);
  assert.equal(t[4], 255);
});

test('name and job', () => {
  assert.equal(lutName('/a/b/S-Log3 to Rec709.CUBE'), 'S-Log3 to Rec709');
  assert.equal(lutJob(null), null);
  assert.equal(lutJob({ path: '/x.cube', strength: 0 }), null);
  assert.deepEqual(lutJob({ path: '/x.cube', strength: 1.4 }), { path: '/x.cube', strength: 1 });
  assert.deepEqual(lutJob({ path: '/x.cube' }), { path: '/x.cube', strength: 1 });
});
