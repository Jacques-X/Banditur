use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
static CANCELS: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Notify>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
struct DownloadRun(String);
impl Drop for DownloadRun {
    fn drop(&mut self) {
        CANCELS.lock().unwrap().remove(&self.0);
    }
}
#[tauri::command]
pub(crate) fn cancel_download(id: String) -> Result<(), String> {
    let jobs = CANCELS.lock().unwrap();
    let cancel = jobs.get(&id).ok_or("Id-download m’għadux għaddej.")?;
    cancel.notify_one();
    Ok(())
}
use tauri::{AppHandle, Emitter};

// ── Event payload ─────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub(crate) struct YtUpdateEvent {
    pub(crate) job_id: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) format: Option<String>,
}

// ── Tools: yt-dlp, ffmpeg and a JavaScript runtime ───────────────────────────
//
// YouTube changes every few weeks and an old yt-dlp stops working, so the app
// keeps its own copy of yt-dlp (the standalone macOS build, nightly channel) in
// `<app data>/tools/` and updates it itself, instead of depending on whatever
// Homebrew or pip left on the Mac. ffmpeg comes from the transcription engine
// (imageio-ffmpeg), and Deno is downloaded next to yt-dlp when the Mac has no
// JavaScript runtime. The system copies stay as fallbacks.

const YTDLP_URL: &str =
    "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos";
/// How often the app's own yt-dlp checks for a new version.
const UPDATE_EVERY: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// Only one download prepares tools at a time.
static TOOLS_LOCK: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

fn deno_url() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip"
    } else {
        "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip"
    }
}

fn tools_dir(app: &AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().ok()?.join("tools");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn emit_preparing(app: &AppHandle, id: &str, message: &str) {
    app.emit(
        "yt-update",
        YtUpdateEvent {
            job_id: id.to_string(),
            kind: "preparing".into(),
            value: None,
            path: None,
            title: None,
            message: Some(message.to_string()),
            format: None,
        },
    )
    .ok();
}

/// Download `url` to `dest` with the system curl (always present on macOS), via a
/// `.part` file so a broken download never replaces a working tool.
async fn fetch(url: &str, dest: &Path) -> Result<(), String> {
    use tokio::process::Command;
    let part = dest.with_extension("part");
    let out = Command::new("/usr/bin/curl")
        .args(["-fsSL", "--retry", "2", "--connect-timeout", "20", "-o"])
        .arg(&part)
        .arg(url)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let _ = std::fs::remove_file(&part);
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    std::fs::rename(&part, dest).map_err(|e| e.to_string())
}

fn make_executable(p: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755));
    }
}

/// Whether the last update check is older than `every` (or never happened).
fn check_due(stamp: &Path, every: std::time::Duration) -> bool {
    std::fs::metadata(stamp)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map_or(true, |age| age >= every)
}

/// Run `yt-dlp -U` on the app's own copy. Failures are ignored: the old copy still works.
async fn update_ytdlp(exe: &Path, stamp: &Path) {
    use tokio::process::Command;
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(90),
        Command::new(exe).arg("-U").output(),
    )
    .await;
    let _ = std::fs::write(stamp, b"");
}

