import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfWithJpeg } from './gantt-export.js';

test('the PDF wrapper is well-formed: header, objects at their xref offsets, trailer', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = pdfWithJpeg(jpeg, 200, 100, 150, 75);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.endsWith('%%EOF\n'));
  const startxref = Number(text.match(/startxref\n(\d+)\n/)[1]);
  assert.ok(text.slice(startxref).startsWith('xref\n0 6\n'));
  const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, 5);
  offsets.forEach((o, i) => assert.ok(text.slice(o).startsWith(`${i + 1} 0 obj\n`), `object ${i + 1}`));
  assert.match(text, /\/MediaBox \[0 0 150 75\]/);
  assert.match(text, /\/Width 200 \/Height 100 .*\/Length 9 >>/);
  // The image bytes sit unchanged inside the stream.
  const at = text.indexOf('stream\n', text.indexOf('4 0 obj')) + 7;
  assert.deepEqual([...pdf.slice(at, at + jpeg.length)], [...jpeg]);
  const content = text.match(/5 0 obj\n<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/);
  assert.equal(Number(content[1]), content[2].length);
});

import { a4Fit, A4 } from './gantt-export.js';

test('the PDF page is always A4: landscape for wide charts, portrait for tall ones, picture fitted and centred', () => {
  const wide = a4Fit(2000, 600);
  assert.deepEqual([wide.page.w, wide.page.h], [A4.h, A4.w]);
  const tall = a4Fit(700, 1500);
  assert.deepEqual([tall.page.w, tall.page.h], [A4.w, A4.h]);
  for (const f of [wide, tall, a4Fit(100, 100)]) {
    assert.ok(f.page.x >= 0 && f.page.y >= 0 && f.page.x + f.width <= f.page.w && f.page.y + f.height <= f.page.h);
    assert.ok(Math.abs(f.page.x * 2 + f.width - f.page.w) < 1e-6 && Math.abs(f.page.y * 2 + f.height - f.page.h) < 1e-6);
  }
  assert.ok(Math.abs(wide.width / wide.height - 2000 / 600) < 1e-9, 'not distorted');
  const pdf = Buffer.from(pdfWithJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 400, 120, wide.width, wide.height, wide.page)).toString('latin1');
  assert.match(pdf, /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.match(pdf, new RegExp(`q ${wide.width.toFixed(2).replace('.', '\\.')} 0 0 ${wide.height.toFixed(2).replace('.', '\\.')} `));
});
