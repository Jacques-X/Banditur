use tauri::{AppHandle, Emitter, Manager};

pub(crate) struct TxState {
    // Holds a channel to a warm preloaded sidecar waiting for a media path.
    pub(crate) path_tx: std::sync::Mutex<Option<tokio::sync::mpsc::Sender<String>>>,
}

fn forward_sidecar_line(window: &tauri::WebviewWindow, line: &str, forwarding: bool) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }

    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(val) => {
            if val["type"] == "ready" {
                // Model is warm; don't forward this internal marker.
            } else if forwarding {
                window.emit("transcribe-update", val).unwrap_or_default();
            }
        }
        Err(_) => eprintln!("[sidecar stdout] {line}"),
    }
}

// ── Sidecar event loop (shared by preload and fresh-spawn paths) ──────────────

pub(crate) fn spawn_sidecar_loop(
    app: &AppHandle,
    mut rx: tauri::async_runtime::Receiver<tauri_plugin_shell::process::CommandEvent>,
    mut child: tauri_plugin_shell::process::CommandChild,
    path_rx: Option<tokio::sync::mpsc::Receiver<String>>,
) {
    use tauri::Manager;
    use tauri_plugin_shell::process::CommandEvent;

    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };

    tauri::async_runtime::spawn(async move {
        let mut path_rx = path_rx;
        let mut forwarding = path_rx.is_none(); // direct mode → forward from the start
        let mut stdout_buf = String::new();

        loop {
            tokio::select! {
                Some(event) = rx.recv() => {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            stdout_buf.push_str(&String::from_utf8_lossy(&bytes));
                            while let Some(pos) = stdout_buf.find('\n') {
                                let line: String = stdout_buf.drain(..=pos).collect();
                                forward_sidecar_line(&window, &line, forwarding);
                            }
                        }
                        CommandEvent::Stderr(bytes) => {
                            let line = String::from_utf8_lossy(&bytes).trim().to_string();
                            if !line.is_empty() { eprintln!("[sidecar stderr] {line}"); }
                        }
                        CommandEvent::Error(e) => {
                            if forwarding {
                                window.emit("transcribe-update",
                                    serde_json::json!({"type":"error","message": e})).ok();
                            }
                            break;
                        }
                        CommandEvent::Terminated(s) => {
                            if !stdout_buf.trim().is_empty() {
                                forward_sidecar_line(&window, &stdout_buf, forwarding);
                                stdout_buf.clear();
                            }
                            if forwarding && s.code != Some(0) {
                                window.emit("transcribe-update", serde_json::json!({
                                    "type": "error",
                                    "message": format!("Sidecar exited with code {:?}", s.code),
                                })).ok();
                            }
                            break;
                        }
                        _ => {}
                    }
                }

                // Receive the video path and pipe it to sidecar stdin.
                Some(path) = async {
                    if let Some(rx) = &mut path_rx { rx.recv().await } else { None }
                } => {
                    let _ = child.write(format!("{path}\n").as_bytes());
                    forwarding = true;
                    path_rx = None; // one video per preloaded sidecar
                }

                else => break,
            }
        }
    });
}

// ── Resolve MLX model path ────────────────────────────────────────────────────
// Priority:
//   1. MLX_MODEL_PATH env var (already respected by the Python script)
//   2. <resource_dir>/mlx-maltese-whisper-4bit  (release bundle)
//   3. <app_dir>/../../mlx-maltese-whisper-4bit  (dev: project root)
fn mlx_model_path(app: &AppHandle) -> Option<String> {
    // Don't override if already set externally.
    if let Ok(v) = std::env::var("MLX_MODEL_PATH") {
        if !v.is_empty() { return Some(v); }
    }

    // Release: look in the app bundle's Resources folder.
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("mlx-maltese-whisper-4bit");
        if p.exists() { return Some(p.to_string_lossy().into_owned()); }
    }

    // Dev: walk up from the app binary (inside target/debug|release) to the
    // project root, looking for the local model directory.
    if let Ok(mut candidate) = std::env::current_exe() {
        for _ in 0..6 {
            candidate = match candidate.parent() {
                Some(p) => p.to_path_buf(),
                None => break,
            };
            let model = candidate.join("mlx-maltese-whisper-4bit");
            if model.exists() { return Some(model.to_string_lossy().into_owned()); }
        }
    }

    None
}

// ── preload_transcribe: warm the model before the user picks a file ───────────

#[tauri::command]
pub(crate) async fn preload_transcribe(
    app: AppHandle,
    state: tauri::State<'_, TxState>,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    if state.path_tx.lock().unwrap().is_some() {
        return Ok(());
    }

    let (path_tx, path_rx) = tokio::sync::mpsc::channel::<String>(1);
    state.path_tx.lock().unwrap().replace(path_tx);

    let mut cmd = app.shell().sidecar("transcribe").map_err(|e| e.to_string())?;
    if let Some(model) = mlx_model_path(&app) {
        cmd = cmd.env("MLX_MODEL_PATH", model);
    }
    let (rx, child) = cmd.spawn().map_err(|e| e.to_string())?;

    spawn_sidecar_loop(&app, rx, child, Some(path_rx));
    Ok(())
}

// ── process_video ─────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) async fn process_video(
    app: AppHandle,
    video_path: String,
    state: tauri::State<'_, TxState>,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    let warm_tx = state.path_tx.lock().unwrap().take();

    // Try the warm sidecar first; if the channel is closed (sidecar crashed during
    // preload), fall through and spawn a fresh one.
    let needs_fresh = match warm_tx {
        Some(tx) => tx.send(video_path.clone()).await.is_err(),
        None => true,
    };

    if needs_fresh {
        // No preloaded sidecar (or stale one) — spawn fresh.
        let mut cmd = app.shell().sidecar("transcribe").map_err(|e| e.to_string())?;
        if let Some(model) = mlx_model_path(&app) {
            cmd = cmd.env("MLX_MODEL_PATH", model);
        }
        let (rx, child) = cmd.arg(&video_path).spawn().map_err(|e| e.to_string())?;

        spawn_sidecar_loop(&app, rx, child, None);
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn save_srt(path: String, content: String) -> Result<(), String> {
    // M7: Restrict this write primitive to .srt files only.
    // The command is exposed to the webview; without this check a compromised
    // renderer could overwrite arbitrary files.
    if !path.ends_with(".srt") {
        return Err("save_srt: path must end in .srt".into());
    }
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}
