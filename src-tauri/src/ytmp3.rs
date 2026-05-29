use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;

// ── Event payloads emitted to the frontend ────────────────────────────────────

#[derive(Serialize, Clone)]
pub(crate) struct YtSearchDoneEvent {
    pub(crate) items: Vec<YtItem>,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct YtItem {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) channel: String,
    pub(crate) duration: f64,
    pub(crate) thumbnail: String,
    pub(crate) url: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct YtUpdateEvent {
    #[serde(rename = "type")]
    pub(crate) kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) message: Option<String>,
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Search YouTube for up to 5 results matching `query`.
/// Emits `yt-search-done` with a list of video metadata items.
#[tauri::command]
pub(crate) async fn yt_search(app: AppHandle, query: String) -> Result<(), String> {
    let output = app
        .shell()
        .sidecar("ytmp3")
        .map_err(|e| e.to_string())?
        .args(["--action", "search", "--query", &query])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stderr.trim().is_empty() {
        eprintln!("[ytmp3 search] stderr: {stderr}");
    }

    // Parse the last valid JSON line
    let result: serde_json::Value = stdout
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str(line).ok())
        .ok_or_else(|| "L-ebda riżultat validu mingħand ytmp3.".to_string())?;

    if result["type"] == "error" {
        return Err(result["message"]
            .as_str()
            .unwrap_or("Żball fit-tfittxija.")
            .to_string());
    }

    let items: Vec<YtItem> = serde_json::from_value(result["items"].clone())
        .map_err(|e| e.to_string())?;

    app.emit("yt-search-done", YtSearchDoneEvent { items }).ok();
    Ok(())
}

/// Download the YouTube video at `url` and extract MP3 into `output_dir`.
/// Streams `yt-update` events: progress, converting, done, error.
#[tauri::command]
pub(crate) async fn yt_download(
    app: AppHandle,
    url: String,
    output_dir: String,
) -> Result<(), String> {
    use tauri_plugin_shell::process::CommandEvent;
    use tokio::sync::mpsc;

    let (mut rx, _child) = app
        .shell()
        .sidecar("ytmp3")
        .map_err(|e| e.to_string())?
        .args(["--action", "download", "--url", &url, "--output-dir", &output_dir])
        .spawn()
        .map_err(|e| e.to_string())?;

    let (done_tx, mut done_rx) = mpsc::channel::<Result<(), String>>(1);
    let app2 = app.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    for raw in line.lines() {
                        if raw.trim().is_empty() {
                            continue;
                        }
                        let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) else {
                            continue;
                        };
                        let kind = val["type"].as_str().unwrap_or("").to_string();

                        let evt = match kind.as_str() {
                            "progress" => YtUpdateEvent {
                                kind: "progress".into(),
                                value: val["value"].as_f64(),
                                path: None,
                                title: None,
                                message: None,
                            },
                            "converting" => YtUpdateEvent {
                                kind: "converting".into(),
                                value: None,
                                path: None,
                                title: None,
                                message: None,
                            },
                            "done" => YtUpdateEvent {
                                kind: "done".into(),
                                value: None,
                                path: val["path"].as_str().map(str::to_string),
                                title: val["title"].as_str().map(str::to_string),
                                message: None,
                            },
                            "error" => YtUpdateEvent {
                                kind: "error".into(),
                                value: None,
                                path: None,
                                title: None,
                                message: val["message"].as_str().map(str::to_string),
                            },
                            _ => continue,
                        };

                        let is_done  = evt.kind == "done";
                        let is_error = evt.kind == "error";
                        let err_msg  = evt.message.clone();

                        app2.emit("yt-update", evt).ok();

                        if is_done {
                            let _ = done_tx.send(Ok(())).await;
                            return;
                        }
                        if is_error {
                            let _ = done_tx
                                .send(Err(err_msg.unwrap_or_else(|| "Żball.".into())))
                                .await;
                            return;
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let msg = String::from_utf8_lossy(&bytes);
                    if !msg.trim().is_empty() {
                        eprintln!("[ytmp3 download] stderr: {msg}");
                    }
                }
                CommandEvent::Error(e) => {
                    let _ = done_tx.send(Err(e)).await;
                    return;
                }
                CommandEvent::Terminated(status) => {
                    // If we haven't sent a result yet, treat non-zero exit as error
                    if status.code != Some(0) {
                        let _ = done_tx
                            .send(Err(format!(
                                "ytmp3 ħareġ b'kodiċi {:?}",
                                status.code
                            )))
                            .await;
                    }
                    return;
                }
                _ => {}
            }
        }
    });

    done_rx
        .recv()
        .await
        .unwrap_or_else(|| Err("Sidecar waqaf mingħajr riżultat.".into()))
}
