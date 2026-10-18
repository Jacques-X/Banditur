import re
p='src-tauri/src/image_processor.rs'
s=open(p,encoding='utf8').read()

# ---- 1. main loop -> batched, parallel
a=s.index("    // Write serially in sorted filename order")
b=s.index("    let elapsed_ms = t0.elapsed()")
loop_new='''    // Speed: photos are handled in small batches. Within a batch the heavy work (decoding, and
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
            if skip_duplicates {
                let hash = dhash(&img);
                if let Some(prev) = last_hash {
                    let distance = (prev ^ hash).count_ones();
                    if distance <= DUP_MAX_DISTANCE {
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
                    img, &out, &wm_portrett, &wm_pajsagg, &wm_cache_p, &wm_cache_l, quality, max_dim,
                )),
            })
            .collect();

        // D) log + progress, in order
        for (path, res) in chunk.iter().zip(results) {
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

'''
s=s[:a]+loop_new+s[b:]

# ---- 2. process_one -> prepare_one / output_path_for / reserve_path / finish_one
a=s.index("fn process_one(")
b=s.index("/// What happened to one source photo.")
c=s.index("/// Two photos whose 64-bit fingerprints")
funcs='''/// Read + decode a photo and apply its EXIF rotation.
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

'''
s=s[:a]+funcs+s[c:]
open(p,'w',encoding='utf8').write(s)
print('ok')
