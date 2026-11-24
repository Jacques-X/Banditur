import test from 'node:test';
import assert from 'node:assert/strict';
import { countFiles, sourceOf, planRun, jpgFolderOf } from './plan.js';

test('counting RAW and image files', () => {
  assert.deepEqual(countFiles(['/a/1.ARW', '/a/1.JPG', '/a/2.cr3', '/a/v.mp4', '/a/x.png']), { raw: 2, images: 2 });
  assert.deepEqual(countFiles([]), { raw: 0, images: 0 });
});

test('which files a run uses', () => {
  assert.equal(sourceOf({ raw: 3, images: 0 }), 'raw');
  assert.equal(sourceOf({ raw: 0, images: 3 }), 'jpg');
  assert.equal(sourceOf({ raw: 3, images: 3 }), 'raw');
  assert.equal(sourceOf({ raw: 3, images: 3 }, 'jpg'), 'jpg');
  assert.equal(sourceOf({ raw: 0, images: 0 }), null);
});

const base = { input: '/p/Festa', output: '/p/Festa-riżultat', quality: 85, maxDim: 2048, watermarkId: 'pack/ganni' };

test('a JPG folder is one watermark step', () => {
  const r = planRun({ ...base, counts: { raw: 0, images: 4 }, watermark: true, dedupe: true });
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].cmd, 'process_images');
  assert.deepEqual(r.steps[0].args, {
    inputDir: '/p/Festa', outputDir: '/p/Festa-riżultat', watermarkId: 'pack/ganni', watermark: true, quality: 85, maxDim: 2048,
    skipDuplicates: true, minSharpness: null, autoBright: false, source: 'jpg',
  });
});

test('RAW with nothing else asked converts straight into the output folder', () => {
  const r = planRun({ ...base, counts: { raw: 4, images: 0 }, watermark: false, dedupe: false });
  assert.deepEqual(r.steps, [{ kind: 'raw', cmd: 'convert_raw_batch', args: { inputDir: '/p/Festa', outputDir: '/p/Festa-riżultat', quality: 85, maxDim: 2048 } }]);
  assert.equal(r.keptJpg, undefined);
});

test('RAW with a watermark is one step straight from the RAW files', () => {
  const r = planRun({ ...base, counts: { raw: 4, images: 0 }, watermark: true });
  assert.equal(r.keptJpg, undefined);
  assert.deepEqual(r.steps.map((s) => s.cmd), ['process_images']);
  assert.equal(r.steps[0].args.inputDir, '/p/Festa');
  assert.equal(r.steps[0].args.source, 'raw');
  assert.equal(r.steps[0].args.quality, 85);
});

test('RAW with a watermark and "keep the JPGs" converts to <folder>-jpg first, then watermarks from there', () => {
  const r = planRun({ ...base, counts: { raw: 4, images: 0 }, watermark: true, keepJpg: true });
  assert.equal(r.keptJpg, '/p/Festa-jpg');
  assert.deepEqual(r.steps.map((s) => s.cmd), ['convert_raw_batch', 'process_images']);
  assert.deepEqual(r.steps[0].args, { inputDir: '/p/Festa', outputDir: '/p/Festa-jpg', quality: 95, maxDim: 0 });
  assert.equal(r.steps[1].args.inputDir, '/p/Festa-jpg');
  assert.equal(r.steps[1].args.source, 'jpg');
  assert.equal(r.steps[1].args.outputDir, '/p/Festa-riżultat');
});

test('a mixed folder uses what was chosen; empty input and empty folders are errors', () => {
  assert.equal(planRun({ ...base, counts: { raw: 2, images: 2 }, use: 'jpg', watermark: true }).steps[0].args.inputDir, '/p/Festa');
  assert.ok(planRun({ ...base, input: '' }).error);
  assert.ok(planRun({ ...base, counts: { raw: 0, images: 0 } }).error);
  assert.equal(planRun({ ...base, output: '', counts: { raw: 0, images: 1 } }).steps[0].args.outputDir, '/p/Festa-riżultat');
  assert.equal(jpgFolderOf('/p/Festa/'), '/p/Festa-jpg');
});

test('blur: sensitivity becomes a limit, RAW is not converted straight any more', () => {
  const r = planRun({ ...base, counts: { raw: 0, images: 4 }, watermark: false, dedupe: false, blur: 'strict' });
  assert.equal(r.steps[0].args.minSharpness, 50);
  assert.equal('blurryFiles' in r.steps[0].args, false);
  assert.equal(planRun({ ...base, counts: { raw: 0, images: 4 }, watermark: false, dedupe: false, blur: null }).steps[0].args.minSharpness, null);
  const raw = planRun({ ...base, counts: { raw: 5, images: 0 }, watermark: false, dedupe: false, blur: 'normal' });
  assert.equal(raw.steps.length, 1); // RAW goes straight through the filter
  assert.equal(raw.steps[0].args.minSharpness, 25);
  assert.equal(raw.steps[0].args.source, 'raw');
});

test('auto-brightness is passed on, and RAW with it goes through the processing step', () => {
  assert.equal(planRun({ ...base, counts: { raw: 0, images: 3 }, watermark: false, bright: true }).steps[0].args.autoBright, true);
  assert.equal(planRun({ ...base, counts: { raw: 0, images: 3 }, watermark: false }).steps[0].args.autoBright, false);
  const raw = planRun({ ...base, counts: { raw: 4, images: 0 }, watermark: false, bright: true });
  assert.deepEqual(raw.steps.map((s) => s.cmd), ['process_images']);
  assert.equal(raw.steps[0].args.source, 'raw');
});
