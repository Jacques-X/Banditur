// Awdjo: clean the speech in a video's sound with NVIDIA NemotronLabs RE-USE.
//
// The work lives in the transcription sidecar's one-shot `--awdjo` mode (sidecar/awdjo.py): it reads the
// sound with the bundled ffmpeg, enhances it on the GPU (MLX) and writes a NEW file next to the original.
// This module checks the job, writes the job file, spawns the sidecar, forwards its JSON lines to the
// webview as `awdjo-update` events (each carries the request id) and lets the UI cancel. It also owns the
// model files: `<app data>/models/nemotron-reuse/` (NVIDIA's `config.json`, `model.safetensors`, `LICENSE`),
// downloaded on first use from Hugging Face and removable from Settings → Components.
//
// One Awdjo file at a time (`AwdjoState`). It never starts the Whisper worker.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

pub(crate) struct AwdjoState {
    pub(crate) child: std::sync::Mutex<Option<CommandChild>>,
}

const OLD_ENGINE: &str = "Aġġorna l-engine (Settings → Components) biex tuża l-Awdjo.";
const NO_MODEL: &str = "Il-model tal-Awdjo mhux imniżżel (Settings → Components).";
const MODEL_BASE_URL: &str = "https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE/resolve/main";
/// The checkpoint is 38.6 MB; anything far from that is a failed or wrong download.
const MODEL_MIN_BYTES: u64 = 30 * 1024 * 1024;
const MODEL_MAX_BYTES: u64 = 80 * 1024 * 1024;
/// Output containers the sidecar can write (sidecar/awdjo.py AUDIO_OUT).
const OUTPUT_EXT: [&str; 5] = ["mov", "mp4", "m4v", "mxf", "wav"];

static DOWNLOADING: AtomicBool = AtomicBool::new(false);

fn emit_value(app: &AppHandle, event: &str, id: &str, mut val: serde_json::Value) {
    if let Some(obj) = val.as_object_mut() {
        obj.insert("id".to_string(), serde_json::Value::String(id.to_string()));
    }
    app.emit(event, val).ok();
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
            // An engine without this mode treats the flag as a file name.
            if kind == "error"
                && val["message"]
                    .as_str()
                    .map(|m| m.contains("--awdjo"))
                    .unwrap_or(false)
            {
                val["message"] = serde_json::Value::String(OLD_ENGINE.to_string());
            }
            emit_value(app, "awdjo-update", id, val);
            kind == "done" || kind == "error" || kind == "cancelled"
        }
        Err(_) => {
            eprintln!("[awdjo stdout] {line}");
            false
        }
    }
}

fn job_dir() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("banditur-awdjo-{}-{nanos}", std::process::id()))
}

/// Write `job` to a temp file and run `transcribe --awdjo <job.json>`, forwarding its output. The child is
/// kept in `AwdjoState` (so it can be cancelled and blocks a second job); the sidecar treats a closed stdin
/// as "cancel", so the child stays held until it ends.
fn spawn_job(app: &AppHandle, job: serde_json::Value, request_id: String) -> Result<(), String> {
    let dir = job_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let job_path = dir.join("job.json");
    std::fs::write(&job_path, job.to_string()).map_err(|e| e.to_string())?;

    let cmd = crate::components::sidecar_command(app)?
        .args(["--awdjo".to_string(), job_path.to_string_lossy().into_owned()]);
    let (mut rx, child) = cmd.spawn().map_err(|e| e.to_string())?;
    app.state::<AwdjoState>().child.lock().unwrap().replace(child);

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
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
                        eprintln!("[awdjo stderr] {line}");
                    }
                }
                CommandEvent::Error(e) => {
                    emit_value(
                        &app2,
                        "awdjo-update",
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
                    // The sidecar reports its own errors and exits 0; a non-zero code means it
                    // crashed (or is an older engine without this mode).
                    if status.code != Some(0) && !finished {
                        emit_value(
                            &app2,
                            "awdjo-update",
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
        app2.state::<AwdjoState>().child.lock().unwrap().take();
        let _ = std::fs::remove_dir_all(&dir);
    });
    Ok(())
}

// ── The model files ──────────────────────────────────────────────────────────

fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join("nemotron-reuse"))
}

