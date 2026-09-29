//! Watermark packs — pure file-format and storage logic (no Tauri types here,
//! so it can be unit-tested on its own). The Tauri commands that wrap this live
//! in `watermark_packs.rs`.
//!
//! A pack is a `.bwpack` file (a plain zip) laid out as:
//!
//! ```text
//! manifest.json
//! <watermark-id>/portrait.png     (optional, but at least one of the two)
//! <watermark-id>/landscape.png    (optional, but at least one of the two)
//! ```
//!
//! Installed packs are unpacked to `<app data>/watermarks/<pack-id>/` with the
//! exact same layout, so an installed pack folder *is* a valid pack.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};

pub const FORMAT: &str = "banditur-watermark-pack";
pub const FORMAT_VERSION: u32 = 1;
pub const ORIENTATIONS: [&str; 2] = ["portrait", "landscape"];

// Zip-bomb / sanity limits.
const MAX_ZIP_ENTRIES: usize = 2_000;
const MAX_FILE_BYTES: u64 = 150 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_SIDE_PX: u32 = 12_000;
const MAX_WATERMARKS: usize = 200;
const MAX_NAME_CHARS: usize = 80;
/// Overlays are stretched to each photo's exact size, so they must be 2:3 / 3:2.
const RATIO_TOLERANCE: f64 = 0.01;

// ── Manifest ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub format_version: u32,
    pub id: String,
    pub name: String,
    pub version: u32,
    pub watermarks: Vec<ManifestEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ManifestEntry {
    pub id: String,
    pub name: String,
}

/// What the UI sees for an installed (or about-to-be-installed) pack.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub id: String,
    pub name: String,
    pub version: u32,
    pub watermarks: Vec<WatermarkInfo>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkInfo {
    pub id: String,
    pub name: String,
    pub portrait: bool,
    pub landscape: bool,
}

/// Result of inspecting a pack file before installing it.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PackPreview {
    pub pack: PackInfo,
    /// Version of the same pack id already installed, if any.
    pub installed_version: Option<u32>,
}

// ── Small helpers ─────────────────────────────────────────────────────────────

/// Ids are used as folder names: lowercase ascii, digits and single dashes.
pub fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.starts_with('-')
        && !s.ends_with('-')
        && !s.contains("--")
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// "Jacques Xuereb" → "jacques-xuereb", "Ħaż-Żebbuġ" → "haz-zebbug".
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars().flat_map(|c| c.to_lowercase()) {
        let mapped = match ch {
            'ħ' => 'h',
            'ġ' => 'g',
            'ċ' => 'c',
            'ż' => 'z',
            'à' | 'á' | 'â' | 'ä' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        };
        if mapped == '-' && (out.is_empty() || out.ends_with('-')) {
            continue;
        }
        out.push(mapped);
    }
    while out.ends_with('-') {
        out.pop();
    }
    out.truncate(64);
    while out.ends_with('-') {
        out.pop();
    }
    out
}

fn check_name(name: &str, what: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(format!("{what}: l-isem huwa vojt."));
    }
    if n.chars().count() > MAX_NAME_CHARS {
        return Err(format!("{what}: l-isem huwa twil wisq (massimu {MAX_NAME_CHARS})."));
    }
    if n.chars().any(|c| c.is_control()) {
        return Err(format!("{what}: l-isem fih karattri invalidi."));
    }
    Ok(n.to_string())
}

fn validate_manifest(m: &Manifest) -> Result<(), String> {
    if m.format != FORMAT {
        return Err("Dan mhux pack tal-marki ta' Banditur (format ħażin).".into());
    }
    if m.format_version != FORMAT_VERSION {
        return Err(format!(
            "Verżjoni tal-format {} mhux supportata (din il-verżjoni tal-app taqra biss {FORMAT_VERSION}). Aġġorna l-app.",
            m.format_version
        ));
    }
    if !valid_id(&m.id) {
        return Err(format!("Id tal-pack invalidu: '{}' (ittri żgħar a-z, numri u '-').", m.id));
    }
    check_name(&m.name, "Pack")?;
    if m.watermarks.len() > MAX_WATERMARKS {
        return Err(format!("Il-pack għandu wisq marki (massimu {MAX_WATERMARKS})."));
    }
    let mut seen = HashSet::new();
    for w in &m.watermarks {
        if !valid_id(&w.id) {
            return Err(format!("Id tal-marka invalidu: '{}' (ittri żgħar a-z, numri u '-').", w.id));
        }
        if !seen.insert(w.id.as_str()) {
            return Err(format!("Il-marka '{}' tidher darbtejn fil-manifest.", w.id));
        }
        check_name(&w.name, &format!("Marka '{}'", w.id))?;
    }
    Ok(())
}