/// The yt-dlp found on the Mac (Homebrew, pip, PATH), used only when the app
/// cannot get its own copy.
async fn find_system_ytdlp() -> Option<String> {
    use tokio::process::Command;
    if let Ok(out) = Command::new("which").arg("yt-dlp").output().await {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout);
            let first = p.lines().next().unwrap_or("").trim();
            if !first.is_empty() && Path::new(first).exists() {
                return Some(first.to_string());
            }
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        "/opt/homebrew/bin/yt-dlp".to_string(),
        "/usr/local/bin/yt-dlp".to_string(),
        format!("{home}/.local/bin/yt-dlp"),
        "/usr/bin/yt-dlp".to_string(),
    ];
    if let Some(c) = candidates.iter().find(|c| Path::new(c.as_str()).exists()) {
        return Some(c.clone());
    }
    // pip --user and the python.org installer use versioned folders.
    for root in [
        PathBuf::from(&home).join("Library/Python"),
        PathBuf::from("/Library/Frameworks/Python.framework/Versions"),
    ] {
        let Ok(entries) = std::fs::read_dir(root) else { continue };
        for entry in entries.flatten() {
            let candidate = entry.path().join("bin/yt-dlp");
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

struct YtDlp {
    path: String,
    /// The app's own copy (always current, knows every option we pass).
    managed: bool,
}

/// The app's own yt-dlp, downloaded on first use and updated once a day;
/// otherwise the system one.
async fn get_ytdlp(app: &AppHandle, id: &str) -> Result<YtDlp, String> {
    if let Some(dir) = tools_dir(app) {
        let exe = dir.join("yt-dlp");
        let stamp = dir.join("yt-dlp.checked");
        if !exe.is_file() {
            emit_preparing(app, id, "Qed inniżżel yt-dlp (darba biss)…");
            match fetch(YTDLP_URL, &exe).await {
                Ok(()) => {
                    make_executable(&exe);
                    let _ = std::fs::write(&stamp, b"");
                }
                Err(e) => eprintln!("[yt] yt-dlp download failed: {e}"),
            }
        } else if check_due(&stamp, UPDATE_EVERY) {
            emit_preparing(app, id, "Qed niċċekkja għal aġġornament ta' yt-dlp…");
            update_ytdlp(&exe, &stamp).await;
        }
        if exe.is_file() {
            return Ok(YtDlp { path: exe.to_string_lossy().into_owned(), managed: true });
        }
    }
    match find_system_ytdlp().await {
        Some(path) => Ok(YtDlp { path, managed: false }),
        None => Err("Ma stajtx inniżżel yt-dlp. Iċċekkja l-internet u erġa' pprova.".into()),
    }
}

/// The ffmpeg inside a folder of imageio-ffmpeg binaries ("ffmpeg-macos-aarch64-v9.0").
pub(crate) fn ffmpeg_in(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            p.is_file() && name.starts_with("ffmpeg") && !name.ends_with(".py") && !name.ends_with(".md")
        })
        .collect();
    found.sort();
    found.pop()
}

/// The ffmpeg that ships with the transcription engine, else a system one.
async fn find_ffmpeg(app: &AppHandle) -> Option<String> {
    if let Some(p) = crate::components::engine_ffmpeg(app) {
        return Some(p.to_string_lossy().into_owned());
    }
    use tokio::process::Command;
    if let Ok(out) = Command::new("which").arg("ffmpeg").output().await {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout);
            let first = p.lines().next().unwrap_or("").trim();
            if !first.is_empty() {
                return Some(first.to_string());
            }
        }
    }
    ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]
        .iter()
        .find(|c| Path::new(c).exists())
        .map(|c| c.to_string())
}

/// A JavaScript runtime for yt-dlp's YouTube challenge solver: a Deno already on
/// the Mac, else the app's own Deno (downloaded once), else a Homebrew Node.
/// yt-dlp only looks on the PATH, and an app started from the Dock has a very
/// short PATH, so the runtime is always passed explicitly.
async fn js_runtime(app: &AppHandle, id: &str) -> Option<(&'static str, String)> {
    let home = std::env::var("HOME").unwrap_or_default();
    for p in [
        "/opt/homebrew/bin/deno".to_string(),
        "/usr/local/bin/deno".to_string(),
        format!("{home}/.deno/bin/deno"),
    ] {
        if Path::new(&p).is_file() {
            return Some(("deno", p));
        }
    }
    if let Some(dir) = tools_dir(app) {
        let deno = dir.join("deno");
        if !deno.is_file() {
            emit_preparing(app, id, "Qed inniżżel Deno għal YouTube (darba biss)…");
            let zip = dir.join("deno.zip");
            match fetch(deno_url(), &zip).await {
                Ok(()) => {
                    let ok = tokio::process::Command::new("/usr/bin/unzip")
                        .args(["-o", "-q"])
                        .arg(&zip)
                        .arg("-d")
                        .arg(&dir)
                        .status()
                        .await
                        .map(|s| s.success())
                        .unwrap_or(false);
                    let _ = std::fs::remove_file(&zip);
                    if ok {
                        make_executable(&deno);
                    }
                }
                Err(e) => eprintln!("[yt] deno download failed: {e}"),
            }
        }
        if deno.is_file() {
            return Some(("deno", deno.to_string_lossy().into_owned()));
        }
    }
    ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
        .iter()
        .find(|p| Path::new(p).is_file())
        .map(|p| ("node", p.to_string()))
}

