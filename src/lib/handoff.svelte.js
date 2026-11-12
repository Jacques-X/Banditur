// Small hand-offs between Studio tools (e.g. RAW → JPG output into Marka).
export const handoff = $state({ markaInput: '' });

export async function sendPaths(paths, { contentType = 'post', caption = '', eventId = '' } = {}) {
  const { replaceWith, addMedia } = await import('../views/skeda/composer.svelte.js');
  const { go, toast } = await import('./app.svelte.js');
  const { fileFromPath } = await import('./tauri.js');
  try {
    const files = await Promise.all(paths.map((p) => fileFromPath(p)));
    const done = await replaceWith((post) => {
      post.contentType = contentType;
      post.caption = caption;
      post.eventId = eventId;
      addMedia(files);
    });
    if (done) go('skeda');
    return done;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}
export async function sendFolder(path) {
  const { openDialog } = await import('./tauri.js');
  const paths = await openDialog({
    defaultPath: path,
    multiple: true,
    filters: [{ name: 'Ritratti', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  if (paths?.length) return sendPaths(Array.isArray(paths) ? paths : [paths]);
}

export const handoffPost = $state({ id: '' });
