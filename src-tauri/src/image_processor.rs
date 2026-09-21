use crate::jpeg::{decode_image_moz, encode_jpeg_moz};
use crate::{log, DoneEvent, ProgressEvent};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

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
        run_processing(
            app,
            input_dir,
            output_dir,
            photographer,
            quality,
            max_dim,
            watermark,
        )
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

    let input_path = PathBuf::from(&input_dir);
    let output_path = PathBuf::from(&output_dir);
    let wm_dir = watermarks_dir(&app);

    std::fs::create_dir_all(&output_path).map_err(|e| e.to_string())?;

    let load_wm = |orientation: &str| -> Option<RgbaImage> {
        let p = wm_dir
            .join(&photographer)
            .join(format!("{orientation}.png"));
        ImageReader::open(&p)
            .ok()?
            .decode()
            .ok()
            .map(|i| i.into_rgba8())
    };
    let wm_portrett = if watermark { load_wm("portrait") } else { None };
    let wm_pajsagg = if watermark {
        load_wm("landscape")
    } else {
        None
    };

    if watermark {
        if wm_portrett.is_none() {
            log(
                &app,
                "warn",
                &format!("Il-marka tal-portrett ma nstabetx għal '{photographer}'"),
            );
        }
        if wm_pajsagg.is_none() {
            log(
                &app,
                "warn",
                &format!("Il-marka tal-pajsaġġ ma nstabetx għal '{photographer}'"),
            );
        }
        if wm_portrett.is_none() && wm_pajsagg.is_none() {
            log(&app, "error", "L-ebda marka ma nstabet — waqfet.");
            app.emit(
                "done",
                DoneEvent {
                    processed: 0,
                    failed: 0,
                    output_dir,
                    elapsed_ms: 0,
                },
            )
            .ok();
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
        app.emit(
            "done",
            DoneEvent {
                processed: 0,
                failed: 0,
                output_dir,
                elapsed_ms: 0,
            },
        )
        .ok();
        return Ok(());
    }

    let total = files.len();
    log(&app, "info", &format!("Instab/u {total} immaġni.\n"));

    use std::collections::HashMap;
    use std::sync::Arc;

    let wm_cache_p: std::sync::RwLock<HashMap<(u32, u32), Arc<image::RgbaImage>>> =
        std::sync::RwLock::new(HashMap::new());
    let wm_cache_l: std::sync::RwLock<HashMap<(u32, u32), Arc<image::RgbaImage>>> =
        std::sync::RwLock::new(HashMap::new());

    let mut processed = 0;
    let mut failed = 0;

    // Write serially in sorted filename order, so the output folder, log, and
    // progress all follow the source sequence.
    for (index, path) in files.iter().enumerate() {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        log(&app, "file", &name);

        match process_one(
            path,
            &output_path,
            &wm_portrett,
            &wm_pajsagg,
            &wm_cache_p,
            &wm_cache_l,
            quality,
            max_dim,
        ) {
            Ok(is_portrait) => {
                let tip = if is_portrait { "portrett" } else { "pajsaġġ" };
                processed += 1;
                log(&app, "ok", &format!("  → {name} ({tip})"));
            }
            Err(e) => {
                log(&app, "error", &format!("  Żball: {e}"));
                failed += 1;
            }
        }

        app.emit(
            "progress",
            ProgressEvent {
                fraction: (index + 1) as f64 / total as f64,
            },
        )
        .ok();
    }

    let elapsed_ms = t0.elapsed().as_millis() as u64;

    log(&app, "info", &format!("\n{}", "─".repeat(46)));
    log(&app, "info", &format!("  Ipproċessati: {processed}"));
    if failed > 0 {
        log(&app, "warn", &format!("  Imqabbla:    {failed}"));
    }
    log(&app, "ok", &format!("\n  Imħażżen f': {output_dir}"));
    log(
        &app,
        "info",
        &format!(
            "  Ħin:       {elapsed_ms}ms ({:.1} fajl/s)",
            total as f64 / (elapsed_ms as f64 / 1000.0).max(0.001)
        ),
    );

    app.emit(
        "done",
        DoneEvent {
            processed,
            failed,
            output_dir,
            elapsed_ms,
        },
    )
    .ok();

    Ok(())
}

fn process_one(
    path: &Path,
    output_dir: &Path,
    wm_portrett: &Option<image::RgbaImage>,
    wm_pajsagg: &Option<image::RgbaImage>,
    wm_cache_p: &std::sync::RwLock<
        std::collections::HashMap<(u32, u32), std::sync::Arc<image::RgbaImage>>,
    >,
    wm_cache_l: &std::sync::RwLock<
        std::collections::HashMap<(u32, u32), std::sync::Arc<image::RgbaImage>>,
    >,
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
    let wm = if is_portrait { wm_portrett } else { wm_pajsagg };
    let cache = if is_portrait { wm_cache_p } else { wm_cache_l };

    let mut base = img.into_rgba8();

    if let Some(watermark) = wm {
        let key = (base.width(), base.height());
        let cached = cache.read().unwrap().get(&key).cloned();
        let wm_scaled = match cached {
            Some(c) => c,
            None => {
                let scaled = Arc::new(imageops::resize(
                    watermark,
                    key.0,
                    key.1,
                    imageops::FilterType::Triangle,
                ));
                cache.write().unwrap().insert(key, Arc::clone(&scaled));
                scaled
            }
        };
        imageops::overlay(&mut base, &*wm_scaled, 0, 0);
    }

    // BUG-11: path.file_name() can be None (e.g. path ending in "..") — this
    // used to unwrap() and panic the whole batch over one bad path, while the
    // otherwise-identical case at the top of run_processing (line ~183) is
    // already guarded with unwrap_or_default().
    let file_name = path
        .file_name()
        .ok_or_else(|| "Isem tal-fajl invalidu.".to_string())?;
    let out_path = output_dir.join(file_name);
    let out_path = match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => out_path,
        _ => out_path.with_extension("jpg"),
    };
    let out_path = next_available_path(out_path)?;

    let rgb = image::DynamicImage::ImageRgba8(base).into_rgb8();
    let compressed = encode_jpeg_moz(&rgb, quality)?;
    std::fs::write(&out_path, compressed).map_err(|e| e.to_string())?;

    Ok(is_portrait)
}

/// Never replace an earlier output file when two source files normalize to the
/// same JPEG name (for example, `photo.png` and `photo.jpg`).
fn next_available_path(path: PathBuf) -> Result<PathBuf, String> {
    if !path.exists() {
        return Ok(path);
    }

    let parent = path
        .parent()
        .ok_or_else(|| "Kartella tal-output invalida.".to_string())?;
    let stem = path
        .file_stem()
        .ok_or_else(|| "Isem tal-fajl invalidu.".to_string())?
        .to_string_lossy();
    let extension = path.extension().unwrap_or_default();

    for copy in 2.. {
        let candidate = parent
            .join(format!("{stem} ({copy})"))
            .with_extension(extension);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    unreachable!("unbounded copy-number loop always returns when the disk is finite")
}

pub(crate) fn exif_orientation(bytes: &[u8]) -> u32 {
    let Ok(exif) = exif::Reader::new().read_from_container(&mut std::io::Cursor::new(bytes)) else {
        return 1;
    };
    exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(1)
}

pub(crate) fn apply_orientation(orientation: u32, img: image::DynamicImage) -> image::DynamicImage {
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
