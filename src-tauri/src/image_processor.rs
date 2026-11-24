use crate::jpeg::{decode_image_scaled, encode_jpeg_moz};
use crate::watermark_packs::packs_root;
use crate::wm_pack;
use crate::{files_with_ext, log, DoneEvent, ProgressEvent};
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
    min_sharpness: Option<f64>,
    source: Option<String>,
    auto_bright: Option<bool>,
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
            min_sharpness,
            source,
            auto_bright.unwrap_or(false),
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
    min_sharpness: Option<f64>,
    source: Option<String>,
    bright: bool,
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
                blurry: 0,
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
                &format!("Il-watermark portrait ma nstabx għal '{wm_name}'"),
            );
        }
        if wm_pajsagg.is_none() {
            log(
                &app,
                "warn",
                &format!("Il-watermark landscape ma nstabx għal '{wm_name}'"),
            );
        }
        if wm_portrett.is_none() && wm_pajsagg.is_none() {
            stop("L-ebda marka ma nstabet — waqfet.");
            return Ok(());
        }
    }

    let mut files = list_photos(&input_path, source.as_deref())?;
    if let Some(selected) = include_files {
        let selected: std::collections::HashSet<String> = selected.into_iter().collect();
        files.retain(|p| selected.contains(p.to_string_lossy().as_ref()));
    }

    if files.is_empty() {
        log(&app, "warn", "L-ebda immaġni supportata ma nstabet.");
        app.emit(
            "done",
            DoneEvent {
                processed: 0,
                failed: 0,
                duplicates: 0,
                blurry: 0,
                output_dir,
                elapsed_ms: 0,
            },
        )
        .ok();
        return Ok(());
    }

    let total = files.len();
    log(&app, "info", &format!("Instab/u {total} immaġni.\n"));

    use rayon::prelude::*;
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;

    let wm_cache_p: MarkCache = std::sync::RwLock::new(HashMap::new());
    let wm_cache_l: MarkCache = std::sync::RwLock::new(HashMap::new());

    let mut processed = 0;
    let mut failed = 0;
    let mut reused = 0;
    let mut duplicates: u32 = 0;
    let mut blurry: u32 = 0;

    // ── 1) Look: a cheap fingerprint (and sharpness) of every photo, from a heavily shrunk decode.
    // Decisions are made here, before any photo is decoded in full, so a skipped photo costs almost nothing.
    let live_dupes = skip_duplicates;
    let live_blur = min_sharpness;
    let looks: Vec<Option<Result<Look, String>>> = if live_dupes || live_blur.is_some() {
        log(&app, "info", "Qed janalizza r-ritratti…");
        files
            .par_iter()
            .map(|p| (!crate::photo_jobs::cancelled()).then(|| look(p, live_blur.is_some())))
            .collect()
    } else {
        files.iter().map(|_| None).collect()
    };

    // Folder-wide: a photo is compared with every photo kept so far, not only the one before it.
    let mut kept: Vec<(u64, String)> = Vec::new();
    let mut acts: Vec<Act> = Vec::with_capacity(total);
    let mut reserved: HashSet<PathBuf> = HashSet::new();
    let mut manifest = load_manifest(&output_path);
    let cfg = settings_key(watermark, &wm_name, &wm_dir, quality, max_dim, bright);
    let mut manifest_dirty = false;
    for (path, look) in files.iter().zip(looks) {
        let look = match look {
            Some(Err(e)) => {
                acts.push(Act::Fail(e));
                continue;
            }
            Some(Ok(l)) => Some(l),
            None => None,
        };
        if let (Some(limit), Some(l)) = (live_blur, &look) {
            // An out-of-focus photo is also never the reference for the duplicate check.
            if l.sharp < limit {
                acts.push(Act::Blurry(l.sharp));
                continue;
            }
        }
        if let (true, Some(l)) = (live_dupes, &look) {
            if let Some((distance, of)) = nearest_kept(&kept, l.hash) {
                if distance <= DUP_MAX_DISTANCE {
                    acts.push(Act::Duplicate(distance, of.to_string()));
                    continue;
                }
            }
            kept.push((l.hash, path.file_name().unwrap_or_default().to_string_lossy().into_owned()));
        }
        // Already made with these settings? Then reuse it instead of encoding again.
        if let Some(out) = reusable(&manifest, path, &output_path, &cfg) {
            reserved.insert(out.clone());
            acts.push(Act::Reuse(out));
            continue;
        }
        match output_path_for(path, &output_path).and_then(|o| reserve_path(o, &mut reserved)) {
            Ok(out) => acts.push(Act::Encode(out)),
            Err(e) => acts.push(Act::Fail(e)),
        }
    }

    // ── 2) Make: decode (only as large as needed), resize, watermark, encode — one photo per worker thread,
    // handed out in source order with no batch boundaries, so every core stays busy. Results are reported
    // in source order, so the log, the progress bar and the output names still follow the sorted source order.
    let workers = rayon::current_num_threads().clamp(1, 8);
    let next = std::sync::atomic::AtomicUsize::new(0);
    let (tx, rx) = std::sync::mpsc::channel::<(usize, Res)>();
    let mut pending: HashMap<usize, Res> = HashMap::new();
    let mut done_so_far = 0usize;

    std::thread::scope(|scope| {
        for _ in 0..workers {
            let tx = tx.clone();
            let (acts, files, next) = (&acts, &files, &next);
            let (wm_p, wm_l, cache_p, cache_l) = (&wm_portrett, &wm_pajsagg, &wm_cache_p, &wm_cache_l);
            scope.spawn(move || loop {
                let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if i >= acts.len() {
                    break;
                }
                let Act::Encode(out) = &acts[i] else { continue };
                let res = if crate::photo_jobs::cancelled() {
                    Res::Cancelled
                } else {
                    Res::Done(
                        decode_for_output(&files[i], max_dim)
                            .and_then(|img| finish_one(img, out, wm_p, wm_l, cache_p, cache_l, quality, max_dim, bright)),
                    )
                };
                if tx.send((i, res)).is_err() {
                    break;
                }
            });
        }
        drop(tx);

        for (i, path) in files.iter().enumerate() {
            if crate::photo_jobs::cancelled() {
                break;
            }
            let res = match &acts[i] {
                Act::Fail(e) => Res::Fail(e.clone()),
                Act::Duplicate(d, of) => Res::Duplicate(*d, of.clone()),
                Act::Blurry(s) => Res::Blurry(*s),
                Act::Reuse(out) => Res::Reused(out.clone()),
                Act::Encode(_) => loop {
                    if let Some(r) = pending.remove(&i) {
                        break r;
                    }
                    match rx.recv() {
                        Ok((j, r)) => {
                            pending.insert(j, r);
                        }
                        Err(_) => break Res::Cancelled,
                    }
                },
            };
            if matches!(res, Res::Cancelled) {
                break;
            }
            let succeeded = !matches!(&res, Res::Done(Err(_)) | Res::Fail(_));
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            log(&app, "file", &name);
            match res {
                Res::Done(Ok(is_portrait)) => {
                    let tip = if is_portrait { "portrait" } else { "landscape" };
                    processed += 1;
                    log(&app, "ok", &format!("  → {name} ({tip})"));
                    if let Act::Encode(out) = &acts[i] {
                        if let Some(entry) = manifest_entry(path, out, &cfg) {
                            manifest.insert(name.to_string(), entry);
                            manifest_dirty = true;
                        }
                    }
                }
                Res::Reused(out) => {
                    processed += 1;
                    reused += 1;
                    log(&app, "ok", &format!("  ↺ {name} — diġà lest ({})", out.file_name().unwrap_or_default().to_string_lossy()));
                }
                Res::Duplicate(distance, of) => {
                    duplicates += 1;
                    let why = format!("jixbah lil {of} (differenza {distance}/64), imqabbeż");
                    log(&app, "warn", &format!("  ⤼ {name} — {why}"));
                }
                Res::Blurry(score) => {
                    blurry += 1;
                    let why = format!("mċajpra (nitidezza {score:.0}), imqabbeż");
                    log(&app, "warn", &format!("  ⤼ {name} — {why}"));
                }
                Res::Done(Err(e)) | Res::Fail(e) => {
                    log(&app, "error", &format!("  Żball: {e}"));
                    failed += 1;
                }
                Res::Cancelled => {}
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
    });
    if manifest_dirty {
        save_manifest(&output_path, &manifest);
    }

    let elapsed_ms = t0.elapsed().as_millis() as u64;

    log(&app, "info", &format!("\n{}", "─".repeat(46)));
    log(&app, "info", &format!("  Ipproċessati: {processed}"));
    if reused > 0 {
        log(&app, "info", &format!("  Diġà lesti (ma erġgħux saru): {reused}"));
    }
    if failed > 0 {
        log(&app, "warn", &format!("  Imqabbla:    {failed}"));
    }
    if duplicates > 0 {
        log(&app, "warn", &format!("  Duplikati mqabbżin: {duplicates}"));
    }
    if blurry > 0 {
        log(&app, "warn", &format!("  Mċajpra mqabbżin: {blurry}"));
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
            blurry,
            output_dir,
            elapsed_ms,
        },
    )
    .ok();

    Ok(())
}

