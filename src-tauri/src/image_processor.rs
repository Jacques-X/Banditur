use crate::jpeg::{decode_image_moz, encode_jpeg_moz};
use crate::watermark_packs::packs_root;
use crate::wm_pack;
use crate::{log, DoneEvent, ProgressEvent};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[tauri::command]
pub(crate) async fn process_images(
    app: AppHandle,
    input_dir: String,
    output_dir: String,
    watermark_id: String,
    quality: u8,
    max_dim: u32,
    watermark: bool,
    skip_duplicates: bool,
    job_id: Option<String>,
    include_files: Option<Vec<String>>,
    keep_files: Option<Vec<String>>,
    skip_files: Option<Vec<String>>,
) -> Result<(), String> {
    let guard = crate::photo_jobs::begin(job_id.unwrap_or("photo".into()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        run_processing(
            app,
            input_dir,
            output_dir,
            watermark_id,
            quality,
            max_dim,
            watermark,
            skip_duplicates,
            include_files,
            keep_files.unwrap_or_default(),
            skip_files,
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
    watermark_id: String,
    quality: u8,
    max_dim: u32,
    watermark: bool,
    skip_duplicates: bool,
    include_files: Option<Vec<String>>,
    keep_files: Vec<String>,
    skip_files: Option<Vec<String>>,
) -> Result<(), String> {
    use image::{ImageReader, RgbaImage};
    use tauri::Emitter;

    let t0 = std::time::Instant::now();

    let input_path = PathBuf::from(&input_dir);
    let output_path = PathBuf::from(&output_dir);

    std::fs::create_dir_all(&output_path).map_err(|e| e.to_string())?;

    let stop = |msg: &str| {
        log(&app, "error", msg);
        app.emit(
            "done",
            DoneEvent {
                processed: 0,
                failed: 0,
                duplicates: 0,
                output_dir: output_dir.clone(),
                elapsed_ms: 0,
            },
        )
        .ok();
    };

    // `watermark_id` is "<pack-id>/<watermark-id>" from an installed pack
    // (see wm_pack.rs); ids are validated there, so no path traversal.
    let (wm_dir, wm_name) = if watermark {
        match packs_root(&app).and_then(|root| wm_pack::resolve_watermark(&root, &watermark_id)) {
            Ok(v) => v,
            Err(e) => {
                stop(&format!("{e} — waqfet."));
                return Ok(());
            }
        }
    } else {
        (PathBuf::new(), String::new())
    };

    let load_wm = |orientation: &str| -> Option<RgbaImage> {
        let p = wm_dir.join(format!("{orientation}.png"));
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
                &format!("Il-marka tal-portrett ma nstabetx għal '{wm_name}'"),
            );
        }
        if wm_pajsagg.is_none() {
            log(
                &app,
                "warn",
                &format!("Il-marka tal-pajsaġġ ma nstabetx għal '{wm_name}'"),
            );
        }
        if wm_portrett.is_none() && wm_pajsagg.is_none() {
            stop("L-ebda marka ma nstabet — waqfet.");
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
    if let Some(ref selected) = include_files {
        files.retain(|p| selected.contains(&p.to_string_lossy().into_owned()));
    }

    if files.is_empty() {
        log(&app, "warn", "L-ebda immaġni supportata ma nstabet.");
        app.emit(
            "done",
            DoneEvent {
                processed: 0,
                failed: 0,
                duplicates: 0,
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
    // "Neħħi duplikati wara xulxin": fingerprint of the last photo that was kept,
    // so a photo is compared with the previous *kept* one (no drifting chains).
    let mut duplicates: u32 = 0;
    let mut last_hash: Option<u64> = None;
    let mut last_kept = String::new();

    // Speed: photos are handled in small batches. Within a batch the heavy work (decoding, and
    // resizing + watermark + JPEG encoding) runs on all CPU cores; the cheap decisions (duplicate
    // check, output file names) and all logging stay sequential, so the log, the progress bar and
    // the output names still follow the sorted source order exactly.
    use rayon::prelude::*;
    use std::collections::HashSet;

    enum Plan {
        Fail(String),
        Duplicate(u32),
        Keep(image::DynamicImage, PathBuf),
    }
    enum Res {
        Fail(String),
        Duplicate(u32),
        Done(Result<bool, String>),
    }

    // Decoded photos are big (a 24 MP image is ~70 MB), so the batch is capped.
    let batch_size = rayon::current_num_threads().clamp(1, 8);
    let mut reserved: HashSet<PathBuf> = HashSet::new();
    let mut done_so_far = 0usize;

    for chunk in files.chunks(batch_size) {
        if crate::photo_jobs::cancelled() {
            break;
        }
        // A) decode + rotate, in parallel
        let prepared: Vec<Result<image::DynamicImage, String>> =
            chunk.par_iter().map(|path| prepare_one(path)).collect();

        // B) in order: duplicate check and output names
        let mut plans: Vec<Plan> = Vec::with_capacity(chunk.len());
        for (path, prep) in chunk.iter().zip(prepared) {
            let img = match prep {
                Ok(img) => img,
                Err(e) => {
                    plans.push(Plan::Fail(e));
                    continue;
                }
            };
            if skip_duplicates
                && skip_files
                    .as_ref()
                    .is_some_and(|paths| paths.contains(&path.to_string_lossy().into_owned()))
            {
                plans.push(Plan::Duplicate(0));
                continue;
            }
            // A reviewed list freezes the decisions; keeping one candidate must
            // never cause a different, unreviewed photo to be skipped later.
            if skip_duplicates && skip_files.is_none() {
                let hash = dhash(&img);
                if let Some(prev) = last_hash {
                    let distance = (prev ^ hash).count_ones();
                    if distance <= DUP_MAX_DISTANCE
                        && !keep_files.contains(&path.to_string_lossy().into_owned())
                    {
                        plans.push(Plan::Duplicate(distance));
                        continue;
                    }
                }
                last_hash = Some(hash);
            }
            match output_path_for(path, &output_path).and_then(|o| reserve_path(o, &mut reserved)) {
                Ok(out) => plans.push(Plan::Keep(img, out)),
                Err(e) => plans.push(Plan::Fail(e)),
            }
        }

        // C) resize + watermark + encode + write, in parallel
        let results: Vec<Res> = plans
            .into_par_iter()
            .map(|plan| match plan {
                Plan::Fail(e) => Res::Fail(e),
                Plan::Duplicate(d) => Res::Duplicate(d),
                Plan::Keep(img, out) => Res::Done(finish_one(
                    img,
                    &out,
                    &wm_portrett,
                    &wm_pajsagg,
                    &wm_cache_p,
                    &wm_cache_l,
                    quality,
                    max_dim,
                )),
            })
            .collect();

        // D) log + progress, in order
        for (path, res) in chunk.iter().zip(results) {
            let succeeded = !matches!(&res, Res::Done(Err(_)) | Res::Fail(_));
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            log(&app, "file", &name);
            match res {
                Res::Done(Ok(is_portrait)) => {
                    let tip = if is_portrait { "portrett" } else { "pajsaġġ" };
                    processed += 1;
                    last_kept = name.to_string();
                    log(&app, "ok", &format!("  → {name} ({tip})"));
                }
                Res::Duplicate(distance) => {
                    duplicates += 1;
                    log(
                        &app,
                        "warn",
                        &format!("  ⤼ {name} — jixbah lil {last_kept} (differenza {distance}/64), imqabbeż"),
                    );
                }
                Res::Done(Err(e)) | Res::Fail(e) => {
                    log(&app, "error", &format!("  Żball: {e}"));
                    failed += 1;
                }
            }
            crate::photo_jobs::file(&app, path, succeeded);
            done_so_far += 1;
            app.emit(
                "progress",
                ProgressEvent {
                    fraction: done_so_far as f64 / total as f64,
                },
            )
            .ok();
        }
    }

    let elapsed_ms = t0.elapsed().as_millis() as u64;

    log(&app, "info", &format!("\n{}", "─".repeat(46)));
    log(&app, "info", &format!("  Ipproċessati: {processed}"));
    if failed > 0 {
        log(&app, "warn", &format!("  Imqabbla:    {failed}"));
    }
    if duplicates > 0 {
        log(&app, "warn", &format!("  Duplikati mqabbżin: {duplicates}"));
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
            duplicates,
            output_dir,
            elapsed_ms,
        },
    )
    .ok();

    Ok(())
}

/// Read + decode a photo and apply its EXIF rotation.
fn prepare_one(path: &Path) -> Result<image::DynamicImage, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let img = decode_image_moz(&bytes)?;
    Ok(apply_orientation(exif_orientation(&bytes), img))
}

/// Where a source photo's JPEG goes (everything that is not already .jpg/.jpeg becomes .jpg).
fn output_path_for(path: &Path, output_dir: &Path) -> Result<PathBuf, String> {
    // BUG-11: path.file_name() can be None (e.g. path ending in "..") — guard it
    // instead of panicking the whole batch over one bad path.
    let file_name = path
        .file_name()
        .ok_or_else(|| "Isem tal-fajl invalidu.".to_string())?;
    let out_path = output_dir.join(file_name);
    Ok(
        match path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str()
        {
            "jpg" | "jpeg" => out_path,
            _ => out_path.with_extension("jpg"),
        },
    )
}

/// Like `next_available_path`, but also avoids names already handed out in this run whose files
/// are not written yet (photos of a batch are written in parallel).
fn reserve_path(
    path: PathBuf,
    reserved: &mut std::collections::HashSet<PathBuf>,
) -> Result<PathBuf, String> {
    let mut candidate = next_available_path(path.clone())?;
    let mut copy = 2;
    while reserved.contains(&candidate) {
        let parent = path
            .parent()
            .ok_or_else(|| "Kartella tal-output invalida.".to_string())?;
        let stem = path
            .file_stem()
            .ok_or_else(|| "Isem tal-fajl invalidu.".to_string())?
            .to_string_lossy();
        let extension = path.extension().unwrap_or_default();
        candidate = next_available_path(
            parent
                .join(format!("{stem} ({copy})"))
                .with_extension(extension),
        )?;
        copy += 1;
    }
    reserved.insert(candidate.clone());
    Ok(candidate)
}

/// Resize, watermark, JPEG-encode and write one prepared photo. Returns `true` for a portrait.
fn finish_one(
    img: image::DynamicImage,
    out_path: &Path,
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

    let rgb = image::DynamicImage::ImageRgba8(base).into_rgb8();
    let compressed = encode_jpeg_moz(&rgb, quality)?;
    std::fs::write(out_path, compressed).map_err(|e| e.to_string())?;

    Ok(is_portrait)
}

/// Two photos whose 64-bit fingerprints differ in at most this many bits count as the same shot.
/// Kept low on purpose: it is better to keep a near-duplicate than to drop a different photo.
const DUP_MAX_DISTANCE: u32 = 5;

/// 64-bit "difference hash": shrink to 9×8 grey and record whether each pixel is brighter than
/// the one to its right. Robust to resizing, compression and small exposure changes.
fn dhash(img: &image::DynamicImage) -> u64 {
    use image::imageops::FilterType;
    let small = img.resize_exact(9, 8, FilterType::Triangle).to_luma8();
    let mut bits = 0u64;
    for y in 0..8u32 {
        for x in 0..8u32 {
            bits <<= 1;
            if small.get_pixel(x, y)[0] > small.get_pixel(x + 1, y)[0] {
                bits |= 1;
            }
        }
    }
    bits
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

#[cfg(test)]
mod dedupe_tests {
    use super::*;

    fn gradient(flip: bool) -> image::DynamicImage {
        let img = image::RgbImage::from_fn(64, 48, |x, _| {
            let v = if flip {
                255 - (x * 4) as u8
            } else {
                (x * 4) as u8
            };
            image::Rgb([v, v, v])
        });
        image::DynamicImage::ImageRgb8(img)
    }

    #[test]
    fn same_picture_has_the_same_fingerprint() {
        assert_eq!(dhash(&gradient(false)), dhash(&gradient(false)));
    }

    #[test]
    fn opposite_pictures_are_far_apart() {
        let d = (dhash(&gradient(false)) ^ dhash(&gradient(true))).count_ones();
        assert!(d > DUP_MAX_DISTANCE, "distance was {d}");
    }
}

#[tauri::command]
pub(crate) async fn inspect_photos(
    app: AppHandle,
    input_dir: String,
    watermark_id: String,
    watermark: bool,
    quality: u8,
    max_dim: u32,
) -> Result<Vec<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::collections::HashMap;
        use std::sync::{Arc, RwLock};
        let mut files: Vec<PathBuf> = std::fs::read_dir(&input_dir)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| SUPPORTED.contains(&e.to_lowercase().as_str()))
            })
            .collect();
        files.sort();
        let (mut portrait, mut landscape) = (None, None);
        if watermark {
            let root = packs_root(&app)?;
            let (dir, _) = wm_pack::resolve_watermark(&root, &watermark_id)?;
            let p = dir.join("portrait.png");
            if p.is_file() {
                portrait = Some(image::open(p).map_err(|e| e.to_string())?.into_rgba8());
            }
            let p = dir.join("landscape.png");
            if p.is_file() {
                landscape = Some(image::open(p).map_err(|e| e.to_string())?.into_rgba8());
            }
        }
        let cache_p: RwLock<HashMap<(u32, u32), Arc<image::RgbaImage>>> =
            RwLock::new(HashMap::new());
        let cache_l = RwLock::new(HashMap::new());
        let mut out = Vec::new();
        let mut last: Option<(u64, String)> = None;
        let mut seen_portrait = false;
        let mut seen_landscape = false;
        for (i, path) in files.iter().enumerate() {
            if i >= 2000 {
                return Err("Ipprevedi sa 2,000 ritratt f’daqqa.".into());
            }
            match prepare_one(path) {
                Ok(img) => {
                    let hash = dhash(&img);
                    let duplicate = last
                        .as_ref()
                        .filter(|(h, _)| (h ^ hash).count_ones() <= DUP_MAX_DISTANCE)
                        .map(|(_, p)| p.clone());
                    let mut preview = String::new();
                    let portrait_shape = img.height() > img.width();
                    let sample = if portrait_shape {
                        !seen_portrait
                    } else {
                        !seen_landscape
                    };
                    if sample || i < 2 {
                        if portrait_shape {
                            seen_portrait = true;
                        } else {
                            seen_landscape = true;
                        }
                        let tmp = std::env::temp_dir()
                            .join(format!("banditur-preview-{}-{i}.jpg", std::process::id()));
                        finish_one(
                            img, &tmp, &portrait, &landscape, &cache_p, &cache_l, quality, max_dim,
                        )?;
                        let result = (|| {
                            let thumb = image::open(&tmp)
                                .map_err(|e| e.to_string())?
                                .thumbnail(420, 420)
                                .into_rgb8();
                            let bytes = encode_jpeg_moz(&thumb, 85)?;
                            Ok::<String, String>(format!(
                                "data:image/jpeg;base64,{}",
                                crate::post_templates::base64(&bytes)
                            ))
                        })();
                        let _ = std::fs::remove_file(&tmp);
                        preview = result?;
                    }
                    let value = path.to_string_lossy().into_owned();
                    if duplicate.is_none() {
                        last = Some((hash, value.clone()));
                    }
                    out.push(
                        serde_json::json!({"path":value,"duplicateOf":duplicate,"preview":preview}),
                    );
                }
                Err(e) => out.push(serde_json::json!({"path":path.to_string_lossy(),"error":e})),
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}
