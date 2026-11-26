// Murtali (fireworks) analysis and export.
//
// The work lives in the transcription sidecar's one-shot modes (see
// sidecar/fireworks.py and sidecar/fireworks_render.py): it measures the
// sound of a video, cuts thumbnails, and renders the 16:9 / 9:16 exports with
// the same bundled ffmpeg. This module writes the job file, spawns the
// sidecar, forwards its JSON lines to the webview as `fireworks-update`
// events (each carries the request id), and lets the UI cancel.
//
// One analysis/export at a time (they share `FireworksState`); thumbnails are
// short and run unattached.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

pub(crate) struct FireworksState {
    pub(crate) child: std::sync::Mutex<Option<CommandChild>>,
}

const OLD_ENGINE: &str = "Aġġorna l-engine (Settings → Components) biex tuża l-Murtali.";

fn emit_value(app: &AppHandle, id: &str, mut val: serde_json::Value) {
    if let Some(obj) = val.as_object_mut() {
        obj.insert("id".to_string(), serde_json::Value::String(id.to_string()));
    }
    app.emit("fireworks-update", val).ok();
}

/// Forward one stdout line. Returns true when it ended the job (done / error / cancelled).
fn emit_line(app: &AppHandle, id: &str, line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(mut val) => {
            let kind = val["type"].as_str().unwrap_or("").to_string();
            // An engine without these modes treats the flag as a file name.
            if kind == "error"
                && val["message"]
                    .as_str()
                    .map(|m| m.contains("--fireworks"))
                    .unwrap_or(false)
            {
                val["message"] = serde_json::Value::String(OLD_ENGINE.to_string());
            }
            emit_value(app, id, val);
            kind == "done" || kind == "error" || kind == "cancelled"
        }
        Err(_) => {
            eprintln!("[fireworks stdout] {line}");
            false
        }
    }
}

fn job_dir() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("banditur-fireworks-{}-{nanos}", std::process::id()))
}

/// Write `job` to a temp file and run `transcribe <flag> <job.json>`, forwarding its output.
/// With `attach` the child is kept in `FireworksState` (so it can be cancelled and blocks a
/// second job); the sidecar treats a closed stdin as "cancel", so the child is kept alive
/// either way until it ends.
fn spawn_job(
    app: &AppHandle,
    flag: &str,
    job: serde_json::Value,
    request_id: String,
    attach: bool,
) -> Result<(), String> {
    let dir = job_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let job_path = dir.join("job.json");
    std::fs::write(&job_path, job.to_string()).map_err(|e| e.to_string())?;

    let cmd = crate::components::sidecar_command(app)?
        .args([flag.to_string(), job_path.to_string_lossy().into_owned()]);
    let (mut rx, child) = cmd.spawn().map_err(|e| e.to_string())?;
    let mut held = Some(child);
    if attach {
        if let Some(c) = held.take() {
            app.state::<FireworksState>().child.lock().unwrap().replace(c);
        }
    }

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let _held = held; // unattached children stay alive until the task ends
        let mut buf = String::new();
        let mut finished = false;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    buf.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(pos) = buf.find('\n') {
                        let line: String = buf.drain(..=pos).collect();
                        if emit_line(&app2, &request_id, &line) {
                            finished = true;
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim().to_string();
                    if !line.is_empty() {
                        eprintln!("[fireworks stderr] {line}");
                    }
                }
                CommandEvent::Error(e) => {
                    emit_value(
                        &app2,
                        &request_id,
                        serde_json::json!({ "type": "error", "message": e }),
                    );
                    finished = true;
                }
                CommandEvent::Terminated(status) => {
                    if !buf.trim().is_empty() {
                        if emit_line(&app2, &request_id, &buf) {
                            finished = true;
                        }
                        buf.clear();
                    }
                    // The sidecar reports its own errors and exits 0; a non-zero code
                    // means it crashed (or is an older engine without this mode).
                    if status.code != Some(0) && !finished {
                        emit_value(
                            &app2,
                            &request_id,
                            serde_json::json!({
                                "type": "error",
                                "message": format!("{OLD_ENGINE} (kodiċi {:?})", status.code),
                            }),
                        );
                    }
                    break;
                }
                _ => {}
            }
        }
        if attach {
            app2.state::<FireworksState>().child.lock().unwrap().take();
        }
        let _ = std::fs::remove_dir_all(&dir);
    });
    Ok(())
}