/// Checks one overlay: real PNG, has transparency, right orientation, 2:3 / 3:2.
pub fn check_png(bytes: &[u8], orientation: &str, label: &str) -> Result<(), String> {
    use image::{ImageDecoder, ImageFormat, ImageReader};

    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("{label}: ma setax jinqara ({e})."))?;
    if reader.format() != Some(ImageFormat::Png) {
        return Err(format!("{label}: irid ikun PNG."));
    }
    let decoder = reader
        .into_decoder()
        .map_err(|e| format!("{label}: PNG korrott ({e})."))?;
    let (w, h) = decoder.dimensions();
    if !decoder.color_type().has_alpha() {
        return Err(format!("{label}: il-PNG irid ikollu sfond trasparenti (alpha)."));
    }
    if w == 0 || h == 0 || w > MAX_SIDE_PX || h > MAX_SIDE_PX {
        return Err(format!("{label}: daqs {w}×{h} mhux aċċettabbli (massimu {MAX_SIDE_PX}px)."));
    }
    match orientation {
        "portrait" if h <= w => {
            return Err(format!("{label}: il-marka tal-portrett trid tkun ogħla milli wiesgħa ({w}×{h})."))
        }
        "landscape" if w <= h => {
            return Err(format!("{label}: il-marka tal-pajsaġġ trid tkun usa' milli għolja ({w}×{h})."))
        }
        _ => {}
    }
    let ratio = w.max(h) as f64 / w.min(h) as f64;
    if (ratio - 1.5).abs() > RATIO_TOLERANCE * 1.5 {
        return Err(format!(
            "{label}: il-proporzjon irid ikun 3:2 / 2:3 (eż. 6000×4000); dan huwa {w}×{h}."
        ));
    }
    Ok(())
}

fn read_manifest(dir: &Path) -> Result<Manifest, String> {
    let text = std::fs::read_to_string(dir.join("manifest.json")).map_err(|e| e.to_string())?;
    let m: Manifest = serde_json::from_str(&text).map_err(|e| format!("manifest.json invalidu: {e}"))?;
    validate_manifest(&m)?;
    Ok(m)
}

