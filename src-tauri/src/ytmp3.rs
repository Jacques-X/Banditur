use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ── Event payload ─────────────────────────────────────────────────────────────

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

// ── yt-dlp discovery ──────────────────────────────────────────────────────────

fn find_ytdlp() -> Result<String, String> {
    // 1. Check PATH via `which`
    if let Ok(out) = std::process::Command::new("which").arg("yt-dlp").output() {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout);
            let first = p.lines().next().unwrap_or("").trim();
            if !first.is_empty() && std::path::Path::new(first).exists() {
                return Ok(first.to_string());
            }
        }
    }

    // 2. Common install locations (macOS)
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        "/opt/homebrew/bin/yt-dlp".to_string(),            // Homebrew arm64
        "/usr/local/bin/yt-dlp".to_string(),               // Homebrew x86
        format!("{home}/.local/bin/yt-dlp"),               // pip install --user
        format!("{home}/Library/Python/3.13/bin/yt-dlp"),  // macOS system Python
        format!("{home}/Library/Python/3.12/bin/yt-dlp"),
        format!("{home}/Library/Python/3.11/bin/yt-dlp"),
        "/usr/bin/yt-dlp".to_string(),
    ];

    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return Ok(c.clone());
        }
    }

    Err("yt-dlp ma nstabx. Installa b': brew install yt-dlp".into())
}

fn find_ffmpeg() -> Option<String> {
    if let Ok(out) = std::process::Command::new("which").arg("ffmpeg").output() {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout);
            let first = p.lines().next().unwrap_or("").trim();
            if !first.is_empty() {
                return Some(first.to_string());
            }
        }
    }
    for c in &["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"] {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    None
}

// ── Download command ──────────────────────────────────────────────────────────

/// Download audio from a YouTube URL, extract as 192 kbps MP3 into output_dir.
/// Emits `yt-update` events: {type:"progress", value:0-100},
///   {type:"converting"}, {type:"done", path, title}, {type:"error", message}.
#[tauri::command]
pub(crate) async fn yt_download(
    app: AppHandle,
    url: String,
    output_dir: String,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;
    use std::process::Stdio;

    let ytdlp = find_ytdlp()?;

    let mut args: Vec<String> = vec![
        "--newline".into(),
        "--no-warnings".into(),
        "-x".into(),
        "--audio-format".into(), "mp3".into(),
        "--audio-quality".into(), "192K".into(),
        "-o".into(), format!("{}/%(title)s.%(ext)s", output_dir),
    ];

    if let Some(ff) = find_ffmpeg() {
        args.push("--ffmpeg-location".into());
        args.push(ff);
    }

    // M8: Prepend `--` so a URL beginning with `-` is not parsed as an option
    // by yt-dlp (argument injection guard).
    args.push("--".into());
    args.push(url.clone());

    let mut child = Command::new(&ytdlp)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Ma stajtx nibda yt-dlp: {e}"))?;

    let stdout = child.stdout.take().ok_or("stdout missing")?;
    let stderr = child.stderr.take().ok_or("stderr missing")?;

    // Drain stderr in a background task (captures error text for final reporting)
    let mut stderr_lines = BufReader::new(stderr).lines();
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut buf = String::new();
        while let Ok(Some(line)) = stderr_lines.next_line().await {
            if !line.trim().is_empty() {
                buf.push_str(&line);
                buf.push('\n');
            }
        }
        buf
    });

    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut final_path = String::new();
    let mut title = String::new();

    while let Ok(Some(line)) = stdout_lines.next_line().await {
        // Progress: "[download]  45.2% of 142MiB ..."
        if line.starts_with("[download]") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(pct_str) = parts.get(1) {
                if pct_str.ends_with('%') {
                    if let Ok(pct) = pct_str.trim_end_matches('%').parse::<f64>() {
                        app.emit("yt-update", YtUpdateEvent {
                            kind: "progress".into(),
                            value: Some(pct),
                            path: None, title: None, message: None,
                        }).ok();
                    }
                }
            }
            // Grab download destination for title
            if line.contains("Destination:") {
                if let Some(p) = line.split("Destination:").nth(1) {
                    let pb = std::path::Path::new(p.trim());
                    title = pb.file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                }
            }
        }
        // Conversion: "[ExtractAudio] Destination: /path/title.mp3"
        if (line.contains("[ExtractAudio]") || line.contains("[Merger]"))
            && line.contains("Destination:")
        {
            app.emit("yt-update", YtUpdateEvent {
                kind: "converting".into(),
                value: None, path: None, title: None, message: None,
            }).ok();
            if let Some(p) = line.split("Destination:").nth(1) {
                final_path = p.trim().to_string();
                if title.is_empty() {
                    title = std::path::Path::new(&final_path)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                }
            }
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if status.success() {
        // If we didn't see [ExtractAudio], the mp3 path is the download dest minus extension
        if final_path.is_empty() && !title.is_empty() {
            final_path = format!("{}/{}.mp3", output_dir, title);
        }
        app.emit("yt-update", YtUpdateEvent {
            kind: "done".into(),
            value: None,
            path: Some(final_path),
            title: Some(title),
            message: None,
        }).ok();
        Ok(())
    } else {
        let msg = if !stderr_output.trim().is_empty() {
            stderr_output.trim().lines().last().unwrap_or("yt-dlp falla.").to_string()
        } else {
            "yt-dlp falla. Ikkuntrolla li l-URL hija korretta.".into()
        };
        Err(msg)
    }
}