/// Options that depend on the yt-dlp version: the JS runtime and, for copies
/// installed without yt-dlp's challenge-solver scripts (plain pip), permission
/// to fetch them from GitHub. The app's own copy has both; an old system copy
/// may have neither, so ask it first.
async fn runtime_args(app: &AppHandle, id: &str, ytdlp: &YtDlp) -> Vec<String> {
    let (runtimes, remote) = if ytdlp.managed {
        (true, false)
    } else {
        match tokio::process::Command::new(&ytdlp.path).arg("--help").output().await {
            Ok(out) => {
                let help = String::from_utf8_lossy(&out.stdout);
                (help.contains("--js-runtimes"), help.contains("--remote-components"))
            }
            Err(_) => (false, false),
        }
    };
    let mut args = vec![];
    if runtimes {
        if let Some((name, path)) = js_runtime(app, id).await {
            args.extend(["--js-runtimes".to_string(), format!("{name}:{path}")]);
        }
    }
    if remote {
        args.extend(["--remote-components".to_string(), "ejs:github".to_string()]);
    }
    args
}

/// The error looks like "this yt-dlp is too old for today's YouTube".
fn looks_outdated(stderr: &str) -> bool {
    let l = stderr.to_lowercase();
    l.contains("http error 403")
        || l.contains("unable to extract")
        || l.contains("n challenge")
        || l.contains("nsig")
        || l.contains("signature")
        || l.contains("only images are available")
        || l.contains("requested format is not available")
}

/// Turn yt-dlp's raw error output into a short Maltese sentence that says what to do,
/// followed by the original last error line in brackets.
fn explain_ytdlp_error(stderr: &str) -> String {
    let raw = stderr
        .lines()
        .rev()
        .find(|l| l.contains("ERROR"))
        .or_else(|| stderr.trim().lines().last())
        .unwrap_or("yt-dlp falla.")
        .trim()
        .to_string();
    let l = stderr.to_lowercase();
    // Order matters: "unable to download video data: HTTP Error 403" is YouTube
    // refusing an old yt-dlp, not a network problem.
    let hint = if l.contains("sign in to confirm") || l.contains("not a bot") {
        "YouTube qed jitlob sign-in (verifika ta' bot). Erġa' pprova aktar tard jew minn internet ieħor."
    } else if l.contains("private video")
        || l.contains("video unavailable")
        || l.contains("members-only")
    {
        "Il-video mhux disponibbli (privat, mneħħi jew għall-membri biss)."
    } else if l.contains("javascript runtime") || l.contains("no js runtime") {
        "Ma nstabx JavaScript runtime (Deno). Iċċekkja l-internet u erġa' pprova, jew installa: brew install deno."
    } else if looks_outdated(stderr) {
        "YouTube biddel xi ħaġa u yt-dlp għadu ma jlaħħaqx. L-app taġġorna yt-dlp waħedha: erġa' pprova aktar tard."
    } else if l.contains("getaddrinfo")
        || l.contains("network is unreachable")
        || l.contains("timed out")
        || l.contains("unable to download")
    {
        "Ma setax jikkonnettja ma' YouTube. Iċċekkja l-internet."
    } else {
        return raw;
    };
    format!("{hint} [{raw}]")
}

// ── Download command ──────────────────────────────────────────────────────────

enum RunError {
    Cancelled,
    Failed(String),
}

fn emit(app: &AppHandle, id: &str, format: &str, kind: &str, value: Option<f64>) {
    app.emit(
        "yt-update",
        YtUpdateEvent {
            job_id: id.to_string(),
            kind: kind.into(),
            value,
            path: None,
            title: None,
            message: None,
            format: Some(format.to_string()),
        },
    )
    .ok();
}

