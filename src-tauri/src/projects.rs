//! Versioned local work and portable project files. No browser-storage quota.
use serde_json::Value;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
const MAX_JSON: u64 = 16 * 1024 * 1024;
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
fn validate(project: &Value) -> Result<String, String> {
    let id = project["id"]
        .as_str()
        .ok_or("Il-proġett jeħtieġ identifikatur.")?;
    if !valid_id(id)
        || project["version"] != 1
        || !["subtitles", "post", "event"].contains(&project["kind"].as_str().unwrap_or(""))
    {
        return Err("Format tal-proġett mhux validu.".into());
    }
    let data = &project["data"];
    if project["kind"] == "subtitles" {
        let cues = data["cues"].as_array().ok_or("Subtitles mhux validi.")?;
        if cues.len() > 100000
            || cues.iter().any(|c| {
                c["start"].as_f64().is_none()
                    || c["end"].as_f64().is_none()
                    || c["words"].as_array().is_none_or(|words| {
                        words.iter().any(|w| {
                            w["text"].as_str().is_none()
                                || w["start"].as_f64().is_none()
                                || w["end"].as_f64().is_none()
                        })
                    })
            })
        {
            return Err("Subtitles mhux validi.".into());
        }
    }
    if project["kind"] == "post" && !data["template"].is_object() {
        return Err("Template tal-proġett mhux valida.".into());
    }
    Ok(id.to_owned())
}
pub(crate) fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _lock = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    std::fs::rename(tmp, path).map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) fn save_project(app: AppHandle, project: Value) -> Result<(), String> {
    let id = validate(&project)?;
    let bytes = serde_json::to_vec(&project).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_JSON {
        return Err("Il-proġett huwa kbir wisq.".into());
    }
    atomic(&root(&app)?.join(format!("{id}.json")), &bytes)
}
#[tauri::command]
pub(crate) fn list_projects(app: AppHandle) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(root(&app)?)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if entry.metadata().map(|m| m.len() > MAX_JSON).unwrap_or(true) {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(p) = serde_json::from_str::<Value>(&text) {
                if validate(&p).is_ok() {
                    out.push(p);
                }
            }
        }
    }
    out.sort_by_key(|p| std::cmp::Reverse(p["savedAt"].as_u64().unwrap_or(0)));
    Ok(out)
}
#[tauri::command]
pub(crate) fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Identifikatur mhux validu.".into());
    }
    let path = root(&app)?.join(format!("{id}.json"));
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn export_project(
    app: AppHandle,
    mut project: Value,
    path: String,
    include_media: bool,
) -> Result<(), String> {
    validate(&project)?;
    if !path.ends_with(".banditur") {
        return Err("Uża l-estensjoni .banditur.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let target = PathBuf::from(path);
        let tmp = target.with_extension("banditur.tmp");
        let result = (|| {
            let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
            let mut zip = zip::ZipWriter::new(file);
            let opt = zip::write::SimpleFileOptions::default();
            for (key, entry) in [("mediaPath", "media.bin"), ("logoPath", "logo.bin")] {
                let source = project[key].as_str().unwrap_or("").to_owned();
                project[format!("{key}Included")] = Value::Bool(false);
                if include_media && !source.is_empty() {
                    let ext = Path::new(&source)
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    if !["mp4", "mov", "mp3", "wav", "jpg", "jpeg", "png", "webp"]
                        .contains(&ext.as_str())
                    {
                        return Err("Format tal-medjum mhux appoġġjat.".into());
                    }
                    let mut media = std::fs::File::open(&source)
                        .map_err(|e| format!("Ma nstabx il-medjum: {e}"))?;
                    if media.metadata().map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024 * 1024 {
                        return Err(
                            "Il-medjum huwa akbar minn 2 GB. Esporta mingħajr media.".into()
                        );
                    }
                    zip.start_file(entry, opt).map_err(|e| e.to_string())?;
                    std::io::copy(&mut media, &mut zip).map_err(|e| e.to_string())?;
                    project[format!("{key}Included")] = Value::Bool(true);
                }
            }
            zip.start_file("project.json", opt)
                .map_err(|e| e.to_string())?;
            zip.write_all(&serde_json::to_vec(&project).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            zip.finish().map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(tmp);
        }
        let _ = app;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn import_project(app: AppHandle, path: String) -> Result<Value, String> {
    if !path.ends_with(".banditur") {
        return Err("Agħżel proġett .banditur.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let mut text = String::new();
        zip.by_name("project.json")
            .map_err(|e| e.to_string())?
            .take(MAX_JSON + 1)
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        if text.len() as u64 > MAX_JSON {
            return Err("Il-proġett huwa kbir wisq.".into());
        }
        let mut project: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        validate(&project)?;
        // Imports always get a new identity; never overwrite a local work session.
        let id = format!(
            "import-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        project["id"] = Value::String(id.clone());
        let dir = root(&app)?.join(&id);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let result = (|| {
            for (key, entry) in [("mediaPath", "media.bin"), ("logoPath", "logo.bin")] {
                if project[format!("{key}Included")].as_bool() == Some(true) {
                    let file = zip.by_name(entry).map_err(|e| e.to_string())?;
                    if file.size() > 2 * 1024 * 1024 * 1024 {
                        return Err("Medjum kbir wisq.".into());
                    }
                    let original = project[key].as_str().unwrap_or("");
                    let ext = Path::new(original)
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("bin");
                    let safe_ext = if ["mp4", "mov", "mp3", "wav", "jpg", "jpeg", "png", "webp"]
                        .contains(&ext.to_lowercase().as_str())
                    {
                        ext
                    } else {
                        "bin"
                    };
                    let dest = dir.join(format!("{key}.{safe_ext}"));
                    let mut output = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
                    std::io::copy(&mut file.take(2 * 1024 * 1024 * 1024 + 1), &mut output)
                        .map_err(|e| e.to_string())?;
                    project[key] = Value::String(dest.to_string_lossy().into_owned());
                }
            }
            save_project(app, project.clone())?;
            Ok(project)
        })();
        if result.is_err() {
            let _ = std::fs::remove_dir_all(dir);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) fn read_work_text(path: String) -> Result<String, String> {
    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["srt", "csv", "btemplate"].contains(&ext.as_str()) {
        return Err("Format mhux appoġġjat.".into());
    }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_JSON {
        return Err("Il-file huwa kbir wisq.".into());
    }
    let mut text = String::new();
    file.take(MAX_JSON)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    Ok(text)
}
#[tauri::command]
pub(crate) fn list_media_files(path: String) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        let p = entry.path();
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if [
            "jpg", "jpeg", "png", "webp", "mp4", "mov", "arw", "cr2", "cr3", "nef", "orf", "rw2",
            "dng", "raf",
        ]
        .contains(&ext.as_str())
        {
            out.push(p.to_string_lossy().into_owned());
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
pub(crate) fn save_work_text(path: String, content: String) -> Result<(), String> {
    if !path.ends_with(".btemplate") || content.len() as u64 > MAX_JSON {
        return Err("Uża pack .btemplate sa 16 MB.".into());
    }
    let value: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    if value["format"] != "banditur-templates" || value["version"] != 1 {
        return Err("Format mhux validu.".into());
    }
    atomic(Path::new(&path), content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_rejects_paths_as_ids_and_invalid_payloads() {
        assert!(
            validate(&serde_json::json!({"id":"../outside","version":1,"kind":"event"})).is_err()
        );
        assert!(validate(&serde_json::json!({"id":"valid","version":2,"kind":"event"})).is_err());
        assert!(validate(&serde_json::json!({"id":"valid","version":1,"kind":"subtitles","data":{"cues":[{"start":0,"end":1,"words":[{}]}]}})).is_err());
        assert!(
            validate(&serde_json::json!({"id":"valid","version":1,"kind":"post","data":{}}))
                .is_err()
        );
    }
    #[test]
    fn atomic_project_write_replaces_complete_json() {
        let dir =
            std::env::temp_dir().join(format!("banditur-project-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("work.json");
        atomic(&path, b"{\"revision\":1}").unwrap();
        atomic(&path, b"{\"revision\":2}").unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&std::fs::read(&path).unwrap()).unwrap()["revision"],
            2
        );
        assert!(!path.with_extension("tmp").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