/// What happens to one photo, decided up front.
enum Act {
    Fail(String),
    Duplicate(u32, String),
    Blurry(f64),
    Reuse(PathBuf),
    Encode(PathBuf),
}
enum Res {
    Fail(String),
    Duplicate(u32, String),
    Blurry(f64),
    Reused(PathBuf),
    Done(Result<bool, String>),
    Cancelled,
}

/// A photo's cheap fingerprint and sharpness.
struct Look {
    hash: u64,
    sharp: f64,
    portrait: bool,
}

/// The photos of a folder: images, or RAW files (their embedded preview) when `source` is "raw".
fn list_photos(dir: &Path, source: Option<&str>) -> Result<Vec<PathBuf>, String> {
    match source {
        Some("raw") => files_with_ext(dir, crate::raw_converter::RAW_SUPPORTED),
        _ => files_with_ext(dir, SUPPORTED),
    }
}

fn is_raw(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| crate::raw_converter::RAW_SUPPORTED.contains(&e.to_lowercase().as_str()))
}

/// The bytes of a photo: the file itself, or a RAW file's embedded JPEG preview.
fn load_bytes(path: &Path) -> Result<Vec<u8>, String> {
    if is_raw(path) {
        crate::raw_converter::extract_arw_jpeg_bytes(path)
    } else {
        std::fs::read(path).map_err(|e| e.to_string())
    }
}

