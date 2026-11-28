// The captions editor's side panel: which tab is open and which folded sections are open (both remembered),
// and the number on the "Iċċekkja" tab. Pure, so it is tested without a page (panel.test.mjs).

export const TABS = ['text', 'style', 'check'];
export const TAB_KEY = 'banditur_sub_tab';
export const SECTIONS_KEY = 'banditur_sub_sections';

/** A remembered tab name, or the first tab when it is unknown. */
export const normalizeTab = v => (TABS.includes(v) ? v : TABS[0]);

/** The count shown on the "Iċċekkja" tab: words the engine is unsure of plus captions that are hard to read. */
export const checkBadge = (unsureWords, hardCues) => Math.max(0, Math.floor(unsureWords) || 0) + Math.max(0, Math.floor(hardCues) || 0);

/** The badge text: nothing for 0, "99+" for a very long list. */
export const badgeLabel = n => (n > 0 ? (n > 99 ? '99+' : String(n)) : '');

/** A stored `{ sectionId: boolean }` map, with anything else dropped. */
export function restoreSections(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** Is section `id` open? Untouched sections use their default. */
export const sectionOpen = (map, id, dflt = false) => (typeof map?.[id] === 'boolean' ? map[id] : dflt);

/** The map with section `id` set open or closed (a new object). */
export const withSection = (map, id, open) => ({ ...restoreSections(map), [id]: !!open });
