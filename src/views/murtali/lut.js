// .cube LUTs for the Murtali preview (the export applies the same file with ffmpeg's lut3d, see
// sidecar/lut.py). Pure: parse, sample (trilinear, as a check of the GPU preview), and pack for a
// WebGL2 3D texture. A LUT is one per project: settings.lut = { path, name, strength } | null.

/** Parse a 3D .cube file → { title, size, min, max, data: Float32Array(size³·3), red fastest }. */
export function parseCube(text) {
  let title = '', size = 0;
  let min = [0, 0, 0], max = [1, 1, 1];
  const vals = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue; }
    if (key === 'LUT_1D_SIZE') throw new Error('lut-1d');
    if (key === 'LUT_3D_SIZE') { size = parseInt(parts[1], 10); continue; }
    if (key === 'DOMAIN_MIN') { min = parts.slice(1, 4).map(Number); continue; }
    if (key === 'DOMAIN_MAX') { max = parts.slice(1, 4).map(Number); continue; }
    if (/^[A-Z_]+$/.test(key)) continue;                     // other keywords (LUT_3D_INPUT_RANGE, …)
    if (parts.length < 3) throw new Error('lut-invalid');
    vals.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!(size >= 2 && size <= 256)) throw new Error('lut-invalid');
  if (vals.length !== size ** 3 * 3 || vals.some((v) => !Number.isFinite(v))) throw new Error('lut-invalid');
  if ([...min, ...max].some((v) => !Number.isFinite(v)) || min.some((v, i) => !(max[i] > v))) throw new Error('lut-invalid');
  return { title, size, min, max, data: Float32Array.from(vals) };
}

/** Apply the LUT to one colour (0–1 each), trilinear, then mix with the original by strength. */
export function sample(lut, rgb, strength = 1) {
  const { size: n, data, min, max } = lut;
  const pos = rgb.map((v, i) => Math.max(0, Math.min(1, (v - min[i]) / (max[i] - min[i]))) * (n - 1));
  const i0 = pos.map((p) => Math.min(n - 2, Math.floor(p)));
  const f = pos.map((p, i) => p - i0[i]);
  const at = (r, g, b, c) => data[((b * n + g) * n + r) * 3 + c];
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let v = 0;
    for (let k = 0; k < 8; k++) {
      const dr = k & 1, dg = (k >> 1) & 1, db = (k >> 2) & 1;
      const w = (dr ? f[0] : 1 - f[0]) * (dg ? f[1] : 1 - f[1]) * (db ? f[2] : 1 - f[2]);
      v += w * at(i0[0] + dr, i0[1] + dg, i0[2] + db, c);
    }
    out[c] = rgb[c] + (v - rgb[c]) * strength;
  }
  return out;
}

/** RGBA8 texels for texImage3D (width = height = depth = size; red fastest, as in the file). */
export function textureBytes(lut) {
  const n3 = lut.size ** 3, out = new Uint8Array(n3 * 4);
  for (let i = 0; i < n3; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(Math.max(0, Math.min(1, lut.data[i * 3 + c])) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** "S-Log3 to Rec709.cube" → "S-Log3 to Rec709" */
export const lutName = (path) => String(path ?? '').split(/[\\/]/).pop().replace(/\.cube$/i, '');

/** The lut setting sent to the sidecar, or null when off. */
export function lutJob(lut) {
  if (!lut?.path) return null;
  const strength = Math.max(0, Math.min(1, Number(lut.strength ?? 1)));
  return strength < 0.005 ? null : { path: lut.path, strength };
}