/// Fingerprint (and optionally sharpness) from a shrunk decode: about 1000 px for sharpness, ~256 px for the fingerprint alone.
fn look(path: &Path, with_sharpness: bool) -> Result<Look, String> {
    let bytes = load_bytes(path)?;
    let img = apply_orientation(
        exif_orientation(&bytes),
        decode_image_scaled(&bytes, if with_sharpness { 1000 } else { 256 })?,
    );
    Ok(Look {
        portrait: img.height() > img.width(),
        hash: dhash(&img),
        sharp: if with_sharpness { sharpness(&img) } else { f64::NAN },
    })
}

/// Decode for export: no larger than the output needs (full size when max_dim is 0), with EXIF rotation applied.
fn decode_for_output(path: &Path, max_dim: u32) -> Result<image::DynamicImage, String> {
    let bytes = load_bytes(path)?;
    Ok(apply_orientation(exif_orientation(&bytes), decode_image_scaled(&bytes, max_dim)?))
}

// ── Already-made outputs ─────────────────────────────────────────────────────
// A small file in the output folder remembers what was made from which source and with which settings,
// so running the same folder again only does the new or changed photos.

const MANIFEST: &str = ".banditur-ritratti.json";

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
struct Made {
    size: u64,
    mtime: i64,
    cfg: String,
    out: String,
    out_size: u64,
}