fn check_source(path: &str) -> Result<(), String> {
    if !Path::new(path).is_file() {
        return Err("Il-video ma nstabx.".into());
    }
    Ok(())
}

/// Measure the sound of `path` (sidecar `--fireworks`). Progress and the final curves
/// arrive as `fireworks-update` events carrying `request_id`; the `done` event also
/// carries the file's `fingerprint` (`{ size, mtimeMs }`).
#[tauri::command]
pub(crate) async fn analyse_fireworks(
    app: AppHandle,
    state: tauri::State<'_, FireworksState>,
    path: String,
    request_id: String,
) -> Result<(), String> {
    check_source(&path)?;
    if state.child.lock().unwrap().is_some() {
        return Err("Diġà qed nipproċessa — stenna jew ikkanċella.".into());
    }
    spawn_job(&app, "--fireworks", serde_json::json!({ "path": path }), request_id, true)
}

fn fingerprint_of(path: &str) -> Result<serde_json::Value, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(serde_json::json!({ "size": meta.len(), "mtimeMs": mtime_ms }))
}

const MAX_LUT_BYTES: u64 = 64 * 1024 * 1024;

fn check_lut_path(path: &str) -> Result<u64, String> {
    if !path.to_lowercase().ends_with(".cube") {
        return Err("Il-LUT irid ikun file .cube.".into());
    }
    let meta = std::fs::metadata(path).map_err(|_| "Il-LUT ma nstabx.".to_string())?;
    if !meta.is_file() || meta.len() > MAX_LUT_BYTES {
        return Err("Il-LUT irid ikun file .cube (sa 64 MB).".into());
    }
    Ok(meta.len())
}

/// A job's optional `lut` (`{ path, strength }`), checked: `None` when absent or at strength 0.
fn clean_lut(v: &serde_json::Value) -> Result<Option<serde_json::Value>, String> {
    let Some(path) = v.get("path").and_then(|p| p.as_str()) else {
        return Ok(None);
    };
    let strength = v
        .get("strength")
        .and_then(|s| s.as_f64())
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    if strength < 0.005 {
        return Ok(None);
    }
    check_lut_path(path)?;
    Ok(Some(serde_json::json!({ "path": path, "strength": strength })))
}

/// The text of a `.cube` LUT, for the live preview (parsed in `views/murtali/lut.js`).
#[tauri::command]
pub(crate) fn read_lut(path: String) -> Result<String, String> {
    check_lut_path(&path)?;
    std::fs::read_to_string(&path).map_err(|_| "Il-LUT ma setax jinqara (mhux test?).".to_string())
}

/// Size and modification time of a file, to tell whether a saved analysis still fits it.
#[tauri::command]
pub(crate) fn fireworks_fingerprint(path: String) -> Result<serde_json::Value, String> {
    fingerprint_of(&path)
}

