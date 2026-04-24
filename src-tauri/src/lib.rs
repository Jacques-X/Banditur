use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

// ── Baked-in config (filled at build time, never exposed to the user) ─────────

const CONFIG_JSON: &str = include_str!("../banditur-config.json");

#[tauri::command]
fn get_config() -> serde_json::Value {
    serde_json::from_str(CONFIG_JSON).unwrap_or_default()
}

// ── Sortjatur event payloads ──────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
struct LogEvent {
    tag: String,
    msg: String,
}

#[derive(serde::Serialize, Clone)]
struct ProgressEvent {
    fraction: f64,
}

#[derive(serde::Serialize, Clone)]
struct DoneEvent {
    portrett:   u32,
    pajsagg:    u32,
    imqabbla:   u32,
    output_dir: String,
}

#[derive(serde::Serialize, Clone)]
struct RawDoneEvent {
    converted:  u32,
    skipped:    u32,
    output_dir: String,
}

// ── Watermarks directory resolution ──────────────────────────────────────────

fn watermarks_dir(app: &AppHandle) -> PathBuf {
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

// ── Sortjatur commands ────────────────────────────────────────────────────────

#[tauri::command]
fn list_photographers(app: AppHandle) -> Vec<String> {
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
async fn process_images(
    app: AppHandle,
    input_dir: String,
    output_dir: String,
    photographer: String,
    quality: u8,
    max_dim: u32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_processing(app, input_dir, output_dir, photographer, quality, max_dim)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Photo processing pipeline ─────────────────────────────────────────────────

const SUPPORTED: &[&str] = &["jpg", "jpeg", "png", "tiff", "tif", "bmp", "webp"];

fn run_processing(
    app: AppHandle,
    input_dir: String,
    output_dir: String,
    photographer: String,
    quality: u8,
    max_dim: u32,
) -> Result<(), String> {
    use image::{ImageReader, RgbaImage};

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
    let wm_portrett = load_wm("portrait");
    let wm_pajsagg  = load_wm("landscape");

    if wm_portrett.is_none() {
        log(&app, "warn", &format!("Il-marka tal-portrett ma nstabetx għal '{photographer}'"));
    }
    if wm_pajsagg.is_none() {
        log(&app, "warn", &format!("Il-marka tal-pajsaġġ ma nstabetx għal '{photographer}'"));
    }
    if wm_portrett.is_none() && wm_pajsagg.is_none() {
        log(&app, "error", "L-ebda marka ma nstabet — waqfet.");
        app.emit("done", DoneEvent { portrett: 0, pajsagg: 0, imqabbla: 0, output_dir }).ok();
        return Ok(());
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
        app.emit("done", DoneEvent { portrett: 0, pajsagg: 0, imqabbla: 0, output_dir }).ok();
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

    log(&app, "info", &format!("\n{}", "─".repeat(46)));
    log(&app, "info", &format!("  Portrett:  {n_portrett}"));
    log(&app, "info", &format!("  Pajsaġġ:   {n_pajsagg}"));
    if n_imqabbla > 0 {
        log(&app, "warn", &format!("  Imqabbla:  {n_imqabbla}"));
    }
    log(&app, "ok", &format!("\n  Imħażżen f': {output_dir}"));

    app.emit("done", DoneEvent {
        portrett: n_portrett, pajsagg: n_pajsagg, imqabbla: n_imqabbla, output_dir,
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

// ── ARW → JPG ─────────────────────────────────────────────────────────────────

#[tauri::command]
async fn convert_raw_batch(
    app: AppHandle,
    input_dir: String,
    output_dir: String,
    quality: u8,
    max_dim: u32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_raw_conversion(app, input_dir, output_dir, quality, max_dim)
    })
    .await
    .map_err(|e| e.to_string())?
}

const RAW_SUPPORTED: &[&str] = &["arw", "cr2", "cr3", "nef", "orf", "rw2", "dng", "raf"];

fn run_raw_conversion(
    app: AppHandle,
    input_dir: String,
    output_dir: String,
    quality: u8,
    max_dim: u32,
) -> Result<(), String> {
    use rayon::prelude::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    let input_path  = PathBuf::from(&input_dir);
    let output_path = PathBuf::from(&output_dir);

    std::fs::create_dir_all(&output_path).map_err(|e| e.to_string())?;

    let mut files: Vec<PathBuf> = std::fs::read_dir(&input_path)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .and_then(|s| s.to_str())
                    .map(|s| RAW_SUPPORTED.contains(&s.to_lowercase().as_str()))
                    .unwrap_or(false)
        })
        .collect();
    files.sort();

    if files.is_empty() {
        log(&app, "warn", "L-ebda fajl RAW ma nstab.");
        app.emit("raw-done", RawDoneEvent { converted: 0, skipped: 0, output_dir }).ok();
        return Ok(());
    }

    let total = files.len();
    log(&app, "info", &format!("Instab/u {total} fajl RAW.\n"));

    let done   = AtomicU32::new(0);
    let n_ok   = AtomicU32::new(0);
    let n_skip = AtomicU32::new(0);

    files.par_iter().for_each(|path| {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        log(&app, "file", &name);

        let stem     = path.file_stem().unwrap_or_default().to_string_lossy();
        let out_path = output_path.join(format!("{stem}.jpg"));

        match extract_arw_jpeg_bytes(path) {
            Ok(jpeg_bytes) => {
                let needs_resize = max_dim > 0 && jpeg_dimensions(&jpeg_bytes)
                    .map(|(w, h)| w > max_dim || h > max_dim)
                    .unwrap_or(true);

                let save_result: Result<(), String> = if needs_resize {
                    (|| {
                        use image::imageops;
                        let img = decode_image_moz(&jpeg_bytes)?;
                        let (w, h) = (img.width(), img.height());
                        let scale = max_dim as f64 / w.max(h) as f64;
                        let new_w = (w as f64 * scale).round() as u32;
                        let new_h = (h as f64 * scale).round() as u32;
                        let img = img.resize_exact(new_w, new_h, imageops::FilterType::Triangle);
                        let rgb = img.into_rgb8();
                        let compressed = encode_jpeg_moz(&rgb, quality)?;
                        std::fs::write(&out_path, compressed).map_err(|e| e.to_string())
                    })()
                } else {
                    std::fs::write(&out_path, &jpeg_bytes).map_err(|e| e.to_string())
                };

                match save_result {
                    Ok(_) => {
                        log(&app, "ok", &format!("  → {stem}.jpg"));
                        n_ok.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => {
                        log(&app, "error", &format!("  Żball fil-ħażna: {e}"));
                        n_skip.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
            Err(e) => {
                log(&app, "error", &format!("  Żball: {e}"));
                n_skip.fetch_add(1, Ordering::Relaxed);
            }
        }

        let d = done.fetch_add(1, Ordering::Relaxed) + 1;
        app.emit("progress", ProgressEvent { fraction: d as f64 / total as f64 }).ok();
    });

    let n_ok   = n_ok.load(Ordering::Relaxed);
    let n_skip = n_skip.load(Ordering::Relaxed);

    log(&app, "info", &format!("\n{}", "─".repeat(46)));
    log(&app, "info", &format!("  Ikkonvertiti: {n_ok}"));
    if n_skip > 0 {
        log(&app, "warn", &format!("  Preteriti:    {n_skip}"));
    }
    log(&app, "ok", &format!("\n  Imħażżen f': {output_dir}"));

    app.emit("raw-done", RawDoneEvent { converted: n_ok, skipped: n_skip, output_dir }).ok();
    Ok(())
}

// ── ARW extraction helpers ────────────────────────────────────────────────────

#[inline]
fn u16_from(b: &[u8], le: bool) -> u16 {
    if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) }
}
#[inline]
fn u32_from(b: &[u8], le: bool) -> u32 {
    if le { u32::from_le_bytes([b[0], b[1], b[2], b[3]]) } else { u32::from_be_bytes([b[0], b[1], b[2], b[3]]) }
}

fn extract_arw_jpeg_bytes(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;

    let mut header = [0u8; 8];
    if file.read_exact(&mut header).is_ok() {
        let le = match &header[..2] {
            b"II" => Some(true),
            b"MM" => Some(false),
            _ => None,
        };
        if let Some(le) = le {
            let ifd0 = u32_from(&header[4..8], le) as u64;
            if let Some((off, len)) = ifd_find_jpeg(&mut file, ifd0, le, 0) {
                if len > 50_000 {
                    let mut buf = vec![0u8; len];
                    if file.seek(SeekFrom::Start(off)).is_ok()
                        && file.read_exact(&mut buf).is_ok()
                        && buf.starts_with(&[0xFF, 0xD8])
                    {
                        return Ok(buf);
                    }
                }
            }
        }
    }

    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    scan_largest_jpeg(&data)
        .filter(|j| j.len() > 50_000)
        .map(|j| j.to_vec())
        .ok_or_else(|| "Ma nstab l-ebda preview JPEG fl-ARW fajl.".to_string())
}

fn ifd_find_jpeg(
    file: &mut std::fs::File,
    ifd_offset: u64,
    le: bool,
    depth: u8,
) -> Option<(u64, usize)> {
    use std::io::{Read, Seek, SeekFrom};

    if depth > 8 || ifd_offset == 0 { return None; }

    file.seek(SeekFrom::Start(ifd_offset)).ok()?;

    let mut cnt_buf = [0u8; 2];
    file.read_exact(&mut cnt_buf).ok()?;
    let entry_count = u16_from(&cnt_buf, le) as usize;
    if entry_count > 4096 { return None; }

    let mut ifd_data = vec![0u8; entry_count * 12];
    file.read_exact(&mut ifd_data).ok()?;

    let mut jpeg_off: Option<u64>   = None;
    let mut jpeg_len: Option<usize> = None;
    let mut best: Option<(u64, usize)> = None;
    let mut subs: Vec<u64> = vec![];

    for e in 0..entry_count {
        let b = e * 12;
        let tag = u16_from(&ifd_data[b..b+2], le);
        let val = u32_from(&ifd_data[b+8..b+12], le);
        match tag {
            0x0201 => jpeg_off = Some(val as u64),
            0x0202 => jpeg_len = Some(val as usize),
            0x014a | 0x8769 => subs.push(val as u64),
            _ => {}
        }
    }

    if let (Some(off), Some(len)) = (jpeg_off, jpeg_len) {
        if len > 50_000 { best = Some((off, len)); }
    }

    let mut next_buf = [0u8; 4];
    if file.read_exact(&mut next_buf).is_ok() {
        let next = u32_from(&next_buf, le) as u64;
        if next != 0 { subs.push(next); }
    }

    for sub in subs {
        if let Some(c) = ifd_find_jpeg(file, sub, le, depth + 1) {
            if best.map_or(true, |(_, bl)| c.1 > bl) { best = Some(c); }
        }
    }

    best
}

fn jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let mut i = 2usize;
    while i + 3 < data.len() {
        if data[i] != 0xFF { break; }
        let marker = data[i + 1];
        let seg_len = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
        if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
            if i + 8 < data.len() {
                let h = u16::from_be_bytes([data[i + 5], data[i + 6]]) as u32;
                let w = u16::from_be_bytes([data[i + 7], data[i + 8]]) as u32;
                return Some((w, h));
            }
        }
        i += 2 + seg_len;
    }
    None
}

fn scan_largest_jpeg(data: &[u8]) -> Option<&[u8]> {
    let mut best: Option<&[u8]> = None;
    let mut i = 0usize;
    while i + 3 < data.len() {
        if data[i] == 0xFF && data[i + 1] == 0xD8 && data[i + 2] == 0xFF {
            if let Some(end) = find_jpeg_end(data, i) {
                let slice = &data[i..end];
                if best.map_or(true, |b: &[u8]| slice.len() > b.len()) {
                    best = Some(slice);
                }
                i = end;
                continue;
            }
        }
        i += 1;
    }
    best
}

fn find_jpeg_end(data: &[u8], start: usize) -> Option<usize> {
    data[start + 2..]
        .windows(2)
        .position(|w| w == [0xFF, 0xD9])
        .map(|pos| start + 2 + pos + 2)
}

// ── mozjpeg encode / decode ───────────────────────────────────────────────────

fn encode_jpeg_moz(rgb: &image::RgbImage, quality: u8) -> Result<Vec<u8>, String> {
    let (width, height) = (rgb.width() as usize, rgb.height() as usize);
    let pixels = rgb.as_raw();

    let mut comp = mozjpeg::Compress::new(mozjpeg::ColorSpace::JCS_RGB);
    comp.set_size(width, height);
    comp.set_quality(quality as f32);
    comp.set_optimize_coding(false);

    let mut started = comp.start_compress(Vec::new()).map_err(|e| e.to_string())?;
    started.write_scanlines(pixels).map_err(|e| e.to_string())?;
    started.finish().map_err(|e| e.to_string())
}

fn decode_image_moz(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    if bytes.starts_with(&[0xFF, 0xD8]) {
        let decomp = mozjpeg::Decompress::new_mem(bytes).map_err(|e| e.to_string())?;
        let mut started = decomp.rgb().map_err(|e| e.to_string())?;
        let width  = started.width()  as u32;
        let height = started.height() as u32;
        let pixels = started.read_scanlines::<u8>()
            .map_err(|e| e.to_string())?;
        image::RgbImage::from_raw(width, height, pixels)
            .map(image::DynamicImage::ImageRgb8)
            .ok_or_else(|| "Dimensjonijiet JPEG ħżiena".to_string())
    } else {
        image::load_from_memory(bytes).map_err(|e| e.to_string())
    }
}

// ── Transcription app state ───────────────────────────────────────────────────

struct TxState {
    // When Some, holds a channel to a warm preloaded sidecar waiting for a path.
    path_tx: std::sync::Mutex<Option<tokio::sync::mpsc::Sender<String>>>,
}

// ── Sidecar event loop (shared by preload and fresh-spawn paths) ──────────────

fn spawn_sidecar_loop(
    app: &AppHandle,
    mut rx: tauri::async_runtime::Receiver<tauri_plugin_shell::process::CommandEvent>,
    mut child: tauri_plugin_shell::process::CommandChild,
    path_rx: Option<tokio::sync::mpsc::Receiver<String>>,
) {
    use tauri_plugin_shell::process::CommandEvent;
    use tauri::Manager;

    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None    => return,
    };

    tauri::async_runtime::spawn(async move {
        let mut path_rx = path_rx;
        let mut forwarding = path_rx.is_none(); // direct mode → forward from the start

        loop {
            tokio::select! {
                Some(event) = rx.recv() => {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            let line = String::from_utf8_lossy(&bytes).trim().to_string();
                            if line.is_empty() { continue; }
                            match serde_json::from_str::<serde_json::Value>(&line) {
                                Ok(val) => {
                                    if val["type"] == "ready" {
                                        // Model is warm; don't forward this internal marker.
                                    } else if forwarding {
                                        window.emit("transcribe-update", val).unwrap_or_default();
                                    }
                                }
                                Err(_) => eprintln!("[sidecar stdout] {line}"),
                            }
                        }
                        CommandEvent::Stderr(bytes) => {
                            let line = String::from_utf8_lossy(&bytes).trim().to_string();
                            if !line.is_empty() { eprintln!("[sidecar stderr] {line}"); }
                        }
                        CommandEvent::Error(e) => {
                            if forwarding {
                                window.emit("transcribe-update",
                                    serde_json::json!({"type":"error","message": e})).ok();
                            }
                            break;
                        }
                        CommandEvent::Terminated(s) => {
                            if forwarding && s.code != Some(0) {
                                window.emit("transcribe-update", serde_json::json!({
                                    "type": "error",
                                    "message": format!("Sidecar exited with code {:?}", s.code),
                                })).ok();
                            }
                            break;
                        }
                        _ => {}
                    }
                }

                // Receive the video path from process_video and pipe it to sidecar stdin.
                Some(path) = async {
                    if let Some(rx) = &mut path_rx { rx.recv().await } else { None }
                } => {
                    let _ = child.write(format!("{path}\n").as_bytes());
                    forwarding = true;
                    path_rx = None; // only one video per preloaded sidecar
                }

                else => break,
            }
        }
    });
}

