// M3: This API is consumed only by the Tauri desktop app (no browser origin).
// A wildcard CORS header is unnecessary and lets any website exercise the API
// from a browser if the key leaks into a web context. CORS headers are dropped.
// OPTIONS preflight is rejected with 405 since the desktop never sends it.
export function cors(_req, _res) {
  return false;
}
