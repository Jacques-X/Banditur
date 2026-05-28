use tauri::{AppHandle, Emitter};

pub(crate) struct TxState {
    // Holds a channel to a warm preloaded sidecar waiting for a video path.
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

    let (rx, child) = app
        .shell()
        .sidecar("transcribe")
        .map_err(|e| e.to_string())?
        .spawn()
        .map_err(|e| e.to_string())?;

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
    use tauri::Manager;
    use tauri_plugin_shell::ShellExt;

    let warm_tx = state.path_tx.lock().unwrap().take();

    // Eagerly warm a replacement sidecar so the model is loading while we transcribe.
    // This runs in the background; preload_transcribe guards against double-spawn.
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let state2 = app2.state::<TxState>();
        if state2.path_tx.lock().unwrap().is_none() {
            let _ = preload_transcribe(app2.clone(), state2).await;
        }
    });

    if let Some(tx) = warm_tx {
        tx.send(video_path).await.map_err(|e| e.to_string())
    } else {
        // No preloaded sidecar — spawn fresh.
        let (rx, child) = app
            .shell()
            .sidecar("transcribe")
            .map_err(|e| e.to_string())?
            .arg(&video_path)
            .spawn()
            .map_err(|e| e.to_string())?;

        spawn_sidecar_loop(&app, rx, child, None);
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn save_srt(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}
