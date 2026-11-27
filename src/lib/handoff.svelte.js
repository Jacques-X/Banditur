// Small hand-offs between screens (a folder for Ritratti).
export const handoff = $state({ ritrattiInput: '' });

export const handoffPost = $state({ id: '' });

/** Reopen a saved subtitle or post project in its tool. */
export async function openProject(p) {
  const { openTool } = await import('./app.svelte.js');
  if (p.kind === 'subtitles') {
    const { handoffTx } = await import('../views/traskrittura/handoff.svelte.js');
    handoffTx.open = p.mediaPath;
    openTool('traskrittura');
  } else if (p.kind === 'fireworks') {
    const { handoffFw } = await import('../views/murtali/handoff.svelte.js');
    handoffFw.open = p.id;
    openTool('murtali');
  } else {
    handoffPost.id = p.id;
    openTool('posts');
  }
}
