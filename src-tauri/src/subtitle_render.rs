// Subtitle video export (Traskrittura → Esporta).
//
// The renderer lives in the transcription sidecar (`transcribe --render
// <job.json>`, see sidecar/subtitle_render.py) so it uses the same bundled,
// libass-enabled ffmpeg as transcription. This module writes the job, spawns
// the sidecar, forwards its JSON lines to the webview as `render-update`
// events, and lets the UI cancel a running export.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

pub(crate) struct RenderState {
    pub(crate) child: std::sync::Mutex<Option<CommandChild>>,
}

fn emit_line(app: &AppHandle, line: &str) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(val) => {
            app.emit("render-update", val).ok();
        }
        Err(_) => eprintln!("[render stdout] {line}"),
    }
}

/// The subtitle fonts bundled with the app (public/fonts → Resources/fonts).
fn bundled_fonts_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("fonts");
        if p.is_dir() {
            return Some(p);
        }
    }
    // Dev: walk up from target/debug to the project root.
    let mut dir = std::env::current_exe().ok()?;
    for _ in 0..6 {
        dir = dir.parent()?.to_path_buf();
        let p = dir.join("public").join("fonts");
        if p.is_dir() {
            return Some(p);
        }
    }
    None
}

fn job_dir() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("banditur-render-{}-{nanos}", std::process::id()))
}

/// Burn `ass` into `video_path` (mode "burn" → .mp4) or render it alone on a
/// transparent background (mode "alpha" → ProRes 4444 .mov).
#[tauri::command]
pub(crate) async fn render_subtitles(
    app: AppHandle,
    state: tauri::State<'_, RenderState>,
    video_path: String,
    ass: String,
    output_path: String,
    mode: String,
    fonts: Vec<String>,
    logo: Option<serde_json::Value>,
    end_card_seconds: Option<f64>,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    let ext = match mode.as_str() {
        "burn" => "mp4",
        "alpha" => "mov",
        _ => return Err("Mod tal-esportazzjoni invalidu.".into()),
    };
    // This command writes wherever the webview asks, so keep it to the one
    // file type the mode produces, and never over the source video.
    if !output_path.to_lowercase().ends_with(&format!(".{ext}")) {
        return Err(format!("Il-fajl tal-output irid jispiċċa b'.{ext}"));
    }
    if !Path::new(&video_path).is_file() {
        return Err("Il-video ma nstabx.".into());
    }
    if Path::new(&output_path) == Path::new(&video_path) {
        return Err("Ma nistax nikteb fuq il-video oriġinali.".into());
    }
    if state.child.lock().unwrap().is_some() {
        return Err("Diġà qed nesporta — stenna jew ikkanċella.".into());
    }

    let dir = job_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ass_path = dir.join("subs.ass");
    std::fs::write(&ass_path, ass).map_err(|e| e.to_string())?;
    // Optional corner logo: only an existing image file is passed through.
    let logo = logo.filter(|l| {
        l.get("path")
            .and_then(|p| p.as_str())
            .map(|p| {
                let lower = p.to_lowercase();
                Path::new(p).is_file()
                    && [".png", ".jpg", ".jpeg", ".webp"].iter().any(|e| lower.ends_with(e))
            })
            .unwrap_or(false)
    });
    let job = serde_json::json!({
        "video": video_path,
        "ass": ass_path.to_string_lossy(),
        "output": output_path,
        "mode": mode,
        "fonts": fonts,
        "fontsDir": bundled_fonts_dir(&app).map(|p| p.to_string_lossy().into_owned()),
        "logo": logo,
        // seconds of plain black added after the video for the end card (0 = none)
        "endCardSeconds": end_card_seconds.unwrap_or(0.0).clamp(0.0, 8.0),
    });
    let job_path = dir.join("job.json");
    std::fs::write(&job_path, job.to_string()).map_err(|e| e.to_string())?;

    let cmd = app
        .shell()
        .sidecar("transcribe")
        .map_err(|e| e.to_string())?
        .args(["--render".to_string(), job_path.to_string_lossy().into_owned()]);
    let (mut rx, child) = cmd.spawn().map_err(|e| e.to_string())?;
    // Keep the child (and so its stdin pipe) alive: the sidecar treats stdin
    // closing as "cancel".
    state.child.lock().unwrap().replace(child);

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut buf = String::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    buf.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(pos) = buf.find('\n') {
                        let line: String = buf.drain(..=pos).collect();
                        emit_line(&app2, &line);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim().to_string();
                    if !line.is_empty() {
                        eprintln!("[render stderr] {line}");
                    }
                }
                CommandEvent::Error(e) => {
                    app2.emit("render-update", serde_json::json!({ "type": "error", "message": e }))
                        .ok();
                }
                CommandEvent::Terminated(status) => {
                    if !buf.trim().is_empty() {
                        emit_line(&app2, &buf);
                        buf.clear();
                    }
                    // The sidecar reports its own errors and exits 0; a non-zero
                    // code means it crashed before it could say anything.
                    if status.code != Some(0) {
                        app2.emit(
                            "render-update",
                            serde_json::json!({
                                "type": "error",
                                "message": format!("L-esportazzjoni waqfet (kodiċi {:?})", status.code),
                            }),
                        )
                        .ok();
                    }
                    break;
                }
                _ => {}
            }
        }
        app2.state::<RenderState>().child.lock().unwrap().take();
        let _ = std::fs::remove_dir_all(&dir);
    });

    Ok(())
}

/// Ask a running export to stop (the sidecar kills ffmpeg and deletes the
/// partial output).
#[tauri::command]
pub(crate) fn cancel_render(state: tauri::State<'_, RenderState>) -> Result<(), String> {
    if let Some(child) = state.child.lock().unwrap().as_mut() {
        child.write(b"cancel\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Waveform peaks for the timeline, for sessions opened without re-transcribing.
/// Returns `{ "rate": 50, "peaks": [0-255, ...] }`.
#[tauri::command]
pub(crate) async fn audio_peaks(app: AppHandle, media_path: String) -> Result<serde_json::Value, String> {
    use tauri_plugin_shell::ShellExt;
    if !Path::new(&media_path).is_file() {
        return Err("Il-fajl ma nstabx.".into());
    }
    let output = app
        .shell()
        .sidecar("transcribe")
        .map_err(|e| e.to_string())?
        .args(["--peaks".to_string(), media_path])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines().rev() {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line.trim()) else { continue };
        match val["type"].as_str() {
            Some("peaks") => return Ok(serde_json::json!({ "rate": val["rate"], "peaks": val["peaks"] })),
            Some("error") => return Err(val["message"].as_str().unwrap_or("peaks failed").to_string()),
            _ => {}
        }
    }
    Err("Ma stajtx naqra l-awdjo.".into())
}

/// Read a shared subtitle look (.bstyle, small JSON) chosen by the user.
#[tauri::command]
pub(crate) fn load_style_file(path: String) -> Result<String, String> {
    if !path.to_lowercase().ends_with(".bstyle") {
        return Err("Il-fajl irid ikun .bstyle".into());
    }
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 512 * 1024 {
        return Err("Il-fajl huwa kbir wisq.".into());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}
