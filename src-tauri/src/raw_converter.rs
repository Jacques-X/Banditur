use crate::jpeg::{decode_image_moz, encode_jpeg_moz};
use crate::{log, ProgressEvent, RawDoneEvent};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[tauri::command]
pub(crate) async fn convert_raw_batch(
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
    use tauri::Emitter;

    let t0 = std::time::Instant::now();

    let input_path = PathBuf::from(&input_dir);
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
        app.emit(
            "raw-done",
            RawDoneEvent {
                converted: 0,
                skipped: 0,
                output_dir,
                elapsed_ms: 0,
            },
        )
        .ok();
        return Ok(());
    }

    let total = files.len();
    log(&app, "info", &format!("Instab/u {total} fajl RAW.\n"));

    let done = AtomicU32::new(0);
    let n_ok = AtomicU32::new(0);
    let n_skip = AtomicU32::new(0);

    files.par_iter().for_each(|path| {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        log(&app, "file", &name);

        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
        let out_path = output_path.join(format!("{stem}.jpg"));

        match extract_arw_jpeg_bytes(path) {
            Ok(jpeg_bytes) => {
                let needs_resize = max_dim > 0
                    && jpeg_dimensions(&jpeg_bytes)
                        .map(|(w, h)| w > max_dim || h > max_dim)
                        .unwrap_or(true);

                let save_result: Result<(), String> = if needs_resize {
                    (|| {
                        use image::imageops;
                        // The embedded preview carries its own EXIF Orientation tag.
                        // We re-encode via mozjpeg (which writes no EXIF), so the
                        // rotation must be baked into the pixels here or the resized
                        // output would be mis-rotated. (The no-resize passthrough
                        // below keeps the original bytes + tags intact, so it's fine.)
                        let orientation = crate::image_processor::exif_orientation(&jpeg_bytes);
                        let img = decode_image_moz(&jpeg_bytes)?;
                        let img = crate::image_processor::apply_orientation(orientation, img);
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
        app.emit(
            "progress",
            ProgressEvent {
                fraction: d as f64 / total as f64,
            },
        )
        .ok();
    });

    let n_ok = n_ok.load(Ordering::Relaxed);
    let n_skip = n_skip.load(Ordering::Relaxed);
    let elapsed_ms = t0.elapsed().as_millis() as u64;

    log(&app, "info", &format!("\n{}", "─".repeat(46)));
    log(&app, "info", &format!("  Ikkonvertiti: {n_ok}"));
    if n_skip > 0 {
        log(&app, "warn", &format!("  Preteriti:    {n_skip}"));
    }
    log(&app, "ok", &format!("\n  Imħażżen f': {output_dir}"));
    log(
        &app,
        "info",
        &format!(
            "  Ħin:          {elapsed_ms}ms ({:.1} fajl/s)",
            total as f64 / (elapsed_ms as f64 / 1000.0).max(0.001)
        ),
    );

    app.emit(
        "raw-done",
        RawDoneEvent {
            converted: n_ok,
            skipped: n_skip,
            output_dir,
            elapsed_ms,
        },
    )
    .ok();
    Ok(())
}

// ── ARW extraction helpers ────────────────────────────────────────────────────

#[inline]
fn u16_from(b: &[u8], le: bool) -> u16 {
    if le {
        u16::from_le_bytes([b[0], b[1]])
    } else {
        u16::from_be_bytes([b[0], b[1]])
    }
}
#[inline]
fn u32_from(b: &[u8], le: bool) -> u32 {
    if le {
        u32::from_le_bytes([b[0], b[1], b[2], b[3]])
    } else {
        u32::from_be_bytes([b[0], b[1], b[2], b[3]])
    }
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

    if depth > 8 || ifd_offset == 0 {
        return None;
    }

    file.seek(SeekFrom::Start(ifd_offset)).ok()?;

    let mut cnt_buf = [0u8; 2];
    file.read_exact(&mut cnt_buf).ok()?;
    let entry_count = u16_from(&cnt_buf, le) as usize;
    if entry_count > 4096 {
        return None;
    }

    let mut ifd_data = vec![0u8; entry_count * 12];
    file.read_exact(&mut ifd_data).ok()?;

    let mut jpeg_off: Option<u64> = None;
    let mut jpeg_len: Option<usize> = None;
    let mut best: Option<(u64, usize)> = None;
    let mut subs: Vec<u64> = vec![];

    for e in 0..entry_count {
        let b = e * 12;
        let tag = u16_from(&ifd_data[b..b + 2], le);
        let val = u32_from(&ifd_data[b + 8..b + 12], le);
        match tag {
            0x0201 => jpeg_off = Some(val as u64),
            0x0202 => jpeg_len = Some(val as usize),
            0x014a | 0x8769 => subs.push(val as u64),
            _ => {}
        }
    }

    if let (Some(off), Some(len)) = (jpeg_off, jpeg_len) {
        if len > 50_000 {
            best = Some((off, len));
        }
    }

    let mut next_buf = [0u8; 4];
    if file.read_exact(&mut next_buf).is_ok() {
        let next = u32_from(&next_buf, le) as u64;
        if next != 0 {
            subs.push(next);
        }
    }

    for sub in subs {
        if let Some(c) = ifd_find_jpeg(file, sub, le, depth + 1) {
            if best.map_or(true, |(_, bl)| c.1 > bl) {
                best = Some(c);
            }
        }
    }

    best
}

pub(crate) fn jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let mut i = 2usize;
    while i + 3 < data.len() {
        if data[i] != 0xFF {
            break;
        }
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
