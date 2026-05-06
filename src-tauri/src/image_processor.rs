use std::path::{Path, PathBuf};
use tauri::AppHandle;
use crate::{log, DoneEvent, ProgressEvent};
use crate::jpeg::{decode_image_moz, encode_jpeg_moz};

pub(crate) fn watermarks_dir(app: &AppHandle) -> PathBuf {
    use tauri::Manager;
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("watermarks")
    } else {
        app.path()
            .resource_dir()
            .map(|d| d.join("watermarks"))
            .unwrap_or_else(|_| PathBuf::from("watermarks"))
    }
}

#[tauri::command]
pub(crate) fn list_photographers(app: AppHandle) -> Vec<String> {
    let dir = watermarks_dir(&app);
    if !dir.is_dir() {
        return vec![];
    }
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    names.sort();
    names
}

#[tauri::command]
pub(crate) async fn process_images(
    app: AppHandle,
    input_dir: String,
    output_dir: String,
    photographer: String,
    quality: u8,
    max_dim: u32,
    watermark: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_processing(app, input_dir, output_dir, photographer, quality, max_dim, watermark)
    })
    .await
    .map_err(|e| e.to_string())?
}

const SUPPORTED: &[&str] = &["jpg", "jpeg", "png", "tiff", "tif", "bmp", "webp"];

fn run_processing(
    app: AppHandle,
    input_dir: String,
    output_dir: String,
    photographer: String,
    quality: u8,
    max_dim: u32,
    watermark: bool,
) -> Result<(), String> {
    use image::{ImageReader, RgbaImage};
    use tauri::Emitter;

    let t0 = std::time::Instant::now();

    let input_path  = PathBuf::from(&input_dir);
    let output_path = PathBuf::from(&output_dir);
    let wm_dir      = watermarks_dir(&app);

    let portrett_out = output_path.join("portrett");
    let pajsagg_out  = output_path.join("pajsaġġ");
    std::fs::create_dir_all(&portrett_out).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&pajsagg_out).map_err(|e| e.to_string())?;

    let load_wm = |orientation: &str| -> Option<RgbaImage> {
        let p = wm_dir.join(&photographer).join(format!("{orientation}.png"));
        ImageReader::open(&p).ok()?.decode().ok().map(|i| i.into_rgba8())
    };
    let wm_portrett = if watermark { load_wm("portrait")  } else { None };
    let wm_pajsagg  = if watermark { load_wm("landscape") } else { None };

    if watermark {
        if wm_portrett.is_none() {
            log(&app, "warn", &format!("Il-marka tal-portrett ma nstabetx għal '{photographer}'"));
        }
        if wm_pajsagg.is_none() {
            log(&app, "warn", &format!("Il-marka tal-pajsaġġ ma nstabetx għal '{photographer}'"));
        }
        if wm_portrett.is_none() && wm_pajsagg.is_none() {
            log(&app, "error", "L-ebda marka ma nstabet — waqfet.");
            app.emit("done", DoneEvent { portrett: 0, pajsagg: 0, imqabbla: 0, output_dir, elapsed_ms: 0 }).ok();
            return Ok(());
        }
    }

    let mut files: Vec<PathBuf> = std::fs::read_dir(&input_path)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .and_then(|s| s.to_str())
                    .map(|s| SUPPORTED.contains(&s.to_lowercase().as_str()))
                    .unwrap_or(false)
        })
        .collect();
    files.sort();

    if files.is_empty() {
        log(&app, "warn", "L-ebda immaġni supportata ma nstabet.");
        app.emit("done", DoneEvent { portrett: 0, pajsagg: 0, imqabbla: 0, output_dir, elapsed_ms: 0 }).ok();
        return Ok(());
    }

    let total = files.len();
    log(&app, "info", &format!("Instab/u {total} immaġni.\n"));

    use rayon::prelude::*;
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};

    let wm_cache_p: std::sync::RwLock<HashMap<(u32,u32), Arc<image::RgbaImage>>> = std::sync::RwLock::new(HashMap::new());
    let wm_cache_l: std::sync::RwLock<HashMap<(u32,u32), Arc<image::RgbaImage>>> = std::sync::RwLock::new(HashMap::new());

    let done       = AtomicU32::new(0);
    let n_portrett = AtomicU32::new(0);
    let n_pajsagg  = AtomicU32::new(0);
    let n_imqabbla = AtomicU32::new(0);

    files.par_iter().for_each(|path| {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        log(&app, "file", &name);

        match process_one(path, &portrett_out, &pajsagg_out, &wm_portrett, &wm_pajsagg, &wm_cache_p, &wm_cache_l, quality, max_dim) {
            Ok(is_portrait) => {
                let tip = if is_portrait { "portrett" } else { "pajsaġġ" };
                if is_portrait { n_portrett.fetch_add(1, Ordering::Relaxed); }
                else           { n_pajsagg.fetch_add(1, Ordering::Relaxed); }
                log(&app, "ok", &format!("  → {tip}/{name}"));
            }
            Err(e) => {
                log(&app, "error", &format!("  Żball: {e}"));
                n_imqabbla.fetch_add(1, Ordering::Relaxed);
            }
        }

        let d = done.fetch_add(1, Ordering::Relaxed) + 1;
        app.emit("progress", ProgressEvent { fraction: d as f64 / total as f64 }).ok();
    });

    let n_portrett = n_portrett.load(Ordering::Relaxed);
    let n_pajsagg  = n_pajsagg.load(Ordering::Relaxed);
    let n_imqabbla = n_imqabbla.load(Ordering::Relaxed);
    let elapsed_ms = t0.elapsed().as_millis() as u64;

    log(&app, "info", &format!("\n{}", "─".repeat(46)));
    log(&app, "info", &format!("  Portrett:  {n_portrett}"));
    log(&app, "info", &format!("  Pajsaġġ:   {n_pajsagg}"));
    if n_imqabbla > 0 {
        log(&app, "warn", &format!("  Imqabbla:  {n_imqabbla}"));
    }
    log(&app, "ok", &format!("\n  Imħażżen f': {output_dir}"));
    log(&app, "info", &format!("  Ħin:       {elapsed_ms}ms ({:.1} fajl/s)",
        total as f64 / (elapsed_ms as f64 / 1000.0).max(0.001)));

    app.emit("done", DoneEvent {
        portrett: n_portrett, pajsagg: n_pajsagg, imqabbla: n_imqabbla, output_dir, elapsed_ms,
    }).ok();

    Ok(())
}

