// The Studio's Video tab holds two screens: Traskrittura and Murtali (components/VideoTabs.svelte).
// `app.tool` always names the screen actually open; the toolbar button is the group 'video'.
// Pure, so it can be tested; the state lives in app.svelte.js.

export const VIDEO_PARTS = ['traskrittura', 'murtali'];

export const isVideoPart = (id) => VIDEO_PARTS.includes(id);

/** The screen an id opens: 'video' → the part used last (Traskrittura by default); anything else is itself. */
export function resolveTool(id, videoPart) {
  if (id === 'video') return isVideoPart(videoPart) ? videoPart : 'traskrittura';
  return id;
}

/** Is the toolbar button `buttonId` the one for the screen open now? ('video' covers both parts.) */
export const toolbarActive = (buttonId, openTool) =>
  buttonId === openTool || (buttonId === 'video' && isVideoPart(openTool));

/** A saved tool id → the screen to restore, or null when it is unknown. */
export function restoreTool(saved, buttonIds, videoPart) {
  const id = resolveTool(saved, videoPart);
  return buttonIds.includes(saved) || buttonIds.includes(id) || isVideoPart(id) ? id : null;
}
