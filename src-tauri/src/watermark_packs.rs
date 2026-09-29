//! Tauri commands for managing watermark packs. The format, validation and
//! storage logic lives in `wm_pack.rs`; this file only resolves the storage
//! folder and moves blocking I/O off the UI thread.

use crate::wm_pack::{self, PackInfo, PackPreview};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Installed packs live in the app's data folder (e.g. on macOS
/// `~/Library/Application Support/app.banditur.desktop/watermarks/`), so they
/// survive app updates and are never part of the app bundle.
pub(crate) fn packs_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Ma nstabx il-folder tad-data tal-app: {e}"))?
        .join("watermarks");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&Path) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = packs_root(&app)?;
        f(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn list_watermark_packs(app: AppHandle) -> Result<Vec<PackInfo>, String> {
    blocking(app, |root| Ok(wm_pack::list_packs(root))).await
}

/// Validates a pack file and reports what it contains (and whether it would
/// replace an installed pack) without installing anything.
#[tauri::command]
pub(crate) async fn inspect_watermark_pack(
    app: AppHandle,
    path: String,
) -> Result<PackPreview, String> {
    blocking(app, move |root| wm_pack::preview_pack_file(root, Path::new(&path))).await
}

#[tauri::command]
pub(crate) async fn import_watermark_pack(app: AppHandle, path: String) -> Result<PackInfo, String> {
    blocking(app, move |root| {
        let loaded = wm_pack::read_pack_file(Path::new(&path))?;
        wm_pack::install_pack(root, loaded)
    })
    .await
}

#[tauri::command]
pub(crate) async fn export_watermark_pack(
    app: AppHandle,
    pack_id: String,
    dest: String,
) -> Result<(), String> {
    blocking(app, move |root| wm_pack::export_pack(root, &pack_id, Path::new(&dest))).await
}

#[tauri::command]
pub(crate) async fn delete_watermark_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    blocking(app, move |root| wm_pack::delete_pack(root, &pack_id)).await
}

/// Adds or replaces one watermark. `pack_id: None` creates a new pack named
/// `new_pack_name`.
#[tauri::command]
pub(crate) async fn add_watermark(
    app: AppHandle,
    pack_id: Option<String>,
    new_pack_name: Option<String>,
    name: String,
    portrait_path: Option<String>,
    landscape_path: Option<String>,
) -> Result<PackInfo, String> {
    blocking(app, move |root| {
        wm_pack::add_watermark(
            root,
            pack_id.as_deref(),
            new_pack_name.as_deref(),
            &name,
            portrait_path.as_deref().map(Path::new),
            landscape_path.as_deref().map(Path::new),
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn remove_watermark(
    app: AppHandle,
    pack_id: String,
    watermark_id: String,
) -> Result<PackInfo, String> {
    blocking(app, move |root| wm_pack::remove_watermark(root, &pack_id, &watermark_id)).await
}
