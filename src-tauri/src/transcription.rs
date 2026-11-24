//! Transcription: one long-lived engine process (the sidecar's serve mode) that loads the
//! model once and then takes one JSON request per stdin line. Every event it prints carries
//! the request's id; only events for the request in flight reach the window
//! (`transcribe-update`). The worker is started ahead (`preload_transcribe`), restarted once if
//! a request cannot be written to it, stopped by `cancel_transcribe`, and stopped after ten idle
//! minutes to give the memory back. An older engine that handles one request and exits still
//! works: its events get the id added here, and the next request starts a new process.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

const EVENT: &str = "transcribe-update";
const IDLE_STOP: Duration = Duration::from_secs(10 * 60);

struct Worker {
    child: CommandChild,
    generation: u64,
}

#[derive(Default)]
pub(crate) struct TxState {
    worker: Mutex<Option<Worker>>,
    /// The id of the request in flight, shared with the worker's reader task.
    current: Arc<Mutex<Option<String>>>,
    last_used: Arc<Mutex<Option<Instant>>>,
    generation: AtomicU64,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ── Pure helpers (unit-tested below) ─────────────────────────────────────────

/// Append a chunk of output and take every complete line out of the buffer.
fn take_lines(buf: &mut String, chunk: &str) -> Vec<String> {
    buf.push_str(chunk);
    let mut lines = Vec::new();
    while let Some(pos) = buf.find('\n') {
        let line: String = buf.drain(..=pos).collect();
        let line = line.trim();
        if !line.is_empty() {
            lines.push(line.to_string());
        }
    }
    lines
}

#[derive(Debug, PartialEq)]
enum Route {
    Ignore,
    Forward(Value),
    /// The request's last event (done or error): forward it, then the worker is free.
    Finish(Value),
}

/// What to do with one line from the engine, given the request in flight.
fn route(line: &str, current: Option<&str>) -> Route {
    let Ok(mut val) = serde_json::from_str::<Value>(line) else { return Route::Ignore };
    let Some(cur) = current else { return Route::Ignore };
    if val["type"] == "ready" {
        return Route::Ignore;
    }
    match val.get("id").and_then(Value::as_str) {
        Some(id) if id != cur => return Route::Ignore,
        Some(_) => {}
        // An older engine sends no id: everything it prints belongs to the one request.
        None => val["id"] = json!(cur),
    }
    if val["type"] == "done" || val["type"] == "error" {
        Route::Finish(val)
    } else {
        Route::Forward(val)
    }
}

// ── The worker ───────────────────────────────────────────────────────────────

/// Start the engine if it is not running. Loading the model starts at once.
fn ensure_worker(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<TxState>();
    let mut slot = lock(&state.worker);
    if slot.is_some() {
        return Ok(());
    }
    let (rx, child) = crate::components::sidecar_command(app)?
        .spawn()
        .map_err(|e| e.to_string())?;
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *slot = Some(Worker { child, generation });
    drop(slot);
    read_worker(app.clone(), rx, generation);
    Ok(())
}

/// Stop the worker of `generation` (or any worker, with None).
fn stop_worker(app: &AppHandle, generation: Option<u64>) {
    let state = app.state::<TxState>();
    let mut slot = lock(&state.worker);
    if slot.as_ref().is_some_and(|w| generation.is_none_or(|g| w.generation == g)) {
        if let Some(w) = slot.take() {
            let _ = w.child.kill();
        }
    }
}

fn finish(app: &AppHandle, generation: u64) {
    let state = app.state::<TxState>();
    *lock(&state.current) = None;
    *lock(&state.last_used) = Some(Instant::now());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(IDLE_STOP).await;
        let state = app.state::<TxState>();
        let idle = lock(&state.current).is_none()
            && lock(&state.last_used).is_some_and(|t| t.elapsed() >= IDLE_STOP);
        if idle {
            stop_worker(&app, Some(generation));
        }
    });
}

