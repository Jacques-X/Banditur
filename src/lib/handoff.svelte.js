// Small hand-offs between Studio tools (e.g. RAW → JPG output into Marka).
export const handoff = $state({ markaInput: '' });

export async function sendPaths(paths, { contentType = 'post', caption = '', eventId = '' } = {}) {
  const { post, saveDraft, addMedia, changed } = await import('../views/skeda/composer.svelte.js');
  const { confirm, go, toast } = await import('./app.svelte.js');
  const { fileFromPath } = await import('./tauri.js');
  if (post.caption.trim() || post.media.length || post.remoteMedia.length) {
    if (
      !(await confirm('Iżżomm il-post attwali bħala draft qabel tuża dan il-medjum?', {
        yes: 'Żomm u kompli',
        no: 'Ibqa’ hawn',
      }))
    )
      return false;
    try {
      await saveDraft();
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  }
  try {
    const files = await Promise.all(paths.map((p) => fileFromPath(p)));
    const { reset } = await import('../views/skeda/composer.svelte.js');
    reset();
    post.contentType = contentType;
    post.caption = caption;
    post.eventId = eventId;
    addMedia(files);
    changed();
    go('skeda');
    return true;
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
