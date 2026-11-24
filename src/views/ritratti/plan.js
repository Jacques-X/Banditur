// Ritratti: what to run for a folder. Pure, so it can be tested; the screen sends the steps to
// the photo lane (lib/photojob.svelte.js), which runs them one after the other.
//
//   JPG / PNG / … folder → process_images (watermark, size, duplicates)
//   RAW folder, nothing else asked → convert_raw_batch straight into the output folder
//   RAW folder + watermark, duplicates, blur or brightness → one step: process_images reads the RAW files' embedded
//     JPEG straight from memory (no intermediate folder; also faster and no second JPEG generation).
//     With `keepJpg` the old way: convert_raw_batch into "<folder>-jpg" (full size, quality 95, kept),
//     then process_images from there
//   both kinds in the folder → the user picks which to use (`use`)

export const RAW_EXT = ['arw', 'cr2', 'cr3', 'nef', 'orf', 'rw2', 'dng', 'raf'];
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'webp'];

const ext = (p) => (p.match(/\.([^./\\]+)$/)?.[1] || '').toLowerCase();

/** files → { raw, images } counts */
export function countFiles(files = []) {
  let raw = 0, images = 0;
  for (const f of files) {
    const e = ext(f);
    if (RAW_EXT.includes(e)) raw++;
    else if (IMAGE_EXT.includes(e)) images++;
  }
  return { raw, images };
}

/** Which kind of file a run uses: 'raw' | 'jpg' | null (nothing usable). */
export function sourceOf({ raw, images }, use) {
  if (raw && images) return use === 'jpg' ? 'jpg' : 'raw';
  return raw ? 'raw' : images ? 'jpg' : null;
}

/** "Neħħi l-mċajpra": the sharpness limit for each level (see sharpness() in image_processor.rs). */
export const BLUR_LEVELS = { light: 10, normal: 25, strict: 50 };

export const jpgFolderOf = (input) => `${input.replace(/[\\/]+$/, '')}-jpg`;

/**
 * → { steps: [{ kind, cmd, args }], keptJpg?: folder } or { error }
 * opts: { input, output, counts, use, watermark, watermarkId, quality, maxDim, dedupe, blur (null | 'light' | 'normal' | 'strict'), bright (lift dark photos toward neutral), keepJpg }
 */
export function planRun(o) {
  if (!o.input) return { error: 'Agħżel il-folder tar-ritratti.' };
  const source = sourceOf(o.counts || { raw: 0, images: 0 }, o.use);
  if (!source) return { error: 'F’dan il-folder m’hemmx ritratti jew files RAW.' };
  const output = o.output || `${o.input.replace(/[\\/]+$/, '')}-riżultat`;
  const quality = Number(o.quality), maxDim = Number(o.maxDim);
  const process = (inputDir, extra = {}) => ({
    kind: 'marka', cmd: 'process_images',
    args: { inputDir, outputDir: output, watermarkId: o.watermark ? o.watermarkId || '' : '', watermark: !!o.watermark, quality, maxDim, skipDuplicates: !!o.dedupe, minSharpness: o.blur ? BLUR_LEVELS[o.blur] ?? null : null, autoBright: !!o.bright, ...extra },
  });
  if (source === 'jpg') return { steps: [process(o.input, { source: 'jpg' })] };
  if (!o.watermark && !o.dedupe && !o.blur && !o.bright) {
    return { steps: [{ kind: 'raw', cmd: 'convert_raw_batch', args: { inputDir: o.input, outputDir: output, quality, maxDim } }] };
  }
  if (!o.keepJpg) return { steps: [process(o.input, { source: 'raw' })] };
  const jpg = jpgFolderOf(o.input);
  return {
    keptJpg: jpg,
    steps: [
      { kind: 'raw', cmd: 'convert_raw_batch', args: { inputDir: o.input, outputDir: jpg, quality: 95, maxDim: 0 } },
      process(jpg, { source: 'jpg' }),
    ],
  };
}