// ── preload_transcribe: warm the model before the user picks a file ───────────

#[tauri::command]
async fn preload_transcribe(
    app: AppHandle,
    state: tauri::State<'_, TxState>,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    // Already preloaded — nothing to do.
    if state.path_tx.lock().unwrap().is_some() {
        return Ok(());
    }

    let (path_tx, path_rx) = tokio::sync::mpsc::channel::<String>(1);
    state.path_tx.lock().unwrap().replace(path_tx);

    let (rx, child) = app
        .shell()
        .sidecar("transcribe")
        .map_err(|e| e.to_string())?
        .spawn()
        .map_err(|e| e.to_string())?;

    spawn_sidecar_loop(&app, rx, child, Some(path_rx));
    Ok(())
}

// ── process_video ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn process_video(
    app: AppHandle,
    video_path: String,
    state: tauri::State<'_, TxState>,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    let warm_tx = state.path_tx.lock().unwrap().take();

    if let Some(tx) = warm_tx {
        // Preloaded sidecar is waiting — send it the path.
        tx.send(video_path).await.map_err(|e| e.to_string())
    } else {
        // No preloaded sidecar — spawn fresh.
        let (rx, child) = app
            .shell()
            .sidecar("transcribe")
            .map_err(|e| e.to_string())?
            .arg(&video_path)
            .spawn()
            .map_err(|e| e.to_string())?;

        spawn_sidecar_loop(&app, rx, child, None);
        Ok(())
    }
}

#[tauri::command]
fn save_srt(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

// ── Log helper ────────────────────────────────────────────────────────────────

fn log(app: &AppHandle, tag: &str, msg: &str) {
    app.emit("log", LogEvent { tag: tag.into(), msg: msg.into() }).ok();
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TxState { path_tx: std::sync::Mutex::new(None) })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            list_photographers,
            process_images,
            convert_raw_batch,
            preload_transcribe,
            process_video,
            save_srt,
        ])
        .run(tauri::generate_context!())
        .expect("Żball fil-bidu ta' Pubblikatur");
}