/// One yt-dlp run, streaming progress. Ok((path, title)) on success.
async fn run_once(
    app: &AppHandle,
    ytdlp: &str,
    args: &[String],
    id: &str,
    format: &str,
    cancel: &tokio::sync::Notify,
) -> Result<(String, String), RunError> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    let mut child = Command::new(ytdlp)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| RunError::Failed(format!("Ma stajtx nibda yt-dlp: {e}")))?;

    let stdout = child.stdout.take().ok_or(RunError::Failed("stdout missing".into()))?;
    let stderr = child.stderr.take().ok_or(RunError::Failed("stderr missing".into()))?;

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
    let stem = |p: &str| {
        Path::new(p).file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string()
    };

    loop {
        let line = tokio::select! {
            line = stdout_lines.next_line() => match line { Ok(Some(line)) => line, _ => break },
            _ = cancel.notified() => { let _ = child.kill().await; return Err(RunError::Cancelled); }
        };
        let trimmed = line.trim();
        // `--print after_move:filepath` prints the finished file on its own line.
        if Path::new(trimmed).extension().and_then(|s| s.to_str()) == Some(format) {
            final_path = trimmed.to_string();
            if title.is_empty() {
                title = stem(trimmed);
            }
        }
        // Progress: "[download]  45.2% of 142MiB ..."
        if line.starts_with("[download]") {
            let pct = line
                .split_whitespace()
                .nth(1)
                .filter(|s| s.ends_with('%'))
                .and_then(|s| s.trim_end_matches('%').parse::<f64>().ok());
            if let Some(pct) = pct {
                emit(app, id, format, "progress", Some(pct));
            }
            if let Some(p) = line.split("Destination:").nth(1) {
                title = stem(p.trim());
            }
        }
        // Conversion: "[ExtractAudio] Destination: /path/title.mp3"
        if (line.contains("[ExtractAudio]") || line.contains("[Merger]")) && line.contains("Destination:") {
            emit(app, id, format, "converting", None);
            if let Some(p) = line.split("Destination:").nth(1) {
                final_path = p.trim().to_string();
                if title.is_empty() {
                    title = stem(&final_path);
                }
            }
        }
    }

    let status = child.wait().await.map_err(|e| RunError::Failed(e.to_string()))?;
    let stderr_output = stderr_task.await.unwrap_or_default();
    if status.success() {
        Ok((final_path, title))
    } else {
        Err(RunError::Failed(stderr_output))
    }
}