fn load_manifest(dir: &Path) -> std::collections::HashMap<String, Made> {
    std::fs::read(dir.join(MANIFEST))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_manifest(dir: &Path, m: &std::collections::HashMap<String, Made>) {
    if let Ok(b) = serde_json::to_vec(m) {
        let _ = std::fs::write(dir.join(MANIFEST), b);
    }
}

fn mtime_secs(path: &Path) -> Option<(u64, i64)> {
    let m = std::fs::metadata(path).ok()?;
    let t = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64;
    Some((m.len(), t))
}

/// Everything about the settings (and the watermark files) that changes what an output looks like.
fn settings_key(watermark: bool, wm_name: &str, wm_dir: &Path, quality: u8, max_dim: u32, bright: bool) -> String {
    let sig = |n: &str| mtime_secs(&wm_dir.join(n)).map(|(s, t)| format!("{s}:{t}")).unwrap_or_default();
    if watermark {
        format!("wm|{wm_name}|{}|{}|q{quality}|d{max_dim}|b{}", sig("portrait.png"), sig("landscape.png"), bright as u8)
    } else {
        format!("plain|q{quality}|d{max_dim}|b{}", bright as u8)
    }
}

/// The earlier output for this source, if the source and settings are unchanged and the file is still there.
fn reusable(
    manifest: &std::collections::HashMap<String, Made>,
    source: &Path,
    out_dir: &Path,
    cfg: &str,
) -> Option<PathBuf> {
    let entry = manifest.get(source.file_name()?.to_str()?)?;
    let (size, mtime) = mtime_secs(source)?;
    let out = out_dir.join(&entry.out);
    let out_size = std::fs::metadata(&out).ok()?.len();
    (entry.size == size && entry.mtime == mtime && entry.cfg == cfg && entry.out_size == out_size).then_some(out)
}

fn manifest_entry(source: &Path, out: &Path, cfg: &str) -> Option<Made> {
    let (size, mtime) = mtime_secs(source)?;
    Some(Made {
        size,
        mtime,
        cfg: cfg.to_string(),
        out: out.file_name()?.to_string_lossy().into_owned(),
        out_size: std::fs::metadata(out).ok()?.len(),
    })
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

/// A watermark scaled to one output size, with the rows that hold any visible pixel (most marks are a small
/// logo, so most rows are fully transparent and can be skipped when blending).
struct ScaledMark {
    img: image::RgbaImage,
    /// First row, and one past the last row, with a pixel whose alpha is above 0. Empty (`first >= last`) when there is none.
    rows: (u32, u32),
}

impl ScaledMark {
    fn new(img: image::RgbaImage) -> Self {
        let rows = visible_rows(&img);
        Self { img, rows }
    }
}

type MarkCache = std::sync::RwLock<
    std::collections::HashMap<(u32, u32), std::sync::Arc<ScaledMark>>,
>;

fn visible_rows(img: &image::RgbaImage) -> (u32, u32) {
    let stride = img.width() as usize * 4;
    if stride == 0 {
        return (0, 0);
    }
    let mut first: Option<u32> = None;
    let mut end = 0u32;
    for (y, row) in img.as_raw().chunks_exact(stride).enumerate() {
        if row.chunks_exact(4).any(|p| p[3] > 0) {
            if first.is_none() {
                first = Some(y as u32);
            }
            end = y as u32 + 1;
        }
    }
    match first {
        Some(f) => (f, end),
        None => (0, 0),
    }
}

/// Lay the mark over the photo: alpha 0 leaves the photo alone, alpha 255 replaces it, anything between mixes
/// `(src*a + dst*(255-a)) / 255` per channel (rounded). Only the rows that can change are visited.
fn blend_rows(dst: &mut image::RgbImage, mark: &ScaledMark) {
    let (dst_w, dst_h) = (dst.width() as usize, dst.height());
    let (first, end) = mark.rows;
    let end = end.min(dst_h).min(mark.img.height());
    if first >= end {
        return;
    }
    let w = dst_w.min(mark.img.width() as usize);
    let src_stride = mark.img.width() as usize * 4;
    let dst_stride = dst_w * 3;
    let src = mark.img.as_raw();
    let dst_raw: &mut [u8] = &mut *dst;
    for y in first as usize..end as usize {
        let s = &src[y * src_stride..y * src_stride + w * 4];
        let d = &mut dst_raw[y * dst_stride..y * dst_stride + w * 3];
        for (sp, dp) in s.chunks_exact(4).zip(d.chunks_exact_mut(3)) {
            let a = sp[3] as u32;
            if a == 0 {
                continue;
            }
            if a == 255 {
                dp.copy_from_slice(&sp[..3]);
                continue;
            }
            for c in 0..3 {
                dp[c] = ((sp[c] as u32 * a + dp[c] as u32 * (255 - a) + 127) / 255) as u8;
            }
        }
    }
}

/// Resize, watermark, JPEG-encode and write one prepared photo. Returns `true` for a portrait.
fn finish_one(
    img: image::DynamicImage,
    out_path: &Path,
    wm_portrett: &Option<image::RgbaImage>,
    wm_pajsagg: &Option<image::RgbaImage>,
    wm_cache_p: &MarkCache,
    wm_cache_l: &MarkCache,
    quality: u8,
    max_dim: u32,
    bright: bool,
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

    // RGB all the way: a JPEG has no alpha, so there is nothing to carry.
    let mut base = img.into_rgb8();
    // Before the watermark, so the logo is not lifted with the picture.
    if bright {
        auto_brighten(&mut base);
    }

    if let Some(watermark) = wm {
        let key = (base.width(), base.height());
        let cached = cache.read().unwrap().get(&key).cloned();
        let wm_scaled = match cached {
            Some(c) => c,
            None => {
                let scaled = Arc::new(ScaledMark::new(imageops::resize(
                    watermark,
                    key.0,
                    key.1,
                    imageops::FilterType::Triangle,
                )));
                cache.write().unwrap().insert(key, Arc::clone(&scaled));
                scaled
            }
        };
        blend_rows(&mut base, &wm_scaled);
    }

    let compressed = encode_jpeg_moz(&base, quality)?;
    std::fs::write(out_path, compressed).map_err(|e| e.to_string())?;

    Ok(is_portrait)
}

/// Two photos whose 64-bit fingerprints differ in at most this many bits count as the same shot.
/// Kept low on purpose: it is better to keep a near-duplicate than to drop a different photo.
const DUP_MAX_DISTANCE: u32 = 5;

/// Median brightness (0–255) of an image, from every 4th pixel in each direction (plenty for a median).
fn median_luma(img: &image::RgbImage) -> u8 {
    let mut hist = [0u32; 256];
    let mut n = 0u32;
    for y in (0..img.height()).step_by(4) {
        for x in (0..img.width()).step_by(4) {
            let p = img.get_pixel(x, y);
            let l = (p[0] as u32 * 54 + p[1] as u32 * 183 + p[2] as u32 * 19) >> 8;
            hist[l.min(255) as usize] += 1;
            n += 1;
        }
    }
    let mut seen = 0;
    for (v, c) in hist.iter().enumerate() {
        seen += c;
        if seen * 2 >= n.max(1) {
            return v as u8;
        }
    }
    128
}

/// Below this median brightness a photo counts as dark; the lift fades in from here and is full at `BRIGHT_FULL`.
const BRIGHT_BELOW: f32 = 90.0;
const BRIGHT_FULL: f32 = 60.0;
/// The median brightness a lifted photo is aimed at (neutral, not bright — a night shot should still look like night).
const BRIGHT_TARGET: f32 = 112.0;

/// The gamma that lifts a dark photo toward neutral; None when it is not dark. Smooth: no jump between
/// two similar photos either side of the limit, and never stronger than 0.5 (a night scene stays a night scene).
fn bright_gamma(median: u8) -> Option<f32> {
    let m = median as f32;
    if m >= BRIGHT_BELOW {
        return None;
    }
    let ratio = (m.max(8.0)) / 255.0;
    let full = ((BRIGHT_TARGET / 255.0).ln() / ratio.ln()).clamp(0.5, 1.0);
    let ramp = ((BRIGHT_BELOW - m) / (BRIGHT_BELOW - BRIGHT_FULL)).clamp(0.0, 1.0);
    Some(1.0 - (1.0 - full) * ramp)
}

/// "Auto-brightness": lift a dark photo toward neutral with one gamma curve on all three channels. Whites stay white,
/// colours keep their balance. Photos that are not dark are left byte-for-byte alone.
fn auto_brighten(img: &mut image::RgbImage) {
    let Some(g) = bright_gamma(median_luma(img)) else { return };
    let mut lut = [0u8; 256];
    for (i, v) in lut.iter_mut().enumerate() {
        *v = (255.0 * (i as f32 / 255.0).powf(g)).round().clamp(0.0, 255.0) as u8;
    }
    for p in img.pixels_mut() {
        p[0] = lut[p[0] as usize];
        p[1] = lut[p[1] as usize];
        p[2] = lut[p[2] as usize];
    }
}

/// The closest photo among those already kept: (distance, its file name). Folder-wide, not just the previous one.
fn nearest_kept(kept: &[(u64, String)], hash: u64) -> Option<(u32, &str)> {
    kept.iter()
        .map(|(h, name)| ((h ^ hash).count_ones(), name.as_str()))
        .min_by_key(|(d, _)| *d)
}

/// How sharp a photo is, on a scale that does not depend on its resolution: shrink to at most 1000 px, soften
/// slightly (so grain does not count as detail), take the Laplacian, and average the variance of the sharpest
/// eighth of an 8×8 grid. Judging the best tiles rather than the whole frame means a portrait with a soft
/// background still scores well; a shot that missed focus or shook is soft everywhere and scores low.
fn sharpness(img: &image::DynamicImage) -> f64 {
    use image::imageops::{blur, FilterType};
    let (w, h) = (img.width(), img.height());
    let img = if w.max(h) > 1000 { img.resize(1000, 1000, FilterType::Triangle) } else { img.clone() };
    let g = blur(&img.to_luma8(), 1.0);
    let (w, h) = (g.width() as usize, g.height() as usize);
    if w < 16 || h < 16 {
        return 0.0;
    }
    const N: usize = 8;
    let mut sum = [0f64; N * N];
    let mut sq = [0f64; N * N];
    let mut cnt = [0f64; N * N];
    let px = |x: usize, y: usize| g.get_pixel(x as u32, y as u32)[0] as f64;
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let l = 4.0 * px(x, y) - px(x - 1, y) - px(x + 1, y) - px(x, y - 1) - px(x, y + 1);
            let t = (y * N / h) * N + (x * N / w);
            sum[t] += l;
            sq[t] += l * l;
            cnt[t] += 1.0;
        }
    }
    let mut vars: Vec<f64> = (0..N * N).filter(|&t| cnt[t] > 0.0).map(|t| sq[t] / cnt[t] - (sum[t] / cnt[t]).powi(2)).collect();
    vars.sort_by(|a, b| b.total_cmp(a));
    let top = &vars[..vars.len().min(N)];
    top.iter().sum::<f64>() / top.len().max(1) as f64
}

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
    fn duplicates_are_found_folder_wide_not_just_next_to_each_other() {
        let a = dhash(&gradient(false));
        let b = dhash(&gradient(true));
        // photo 1 = a, photo 2 = b (different), photo 3 = a again: it matches photo 1, not photo 2
        let kept = vec![(a, "1.jpg".to_string()), (b, "2.jpg".to_string())];
        assert_eq!(nearest_kept(&kept, a), Some((0, "1.jpg")));
        assert!(nearest_kept(&[], a).is_none());
    }

    fn texture(blurred: f32) -> image::DynamicImage {
        let mut seed = 12345u32;
        let img = image::RgbImage::from_fn(1200, 800, |x, y| {
            // coarse blocks of pseudo-random grey: edges everywhere, like a busy scene
            seed = (x / 6 * 7919 + y / 6 * 104729).wrapping_mul(2654435761) ^ 0x9e3779b9;
            let v = (seed >> 24) as u8;
            image::Rgb([v, v, v])
        });
        let img = image::DynamicImage::ImageRgb8(img);
        if blurred > 0.0 { image::DynamicImage::ImageRgb8(image::imageops::blur(&img.to_rgb8(), blurred)) } else { img }
    }

    #[test]
    fn blurred_picture_scores_far_below_a_sharp_one() {
        let sharp = sharpness(&texture(0.0));
        let soft = sharpness(&texture(5.0));
        let flat = sharpness(&image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(800, 600, image::Rgb([90, 90, 90]))));
        assert!(sharp > soft * 10.0, "sharp {sharp}, soft {soft}");
        assert!(flat < 1.0, "flat {flat}");
        // resolution does not change the verdict much: same scene at half size stays well above the soft one
        let half = sharpness(&texture(0.0).resize(600, 400, image::imageops::FilterType::Triangle));
        assert!(half > soft * 3.0, "half {half}, soft {soft}");
    }

    fn scene(w: u32, h: u32) -> image::RgbImage {
        // soft shapes, like a real picture: big blobs rather than per-pixel noise
        image::RgbImage::from_fn(w, h, |x, y| {
            let (fx, fy) = (x as f32 / w as f32, y as f32 / h as f32);
            let v = 128.0 + 90.0 * (fx * 9.0).sin() * (fy * 5.0).cos() + 30.0 * (fx * 40.0 + fy * 25.0).sin();
            image::Rgb([v as u8, (v * 0.8) as u8, (255.0 - v) as u8])
        })
    }

    #[test]
    fn fingerprint_from_a_shrunk_decode_matches_the_full_decode() {
        let bytes = crate::jpeg::encode_jpeg_moz(&scene(2400, 1600), 90).unwrap();
        let full = crate::jpeg::decode_image_scaled(&bytes, 0).unwrap();
        let small = crate::jpeg::decode_image_scaled(&bytes, 256).unwrap();
        assert!(small.width() < full.width());
        let d = (dhash(&full) ^ dhash(&small)).count_ones();
        assert!(d <= 2, "distance {d}");
        // and the blur score is steady between a ~1000 px decode and the full one
        let a = sharpness(&full);
        let b = sharpness(&crate::jpeg::decode_image_scaled(&bytes, 1000).unwrap());
        assert!((a - b).abs() <= a.max(b) * 0.35, "full {a} vs scaled {b}");
    }

    #[test]
    fn earlier_outputs_are_reused_only_when_nothing_changed() {
        let dir = std::env::temp_dir().join(format!("banditur-manifest-{}", std::process::id()));
        let (src, out_dir) = (dir.join("in"), dir.join("out"));
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&out_dir).unwrap();
        let photo = src.join("a.jpg");
        std::fs::write(&photo, b"original bytes").unwrap();
        let out = out_dir.join("a.jpg");
        std::fs::write(&out, b"made").unwrap();
        let mut m = std::collections::HashMap::new();
        m.insert("a.jpg".to_string(), manifest_entry(&photo, &out, "plain|q85|d2048").unwrap());
        assert_eq!(reusable(&m, &photo, &out_dir, "plain|q85|d2048"), Some(out.clone()));
        assert_eq!(reusable(&m, &photo, &out_dir, "plain|q90|d2048"), None); // settings changed
        std::fs::write(&photo, b"edited, different length").unwrap();
        assert_eq!(reusable(&m, &photo, &out_dir, "plain|q85|d2048"), None); // source changed
        std::fs::write(&photo, b"original bytes").unwrap();
        std::fs::write(&out, b"hand-edited output").unwrap();
        assert_eq!(reusable(&m, &photo, &out_dir, "plain|q85|d2048"), None); // output changed
        std::fs::remove_file(&out).unwrap();
        assert_eq!(reusable(&m, &photo, &out_dir, "plain|q85|d2048"), None); // output gone
        save_manifest(&out_dir, &m);
        assert_eq!(load_manifest(&out_dir).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn raw_or_image_listing_follows_the_chosen_source() {
        let dir = std::env::temp_dir().join(format!("banditur-list-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for n in ["a.ARW", "a.JPG", "b.jpg", "c.cr3", "d.txt"] {
            std::fs::write(dir.join(n), b"x").unwrap();
        }
        let names = |v: Vec<PathBuf>| v.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect::<Vec<_>>();
        assert_eq!(names(list_photos(&dir, Some("raw")).unwrap()), vec!["a.ARW", "c.cr3"]);
        assert_eq!(names(list_photos(&dir, Some("jpg")).unwrap()), vec!["a.JPG", "b.jpg"]);
        assert_eq!(names(list_photos(&dir, None).unwrap()), vec!["a.JPG", "b.jpg"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dark_photos_are_lifted_toward_neutral_and_normal_ones_are_not_touched() {
        let flat = |v: u8| image::RgbImage::from_pixel(64, 64, image::Rgb([v, v, v]));
        let mut dark = flat(30);
        auto_brighten(&mut dark);
        let m = median_luma(&dark);
        assert!(m > 70 && m < 125, "lifted to {m}");
        let mut ok = flat(120);
        let before = ok.clone();
        auto_brighten(&mut ok);
        assert_eq!(ok, before);
        // white stays white, black stays black
        let mut mixed = image::RgbImage::from_fn(64, 64, |x, _| if x < 50 { image::Rgb([20, 20, 20]) } else { image::Rgb([255, 255, 255]) });
        auto_brighten(&mut mixed);
        assert_eq!(mixed.get_pixel(60, 0)[0], 255);
        // colour balance: a dark warm photo stays warm
        let mut warm = image::RgbImage::from_pixel(64, 64, image::Rgb([60, 30, 15]));
        auto_brighten(&mut warm);
        let p = warm.get_pixel(0, 0);
        assert!(p[0] > p[1] && p[1] > p[2], "{p:?}");
    }

    fn mark(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> ScaledMark {
        ScaledMark::new(image::RgbaImage::from_fn(w, h, |x, y| image::Rgba(f(x, y))))
    }

    #[test]
    fn a_transparent_mark_changes_nothing_and_an_opaque_pixel_replaces() {
        let base = image::RgbImage::from_pixel(8, 8, image::Rgb([10, 20, 30]));
        let mut out = base.clone();
        let clear = mark(8, 8, |_, _| [200, 100, 50, 0]);
        assert_eq!(clear.rows.0 >= clear.rows.1, true, "no visible rows");
        blend_rows(&mut out, &clear);
        assert_eq!(out, base);
        let opaque = mark(8, 8, |x, y| if (x, y) == (3, 4) { [200, 100, 50, 255] } else { [0, 0, 0, 0] });
        blend_rows(&mut out, &opaque);
        assert_eq!(out.get_pixel(3, 4).0, [200, 100, 50]);
        assert_eq!(out.get_pixel(2, 4).0, [10, 20, 30]);
    }

    #[test]
    fn a_half_transparent_pixel_lands_on_the_average() {
        let mut out = image::RgbImage::from_pixel(4, 4, image::Rgb([0, 100, 255]));
        let half = mark(4, 4, |_, _| [255, 0, 255, 128]);
        blend_rows(&mut out, &half);
        let p = out.get_pixel(1, 1).0;
        for (got, want) in p.iter().zip([127u8, 50, 255]) {
            assert!((*got as i32 - want as i32).abs() <= 1, "{p:?}");
        }
    }

    #[test]
    fn visible_rows_cover_only_rows_with_any_alpha() {
        let one_row = mark(10, 12, |_, y| if y == 7 { [1, 2, 3, 40] } else { [9, 9, 9, 0] });
        assert_eq!(one_row.rows, (7, 8));
        let two = mark(10, 12, |x, y| if (y == 2 && x == 9) || y == 5 { [1, 2, 3, 255] } else { [0, 0, 0, 0] });
        assert_eq!(two.rows, (2, 6));
        let none = mark(10, 12, |_, _| [5, 5, 5, 0]);
        assert_eq!(none.rows, (0, 0));
    }

    #[test]
    fn the_lift_fades_in_smoothly_and_is_capped() {
        assert_eq!(bright_gamma(90), None);
        assert_eq!(bright_gamma(200), None);
        let g89 = bright_gamma(89).unwrap();
        assert!(g89 > 0.97, "{g89}");
        let mut last = 1.0;
        for m in (0..90).rev() {
            let g = bright_gamma(m).unwrap();
            assert!(g <= last + 1e-6 && g >= 0.5, "m {m} g {g}");
            last = g;
        }
        assert_eq!(bright_gamma(5).unwrap(), 0.5);
    }

    #[test]
    fn opposite_pictures_are_far_apart() {
        let d = (dhash(&gradient(false)) ^ dhash(&gradient(true))).count_ones();
        assert!(d > DUP_MAX_DISTANCE, "distance was {d}");
    }
}
