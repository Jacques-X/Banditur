mod beat_sync;
mod image_processor;
mod jpeg;
mod raw_converter;
mod transcription;
mod ytmp3;

use tauri::{AppHandle, Emitter};
use transcription::TxState;

// ── Baked-in config ───────────────────────────────────────────────────────────

const CONFIG_JSON: &str = include_str!("../banditur-config.json");

#[tauri::command]
fn get_config() -> serde_json::Value {
    serde_json::from_str(CONFIG_JSON).unwrap_or_default()
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
    pub(crate) portrett: u32,
    pub(crate) pajsagg: u32,
    pub(crate) imqabbla: u32,
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(TxState {
            path_tx: std::sync::Mutex::new(None),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            image_processor::list_photographers,
            image_processor::process_images,
            raw_converter::convert_raw_batch,
            beat_sync::generate_beat_sync_timeline,
            transcription::preload_transcribe,
            transcription::process_video,
            transcription::save_srt,
            ytmp3::yt_download,
        ])
        .run(tauri::generate_context!())
        .expect("Żball fil-bidu ta' Pubblikatur");
}