/// Both files are there and the weights have a believable size.
fn model_ready(dir: &Path) -> bool {
    let weights = std::fs::metadata(dir.join("model.safetensors"))
        .map(|m| m.is_file() && (MODEL_MIN_BYTES..=MODEL_MAX_BYTES).contains(&m.len()))
        .unwrap_or(false);
    weights && dir.join("config.json").is_file()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelStatus {
    installed: bool,
    dir: String,
    bytes: u64,
}

/// For Settings and the Awdjo screen: is the RE-USE model downloaded?
#[tauri::command]
pub(crate) fn awdjo_model_status(app: AppHandle) -> Result<ModelStatus, String> {
    let dir = model_dir(&app)?;
    let installed = model_ready(&dir);
    let bytes = if installed {
        std::fs::metadata(dir.join("model.safetensors")).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };
    Ok(ModelStatus { installed, dir: dir.to_string_lossy().into_owned(), bytes })
}

/// Download `url` to `dest` with the system curl (always present on macOS) through a `.part` file,
/// emitting `awdjo-model` progress (0-100, scaled into lo..hi) while the file grows.
async fn fetch(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    expected: u64,
    lo: f64,
    hi: f64,
) -> Result<(), String> {
    use std::process::Stdio;
    let part = dest.with_extension("part");
    let _ = std::fs::remove_file(&part);
    let mut child = tokio::process::Command::new("/usr/bin/curl")
        .args(["-fsSL", "--retry", "2", "--connect-timeout", "20", "-o"])
        .arg(&part)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => {
                if expected > 0 {
                    let got = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
                    let frac = (got as f64 / expected as f64).min(1.0);
                    app.emit("awdjo-model", serde_json::json!({ "type": "progress", "value": lo + (hi - lo) * frac }))
                        .ok();
                }
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    if !status.success() {
        let _ = std::fs::remove_file(&part);
        return Err("Ma setax tniżżel il-model. Iċċekkja l-konnessjoni u erġa' pprova.".into());
    }
    std::fs::rename(&part, dest).map_err(|e| e.to_string())
}

/// Download NVIDIA's RE-USE files (about 39 MB) into the model folder. Emits `awdjo-model`
/// `{ type: "progress" | "done" | "error" }`; also returns the result.
#[tauri::command]
pub(crate) async fn awdjo_model_download(app: AppHandle) -> Result<(), String> {
    if DOWNLOADING.swap(true, Ordering::SeqCst) {
        return Err("Il-model diġà qed jinżel.".into());
    }
    let result = download_model(&app).await;
    DOWNLOADING.store(false, Ordering::SeqCst);
    match &result {
        Ok(()) => {
            app.emit("awdjo-model", serde_json::json!({ "type": "done" })).ok();
        }
        Err(e) => {
            app.emit("awdjo-model", serde_json::json!({ "type": "error", "message": e })).ok();
        }
    }
    result
}

async fn download_model(app: &AppHandle) -> Result<(), String> {
    let dir = model_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Small files first; the weights last, so a half download never looks installed.
    fetch(app, &format!("{MODEL_BASE_URL}/LICENSE"), &dir.join("LICENSE"), 0, 0.0, 0.0).await?;
    fetch(app, &format!("{MODEL_BASE_URL}/config.json"), &dir.join("config.json"), 0, 0.0, 0.0).await?;
    let weights = dir.join("model.safetensors");
    fetch(app, &format!("{MODEL_BASE_URL}/model.safetensors"), &weights, 38_600_000, 0.0, 99.0).await?;
    let cfg = std::fs::read_to_string(dir.join("config.json")).map_err(|e| e.to_string())?;
    let valid = serde_json::from_str::<serde_json::Value>(&cfg)
        .map(|v| v.get("model_cfg").is_some())
        .unwrap_or(false);
    if !valid || !model_ready(&dir) {
        let _ = std::fs::remove_file(&weights);
        return Err("Il-fajls imniżżla mhumiex tal-model mistenni. Erġa' pprova.".into());
    }
    Ok(())
}

/// Delete the downloaded model (it can be downloaded again).
#[tauri::command]
pub(crate) fn awdjo_model_remove(app: AppHandle, state: tauri::State<'_, AwdjoState>) -> Result<(), String> {
    if state.child.lock().unwrap().is_some() {
        return Err("L-Awdjo qed jaħdem — stenna jew ikkanċella.".into());
    }
    let dir = model_dir(&app)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

/// Which of these paths already exist (the webview picks the first free "(nadif)" name).
#[tauri::command]
pub(crate) fn awdjo_taken(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).exists()).collect()
}

/// Checks on an input/output pair; the sidecar checks again.
fn check_job_paths(path: &str, output: &str) -> Result<(), String> {
    if !Path::new(path).is_file() {
        return Err("Il-fajl ma nstabx.".into());
    }
    let ext = Path::new(output)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !OUTPUT_EXT.contains(&ext.as_str()) {
        return Err("Format tal-output mhux appoġġat.".into());
    }
    if Path::new(output) == Path::new(path) {
        return Err("Ma nistax nikteb fuq il-fajl oriġinali.".into());
    }
    if Path::new(output).exists() {
        return Err("Il-fajl tal-output diġà jeżisti.".into());
    }
    match Path::new(output).parent() {
        Some(p) if p.is_dir() => Ok(()),
        _ => Err("Il-folder tal-output ma nstabx.".into()),
    }
}

/// Clean the sound of `job.path` into the new file `job.output`. `job` = `{ path, output, strength }`
/// (strength 0-1, the wet/dry mix). Progress and the result arrive as `awdjo-update` events carrying
/// `request_id`; `done` carries `{ path, rate, channels, seconds }`.
#[tauri::command]
pub(crate) async fn awdjo_run(
    app: AppHandle,
    state: tauri::State<'_, AwdjoState>,
    job: serde_json::Value,
    request_id: String,
) -> Result<(), String> {
    let path = job["path"].as_str().unwrap_or("").to_string();
    let output = job["output"].as_str().unwrap_or("").to_string();
    check_job_paths(&path, &output)?;
    let strength = job["strength"].as_f64().unwrap_or(1.0).clamp(0.0, 1.0);
    let dir = model_dir(&app)?;
    if !model_ready(&dir) {
        return Err(NO_MODEL.into());
    }
    if state.child.lock().unwrap().is_some() {
        return Err("Diġà qed nipproċessa — stenna jew ikkanċella.".into());
    }
    let clean = serde_json::json!({
        "path": path,
        "output": output,
        "model_dir": dir.to_string_lossy(),
        "strength": strength,
    });
    spawn_job(&app, clean, request_id)
}

/// Ask a running job to stop (the sidecar kills ffmpeg and deletes the partial output).
#[tauri::command]
pub(crate) fn cancel_awdjo(state: tauri::State<'_, AwdjoState>) -> Result<(), String> {
    if let Some(child) = state.child.lock().unwrap().as_mut() {
        child.write(b"cancel\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show a file in Finder.
#[tauri::command]
pub(crate) fn reveal_in_finder(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("Il-fajl ma nstabx.".into());
    }
    std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("banditur-awdjo-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_model_needs_both_files_and_a_believable_size() {
        let dir = scratch("model");
        assert!(!model_ready(&dir));
        std::fs::write(dir.join("config.json"), "{}").unwrap();
        assert!(!model_ready(&dir));
        std::fs::write(dir.join("model.safetensors"), vec![0u8; 1024]).unwrap();
        assert!(!model_ready(&dir)); // a truncated download
        let f = std::fs::File::create(dir.join("model.safetensors")).unwrap();
        f.set_len(MODEL_MIN_BYTES + 1).unwrap();
        assert!(model_ready(&dir));
        std::fs::remove_file(dir.join("config.json")).unwrap();
        assert!(!model_ready(&dir));
    }

    #[test]
    fn job_paths_are_checked() {
        let dir = scratch("paths");
        let src = dir.join("a.mov");
        std::fs::write(&src, b"x").unwrap();
        let src_s = src.to_string_lossy().into_owned();
        let ok = dir.join("a (nadif).mov").to_string_lossy().into_owned();
        assert!(check_job_paths(&src_s, &ok).is_ok());
        assert!(check_job_paths(&src_s, &src_s).is_err()); // never the original
        assert!(check_job_paths("/nowhere/x.mov", &ok).is_err());
        assert!(check_job_paths(&src_s, &dir.join("a (nadif).avi").to_string_lossy()).is_err());
        assert!(check_job_paths(&src_s, "/nowhere/folder/a.mov").is_err());
        std::fs::write(dir.join("a (nadif).mov"), b"y").unwrap();
        assert!(check_job_paths(&src_s, &ok).is_err()); // never an existing file
    }

    #[test]
    fn taken_names_are_reported() {
        let dir = scratch("taken");
        let a = dir.join("a.mov");
        std::fs::write(&a, b"x").unwrap();
        let got = awdjo_taken(vec![a.to_string_lossy().into_owned(), dir.join("b.mov").to_string_lossy().into_owned()]);
        assert_eq!(got, vec![true, false]);
    }
}