fn process_one(
    path: &Path,
    portrett_out: &Path,
    pajsagg_out: &Path,
    wm_portrett: &Option<image::RgbaImage>,
    wm_pajsagg: &Option<image::RgbaImage>,
    wm_cache_p: &std::sync::RwLock<std::collections::HashMap<(u32,u32), std::sync::Arc<image::RgbaImage>>>,
    wm_cache_l: &std::sync::RwLock<std::collections::HashMap<(u32,u32), std::sync::Arc<image::RgbaImage>>>,
    quality: u8,
    max_dim: u32,
) -> Result<bool, String> {
    use image::imageops;
    use std::sync::Arc;

    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let img = decode_image_moz(&bytes)?;
    let img = apply_orientation(exif_orientation(&bytes), img);

    let img = if max_dim > 0 && (img.width() > max_dim || img.height() > max_dim) {
        let (w, h) = (img.width(), img.height());
        let scale = max_dim as f64 / w.max(h) as f64;
        let new_w = (w as f64 * scale).round() as u32;
        let new_h = (h as f64 * scale).round() as u32;
        img.resize_exact(new_w, new_h, imageops::FilterType::Triangle)
    } else {
        img
    };

    let is_portrait = img.height() > img.width();
    let dest_dir    = if is_portrait { portrett_out } else { pajsagg_out };
    let wm          = if is_portrait { wm_portrett  } else { wm_pajsagg  };
    let cache       = if is_portrait { wm_cache_p   } else { wm_cache_l  };

    let mut base = img.into_rgba8();

    if let Some(watermark) = wm {
        let key = (base.width(), base.height());
        let cached = cache.read().unwrap().get(&key).cloned();
        let wm_scaled = match cached {
            Some(c) => c,
            None => {
                let scaled = Arc::new(imageops::resize(
                    watermark, key.0, key.1, imageops::FilterType::Triangle,
                ));
                cache.write().unwrap().insert(key, Arc::clone(&scaled));
                scaled
            }
        };
        imageops::overlay(&mut base, &*wm_scaled, 0, 0);
    }

    let out_path = dest_dir.join(path.file_name().unwrap());
    let out_path = match path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase().as_str() {
        "jpg" | "jpeg" => out_path,
        _              => out_path.with_extension("jpg"),
    };

    let rgb = image::DynamicImage::ImageRgba8(base).into_rgb8();
    let compressed = encode_jpeg_moz(&rgb, quality)?;
    std::fs::write(&out_path, compressed).map_err(|e| e.to_string())?;

    Ok(is_portrait)
}

fn exif_orientation(bytes: &[u8]) -> u32 {
    let Ok(exif) = exif::Reader::new()
        .read_from_container(&mut std::io::Cursor::new(bytes))
    else {
        return 1;
    };
    exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(1)
}

fn apply_orientation(orientation: u32, img: image::DynamicImage) -> image::DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}