fn read_worker(
    app: AppHandle,
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
    generation: u64,
) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<TxState>();
        let mut buf = String::new();
        let handle_line = |line: &str| {
            let cur = lock(&state.current).clone();
            match route(line, cur.as_deref()) {
                Route::Ignore => {
                    if serde_json::from_str::<Value>(line).is_err() {
                        eprintln!("[transcribe stdout] {line}");
                    }
                }
                Route::Forward(v) => {
                    app.emit(EVENT, v).ok();
                }
                Route::Finish(v) => {
                    app.emit(EVENT, v).ok();
                    finish(&app, generation);
                }
            }
        };
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    for line in take_lines(&mut buf, &String::from_utf8_lossy(&bytes)) {
                        handle_line(&line);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim().to_string();
                    if !line.is_empty() {
                        eprintln!("[transcribe stderr] {line}");
                    }
                }
                CommandEvent::Error(e) => {
                    eprintln!("[transcribe] {e}");
                    break;
                }
                CommandEvent::Terminated(s) => {
                    let rest = std::mem::take(&mut buf);
                    if !rest.trim().is_empty() {
                        handle_line(rest.trim());
                    }
                    if s.code != Some(0) {
                        eprintln!("[transcribe] engine exited with {:?}", s.code);
                    }
                    break;
                }
                _ => {}
            }
        }
        // The process is gone: the request in flight (if any) failed, and the next one starts a new worker.
        let lost = {
            let slot = lock(&state.worker);
            slot.as_ref().is_some_and(|w| w.generation == generation)
        };
        if lost {
            lock(&state.worker).take();
            if let Some(id) = lock(&state.current).take() {
                app.emit(EVENT, json!({ "type": "error", "id": id, "message": "L-engine tat-traskrizzjoni waqaf f'nofs ix-xogħol. Erġa' pprova." })).ok();
            }
        }
    });
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Warm the model before the user picks a file.
#[tauri::command]
pub(crate) async fn preload_transcribe(app: AppHandle) -> Result<(), String> {
    ensure_worker(&app)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn process_video(
    app: AppHandle,
    video_path: String,
    language: Option<String>,
    start: Option<f64>,
    end: Option<f64>,
    request_id: Option<String>,
    state: tauri::State<'_, TxState>,
) -> Result<String, String> {
    if language
        .as_ref()
        .is_some_and(|l| !["mt", "en", "it", "auto"].contains(&l.as_str()))
    {
        return Err("Lingwa mhux valida.".into());
    }
    if start.is_some_and(|s| !s.is_finite() || s < 0.0)
        || end.is_some_and(|e| !e.is_finite() || e <= start.unwrap_or(0.0))
    {
        return Err("Passaġġ mhux validu.".into());
    }
    let id = request_id.unwrap_or_else(|| {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        format!("req-{n}")
    });
    {
        let mut cur = lock(&state.current);
        if cur.is_some() {
            return Err("Diġà qed tittraskrivi. Stenna jew ikkanċella.".into());
        }
        *cur = Some(id.clone());
    }
    let line = format!(
        "{}\n",
        json!({ "id": id, "op": "transcribe", "path": video_path, "language": language.unwrap_or_else(|| "mt".into()), "start": start, "end": end })
    );
    // Write to the running worker; if that fails (it died), start a new one and try once more.
    let mut last_err = String::new();
    for _ in 0..2 {
        if let Err(e) = ensure_worker(&app) {
            last_err = e;
            break;
        }
        let written = lock(&state.worker)
            .as_mut()
            .map(|w| w.child.write(line.as_bytes()).map_err(|e| e.to_string()))
            .unwrap_or_else(|| Err("no worker".into()));
        match written {
            Ok(()) => return Ok(id),
            Err(e) => {
                last_err = e;
                stop_worker(&app, None);
            }
        }
    }
    *lock(&state.current) = None;
    Err(format!("Ma stajtx nibgħat il-video lill-engine tat-traskrizzjoni: {last_err}"))
}

/// Stop the transcription in flight: the worker is stopped (the next request starts a new one).
#[tauri::command]
pub(crate) fn cancel_transcribe(app: AppHandle, state: tauri::State<'_, TxState>) -> Result<(), String> {
    let id = lock(&state.current).take();
    stop_worker(&app, None);
    if let Some(id) = id {
        app.emit(EVENT, json!({ "type": "cancelled", "id": id })).ok();
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn save_srt(path: String, content: String) -> Result<(), String> {
    // M7: Restrict this write primitive to subtitle files only (.srt, .ass for
    // the styled export, .bstyle for shared looks). The command is exposed to
    // the webview; without this check a compromised renderer could overwrite
    // arbitrary files.
    let lower = path.to_lowercase();
    if ![".srt", ".ass", ".bstyle"]
        .iter()
        .any(|e| lower.ends_with(e))
    {
        return Err("save_srt: path must end in .srt, .ass or .bstyle".into());
    }
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_split_across_chunks() {
        let mut buf = String::new();
        assert!(take_lines(&mut buf, "{\"type\":\"sta").is_empty());
        assert_eq!(take_lines(&mut buf, "tus\"}\n{\"a\":1}\n\n{\"b\""), vec!["{\"type\":\"status\"}", "{\"a\":1}"]);
        assert_eq!(buf, "{\"b\"");
        assert_eq!(take_lines(&mut buf, ":2}\r\n"), vec!["{\"b\":2}"]);
        assert!(buf.is_empty());
    }

    #[test]
    fn only_the_request_in_flight_is_forwarded() {
        let line = r#"{"type":"progress","value":5,"id":"a"}"#;
        assert!(matches!(route(line, Some("a")), Route::Forward(_)));
        assert_eq!(route(line, Some("b")), Route::Ignore);
        assert_eq!(route(line, None), Route::Ignore);
        assert_eq!(route(r#"{"type":"ready"}"#, Some("a")), Route::Ignore);
        assert_eq!(route("not json", Some("a")), Route::Ignore);
    }

    #[test]
    fn done_and_error_finish_the_request() {
        assert!(matches!(route(r#"{"type":"done","id":"a"}"#, Some("a")), Route::Finish(_)));
        assert!(matches!(route(r#"{"type":"error","id":"a","message":"x"}"#, Some("a")), Route::Finish(_)));
    }

    #[test]
    fn an_older_engine_without_ids_gets_the_current_id() {
        match route(r#"{"type":"done","all_words":[]}"#, Some("req-1")) {
            Route::Finish(v) => assert_eq!(v["id"], "req-1"),
            other => panic!("{other:?}"),
        }
    }
}
