// Posts production helpers (projects / template packs / batch) that need no
// DOM: CSV names, .btemplate pack checks and the starter template's layout.
// Tested in production.test.mjs; the panel is views/posts/WorkPanel.svelte.
import { normalizeTemplate, newZone, makeId } from './model.js';

export const PACK_FORMAT = 'banditur-templates';
const MAX_PACK_TEMPLATES = 100;
const MAX_OVERLAY_BYTES = 40 * 1024 * 1024;

/** Names from a CSV (first column, quoted or not), skipping a "isem"/"name" header and blank lines. */
export function namesFromCsv(text) {
  return String(text || '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.match(/^"((?:[^"]|"")*)"/)?.[1].replaceAll('""', '"') || l.split(',')[0])
    .filter((s, i) => i || !/^(isem|name)$/i.test(s))
    .join('\n');
}

/** Non-empty trimmed lines of the names box. */
export const nameLines = (text) =>
  String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

/** The contents of an exported .btemplate file. */
export const packJson = (templates) => JSON.stringify({ format: PACK_FORMAT, version: 1, templates });

/**
 * Templates from a parsed .btemplate pack, ready for `import_post_templates`:
 * fresh ids that don't clash with `takenIds`, overlays decoded to bytes.
 * Throws a Maltese message for anything invalid.
 */
export function templatesFromPack(pack, takenIds = []) {
  if (
    !pack ||
    pack.format !== PACK_FORMAT ||
    pack.version !== 1 ||
    !Array.isArray(pack.templates) ||
    pack.templates.length > MAX_PACK_TEMPLATES
  )
    throw new Error('Pack mhux validu.');
  const valid = pack.templates.map((t) => {
    const manifest = normalizeTemplate(t?.manifest);
    if (!manifest || !/^data:image\/png;base64,/.test(t.overlay || ''))
      throw new Error('Template jew overlay mhux valida.');
    return { manifest, overlay: t.overlay };
  });
  const taken = [...takenIds];
  return valid.map((t) => {
    t.manifest.id = makeId(t.manifest.id, taken);
    taken.push(t.manifest.id);
    const raw = atob(t.overlay.split(',')[1]);
    if (raw.length > MAX_OVERLAY_BYTES) throw new Error('Overlay kbir wisq.');
    return { manifest: t.manifest, overlayBytes: Array.from(raw, (c) => c.charCodeAt(0)) };
  });
}

/** The manifest of the branded starter template for a frame `height` (1080 wide). */
export function starterManifest({ height, caption, takenIds = [] }) {
  return normalizeTemplate({
    id: makeId('Awguri', takenIds),
    name: 'Awguri',
    width: 1080,
    height,
    caption: caption || 'Awguri [ISEM]!',
    zones: [{ ...newZone(), x: 80, y: Math.round(height * 0.8), w: 920, h: Math.round(height * 0.14), maxSize: 90 }],
  });
}

/** Draw the starter overlay: brand-colour bands, the brand name, and the logo if any. */
export function drawStarterOverlay(ctx, { height, color, name, logo }) {
  ctx.fillStyle = color;
  ctx.fillRect(0, height * 0.75, 1080, height * 0.25);
  ctx.fillRect(0, 0, 1080, 90);
  ctx.fillStyle = '#fff';
  ctx.font = '36px "Montserrat Bold"';
  ctx.textAlign = 'center';
  ctx.fillText(name || 'Awguri', 540, 58);
  if (logo) ctx.drawImage(logo, 30, 110, 90, (90 * logo.height) / logo.width);
}
