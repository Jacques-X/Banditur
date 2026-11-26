<script>
  // Live LUT preview: a WebGL2 canvas laid exactly over the <video>, redrawn every frame. The
  // video's pixels go into a 2D texture and the .cube into a 3D texture (hardware trilinear),
  // mixed with the original by `strength` — the same maths as the export's lut3d + blend.
  // If WebGL2 is missing or the frame can't be read (cross-origin), it calls onfail() and the
  // plain video shows through; the export still applies the LUT.
  import { onMount } from 'svelte';
  import { textureBytes } from './lut.js';

  let { video, lut, strength = 1, width = 0, height = 0, onfail = () => {} } = $props();
  let canvas = $state();
  let gl = null, prog = null, vTex = null, lTex = null, uStrength = null, uSize = null, uMin = null, uMax = null, dead = false;
  let raf = 0, vfc = 0;

  const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o;
uniform sampler2D frame; uniform sampler3D lut; uniform float strength; uniform float size;
uniform vec3 dmin; uniform vec3 dmax;
void main() {
  vec3 c = clamp(texture(frame, uv).rgb, 0.0, 1.0);
  vec3 d = clamp((c - dmin) / (dmax - dmin), 0.0, 1.0);
  vec3 g = texture(lut, d * ((size - 1.0) / size) + 0.5 / size).rgb;
  o = vec4(mix(c, g, strength), 1.0);
}`;

  function fail(why) {
    if (dead) return;
    dead = true;
    console.warn('[murtali] LUT preview off:', why);
    onfail(why);
  }
  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  }
  function setup() {
    gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('no-webgl2');
    prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    vTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, vTex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    lTex = gl.createTexture();
    gl.uniform1i(gl.getUniformLocation(prog, 'frame'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'lut'), 1);
    uStrength = gl.getUniformLocation(prog, 'strength');
    uSize = gl.getUniformLocation(prog, 'size');
    uMin = gl.getUniformLocation(prog, 'dmin');
    uMax = gl.getUniformLocation(prog, 'dmax');
  }
  function uploadLut(l) {
    if (!gl || !l) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, l.size, l.size, l.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureBytes(l));
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    gl.uniform1f(uSize, l.size);
    gl.uniform3fv(uMin, l.min);
    gl.uniform3fv(uMax, l.max);
    gl.activeTexture(gl.TEXTURE0);
  }
  function draw() {
    if (dead || !gl || !video || video.readyState < 2) return;
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return;
    try {
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, vTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.uniform1f(uStrength, Math.max(0, Math.min(1, strength)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } catch (e) {
      fail(e?.name === 'SecurityError' ? 'cross-origin' : String(e));
    }
  }
  // Redraw on every decoded frame while playing, and once after seeks / setting changes.
  function frameLoop() {
    draw();
    if (dead) return;
    if (video?.requestVideoFrameCallback) vfc = video.requestVideoFrameCallback(frameLoop);
    else raf = requestAnimationFrame(frameLoop);
  }

  onMount(() => {
    try { setup(); uploadLut(lut); } catch (e) { fail(String(e?.message || e)); return; }
    const redraw = () => draw();
    video.addEventListener('seeked', redraw);
    video.addEventListener('loadeddata', redraw);
    frameLoop();
    return () => {
      dead = true;
      video.removeEventListener('seeked', redraw);
      video.removeEventListener('loadeddata', redraw);
      cancelAnimationFrame(raf);
      if (vfc && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(vfc);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  });
  $effect(() => { uploadLut(lut); draw(); });
  $effect(() => { strength; draw(); });
  // canvas pixels: the on-screen size × device pixel ratio (not the 4K source: the GPU scales)
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  $effect(() => { if (canvas) { canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = Math.max(1, Math.round(height * dpr)); draw(); } });
</script>

<canvas bind:this={canvas} class="lut" aria-hidden="true"></canvas>

<style>
  .lut { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; display: block; }
</style>
