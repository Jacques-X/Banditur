// postmaker/render.js — draws a post onto a 1080×1350 canvas. The preview, the
// template editor and the export all call drawPost(), so what you see is what
// gets saved: photo at the bottom, the template's overlay on top of it, then the
// text on top of both.

import { FRAME_W, FRAME_H, photoRect, fitText } from './model.js';

const fontCss = (family, size) => `${size}px "${family}", "Helvetica Neue", Arial, sans-serif`;

/** Make sure the bundled fonts are ready before measuring or drawing text. */
export async function loadFonts(families) {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([...new Set(families)].map(f => document.fonts.load(fontCss(f, 40)).catch(() => {})));
}

function drawPhoto(ctx, photo) {
  ctx.fillStyle = '#16141a';
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  if (!photo) {
    // No photo yet: a calm gradient so the overlay and text can still be judged.
    const g = ctx.createLinearGradient(0, 0, 0, FRAME_H);
    g.addColorStop(0, '#6f6a76'); g.addColorStop(1, '#2f2c33');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FRAME_W, FRAME_H);
    return;
  }
  const r = photoRect(photo.w, photo.h, photo.state);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo.bitmap, r.left, r.top, r.w, r.h);
}

function drawZone(ctx, zone, text, ghost) {
  const measure = (s, size) => { ctx.font = fontCss(zone.font, size); return ctx.measureText(s).width; };
  const fit = fitText(text, zone, measure);
  if (!fit.lines.length) return fit;
  ctx.save();
  ctx.font = fontCss(zone.font, fit.size);
  ctx.fillStyle = zone.color;
  ctx.textAlign = zone.align;
  ctx.textBaseline = 'middle';
  if (ghost) ctx.globalAlpha = 0.45;
  if (zone.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = fit.size * 0.14;
    ctx.shadowOffsetY = fit.size * 0.04;
  }
  const lineH = fit.size * zone.lineHeight;
  const blockH = fit.lines.length * lineH;
  const top = zone.valign === 'top' ? zone.y
    : zone.valign === 'bottom' ? zone.y + zone.h - blockH
    : zone.y + (zone.h - blockH) / 2;
  const x = zone.align === 'left' ? zone.x : zone.align === 'right' ? zone.x + zone.w : zone.x + zone.w / 2;
  fit.lines.forEach((line, i) => ctx.fillText(line, x, top + lineH * (i + 0.5)));
  ctx.restore();
  return fit;
}

/**
 * photo:   { bitmap, w, h, state } or null
 * overlay: an image (data: URL or a same-origin image) or null
 * texts:   { [zoneId]: typed text }
 * ghost:   when true, an empty zone shows its sample text faded (preview only)
 * Returns { [zoneId]: { fits, size, lines } } so the UI can warn about names that don't fit.
 */
export function drawPost(ctx, { photo = null, overlay = null, template, texts = {}, showOverlay = true, ghost = false }) {
  ctx.clearRect(0, 0, FRAME_W, FRAME_H);
  drawPhoto(ctx, photo);
  if (overlay && showOverlay) ctx.drawImage(overlay, 0, 0, FRAME_W, FRAME_H);
  const report = {};
  if (template && showOverlay) {
    for (const zone of template.zones) {
      const typed = String(texts[zone.id] ?? '').trim();
      const useSample = ghost && !typed;
      report[zone.id] = drawZone(ctx, zone, useSample ? zone.sample : typed, useSample);
    }
  }
  return report;
}
