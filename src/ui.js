// Small dependency-free helpers shared by the views and the vanilla modules
// (subtitle editor, post maker); safe to import from node tests.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Last part of a path ("/a/b/clip.mp4" → "clip.mp4"), for / and \ separators. */
export const baseName = p => String(p ?? '').split(/[\\/]/).pop();

/** The default output folder next to a source folder: "/a/Ritratti" → "/a/Ritratti-riżultat". */
export function resultFolder(p) {
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(sep);
  const name = parts.pop();
  return [...parts, `${name}-riżultat`].join(sep);
}
