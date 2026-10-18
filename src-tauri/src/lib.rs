mod image_processor;
mod jpeg;
mod raw_converter;
mod subtitle_render;
mod transcription;
mod watermark_packs;
mod wm_pack;
mod ytmp3;

use tauri::{AppHandle, Emitter};
use subtitle_render::RenderState;
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

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(TxState {
            path_tx: std::sync::Mutex::new(None),
        })
        .manage(RenderState {
            child: std::sync::Mutex::new(None),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
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
            transcription::preload_transcribe,
            transcription::process_video,
            transcription::save_srt,
            subtitle_render::render_subtitles,
            subtitle_render::cancel_render,
            subtitle_render::audio_peaks,
            subtitle_render::load_style_file,
            ytmp3::yt_download,
        ])
        .run(tauri::generate_context!())
        .expect("Żball fil-bidu ta' Pubblikatur");
}
