// Where files dropped on a screen without its own drop target should go.
// Pure, so it can be tested: the caller does the navigation.
//
//   video / audio       → Traskrittura (the first one)
//   RAW photos          → Ritratti, with their folder
//   JPG / PNG / WebP    → a new post in Skeda (up to 10)
//   a folder (no ext.)  → Ritratti
//
// Anything else returns null and the caller says it cannot be used.

export const MEDIA_EXT = ['mp4', 'mov', 'mp3', 'wav'];
export const RAW_EXT = ['arw', 'cr2', 'cr3', 'nef', 'orf', 'rw2', 'dng', 'raf'];
export const PHOTO_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_POST_FILES = 10;

const name = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
export const extOf = (p) => {
  const n = name(p);
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(i + 1).toLowerCase() : '';
};
export const parentOf = (p) => p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '') || '/';

/** paths → { to: 'traskrittura'|'ritratti'|'skeda', paths, label } | null */
export function routeDrop(paths = []) {
  const list = paths.filter(Boolean);
  if (!list.length) return null;
  const media = list.filter((p) => MEDIA_EXT.includes(extOf(p)));
  if (media.length) return { to: 'traskrittura', paths: [media[0]], label: 'Traskrittura' };
  const raw = list.filter((p) => RAW_EXT.includes(extOf(p)));
  if (raw.length) return { to: 'ritratti', paths: [parentOf(raw[0])], label: 'Ritratti' };
  const photos = list.filter((p) => PHOTO_EXT.includes(extOf(p)));
  if (photos.length) return { to: 'skeda', paths: photos.slice(0, MAX_POST_FILES), label: 'Skeda', capped: photos.length > MAX_POST_FILES };
  const folder = list.find((p) => !extOf(p));
  if (folder) return { to: 'ritratti', paths: [folder], label: 'Ritratti' };
  return null;
}
