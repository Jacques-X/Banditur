//! Where the transcription engine and the Maltese model live.
//!
//! They are not inside the app: `npm run build:local` copies them into
//! `<app data>/components/{engine,model}/<version>/` and records the versions in
//! `components/installed.json` (written last, see scripts/lib/components.mjs).
//! This module finds them for every sidecar launch (transcription, subtitle
//! rendering, waveform peaks) and falls back to the copy bundled in the app
//! (older builds) and to the project checkout (`tauri dev`).
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Bumped by hand whenever a Rust command is added or changes shape, so a
/// separately installed interface can tell whether this core understands it.
pub(crate) const CORE_API: u32 = 3; // 2: process_video takes a request id; cancel_transcribe. 3: inspect_photos removed; process_images lost the review lists

const MISSING_ENGINE: &str =
    "It-transcription engine mhix installata. Ħaddem “npm run build:local” fil-folder tal-proġett.";

/// What `installed.json` says. Unknown or malformed entries read as "not installed".
#[derive(Debug, Default, PartialEq, Clone, serde::Serialize)]
pub(crate) struct Installed {
    pub(crate) engine: Option<u32>,
    pub(crate) model: Option<u32>,
    pub(crate) ui: Option<String>,
}

pub(crate) fn parse_installed(text: &str) -> Installed {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return Installed::default();
    };
    let version = |k: &str| {
        v.get(k)
            .and_then(|n| n.as_u64())
            .filter(|n| *n > 0 && *n <= u32::MAX as u64)
            .map(|n| n as u32)
    };
    Installed {
        engine: version("engine"),
        model: version("model"),
        ui: v.get("ui").and_then(|s| s.as_str()).map(str::to_owned),
    }
}

/// `<base>/engine/<n>` when it holds the engine executable.
pub(crate) fn engine_dir(base: &Path, i: &Installed) -> Option<PathBuf> {
    let dir = base.join("engine").join(i.engine?.to_string());
    dir.join("transcribe-bundle").is_file().then_some(dir)
}

/// `<base>/model/<n>` when it holds the model files.
pub(crate) fn model_dir(base: &Path, i: &Installed) -> Option<PathBuf> {
    let dir = base.join("model").join(i.model?.to_string());
    (dir.join("config.json").is_file() && dir.join("weights.safetensors").is_file()).then_some(dir)
}

/// `<app data>/components`, worked out from the app identifier alone so it is
/// available before the app exists (the interface is chosen while building it).
/// Matches Tauri's `app_data_dir()`.
pub(crate) fn components_base_for(identifier: &str) -> Option<PathBuf> {
    if let Ok(v) = std::env::var("BANDITUR_COMPONENTS_DIR") {
        if !v.is_empty() {
            return Some(PathBuf::from(v));
        }
    }
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    let data = if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support")
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".local").join("share"))
    };
    Some(data.join(identifier).join("components"))
}

fn components_base(app: &AppHandle) -> Option<PathBuf> {
    components_base_for(&app.config().identifier)
}

pub(crate) fn read_installed(base: &Path) -> Installed {
    std::fs::read_to_string(base.join("installed.json"))
        .map(|t| parse_installed(&t))
        .unwrap_or_default()
}

/// Walk up from the app binary (inside target/debug|release) looking for `rel` in a project checkout.
fn find_in_checkout(rel: &str) -> Option<PathBuf> {
    let mut dir = std::env::current_exe().ok()?;
    for _ in 0..8 {
        dir = dir.parent()?.to_path_buf();
        let p = dir.join(rel);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

#[derive(Debug, PartialEq, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Source {
    Installed,
    Bundled,
    Dev,
    Missing,
}

/// Where the engine would be launched from: the components folder first, then
/// the bundle inside the app (older builds), then the project's venv (`tauri dev`).
fn engine_source(app: &AppHandle) -> (Source, Option<PathBuf>) {
    if let Some(base) = components_base(app) {
        if let Some(dir) = engine_dir(&base, &read_installed(&base)) {
            return (Source::Installed, Some(dir));
        }
    }
    if let Ok(res) = app.path().resource_dir() {
        if res.join("transcribe-bundle").join("transcribe-bundle").is_file() {
            return (Source::Bundled, None);
        }
    }
    if find_in_checkout("sidecar/transcribe.py").is_some() {
        return (Source::Dev, None);
    }
    (Source::Missing, None)
}

/// The ffmpeg that ships with the engine (imageio-ffmpeg, libass-enabled), for
/// code outside the sidecar such as the YouTube download. Same search order as
/// the engine itself: components folder, app bundle, then a dev checkout.
pub(crate) fn engine_ffmpeg(app: &AppHandle) -> Option<PathBuf> {
    const BINARIES: &str = "_internal/imageio_ffmpeg/binaries";
    let mut dirs: Vec<PathBuf> = vec![];
    if let (Source::Installed, Some(dir)) = engine_source(app) {
        dirs.push(dir.join(BINARIES));
    }
    if let Ok(res) = app.path().resource_dir() {
        dirs.push(res.join("transcribe-bundle").join(BINARIES));
    }
    if let Some(p) = find_in_checkout("sidecar-dist/transcribe-bundle") {
        dirs.push(p.join(BINARIES));
    }
    if let Some(lib) = find_in_checkout("venv/lib") {
        for e in std::fs::read_dir(lib).into_iter().flatten().flatten() {
            dirs.push(e.path().join("site-packages/imageio_ffmpeg/binaries"));
        }
    }
    dirs.iter().find_map(|d| crate::ytmp3::ffmpeg_in(d))
}

/// The MLX model folder: MLX_MODEL_PATH, the components folder, the bundle, the checkout.
fn model_source(app: &AppHandle) -> (Source, Option<PathBuf>) {
    if let Ok(v) = std::env::var("MLX_MODEL_PATH") {
        if !v.is_empty() {
            return (Source::Dev, Some(PathBuf::from(v)));
        }
    }
    if let Some(base) = components_base(app) {
        if let Some(dir) = model_dir(&base, &read_installed(&base)) {
            return (Source::Installed, Some(dir));
        }
    }
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("mlx-maltese-whisper-4bit");
        if p.exists() {
            return (Source::Bundled, Some(p));
        }
    }
    match find_in_checkout("mlx-maltese-whisper-4bit") {
        Some(p) => (Source::Dev, Some(p)),
        None => (Source::Missing, None),
    }
}

