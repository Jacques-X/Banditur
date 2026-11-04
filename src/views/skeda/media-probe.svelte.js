// Browser side of the media pre-flight: measure a picked photo/video once
// (size, shape, length) and rebuild a photo as a JPEG that fits — converted,
// cropped, padded or shrunk. The rules themselves are in media-check.js.
import { SvelteMap } from 'svelte/reactivity';
import { fitPlan } from './media-check.js';

/** File → { type, size, width, height, duration? } once measured. */
export const mediaInfo = new SvelteMap();
const pending = new Set();

/** Measure a file (once). Files that cannot be read stay unmeasured and are not checked. */
export async function probe(file) {
  if (!file || mediaInfo.has(file) || pending.has(file)) return;
  pending.add(file);
  try {
    const base = { type: file.type, size: file.size };
    if (file.type.startsWith('image/')) {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      mediaInfo.set(file, { ...base, width: bmp.width, height: bmp.height });
      bmp.close();
    } else if (file.type.startsWith('video/')) {
      mediaInfo.set(file, { ...base, ...(await videoMeta(file)) });
    }
  } catch {
    /* unreadable here (e.g. HEIC): the server-side checks still apply */
  } finally {
    pending.delete(file);
  }
}

function videoMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = (fn, value) => { clearTimeout(timer); URL.revokeObjectURL(url); v.removeAttribute('src'); fn(value); };
    const timer = setTimeout(() => done(reject, new Error('timeout')), 15000);
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => done(resolve, { width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    v.onerror = () => done(reject, new Error('unreadable'));
    v.src = url;
  });
}

/**
 * A new JPEG File from `file`: `fix.op` is 'jpeg' (convert / shrink only),
 * 'crop' or 'pad' to `fix.ratio`. Padding fills the sides with a blurred,
 * darkened copy of the photo. `target` = { maxWidth, maxHeight, maxBytes }.
 */
export async function fixPhoto(file, fix, target) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const plan = fitPlan(bmp.width, bmp.height, fix.op, fix.ratio, target);
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, plan.width, plan.height);
    if (plan.pad) {
      const cover = Math.max(plan.width / bmp.width, plan.height / bmp.height);
      const w = bmp.width * cover, h = bmp.height * cover;
      ctx.filter = 'blur(40px) brightness(0.55)';
      ctx.drawImage(bmp, (plan.width - w) / 2, (plan.height - h) / 2, w, h);
      ctx.filter = 'none';
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, ...plan.src, ...plan.dst);
    let blob;
    for (const q of [0.92, 0.86, 0.8, 0.72, 0.62]) {
      blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
      if (!blob) throw new Error('Ma stajtx noħloq il-JPG.');
      if (blob.size <= target.maxBytes) break;
    }
    if (blob.size > target.maxBytes) throw new Error('Ir-ritratt baqa’ kbir wisq anke wara li ċċekken.');
    const name = file.name.replace(/\.[^.]+$/, '') + (fix.op === 'jpeg' ? '' : fix.op === 'crop' ? '-maqtugħ' : '-margini') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    bmp.close();
  }
}
