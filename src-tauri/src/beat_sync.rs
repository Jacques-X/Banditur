use crate::{log, ProgressEvent};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub(crate) struct BeatSyncDoneEvent {
    pub(crate) clips: u32,
    pub(crate) beats: u32,
    pub(crate) images: u32,
    pub(crate) output_path: String,
    pub(crate) elapsed_ms: u64,
}

#[tauri::command]
pub(crate) async fn generate_beat_sync_timeline(
    app: AppHandle,
    audio_path: String,
    image_dir: String,
    output_path: String,
    fps: u32,
    sensitivity: f32,
    min_gap_frames: u32,
    max_gap_frames: u32,
    sync_style: String,
    media_mode: String,
    max_video_start: u32,
    smart_video: bool,
    loop_images: bool,
) -> Result<(), String> {
    run_beat_sync(
        app,
        audio_path,
        image_dir,
        output_path,
        fps,
        sensitivity,
        min_gap_frames,
        max_gap_frames,
        sync_style,
        media_mode,
        max_video_start,
        smart_video,
        loop_images,
    )
    .await
}

async fn run_beat_sync(
    app: AppHandle,
    audio_path: String,
    image_dir: String,
    output_path: String,
    fps: u32,
    sensitivity: f32,
    min_gap_frames: u32,
    max_gap_frames: u32,
    sync_style: String,
    media_mode: String,
    max_video_start: u32,
    smart_video: bool,
    loop_images: bool,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    let t0 = std::time::Instant::now();

    validate_audio(&audio_path)?;
    validate_media_dir(&image_dir, &media_mode)?;
    if !(1..=120).contains(&fps) {
        return Err("FPS għandu jkun bejn 1 u 120.".into());
    }
    if !(0.01..=1.0).contains(&sensitivity) {
        return Err("Is-sensittività għandha tkun bejn 0.01 u 1.00.".into());
    }
    if max_gap_frames > 0 && max_gap_frames < min_gap_frames {
        return Err("Il-massimu ta' frames/clip għandu jkun akbar mill-minimu.".into());
    }
    if !matches!(sync_style.as_str(), "calm" | "balanced" | "energetic") {
        return Err("Stil ta' sync mhux magħruf.".into());
    }
    if !matches!(media_mode.as_str(), "image" | "video") {
        return Err("Tip ta' media mhux magħruf.".into());
    }

    let output_path = normalize_output_path(&output_path)?;
    if let Some(parent) = Path::new(&output_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    log(&app, "info", "Qed nanalizza l-awdjo u nibni timeline FCPXML...");
    app.emit("progress", ProgressEvent { fraction: 0.08 }).ok();

    let fps_arg = fps.to_string();
    let sensitivity_arg = sensitivity.to_string();
    let min_gap_arg = min_gap_frames.to_string();
    let max_gap_arg = max_gap_frames.to_string();
    let max_video_start_arg = max_video_start.to_string();
    let args = vec![
        "--audio".to_string(),
        audio_path.clone(),
        "--images".to_string(),
        image_dir.clone(),
        "--output".to_string(),
        output_path.clone(),
        "--fps".to_string(),
        fps_arg,
        "--sensitivity".to_string(),
        sensitivity_arg,
        "--min-gap".to_string(),
        min_gap_arg,
        "--max-gap".to_string(),
        max_gap_arg,
        "--style".to_string(),
        sync_style,
        "--media-mode".to_string(),
        media_mode,
        "--max-video-start".to_string(),
        max_video_start_arg,
    ];

    let mut command = app
        .shell()
        .sidecar("beat-sync")
        .map_err(|e| e.to_string())?
        .env("BANDITUR_PROJECT_ROOT", project_root_hint())
        .args(args);

    if loop_images {
        command = command.arg("--loop-images");
    }
    if smart_video {
        command = command.arg("--smart-video");
    }

    let output = command.output().await.map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stderr.trim().is_empty() {
        for line in stderr.lines().filter(|line| !line.trim().is_empty()) {
            log(&app, "info", line);
        }
    }

    let payload = parse_sidecar_output(&stdout)?;
    if payload["type"] == "error" {
        return Err(payload["message"].as_str().unwrap_or("Żball fil-Beat Sync.").into());
    }
    if !output.status.success() {
        return Err(format!("Beat Sync falla b'kodiċi {:?}", output.status.code()));
    }

    let clips = payload["clip_count"].as_u64().unwrap_or(0) as u32;
    let beats = payload["beat_count"].as_u64().unwrap_or(0) as u32;
    let images = payload["image_count"].as_u64().unwrap_or(0) as u32;
    let highlights = payload["highlight_count"].as_u64().unwrap_or(0) as u32;
    let elapsed_ms = t0.elapsed().as_millis() as u64;

    app.emit("progress", ProgressEvent { fraction: 1.0 }).ok();
    log(&app, "ok", &format!("Timeline ġġenerata: {clips} clips minn {images} media."));
    log(&app, "info", &format!("Beats użati: {beats}"));
    if highlights > 0 {
        log(&app, "info", &format!("Mumenti tajbin misjuba: {highlights}"));
    }
    log(&app, "ok", &format!("Imħażżen f': {output_path}"));

    app.emit(
        "beat-sync-done",
        BeatSyncDoneEvent {
            clips,
            beats,
            images,
            output_path,
            elapsed_ms,
        },
    )
    .ok();

    Ok(())
}

fn validate_audio(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if !path.is_file() {
        return Err("Il-fajl tal-awdjo huwa meħtieġ.".into());
    }
    let ok = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| matches!(s.to_lowercase().as_str(), "mp3" | "wav" | "aiff" | "aif" | "m4a" | "flac"))
        .unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err("Uża fajl tal-awdjo MP3, WAV, AIFF, M4A jew FLAC.".into())
    }
}

fn validate_media_dir(path: &str, media_mode: &str) -> Result<(), String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err("Il-folder tal-media huwa meħtieġ.".into());
    }
    let has_media = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .any(|entry| {
            entry.path().is_file()
                && entry
                    .path()
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(|s| {
                        if media_mode == "video" {
                            matches!(s.to_lowercase().as_str(), "mp4" | "mov" | "m4v" | "avi" | "mkv" | "webm")
                        } else {
                            matches!(s.to_lowercase().as_str(), "jpg" | "jpeg" | "png" | "tif" | "tiff" | "bmp" | "webp")
                        }
                    })
                    .unwrap_or(false)
        });
    if has_media {
        Ok(())
    } else if media_mode == "video" {
        Err("L-ebda video supportat ma nstab fil-folder.".into())
    } else {
        Err("L-ebda immaġni supportata ma nstabet fil-folder.".into())
    }
}

fn normalize_output_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Il-path tal-output huwa meħtieġ.".into());
    }
    let mut out = PathBuf::from(trimmed);
    if out.extension().and_then(|s| s.to_str()) != Some("fcpxml") {
        out.set_extension("fcpxml");
    }
    Ok(out.to_string_lossy().to_string())
}

fn parse_sidecar_output(stdout: &str) -> Result<serde_json::Value, String> {
    stdout
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .ok_or_else(|| "Beat Sync ma rritornax riżultat validu.".to_string())
}

fn project_root_hint() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .to_string_lossy()
        .to_string()
}
