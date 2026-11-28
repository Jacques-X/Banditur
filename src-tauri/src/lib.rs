mod archive;
mod awdjo;
mod components;
mod fireworks;
mod ui_loader;
mod image_processor;
mod jpeg;
mod photo_jobs;
mod post_templates;
mod projects;
mod raw_converter;
mod source_update;
mod subtitle_render;
mod transcription;
mod watermark_packs;
mod wm_pack;
mod ytmp3;

use std::path::{Path, PathBuf};
use awdjo::AwdjoState;
use fireworks::FireworksState;
use subtitle_render::RenderState;
use tauri::{AppHandle, Emitter};
use transcription::TxState;

// ── Baked-in config ───────────────────────────────────────────────────────────

const CONFIG_JSON: &str = include_str!("../banditur-config.json");

#[tauri::command]
fn get_config() -> Result<serde_json::Value, String> {
    // P2-12: surface a clear error instead of silently returning null, which left
    // the frontend with no backend config and no indication why.
    serde_json::from_str(CONFIG_JSON)
        .map_err(|e| format!("Konfigurazzjoni invalida (banditur-config.json): {e}"))
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.request_restart();
}

// ── Shared event payloads ─────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub(crate) struct LogEvent {
    pub(crate) tag: String,
    pub(crate) msg: String,
}

#[derive(serde::Serialize, Clone)]
pub(crate) struct ProgressEvent {
    pub(crate) fraction: f64,
}

#[derive(serde::Serialize, Clone)]
pub(crate) struct DoneEvent {
    pub(crate) processed: u32,
    pub(crate) failed: u32,
    /// Photos left out because they looked like the one before ("Neħħi duplikati").
    pub(crate) duplicates: u32,
    /// Photos left out because they were out of focus ("Neħħi l-mċajpra").
    pub(crate) blurry: u32,
    pub(crate) output_dir: String,
    pub(crate) elapsed_ms: u64,
}

#[derive(serde::Serialize, Clone)]
pub(crate) struct RawDoneEvent {
    pub(crate) converted: u32,
    pub(crate) skipped: u32,
    pub(crate) output_dir: String,
    pub(crate) elapsed_ms: u64,
}

// ── Shared log helper ─────────────────────────────────────────────────────────

pub(crate) fn log(app: &AppHandle, tag: &str, msg: &str) {
    app.emit(
        "log",
        LogEvent {
            tag: tag.into(),
            msg: msg.into(),
        },
    )
    .ok();
}

/// Files directly inside `dir` whose extension (any case) is in `exts`, sorted by path.
pub(crate) fn files_with_ext(dir: &Path, exts: &[&str]) -> Result<Vec<PathBuf>, String> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| exts.contains(&e.to_lowercase().as_str()))
        })
        .collect();
    files.sort();
    Ok(files)
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The interface served to the window: an installed one from the components
    // folder when there is a usable one, else the one embedded in the app.
    let mut context = tauri::generate_context!();
    let ui_root = std::sync::Arc::new(std::sync::RwLock::new(None));
    let embedded = context.set_assets(Box::new(ui_loader::NoAssets));
    context.set_assets(Box::new(ui_loader::LayeredAssets::new(embedded, ui_root.clone())));
    let ui_loader = ui_loader::UiLoader {
        base: components::components_base_for(&context.config().identifier).unwrap_or_default(),
        root: ui_root,
        active: std::sync::RwLock::new(None),
    };
    ui_loader.select();

    tauri::Builder::default()
        .manage(ui_loader)
        .manage(TxState::default())
        .manage(RenderState {
            child: std::sync::Mutex::new(None),
        })
        .manage(FireworksState {
            child: std::sync::Mutex::new(None),
        })
        .manage(AwdjoState {
            child: std::sync::Mutex::new(None),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            archive::archive_volumes,
            archive::archive_scan,
            archive::archive_put,
            archive::archive_copy,
            archive::archive_cancel,
            archive::archive_eject,
            photo_jobs::cancel_photo_job,
            get_config,
            projects::save_project,
            projects::list_projects,
            projects::delete_project,
            projects::export_project,
            projects::import_project,
            projects::read_work_text,
            projects::save_work_text,
            projects::list_media_files,
            restart_app,
            image_processor::process_images,
            watermark_packs::list_watermark_packs,
            watermark_packs::inspect_watermark_pack,
            watermark_packs::import_watermark_pack,
            watermark_packs::export_watermark_pack,
            watermark_packs::delete_watermark_pack,
            watermark_packs::add_watermark,
            watermark_packs::remove_watermark,
            raw_converter::convert_raw_batch,
            post_templates::list_post_templates,
            post_templates::get_post_template_overlay,
            post_templates::save_post_template,
            post_templates::import_post_templates,
            post_templates::delete_post_template,
            post_templates::save_post_image,
            components::components_status,
            source_update::update_status,
            source_update::update_pull,
            source_update::update_run_background,
            source_update::update_and_restart,
            source_update::update_clear_result,
            ui_loader::interface_ready,
            ui_loader::reload_interface,
            transcription::preload_transcribe,
            transcription::process_video,
            transcription::cancel_transcribe,
            transcription::save_srt,
            subtitle_render::render_subtitles,
            subtitle_render::cancel_render,
            subtitle_render::audio_peaks,
            subtitle_render::load_style_file,
            fireworks::analyse_fireworks,
            fireworks::fireworks_thumbs,
            fireworks::fireworks_fingerprint,
            fireworks::render_fireworks,
            fireworks::cancel_fireworks,
            fireworks::make_matte,
            fireworks::read_lut,
            awdjo::awdjo_model_status,
            awdjo::awdjo_model_download,
            awdjo::awdjo_model_remove,
            awdjo::awdjo_taken,
            awdjo::awdjo_run,
            awdjo::cancel_awdjo,
            awdjo::reveal_in_finder,
            ytmp3::yt_download,
            ytmp3::cancel_download,
        ])
        .run(context)
        .expect("Żball fil-bidu ta' Pubblikatur");
}
