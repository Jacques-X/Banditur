use tauri::{AppHandle, Emitter};

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

/// The transcription sidecar, pointed at the installed engine and model
/// (see components.rs).
fn transcribe_command(app: &AppHandle) -> Result<tauri_plugin_shell::process::Command, String> {
    crate::components::sidecar_command(app)
}

// ── preload_transcribe: warm the model before the user picks a file ───────────

#[tauri::command]
pub(crate) async fn preload_transcribe(
    app: AppHandle,
    state: tauri::State<'_, TxState>,
) -> Result<(), String> {
    if state.path_tx.lock().unwrap().is_some() {
        return Ok(());
    }

    let (path_tx, path_rx) = tokio::sync::mpsc::channel::<String>(1);
    state.path_tx.lock().unwrap().replace(path_tx);

    let (rx, child) = transcribe_command(&app)?.spawn().map_err(|e| e.to_string())?;

    spawn_sidecar_loop(&app, rx, child, Some(path_rx));
    Ok(())
}

// ── process_video ─────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) async fn process_video(
    app: AppHandle,
    video_path: String,
    language: Option<String>,
    start: Option<f64>,
    end: Option<f64>,
    state: tauri::State<'_, TxState>,
) -> Result<(), String> {
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
    let request=serde_json::json!({"path":video_path,"language":language.unwrap_or("mt".into()),"start":start,"end":end}).to_string();
    let warm_tx = state.path_tx.lock().unwrap().take();

    // Try the warm sidecar first; if the channel is closed (sidecar crashed during
    // preload), fall through and spawn a fresh one.
    let needs_fresh = match warm_tx {
        Some(tx) => tx.send(request.clone()).await.is_err(),
        None => true,
    };

    if needs_fresh {
        // No preloaded sidecar (or stale one) — spawn fresh.
        let (rx, child) = transcribe_command(&app)?
            .arg(&request)
            .spawn()
            .map_err(|e| e.to_string())?;

        spawn_sidecar_loop(&app, rx, child, None);
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