/// The transcription sidecar, pointed at the installed engine and model. Used by
/// every launch of it, so they all find the same copy.
pub(crate) fn sidecar_command(app: &AppHandle) -> Result<tauri_plugin_shell::process::Command, String> {
    use tauri_plugin_shell::ShellExt;
    let (source, engine) = engine_source(app);
    if source == Source::Missing {
        return Err(MISSING_ENGINE.into());
    }
    let mut cmd = app.shell().sidecar("transcribe").map_err(|e| e.to_string())?;
    if let Some(dir) = engine {
        // The launcher script (src-tauri/binaries/transcribe-*) runs this one when set.
        cmd = cmd.env("BANDITUR_ENGINE_DIR", dir.to_string_lossy().into_owned());
    }
    if let (_, Some(model)) = model_source(app) {
        cmd = cmd.env("MLX_MODEL_PATH", model.to_string_lossy().into_owned());
    }
    Ok(cmd)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    dir: Option<String>,
    installed: Installed,
    engine: Source,
    model: Source,
    core_api: u32,
    /// The installed interface being served ("5"), or None for the one inside the app.
    ui: Option<String>,
    ui_bad: Vec<String>,
}

/// For Settings: what is installed and where each piece is used from.
#[tauri::command]
pub(crate) fn components_status(app: AppHandle, ui: tauri::State<'_, crate::ui_loader::UiLoader>) -> Status {
    let base = components_base(&app);
    Status {
        installed: base.as_deref().map(read_installed).unwrap_or_default(),
        dir: base.map(|b| b.to_string_lossy().into_owned()),
        engine: engine_source(&app).0,
        model: model_source(&app).0,
        core_api: CORE_API,
        ui: ui.active.read().ok().and_then(|a| a.clone()),
        ui_bad: crate::ui_loader::read_state(&ui.base).bad,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("banditur-components-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn installed_json_is_read_leniently() {
        assert_eq!(
            parse_installed(r#"{"ui":"1.4.2","engine":3,"model":1}"#),
            Installed { engine: Some(3), model: Some(1), ui: Some("1.4.2".into()) }
        );
        assert_eq!(parse_installed("{oops"), Installed::default());
        assert_eq!(parse_installed(""), Installed::default());
        let odd = parse_installed(r#"{"engine":"3","model":0,"ui":7}"#);
        assert_eq!(odd, Installed::default());
        assert_eq!(parse_installed(r#"{"engine":-2}"#).engine, None);
        assert_eq!(parse_installed(r#"{"engine":99999999999}"#).engine, None);
    }

    #[test]
    fn the_engine_is_only_used_when_its_executable_is_there() {
        let base = scratch("engine");
        let i = Installed { engine: Some(3), ..Default::default() };
        assert_eq!(engine_dir(&base, &i), None);
        std::fs::create_dir_all(base.join("engine/3")).unwrap();
        assert_eq!(engine_dir(&base, &i), None, "folder without the executable");
        std::fs::write(base.join("engine/3/transcribe-bundle"), "x").unwrap();
        assert_eq!(engine_dir(&base, &i), Some(base.join("engine/3")));
        assert_eq!(engine_dir(&base, &Installed::default()), None, "no version recorded");
        assert_eq!(engine_dir(&base, &Installed { engine: Some(4), ..Default::default() }), None, "recorded version missing on disk");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_model_needs_both_files() {
        let base = scratch("model");
        let i = Installed { model: Some(1), ..Default::default() };
        std::fs::create_dir_all(base.join("model/1")).unwrap();
        std::fs::write(base.join("model/1/config.json"), "{}").unwrap();
        assert_eq!(model_dir(&base, &i), None);
        std::fs::write(base.join("model/1/weights.safetensors"), "w").unwrap();
        assert_eq!(model_dir(&base, &i), Some(base.join("model/1")));
        let _ = std::fs::remove_dir_all(&base);
    }
}
