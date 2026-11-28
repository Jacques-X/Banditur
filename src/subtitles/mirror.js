// A hidden twin of the preview video that the speaker cut-out reads its frames from.
//
// Why a twin: drawing the picture onto a canvas needs a video loaded with `crossorigin`, and WKWebView can decode such
// a video for the canvas yet not paint it (the picture went black behind the cut-out). So the visible <video> stays
// a plain one, exactly as it was before the feature, and only this muted copy carries `crossorigin`.

/** Allowed difference (seconds) between the twin and the visible video before the twin is moved. */
export const DRIFT_PAUSED = 0.02;
export const DRIFT_PLAYING = 0.15;

/** Does the twin have to jump to the visible video's time? (`mt` = the twin's time, NaN while it has none.) */
export function needsSeek(vt, mt, playing) {
  if (!Number.isFinite(vt)) return false;
  if (!Number.isFinite(mt)) return true;
  return Math.abs(vt - mt) > (playing ? DRIFT_PLAYING : DRIFT_PAUSED);
}

/** `host`: an element in the page to hold the twin; `onFrame`: called when the twin has a new frame to draw. */
export function createMirror(video, host, onFrame = () => {}) {
  const m = document.createElement('video');
  m.muted = true;
  m.playsInline = true;
  m.preload = 'auto';
  m.crossOrigin = 'anonymous';
  m.tabIndex = -1;
  m.setAttribute('aria-hidden', 'true');
  m.className = 'sub-mirror';
  host.appendChild(m);
  let failed = false;

  function syncSrc() {
    const s = video.getAttribute('src');
    if ((m.getAttribute('src') || null) === (s || null)) return;
    failed = false;
    if (s) m.src = s;
    else { m.removeAttribute('src'); m.load(); }
  }
  function sync() {
    syncSrc();
    if (failed || !m.getAttribute('src')) return;
    const playing = !video.paused && !video.ended;
    if (m.playbackRate !== video.playbackRate) m.playbackRate = video.playbackRate;
    if (needsSeek(video.currentTime, m.currentTime, playing)) {
      try { m.currentTime = video.currentTime; } catch { /* not ready yet: loadedmetadata syncs again */ }
    }
    if (playing && m.paused) m.play().catch(() => {});
    else if (!playing && !m.paused) m.pause();
  }

  const mine = [];
  const on = (el, ev, fn) => { el.addEventListener(ev, fn); mine.push([el, ev, fn]); };
  for (const ev of ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'loadedmetadata', 'emptied', 'durationchange']) on(video, ev, sync);
  on(m, 'error', () => { failed = true; });
  on(m, 'seeked', onFrame);
  on(m, 'loadeddata', () => { sync(); onFrame(); });
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(sync) : null;
  mo?.observe(video, { attributes: true, attributeFilter: ['src'] });
  sync();

  return {
    el: m,
    sync,
    /** A frame of the right moment can be drawn now. */
    get ready() {
      return !failed && m.readyState >= 2 && !m.seeking && Number.isFinite(video.currentTime)
        && Math.abs(m.currentTime - video.currentTime) <= (video.paused ? 0.06 : 0.3);
    },
    /** The twin could not be loaded with `crossorigin` (the cut-out is then only in the export). */
    get failed() { return failed; },
    destroy() {
      mo?.disconnect();
      for (const [el, ev, fn] of mine) el.removeEventListener(ev, fn);
      m.pause();
      m.removeAttribute('src');
      m.load();
      m.remove();
    },
  };
}