/// One JPEG per time (seconds) in `path`, cached under the app cache directory. Emits
/// `done { files }` (a path per time, null when a frame could not be cut).
#[tauri::command]
pub(crate) async fn fireworks_thumbs(
    app: AppHandle,
    path: String,
    times: Vec<f64>,
    lut: Option<serde_json::Value>,
    request_id: String,
) -> Result<(), String> {
    check_source(&path)?;
    let lut = match lut {
        Some(v) => clean_lut(&v)?,
        None => None,
    };
    if times.is_empty() || times.len() > 500 {
        return Err("Lista ta' kwadri mhux valida.".into());
    }
    let fp = fingerprint_of(&path)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    fp.to_string().hash(&mut hasher);
    for t in &times {
        t.to_bits().hash(&mut hasher);
    }
    // A different LUT, LUT file or strength gives different pictures.
    if let Some(l) = &lut {
        let lp = l["path"].as_str().unwrap_or("");
        lp.hash(&mut hasher);
        fingerprint_of(lp)?.to_string().hash(&mut hasher);
        ((l["strength"].as_f64().unwrap_or(1.0) * 1000.0).round() as i64).hash(&mut hasher);
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("fireworks-thumbs")
        .join(format!("{:016x}", hasher.finish()));
    let files: Vec<PathBuf> = (0..times.len()).map(|i| dir.join(format!("{i}.jpg"))).collect();
    if files.iter().all(|f| f.is_file()) {
        let list: Vec<String> = files.iter().map(|f| f.to_string_lossy().into_owned()).collect();
        emit_value(&app, &request_id, serde_json::json!({ "type": "done", "files": list }));
        return Ok(());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    spawn_job(
        &app,
        "--fireworks-thumbs",
        serde_json::json!({ "path": path, "times": times, "dir": dir.to_string_lossy(), "lut": lut }),
        request_id,
        false,
    )
}

/// Export the items of a Murtali project. `job` = `{ kind: "full" | "reel", output, size?,
/// items: [{ path, start, end, crop? }] }`; checked here because it writes wherever the
/// webview asks.
#[tauri::command]
pub(crate) async fn render_fireworks(
    app: AppHandle,
    state: tauri::State<'_, FireworksState>,
    job: serde_json::Value,
    request_id: String,
) -> Result<(), String> {
    let kind = job["kind"].as_str().unwrap_or("");
    if kind != "full" && kind != "reel" {
        return Err("Tip tal-esportazzjoni invalidu.".into());
    }
    let output = job["output"].as_str().unwrap_or("").to_string();
    if !output.to_lowercase().ends_with(".mp4") {
        return Err("Il-fajl tal-output irid jispiċċa b'.mp4".into());
    }
    let items = job["items"].as_array().ok_or("L-ebda murtal biex tiġi esportata.")?;
    if items.is_empty() || items.len() > 2000 {
        return Err("L-ebda murtal biex tiġi esportata.".into());
    }
    let mut clean = Vec::with_capacity(items.len());
    for it in items {
        let p = it["path"].as_str().unwrap_or("");
        let (start, end) = (it["start"].as_f64(), it["end"].as_f64());
        match (start, end) {
            (Some(s), Some(e)) if s >= 0.0 && e > s => {}
            _ => return Err("Murtal b'ħin mhux validu.".into()),
        }
        check_source(p)?;
        if Path::new(&output) == Path::new(p) {
            return Err("Ma nistax nikteb fuq il-video oriġinali.".into());
        }
        clean.push(serde_json::json!({
            "path": p,
            "start": it["start"],
            "end": it["end"],
            "crop": it["crop"],
        }));
    }
    if state.child.lock().unwrap().is_some() {
        return Err("Diġà qed nipproċessa — stenna jew ikkanċella.".into());
    }
    let size = if job["size"].as_str() == Some("1080p") { "1080p" } else { "auto" };
    let lut = clean_lut(&job["lut"])?;
    let clean_job = serde_json::json!({
        "kind": kind,
        "output": output,
        "size": size,
        "items": clean,
        "lut": lut,
    });
    spawn_job(&app, "--fireworks-render", clean_job, request_id, true)
}

/// Ask a running analysis / export to stop (the sidecar kills ffmpeg and deletes a partial output).
#[tauri::command]
pub(crate) fn cancel_fireworks(state: tauri::State<'_, FireworksState>) -> Result<(), String> {
    if let Some(child) = state.child.lock().unwrap().as_mut() {
        child.write(b"cancel\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}