fn write_manifest(dir: &Path, m: &Manifest) -> Result<(), String> {
    let json = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    let tmp = dir.join(".manifest.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join("manifest.json")).map_err(|e| e.to_string())
}

fn info_for(dir: &Path, m: &Manifest) -> PackInfo {
    PackInfo {
        id: m.id.clone(),
        name: m.name.clone(),
        version: m.version,
        watermarks: m
            .watermarks
            .iter()
            .map(|w| WatermarkInfo {
                id: w.id.clone(),
                name: w.name.clone(),
                portrait: dir.join(&w.id).join("portrait.png").is_file(),
                landscape: dir.join(&w.id).join("landscape.png").is_file(),
            })
            .collect(),
    }
}

fn unique_tmp(root: &Path, prefix: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    root.join(format!(".{prefix}-{}-{nanos}", std::process::id()))
}

// ── Listing ───────────────────────────────────────────────────────────────────

/// All installed packs, sorted by name. Broken folders are skipped, not fatal.
pub fn list_packs(root: &Path) -> Vec<PackInfo> {
    let mut packs: Vec<PackInfo> = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(|e| {
            let dir = e.path();
            let m = read_manifest(&dir).ok()?;
            // Folder name must match the id, or selections could point at the wrong pack.
            (dir.file_name()?.to_str()? == m.id).then(|| info_for(&dir, &m))
        })
        .collect();
    packs.sort_by_key(|p| p.name.to_lowercase());
    for p in &mut packs {
        p.watermarks.sort_by_key(|w| w.name.to_lowercase());
    }
    packs
}

/// Resolves a UI selection `"<pack-id>/<watermark-id>"` to its folder.
pub fn resolve_watermark(root: &Path, selection: &str) -> Result<(PathBuf, String), String> {
    let (pack, wm) = selection
        .split_once('/')
        .ok_or_else(|| format!("Għażla tal-marka invalida: '{selection}'"))?;
    if !valid_id(pack) || !valid_id(wm) {
        return Err(format!("Għażla tal-marka invalida: '{selection}'"));
    }
    let dir = root.join(pack);
    let m = read_manifest(&dir).map_err(|_| format!("Il-pack '{pack}' mhux installat."))?;
    let entry = m
        .watermarks
        .iter()
        .find(|w| w.id == wm)
        .ok_or_else(|| format!("Il-marka '{wm}' ma tinsabx fil-pack '{}'.", m.name))?;
    Ok((dir.join(wm), entry.name.clone()))
}

// ── Reading a pack file ───────────────────────────────────────────────────────

/// A fully validated pack held in memory, ready to be installed.
pub struct LoadedPack {
    pub manifest: Manifest,
    /// (watermark id, orientation, png bytes)
    pub files: Vec<(String, &'static str, Vec<u8>)>,
}

fn is_junk(path: &Path) -> bool {
    path.components().any(|c| match c {
        Component::Normal(s) => {
            let s = s.to_string_lossy();
            s == "__MACOSX" || s == ".DS_Store" || s.starts_with("._")
        }
        _ => false,
    })
}

/// Opens and fully validates a `.bwpack`/`.zip` without touching the install dir.
pub fn read_pack_file(path: &Path) -> Result<LoadedPack, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Ma setax jiftaħ il-fajl: {e}"))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|_| "Il-fajl mhux pack validu (mhux zip).".to_string())?;
    if zip.len() > MAX_ZIP_ENTRIES {
        return Err("Il-pack fih wisq fajls.".into());
    }

    // Pass 1: find manifest.json. Accept it at the root, or inside exactly one
    // top-level folder (what macOS "Compress" produces when zipping a folder).
    let mut names: Vec<(usize, PathBuf)> = Vec::new();
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let p = f
            .enclosed_name()
            .ok_or_else(|| format!("Il-pack fih path perikoluż: '{}'", f.name()))?;
        if !is_junk(&p) {
            names.push((i, p));
        }
    }
    let manifests: Vec<&PathBuf> = names
        .iter()
        .map(|(_, p)| p)
        .filter(|p| p.file_name().is_some_and(|n| n == "manifest.json"))
        .filter(|p| p.components().count() <= 2)
        .collect();
    let prefix: PathBuf = match manifests.as_slice() {
        [one] => one.parent().map(Path::to_path_buf).unwrap_or_default(),
        [] => return Err("Il-pack m'għandux manifest.json.".into()),
        _ => return Err("Il-pack fih aktar minn manifest.json wieħed.".into()),
    };

    // Pass 2: read manifest + the PNGs it references.
    let mut total: u64 = 0;
    let mut read_entry = |zip: &mut zip::ZipArchive<std::fs::File>, idx: usize, cap: u64| {
        let f = zip.by_index(idx).map_err(|e| e.to_string())?;
        if f.size() > cap {
            return Err(format!("'{}' huwa kbir wisq.", f.name()));
        }
        let mut buf = Vec::with_capacity(f.size() as usize);
        // `take` guards against a lying size header.
        f.take(cap + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        if buf.len() as u64 > cap {
            return Err("Fajl fil-pack huwa kbir wisq.".to_string());
        }
        total += buf.len() as u64;
        if total > MAX_TOTAL_BYTES {
            return Err("Il-pack huwa kbir wisq.".to_string());
        }
        Ok(buf)
    };

    let find = |rel: &Path| names.iter().find(|(_, p)| p == &prefix.join(rel)).map(|(i, _)| *i);

    let mi = find(Path::new("manifest.json")).expect("found above");
    let mbytes = read_entry(&mut zip, mi, MAX_MANIFEST_BYTES)?;
    let manifest: Manifest = serde_json::from_slice(&mbytes)
        .map_err(|e| format!("manifest.json invalidu: {e}"))?;
    validate_manifest(&manifest)?;
    if manifest.watermarks.is_empty() {
        return Err("Il-pack m'għandu l-ebda marka.".into());
    }

    let mut files = Vec::new();
    for w in &manifest.watermarks {
        let mut found = 0;
        for orient in ORIENTATIONS {
            let rel = PathBuf::from(&w.id).join(format!("{orient}.png"));
            if let Some(idx) = find(&rel) {
                let bytes = read_entry(&mut zip, idx, MAX_FILE_BYTES)?;
                check_png(&bytes, orient, &format!("{} ({orient})", w.name))?;
                files.push((w.id.clone(), orient, bytes));
                found += 1;
            }
        }
        if found == 0 {
            return Err(format!(
                "'{}': nieqsa {id}/portrait.png u {id}/landscape.png (trid tal-inqas waħda).",
                w.name,
                id = w.id
            ));
        }
    }
    Ok(LoadedPack { manifest, files })
}

pub fn preview_pack_file(root: &Path, path: &Path) -> Result<PackPreview, String> {
    let loaded = read_pack_file(path)?;
    let m = &loaded.manifest;
    let has = |id: &str, o: &str| loaded.files.iter().any(|(w, or, _)| w == id && *or == o);
    let installed_version = read_manifest(&root.join(&m.id)).ok().map(|x| x.version);
    Ok(PackPreview {
        pack: PackInfo {
            id: m.id.clone(),
            name: m.name.clone(),
            version: m.version,
            watermarks: m
                .watermarks
                .iter()
                .map(|w| WatermarkInfo {
                    id: w.id.clone(),
                    name: w.name.clone(),
                    portrait: has(&w.id, "portrait"),
                    landscape: has(&w.id, "landscape"),
                })
                .collect(),
        },
        installed_version,
    })
}

// ── Installing / removing ─────────────────────────────────────────────────────

/// Writes the pack to a staging folder, then swaps it into place, so a failed
/// import never leaves a half-installed pack. Replaces an existing pack with
/// the same id (the UI asks the user first).
pub fn install_pack(root: &Path, loaded: LoadedPack) -> Result<PackInfo, String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let staging = unique_tmp(root, "staging");
    let result = (|| {
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        for w in &loaded.manifest.watermarks {
            std::fs::create_dir_all(staging.join(&w.id)).map_err(|e| e.to_string())?;
        }
        for (id, orient, bytes) in &loaded.files {
            std::fs::write(staging.join(id).join(format!("{orient}.png")), bytes)
                .map_err(|e| e.to_string())?;
        }
        write_manifest(&staging, &loaded.manifest)?;
        swap_into_place(root, &staging, &loaded.manifest.id)
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result?;
    let dir = root.join(&loaded.manifest.id);
    Ok(info_for(&dir, &loaded.manifest))
}

fn swap_into_place(root: &Path, staging: &Path, id: &str) -> Result<(), String> {
    let target = root.join(id);
    let old = unique_tmp(root, "old");
    let had_old = target.exists();
    if had_old {
        std::fs::rename(&target, &old).map_err(|e| e.to_string())?;
    }
    if let Err(e) = std::fs::rename(staging, &target) {
        if had_old {
            let _ = std::fs::rename(&old, &target);
        }
        return Err(e.to_string());
    }
    if had_old {
        let _ = std::fs::remove_dir_all(&old);
    }
    Ok(())
}

pub fn delete_pack(root: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("Id tal-pack invalidu: '{id}'"));
    }
    let dir = root.join(id);
    if !dir.is_dir() {
        return Err("Il-pack ma nstabx.".into());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

/// Zips an installed pack back into a shareable `.bwpack`.
pub fn export_pack(root: &Path, id: &str, dest: &Path) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("Id tal-pack invalidu: '{id}'"));
    }
    let dir = root.join(id);
    let m = read_manifest(&dir)?;
    if m.watermarks.is_empty() {
        return Err("Il-pack m'għandu l-ebda marka — m'hemmx x'tesporta.".into());
    }
    let tmp = dest.with_extension("bwpack.tmp");
    let result = (|| {
        let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut zw = zip::ZipWriter::new(file);
        // PNGs are already compressed; storing them is much faster and no bigger.
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let json = serde_json::to_vec_pretty(&m).map_err(|e| e.to_string())?;
        zw.start_file("manifest.json", stored).map_err(|e| e.to_string())?;
        zw.write_all(&json).map_err(|e| e.to_string())?;
        for w in &m.watermarks {
            for orient in ORIENTATIONS {
                let p = dir.join(&w.id).join(format!("{orient}.png"));
                if p.is_file() {
                    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
                    zw.start_file(format!("{}/{orient}.png", w.id), stored)
                        .map_err(|e| e.to_string())?;
                    zw.write_all(&bytes).map_err(|e| e.to_string())?;
                }
            }
        }
        zw.finish().map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, dest).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Adds (or replaces) one watermark in a pack, creating the pack if `pack_id`
/// is `None`. Bumps the pack version so re-exported copies supersede old ones.
pub fn add_watermark(
    root: &Path,
    pack_id: Option<&str>,
    new_pack_name: Option<&str>,
    name: &str,
    portrait: Option<&Path>,
    landscape: Option<&Path>,
) -> Result<PackInfo, String> {
    let name = check_name(name, "Marka")?;
    if portrait.is_none() && landscape.is_none() {
        return Err("Agħżel tal-inqas PNG waħda (portrett jew pajsaġġ).".into());
    }
    let wm_id = slugify(&name);
    if !valid_id(&wm_id) {
        return Err("L-isem tal-marka jrid ikollu tal-inqas ittra jew numru.".into());
    }

    // Read + validate the new images before changing anything on disk.
    let mut new_files: Vec<(&'static str, Vec<u8>)> = Vec::new();
    for (orient, p) in [("portrait", portrait), ("landscape", landscape)] {
        if let Some(p) = p {
            let bytes = std::fs::read(p).map_err(|e| format!("Ma setax jaqra {}: {e}", p.display()))?;
            check_png(&bytes, orient, &format!("{name} ({orient})"))?;
            new_files.push((orient, bytes));
        }
    }

    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let (dir, mut m) = match pack_id {
        Some(id) => {
            if !valid_id(id) {
                return Err(format!("Id tal-pack invalidu: '{id}'"));
            }
            let dir = root.join(id);
            let mut m = read_manifest(&dir)?;
            m.version += 1;
            (dir, m)
        }
        None => {
            let pname = check_name(new_pack_name.unwrap_or(""), "Pack")?;
            let base = slugify(&pname);
            if !valid_id(&base) {
                return Err("L-isem tal-pack irid ikollu tal-inqas ittra jew numru.".into());
            }
            let mut id = base.clone();
            let mut n = 2;
            while root.join(&id).exists() {
                id = format!("{base}-{n}");
                n += 1;
            }
            let dir = root.join(&id);
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let m = Manifest {
                format: FORMAT.into(),
                format_version: FORMAT_VERSION,
                id,
                name: pname,
                version: 1,
                watermarks: vec![],
            };
            (dir, m)
        }
    };
    if !m.watermarks.iter().any(|w| w.id == wm_id) && m.watermarks.len() >= MAX_WATERMARKS {
        return Err(format!("Il-pack għandu wisq marki (massimu {MAX_WATERMARKS})."));
    }

    let wdir = dir.join(&wm_id);
    std::fs::create_dir_all(&wdir).map_err(|e| e.to_string())?;
    for (orient, bytes) in &new_files {
        let tmp = wdir.join(format!(".{orient}.png.tmp"));
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, wdir.join(format!("{orient}.png"))).map_err(|e| e.to_string())?;
    }
    match m.watermarks.iter_mut().find(|w| w.id == wm_id) {
        Some(w) => w.name = name,
        None => m.watermarks.push(ManifestEntry { id: wm_id, name }),
    }
    write_manifest(&dir, &m)?;
    Ok(info_for(&dir, &m))
}

pub fn remove_watermark(root: &Path, pack_id: &str, wm_id: &str) -> Result<PackInfo, String> {
    if !valid_id(pack_id) || !valid_id(wm_id) {
        return Err("Id invalidu.".into());
    }
    let dir = root.join(pack_id);
    let mut m = read_manifest(&dir)?;
    let before = m.watermarks.len();
    m.watermarks.retain(|w| w.id != wm_id);
    if m.watermarks.len() == before {
        return Err("Il-marka ma nstabitx.".into());
    }
    m.version += 1;
    write_manifest(&dir, &m)?;
    let _ = std::fs::remove_dir_all(dir.join(wm_id));
    Ok(info_for(&dir, &m))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32, alpha: bool) -> Vec<u8> {
        let mut out = Vec::new();
        if alpha {
            image::RgbaImage::new(w, h)
                .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
                .unwrap();
        } else {
            image::RgbImage::new(w, h)
                .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
                .unwrap();
        }
        out
    }

    fn tmpdir(tag: &str) -> PathBuf {
        let d = unique_tmp(&std::env::temp_dir(), tag);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn make_zip(path: &Path, entries: &[(&str, Vec<u8>)]) {
        let mut zw = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let opt = zip::write::SimpleFileOptions::default();
        for (n, b) in entries {
            zw.start_file(*n, opt).unwrap();
            zw.write_all(b).unwrap();
        }
        zw.finish().unwrap();
    }

    fn manifest_json(id: &str, wms: &[(&str, &str)]) -> Vec<u8> {
        let wm: Vec<_> = wms
            .iter()
            .map(|(i, n)| serde_json::json!({"id": i, "name": n}))
            .collect();
        serde_json::to_vec(&serde_json::json!({
            "format": FORMAT, "formatVersion": 1, "id": id, "name": "Test Pack",
            "version": 1, "watermarks": wm
        }))
        .unwrap()
    }

    #[test]
    fn slugs_and_ids() {
        assert_eq!(slugify("Jacques Xuereb"), "jacques-xuereb");
        assert_eq!(slugify("  Ħaż-Żebbuġ  Ċirku "), "haz-zebbug-cirku");
        assert!(valid_id("sebio-audio-visuals"));
        assert!(!valid_id("../etc"));
        assert!(!valid_id("A"));
        assert!(!valid_id(""));
    }

    #[test]
    fn png_rules() {
        assert!(check_png(&png(300, 200, true), "landscape", "x").is_ok());
        assert!(check_png(&png(200, 300, true), "portrait", "x").is_ok());
        assert!(check_png(&png(200, 300, true), "landscape", "x").is_err()); // wrong orientation
        assert!(check_png(&png(300, 200, false), "landscape", "x").is_err()); // no alpha
        assert!(check_png(&png(400, 300, true), "landscape", "x").is_err()); // 4:3
        assert!(check_png(b"not a png", "landscape", "x").is_err());
    }

    #[test]
    fn roundtrip_import_export_and_edit() {
        let root = tmpdir("root");
        let work = tmpdir("work");
        let pack = work.join("t.bwpack");
        make_zip(
            &pack,
            &[
                ("manifest.json", manifest_json("test", &[("anna", "Anna"), ("ben", "Ben")])),
                ("anna/portrait.png", png(200, 300, true)),
                ("anna/landscape.png", png(300, 200, true)),
                ("ben/landscape.png", png(300, 200, true)),
                ("ben/notes.txt", b"ignored".to_vec()),
                ("__MACOSX/._x", b"junk".to_vec()),
            ],
        );
        let prev = preview_pack_file(&root, &pack).unwrap();
        assert_eq!(prev.installed_version, None);
        assert_eq!(prev.pack.watermarks.len(), 2);

        install_pack(&root, read_pack_file(&pack).unwrap()).unwrap();
        let packs = list_packs(&root);
        assert_eq!(packs.len(), 1);
        assert!(packs[0].watermarks[1].landscape && !packs[0].watermarks[1].portrait);
        assert!(!root.join("test/ben/notes.txt").exists());

        let (dir, name) = resolve_watermark(&root, "test/anna").unwrap();
        assert!(dir.join("portrait.png").is_file());
        assert_eq!(name, "Anna");
        assert!(resolve_watermark(&root, "../x/anna").is_err());
        assert!(resolve_watermark(&root, "test/zed").is_err());

        // Add a watermark to the existing pack → version bump.
        let lp = work.join("l.png");
        std::fs::write(&lp, png(300, 200, true)).unwrap();
        let info = add_watermark(&root, Some("test"), None, "Ċensu Borg", None, Some(&lp)).unwrap();
        assert_eq!(info.version, 2);
        assert!(info.watermarks.iter().any(|w| w.id == "censu-borg"));

        // Export and re-import over the top.
        let out = work.join("out.bwpack");
        export_pack(&root, "test", &out).unwrap();
        let prev = preview_pack_file(&root, &out).unwrap();
        assert_eq!(prev.installed_version, Some(2));
        assert_eq!(prev.pack.watermarks.len(), 3);
        install_pack(&root, read_pack_file(&out).unwrap()).unwrap();

        remove_watermark(&root, "test", "ben").unwrap();
        assert_eq!(list_packs(&root)[0].watermarks.len(), 2);
        assert!(!root.join("test/ben").exists());

        // New pack via add_watermark.
        let info = add_watermark(&root, None, Some("Test Pack"), "Zed", None, Some(&lp)).unwrap();
        assert_eq!(info.id, "test-pack");
        assert_eq!(list_packs(&root).len(), 2);

        delete_pack(&root, "test").unwrap();
        assert_eq!(list_packs(&root).len(), 1);
        // No staging leftovers.
        assert!(std::fs::read_dir(&root).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with('.')));
    }

    #[test]
    fn folder_wrapped_zip_is_accepted() {
        let root = tmpdir("root");
        let work = tmpdir("work");
        let pack = work.join("wrapped.zip");
        make_zip(
            &pack,
            &[
                ("My Pack/manifest.json", manifest_json("wrapped", &[("anna", "Anna")])),
                ("My Pack/anna/landscape.png", png(300, 200, true)),
            ],
        );
        install_pack(&root, read_pack_file(&pack).unwrap()).unwrap();
        assert_eq!(list_packs(&root)[0].id, "wrapped");
    }

    #[test]
    fn bad_packs_are_rejected() {
        let work = tmpdir("work");
        let cases: Vec<(&str, Vec<(&str, Vec<u8>)>)> = vec![
            ("no manifest", vec![("anna/landscape.png", png(300, 200, true))]),
            ("bad id", vec![("manifest.json", manifest_json("Bad Id", &[("anna", "Anna")]))]),
            ("missing pngs", vec![("manifest.json", manifest_json("ok", &[("anna", "Anna")]))]),
            (
                "wrong format",
                vec![("manifest.json", br#"{"format":"x","formatVersion":1,"id":"a","name":"a","version":1,"watermarks":[]}"#.to_vec())],
            ),
            (
                "no alpha",
                vec![
                    ("manifest.json", manifest_json("ok", &[("anna", "Anna")])),
                    ("anna/landscape.png", png(300, 200, false)),
                ],
            ),
            (
                "traversal",
                vec![
                    ("manifest.json", manifest_json("ok", &[("anna", "Anna")])),
                    ("../evil.png", png(300, 200, true)),
                ],
            ),
        ];
        for (label, entries) in cases {
            let p = work.join(format!("{}.bwpack", slugify(label)));
            make_zip(&p, &entries);
            assert!(read_pack_file(&p).is_err(), "{label} should fail");
        }
        std::fs::write(work.join("junk.bwpack"), b"hello").unwrap();
        assert!(read_pack_file(&work.join("junk.bwpack")).is_err());
    }
}
