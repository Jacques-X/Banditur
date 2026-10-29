//! Post-maker templates (Għodda → Posts). A template is a folder in the app-data
//! directory — `post-templates/<id>/template.json` plus `overlay.png` (the
//! transparent 1080×1350 frame exported from Photoshop). Like watermark packs,
//! templates live outside the app bundle, so adding or fixing one never needs
//! a new signed build and they survive updates.
//!
//! The format is decided and drawn by the frontend (`src/postmaker/`); this file
//! only stores it, validates the overlay, and writes the finished image.

use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Every overlay is exactly this size (4:5, Instagram's feed portrait).
const OVERLAY_W: u32 = 1080;
/// Sanity limits so a wrong file cannot fill the disk or the IPC channel.
const MAX_OVERLAY_BYTES: u64 = 40 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 60 * 1024 * 1024;

fn templates_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Ma nstabx il-folder tad-data tal-app: {e}"))?
        .join("post-templates");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Template ids become folder names, so only allow plain characters.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn template_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Identifikatur tat-template mhux validu.".into());
    }
    Ok(templates_root(app)?.join(id))
}

/// Reads width/height from a PNG header. `None` if it is not a PNG.
fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.len() < 24 || bytes[..8] != SIG || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((w, h))
}

pub(crate) fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            T[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// All installed templates (their `template.json`, with `id` set to the folder
/// name), sorted by name. Broken folders are skipped, never fatal.
#[tauri::command]
pub(crate) fn list_post_templates(app: AppHandle) -> Result<Vec<Value>, String> {
    let root = templates_root(&app)?;
    let mut out: Vec<Value> = Vec::new();
    let entries = std::fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() || !dir.join("overlay.png").is_file() {
            continue;
        }
        let Some(id) = dir.file_name().and_then(|n| n.to_str()).map(str::to_owned) else {
            continue;
        };
        if !valid_id(&id) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(dir.join("template.json")) else {
            continue;
        };
        let Ok(mut manifest) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        if let Some(obj) = manifest.as_object_mut() {
            obj.insert("id".into(), Value::String(id));
            out.push(manifest);
        }
    }
    out.sort_by_key(|m| {
        m.get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_lowercase()
    });
    Ok(out)
}

/// The overlay as a `data:` URL. A data URL never taints the canvas, so the
/// finished image can be exported (an `asset://` image would block `toBlob`).
#[tauri::command]
pub(crate) fn get_post_template_overlay(app: AppHandle, id: String) -> Result<String, String> {
    let path = template_dir(&app, &id)?.join("overlay.png");
    let bytes = std::fs::read(&path).map_err(|e| format!("Ma setax naqra l-overlay: {e}"))?;
    Ok(format!("data:image/png;base64,{}", base64(&bytes)))
}

/// Saves a template. `manifest` needs a valid `id`. `overlay_path` is a PNG the
/// user picked; leave it out when only the text zones changed.
#[tauri::command]
pub(crate) fn save_post_template(
    app: AppHandle,
    manifest: Value,
    overlay_path: Option<String>,
    overlay_bytes: Option<Vec<u8>>,
) -> Result<Value, String> {
    let id = manifest
        .get("id")
        .and_then(Value::as_str)
        .ok_or("It-template ma għandhiex identifikatur.")?
        .to_owned();
    let dir = template_dir(&app, &id)?;
    let overlay_dest = dir.join("overlay.png");

    let height = manifest["height"].as_u64().unwrap_or(1350);
    if ![1080, 1350, 1920].contains(&height) || manifest["width"].as_u64().unwrap_or(1080) != 1080 {
        return Err("Daqs tat-template mhux validu.".into());
    }
    if let Some(ref bytes) = overlay_bytes {
        if bytes.len() as u64 > MAX_OVERLAY_BYTES || !valid_overlay(bytes, height as u32) {
            return Err("Overlay PNG mhux validu jew ta’ daqs ħażin.".into());
        }
    }
    let new_overlay = if overlay_bytes.is_some() {
        overlay_bytes
    } else {
        match overlay_path {
            Some(p) => {
                let meta =
                    std::fs::metadata(&p).map_err(|e| format!("Ma setax naqra l-fajl: {e}"))?;
                if meta.len() > MAX_OVERLAY_BYTES {
                    return Err("L-overlay huwa kbir wisq (massimu 40 MB).".into());
                }
                let bytes = std::fs::read(&p).map_err(|e| format!("Ma setax naqra l-fajl: {e}"))?;
                match png_size(&bytes) {
                    None => return Err("L-overlay irid ikun fajl PNG.".into()),
                    Some((w, h)) if w != OVERLAY_W || u64::from(h) != height => {
                        return Err(format!(
                        "L-overlay irid ikun eżattament {OVERLAY_W}×{height}. Dan huwa {w}×{h}."
                    ));
                    }
                    Some(_) => {}
                }
                if !valid_overlay(&bytes, height as u32) {
                    return Err("Overlay PNG bil-ħsara.".into());
                }
                Some(bytes)
            }
            None => {
                if !overlay_dest.is_file() {
                    return Err("Agħżel overlay PNG għal din it-template.".into());
                }
                None
            }
        }
    };

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if let Some(bytes) = new_overlay {
        let tmp = dir.join("overlay.png.tmp");
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &overlay_dest).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    crate::projects::atomic(&dir.join("template.json"), text.as_bytes())?;
    Ok(manifest)
}

