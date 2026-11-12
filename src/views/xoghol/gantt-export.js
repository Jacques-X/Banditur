// Gantt export: draws the chart on a canvas (always light, print-friendly) and
// saves it as PNG, or as a one-page PDF holding the same picture. The PDF
// writer is tiny on purpose: one page, one JPEG image (DCTDecode), no fonts.
import { span, chartRange, ticks, barOf, xOf, ganttRows, stepsOf } from './gantt-model.js';
import { labelById, dateText, moneyInfo, budgetTotals, moneyText } from './model.js';

const LABEL_W = 240, PAD = 28, HEAD = 64, AXIS = 44, GROUP = 28, ROW = 30, BAR = 18, SUB = 22, SUBBAR = 10;
const C = {
  bg: '#FFFFFF', fg: '#1B2330', muted: '#6B7686', line: '#E3E7ED', soft: '#F4F6F9',
  weekend: '#F8F9FB', today: '#D9483B', bar: '#5B6B82',
};
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

/** Fit text into maxW, ending in "…" when cut. */
function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo ? text.slice(0, lo).trimEnd() + '…' : '';
}

function rounded(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draw the board's dated cards. → { canvas, width, height } (width/height in
 * CSS px; the canvas is drawn at `ratio`× for sharpness).
 */
export function drawGantt({ title, columns, tasks, scale, px, today, lastId, steps = true, ratio = 2, doc = document }) {
  const { groups } = ganttRows(columns, tasks);
  const shown = groups.map((g) => ({ ...g, tasks: g.tasks.filter((t) => span(t)) })).filter((g) => g.tasks.length);
  const dated = shown.flatMap((g) => g.tasks);
  const range = chartRange(dated, today, scale);
  const trackW = range.days * px;
  const width = PAD * 2 + LABEL_W + trackW;
  const subs = (t) => (steps ? stepsOf(t) : []);
  const bodyH = shown.reduce((h, g) => h + GROUP + g.tasks.reduce((n, t) => n + ROW + subs(t).length * SUB, 0), 0) || ROW;
  const height = PAD + HEAD + AXIS + bodyH + PAD;

  const canvas = doc.createElement('canvas');
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  // Title
  ctx.fillStyle = C.fg;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText(fit(ctx, title || 'Xogħol', width - PAD * 2), PAD, PAD + 14);
  ctx.fillStyle = C.muted;
  ctx.font = `13px ${FONT}`;
  const sum = budgetTotals(tasks);
  const money = sum.count ? ` · Budget ${moneyText(sum.budget)} · Spent ${moneyText(sum.spent)} · ${sum.left < 0 ? 'Over' : 'Left'} ${moneyText(Math.abs(sum.left))}` : '';
  ctx.fillText(`Xogħol · ${dated.length === 1 ? '1 kompitu' : `${dated.length} kompiti`} · ${dateText(today, '0000')}${money}`, PAD, PAD + 40);

  const left = PAD + LABEL_W, top = PAD + HEAD, bodyTop = top + AXIS, bottom = bodyTop + bodyH;
  const { months, lines, weekends } = ticks(range, scale, px);

  // Weekends and grid
  ctx.fillStyle = C.weekend;
  for (const w of weekends) ctx.fillRect(left + w.x, bodyTop, w.w, bodyH);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  for (const l of lines) { ctx.beginPath(); ctx.moveTo(left + l.x + .5, top + 22); ctx.lineTo(left + l.x + .5, bottom); ctx.stroke(); }
  for (const m of months) { ctx.beginPath(); ctx.moveTo(left + m.x + .5, top); ctx.lineTo(left + m.x + .5, bottom); ctx.stroke(); }

  // Axis
  ctx.font = `600 12px ${FONT}`;
  ctx.fillStyle = C.fg;
  for (const m of months) ctx.fillText(fit(ctx, m.label, m.w - 10), left + m.x + 6, top + 11);
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = C.muted;
  for (const l of lines) if (l.label) ctx.fillText(l.label, left + l.x + 4, top + 32);
  ctx.strokeStyle = C.line;
  ctx.beginPath(); ctx.moveTo(PAD, bodyTop + .5); ctx.lineTo(width - PAD, bodyTop + .5); ctx.stroke();

  // Rows
  let y = bodyTop;
  if (!shown.length) {
    ctx.fillStyle = C.muted;
    ctx.font = `13px ${FONT}`;
    ctx.fillText('L-ebda kompitu b’dati.', PAD, y + ROW / 2);
  }
  for (const g of shown) {
    ctx.fillStyle = C.soft;
    ctx.fillRect(PAD, y, LABEL_W + trackW, GROUP);
    ctx.fillStyle = C.muted;
    ctx.font = `700 11px ${FONT}`;
    ctx.fillText(fit(ctx, g.column.title.toUpperCase(), LABEL_W - 16), PAD + 8, y + GROUP / 2);
    const gt = budgetTotals(g.tasks);
    if (gt.count) {
      ctx.font = `600 11px ${FONT}`;
      ctx.fillStyle = gt.left < 0 ? C.today : C.muted;
      ctx.textAlign = 'right';
      ctx.fillText(`${moneyText(gt.spent)} / ${moneyText(gt.budget)}`, PAD + LABEL_W - 8, y + GROUP / 2);
      ctx.textAlign = 'left';
    }
    y += GROUP;
    const done = g.column.id === lastId && columns.length > 1;
    for (const t of g.tasks) {
      ctx.fillStyle = C.fg;
      ctx.font = `13px ${FONT}`;
      ctx.globalAlpha = done ? 0.55 : 1;
      const m = moneyInfo(t);
      let mw = 0;
      if (m) {
        ctx.font = `600 11px ${FONT}`;
        mw = ctx.measureText(m.text).width + 8;
        ctx.fillStyle = m.tone === 'over' ? C.today : C.muted;
        ctx.textAlign = 'right';
        ctx.fillText(m.text, PAD + LABEL_W - 8, y + ROW / 2);
        ctx.textAlign = 'left';
        ctx.fillStyle = C.fg;
        ctx.font = `13px ${FONT}`;
      }
      ctx.fillText(fit(ctx, t.title, LABEL_W - 20 - mw), PAD + 8, y + ROW / 2);
      const b = barOf(t, range, px);
      ctx.fillStyle = labelById(t.label)?.color || C.bar;
      ctx.globalAlpha = done ? 0.4 : 1;
      rounded(ctx, left + b.x + 1, y + (ROW - BAR) / 2, Math.max(b.w - 2, 4), BAR, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = `600 11px ${FONT}`;
      const inside = fit(ctx, t.title, b.w - 12);
      if (inside && inside === t.title) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(inside, left + b.x + 7, y + ROW / 2);
      } else {
        ctx.fillStyle = C.muted;
        ctx.fillText(fit(ctx, t.title, Math.max(0, trackW - b.x - b.w - 10)), left + b.x + b.w + 6, y + ROW / 2);
      }
      ctx.strokeStyle = C.line;
      ctx.beginPath(); ctx.moveTo(PAD, y + ROW + .5); ctx.lineTo(width - PAD, y + ROW + .5); ctx.stroke();
      y += ROW;
      for (const s of subs(t)) {
        const sb = barOf(s, range, px);
        ctx.font = `12px ${FONT}`;
        ctx.fillStyle = C.muted;
        ctx.globalAlpha = done || s.done ? 0.55 : 1;
        const sm = moneyInfo(s);
        let smw = 0;
        if (sm) {
          ctx.font = `600 10.5px ${FONT}`;
          smw = ctx.measureText(sm.text).width + 8;
          ctx.fillStyle = sm.tone === 'over' ? C.today : C.muted;
          ctx.textAlign = 'right';
          ctx.fillText(sm.text, PAD + LABEL_W - 8, y + SUB / 2);
          ctx.textAlign = 'left';
          ctx.font = `12px ${FONT}`;
          ctx.fillStyle = C.muted;
        }
        ctx.fillText(fit(ctx, `↳ ${s.text}`, LABEL_W - 28 - smw), PAD + 20, y + SUB / 2);
        ctx.fillStyle = labelById(t.label)?.color || C.bar;
        ctx.globalAlpha = done || s.done ? 0.35 : 0.8;
        rounded(ctx, left + sb.x + 1, y + (SUB - SUBBAR) / 2, Math.max(sb.w - 2, 4), SUBBAR, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = C.line;
        ctx.beginPath(); ctx.moveTo(PAD, y + SUB + .5); ctx.lineTo(width - PAD, y + SUB + .5); ctx.stroke();
        y += SUB;
      }
    }
  }

  // Today
  const tx = xOf(today, range, px);
  if (tx >= 0 && tx <= trackW) {
    ctx.strokeStyle = C.today;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(left + tx + px / 2, top + 22); ctx.lineTo(left + tx + px / 2, bottom); ctx.stroke();
  }
  return { canvas, width, height };
}

export const A4 = { w: 595.28, h: 841.89 }; // points
const A4_MARGIN = 28;

/**
 * An A4 page for a picture of `w` × `h` px: landscape when the picture is wider than
 * tall, portrait otherwise; the picture is scaled to fit inside the margins (never
 * distorted) and centred. → { page: { w, h, x, y }, width, height } — width/height = the
 * picture's size on the page in points.
 */
export function a4Fit(w, h) {
  const landscape = w >= h;
  const pw = landscape ? A4.h : A4.w, ph = landscape ? A4.w : A4.h;
  const k = Math.min((pw - 2 * A4_MARGIN) / w, (ph - 2 * A4_MARGIN) / h);
  const width = w * k, height = h * k;
  return { page: { w: pw, h: ph, x: (pw - width) / 2, y: (ph - height) / 2 }, width, height };
}

const ascii = (s) => new TextEncoder().encode(s);

/**
 * A one-page PDF showing a JPEG. widthPt/heightPt: the page size in points;
 * imgW/imgH: the JPEG's pixel size. → Uint8Array
 */
export function pdfWithJpeg(jpeg, imgW, imgH, widthPt, heightPt, page = null) {
  // Without `page` the page is exactly the picture; with it ({ w, h, x, y } from a4Fit) the
  // picture is placed at x, y on a page of w × h points.
  const pw = page ? page.w : widthPt, ph = page ? page.h : heightPt;
  const W = +pw.toFixed(2), H = +ph.toFixed(2);
  const [px_, py_] = page ? [+page.x.toFixed(2), +page.y.toFixed(2)] : [0, 0];
  const [dw, dh] = [+widthPt.toFixed(2), +heightPt.toFixed(2)];
  const content = `q ${dw} 0 0 ${dh} ${px_} ${py_} cm /Im0 Do Q\n`;
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (p) => { const b = typeof p === 'string' ? ascii(p) : p; parts.push(b); length += b.length; };
  const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n${body}\nendobj\n`); };

  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}endstream`);

  const xref = length;
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (let n = 1; n <= 5; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(`${table}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const blobOf = (canvas, type, quality) => new Promise((ok, fail) =>
  canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Ma stajtx noħloq l-istampa.'))), type, quality));

/** The chart as file bytes: 'png' or 'pdf'. */
export async function exportBytes(chart, format) {
  if (format === 'png') return new Uint8Array(await (await blobOf(chart.canvas, 'image/png')).arrayBuffer());
  const jpeg = new Uint8Array(await (await blobOf(chart.canvas, 'image/jpeg', 0.92)).arrayBuffer());
  // Always an A4 page (landscape for wide charts), the chart scaled to fit.
  const fit = a4Fit(chart.width, chart.height);
  return pdfWithJpeg(jpeg, chart.canvas.width, chart.canvas.height, fit.width, fit.height, fit.page);
}