/// Download media from a YouTube URL as MP4 or MP3 into output_dir.
/// Emits `yt-update` events: {type:"preparing", message} while tools are fetched
/// or updated, {type:"progress", value:0-100}, {type:"converting"},
/// {type:"done", path, title}, {type:"error", message}.
#[tauri::command]
pub(crate) async fn yt_download(
    app: AppHandle,
    url: String,
    output_dir: String,
    format: String,
    job_id: Option<String>,
) -> Result<(), String> {
    let format = format.to_lowercase();
    if !matches!(format.as_str(), "mp3" | "mp4") {
        return Err("Format mhux magħruf. Agħżel MP4 jew MP3.".into());
    }

    // P1-7 / SEC-1: this command spawns yt-dlp directly (outside the Tauri shell
    // allowlist), so validate the webview-supplied inputs before use.
    // URL must be a plain http(s) YouTube link; output_dir must be an existing dir.
    //
    // IMPORTANT: this must be a real host comparison, not a substring check.
    // `url_l.contains("youtube.com")` would also match
    // "https://youtube.com.attacker.example/x" or
    // "https://attacker.example/?x=youtube.com", letting an attacker point
    // yt-dlp at an arbitrary site. Parse the URL and compare the actual host.
    const ALLOWED_YT_HOSTS: [&str; 3] = ["youtube.com", "youtu.be", "music.youtube.com"];
    let parsed = url::Url::parse(url.trim())
        .map_err(|_| "URL invalida. Daħħal link ta' YouTube (https://…).".to_string())?;
    let scheme_ok = matches!(parsed.scheme(), "http" | "https");
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    let yt_ok = ALLOWED_YT_HOSTS
        .iter()
        .any(|h| host == *h || host.ends_with(format!(".{h}").as_str()));
    if !scheme_ok || !yt_ok {
        return Err("URL invalida. Daħħal link ta' YouTube (https://…).".into());
    }
    if !Path::new(&output_dir).is_dir() {
        return Err("Il-folder tal-output ma jeżistix.".into());
    }

    let id = job_id.unwrap_or_else(|| format!("yt-{}", std::process::id()));
    // Registered before the tools are prepared: a cancel pressed meanwhile is
    // remembered by the Notify and stops the download as soon as it starts.
    let cancel = Arc::new(tokio::sync::Notify::new());
    CANCELS.lock().unwrap().insert(id.clone(), cancel.clone());
    let _guard = DownloadRun(id.clone());

    let (ytdlp, mut args) = {
        let _tools = TOOLS_LOCK.lock().await;
        let ytdlp = get_ytdlp(&app, &id).await?;
        let mut args: Vec<String> = vec![
            "--newline".into(),
            "--no-warnings".into(),
            "--print".into(),
            "after_move:filepath".into(),
            "-o".into(),
            format!("{}/%(title)s.%(ext)s", output_dir),
        ];
        if format == "mp3" {
            args.extend(["-x", "--audio-format", "mp3", "--audio-quality", "192K"].map(String::from));
        } else {
            args.extend(
                [
                    "-f",
                    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
                    "--merge-output-format",
                    "mp4",
                    "--remux-video",
                    "mp4",
                ]
                .map(String::from),
            );
        }
        if let Some(ff) = find_ffmpeg(&app).await {
            args.extend(["--ffmpeg-location".to_string(), ff]);
        }
        args.extend(runtime_args(&app, &id, &ytdlp).await);
        (ytdlp, args)
    };
    // M8: Prepend `--` so a URL beginning with `-` is not parsed as an option
    // by yt-dlp (argument injection guard).
    args.push("--".into());
    args.push(url.clone());

    let mut result = run_once(&app, &ytdlp.path, &args, &id, &format, &cancel).await;
    // YouTube broke this version: update the app's copy now (not tomorrow) and try once more.
    if let Err(RunError::Failed(err)) = &result {
        if ytdlp.managed && looks_outdated(err) {
            if let Some(dir) = tools_dir(&app) {
                emit_preparing(&app, &id, "Qed naġġorna yt-dlp u nerġa' nipprova…");
                let _tools = TOOLS_LOCK.lock().await;
                update_ytdlp(Path::new(&ytdlp.path), &dir.join("yt-dlp.checked")).await;
                result = run_once(&app, &ytdlp.path, &args, &id, &format, &cancel).await;
            }
        }
    }

    match result {
        Ok((mut final_path, title)) => {
            if final_path.is_empty() && !title.is_empty() {
                final_path = format!("{}/{}.{}", output_dir, title, format);
            }
            app.emit(
                "yt-update",
                YtUpdateEvent {
                    job_id: id.clone(),
                    kind: "done".into(),
                    value: None,
                    path: Some(final_path),
                    title: Some(title),
                    message: None,
                    format: Some(format),
                },
            )
            .ok();
            Ok(())
        }
        Err(RunError::Cancelled) => Err("Id-download ġie kkanċellat. Il-files lesti nżammu.".into()),
        Err(RunError::Failed(err)) if err.trim().is_empty() => {
            Err("yt-dlp falla. Ikkuntrolla li l-URL hija korretta.".into())
        }
        Err(RunError::Failed(err)) => Err(explain_ytdlp_error(&err)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_403_is_an_outdated_ytdlp_not_a_network_problem() {
        let e = "ERROR: unable to download video data: HTTP Error 403: Forbidden";
        assert!(looks_outdated(e));
        assert!(explain_ytdlp_error(e).starts_with("YouTube biddel"));
    }

    #[test]
    fn errors_get_the_right_hint() {
        assert!(explain_ytdlp_error("ERROR: [youtube] x: Private video").starts_with("Il-video mhux"));
        assert!(explain_ytdlp_error("ERROR: Sign in to confirm you're not a bot").starts_with("YouTube qed jitlob"));
        assert!(explain_ytdlp_error("ERROR: [Errno 8] getaddrinfo failed").starts_with("Ma setax"));
        assert!(explain_ytdlp_error("WARNING: n challenge solving failed\nERROR: Requested format is not available")
            .starts_with("YouTube biddel"));
        assert_eq!(explain_ytdlp_error("ERROR: something new"), "ERROR: something new");
    }

    #[test]
    fn finds_the_imageio_ffmpeg_binary() {
        let d = std::env::temp_dir().join(format!("banditur-ff-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        for f in ["__init__.py", "README.md"] {
            std::fs::write(d.join(f), "").unwrap();
        }
        assert_eq!(ffmpeg_in(&d), None);
        std::fs::write(d.join("ffmpeg-macos-aarch64-v9.0"), "").unwrap();
        assert_eq!(ffmpeg_in(&d), Some(d.join("ffmpeg-macos-aarch64-v9.0")));
    }

    #[test]
    fn update_check_is_due_without_a_stamp() {
        let p = std::env::temp_dir().join(format!("banditur-stamp-{}", std::process::id()));
        let _ = std::fs::remove_file(&p);
        assert!(check_due(&p, UPDATE_EVERY));
        std::fs::write(&p, "").unwrap();
        assert!(!check_due(&p, UPDATE_EVERY));
        assert!(check_due(&p, std::time::Duration::ZERO));
    }
}