#[tauri::command]
pub(crate) fn delete_post_template(app: AppHandle, id: String) -> Result<(), String> {
    let dir = template_dir(&app, &id)?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Writes the finished post to a path the user chose in a save dialog. The
/// image arrives as the raw request body (no JSON array of numbers), and the
/// destination in the `path` header, percent-encoded. Only JPEG/PNG data may be
/// written, and only to a .jpg/.jpeg/.png path — the command is reachable from
/// the webview, so it must not become a general file-write primitive.
#[tauri::command]
pub(crate) fn save_post_image(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("save_post_image: expected raw image data".into());
    };
    let path = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .and_then(percent_decode)
        .ok_or("save_post_image: missing path")?;

    let lower = path.to_lowercase();
    if ![".jpg", ".jpeg", ".png"].iter().any(|e| lower.ends_with(e)) {
        return Err("save_post_image: path must end in .jpg, .jpeg or .png".into());
    }
    if data.is_empty() || data.len() > MAX_IMAGE_BYTES {
        return Err("save_post_image: image size is out of range".into());
    }
    let is_jpeg = data.starts_with(&[0xFF, 0xD8, 0xFF]);
    let is_png = png_size(data).is_some();
    if !is_jpeg && !is_png {
        return Err("save_post_image: data is not a JPEG or PNG".into());
    }
    std::fs::write(&path, data).map_err(|e| format!("Ma setax insejvja l-fajl: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_rfc4648_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn ids_are_plain() {
        assert!(valid_id("awguri-2"));
        assert!(!valid_id(""));
        assert!(!valid_id("../x"));
        assert!(!valid_id("a/b"));
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("a%20b").as_deref(), Some("a b"));
        assert_eq!(percent_decode("%C4%A7").as_deref(), Some("ħ"));
        assert_eq!(percent_decode("%zz"), None);
    }

    #[test]
    fn reads_png_header() {
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&1080u32.to_be_bytes());
        png.extend_from_slice(&1350u32.to_be_bytes());
        assert_eq!(png_size(&png), Some((1080, 1350)));
        assert_eq!(png_size(b"not a png at all, sorry......"), None);
    }
}

fn valid_overlay(bytes: &[u8], height: u32) -> bool {
    bytes.len() as u64 <= MAX_OVERLAY_BYTES
        && png_size(bytes) == Some((1080, height))
        && image::load_from_memory_with_format(bytes, image::ImageFormat::Png).is_ok()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TemplateImport {
    manifest: Value,
    overlay_bytes: Vec<u8>,
}

/// Validate the whole pack before installing any entry. Existing templates
/// are never overwritten; a failed commit removes only this import's entries.
#[tauri::command]
pub(crate) fn import_post_templates(
    app: AppHandle,
    templates: Vec<TemplateImport>,
) -> Result<(), String> {
    if templates.is_empty() || templates.len() > 100 {
        return Err("Pack mhux validu.".into());
    }
    let root = templates_root(&app)?;
    let mut ids = std::collections::HashSet::new();
    for t in &templates {
        let id = t.manifest["id"].as_str().unwrap_or("");
        let h = t.manifest["height"].as_u64().unwrap_or(1350);
        if !valid_id(id)
            || !ids.insert(id.to_owned())
            || root.join(id).exists()
            || t.manifest["width"].as_u64().unwrap_or(1080) != 1080
            || ![1080, 1350, 1920].contains(&h)
            || !valid_overlay(&t.overlay_bytes, h as u32)
        {
            return Err("Pack mhux validu jew template diġà teżisti.".into());
        }
    }
    let staging = root.join(format!(
        ".import-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let mut installed = Vec::new();
    let result = (|| {
        for t in templates {
            let id = t.manifest["id"].as_str().unwrap();
            let dir = staging.join(id);
            std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
            crate::projects::atomic(&dir.join("overlay.png"), &t.overlay_bytes)?;
            crate::projects::atomic(
                &dir.join("template.json"),
                &serde_json::to_vec_pretty(&t.manifest).map_err(|e| e.to_string())?,
            )?;
        }
        for id in ids {
            let target = root.join(&id);
            if target.exists() {
                return Err("Template diġà teżisti.".into());
            }
            std::fs::rename(staging.join(&id), &target).map_err(|e| e.to_string())?;
            installed.push(target);
        }
        Ok(())
    })();
    if result.is_err() {
        for path in installed {
            let _ = std::fs::remove_dir_all(path);
        }
    }
    let _ = std::fs::remove_dir_all(staging);
    result
}
