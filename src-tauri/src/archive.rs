//! SD-card → Drive archive, the native half: find cards, read what is on them, send bytes to a
//! resumable upload session (the backend opens the session; no file ever passes through it).
use md5::{Digest, Md5};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

const CHUNK: u64 = 8 * 1024 * 1024; // a multiple of 256 KiB, as Drive requires
/// Bumped by `archive_cancel`. A transfer reads it when its command starts and is cancelled once it differs,
/// so a cancel stops everything already running but never a transfer that starts afterwards (several run at once).
static CANCEL_GEN: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
pub struct Volume {
    path: String,
    name: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ScanFile {
    path: String,
    name: String,
    size: u64,
    kind: &'static str,
    /// The camera's wall clock as if it were UTC (seconds).
    taken: i64,
    /// "exif" or "mtime"
    src: &'static str,
}

const PHOTO: &[&str] = &["jpg", "jpeg", "png", "heic", "tif", "tiff"];
const RAW: &[&str] = &["arw", "cr2", "cr3", "nef", "nrw", "raf", "rw2", "orf", "dng", "pef", "srw", "raw"];
const VIDEO: &[&str] = &["mp4", "mov", "mxf", "mts", "m2ts", "avi", "mkv", "m4v", "crm", "braw"];
const SKIP_DIRS: &[&str] = &["THMBNL", "MISC", "SUB", "SUBDIR", "TRASH", "TRASHES"];

fn kind_of(path: &Path) -> Option<&'static str> {
    let e = path.extension()?.to_str()?.to_ascii_lowercase();
    let e = e.as_str();
    if PHOTO.contains(&e) {
        Some("photo")
    } else if RAW.contains(&e) {
        Some("raw")
    } else if VIDEO.contains(&e) {
        Some("video")
    } else {
        None
    }
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// "2026:08:15 09:30:00" → naive seconds.
fn parse_exif_time(s: &str) -> Option<i64> {
    let s = s.trim().trim_matches('\0');
    let (d, t) = s.split_once(' ')?;
    let mut dp = d.split(|c| c == ':' || c == '-');
    let (y, mo, da): (i64, i64, i64) = (dp.next()?.parse().ok()?, dp.next()?.parse().ok()?, dp.next()?.parse().ok()?);
    let mut tp = t.split(':');
    let (h, mi, se): (i64, i64, i64) = (tp.next()?.parse().ok()?, tp.next()?.parse().ok()?, tp.next()?.get(..2)?.parse().ok()?);
    if y < 1990 || !(1..=12).contains(&mo) || !(1..=31).contains(&da) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    Some(days_from_civil(y, mo, da) * 86400 + h * 3600 + mi * 60 + se)
}

fn exif_taken(path: &Path) -> Option<i64> {
    let f = fs::File::open(path).ok()?;
    let ex = exif::Reader::new().read_from_container(&mut BufReader::new(f)).ok()?;
    for tag in [exif::Tag::DateTimeOriginal, exif::Tag::DateTimeDigitized, exif::Tag::DateTime] {
        if let Some(field) = ex.get_field(tag, exif::In::PRIMARY) {
            if let exif::Value::Ascii(v) = &field.value {
                if let Some(t) = v.first().and_then(|b| parse_exif_time(&String::from_utf8_lossy(b))) {
                    return Some(t);
                }
            }
        }
    }
    None
}

/// File times on a FAT/exFAT card are the camera's local time; read as the Mac's local time, then made naive again.
fn mtime_taken(path: &Path) -> Option<i64> {
    let m = fs::metadata(path).ok()?.modified().ok()?;
    let local: chrono::DateTime<chrono::Local> = m.into();
    Some(local.naive_local().and_utc().timestamp())
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > 8 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(t) = e.file_type() else { continue };
        let p = e.path();
        if t.is_dir() {
            if !SKIP_DIRS.contains(&name.to_ascii_uppercase().as_str()) {
                walk(&p, depth + 1, out);
            }
        } else if t.is_file() && kind_of(&p).is_some() {
            out.push(p);
        }
    }
}

/// Cards currently mounted that look like a camera card (a DCIM folder, or Sony/Canon video folders).
#[tauri::command]
pub fn archive_volumes() -> Vec<Volume> {
    let mut out = vec![];
    let Ok(rd) = fs::read_dir("/Volumes") else { return out };
    for e in rd.flatten() {
        let p = e.path();
        if fs::symlink_metadata(&p).map(|m| m.file_type().is_symlink()).unwrap_or(true) {
            continue; // "Macintosh HD" is a link to /
        }
        let cam = ["DCIM", "PRIVATE", "CONTENTS", "MP_ROOT"].iter().any(|d| p.join(d).is_dir());
        if cam {
            out.push(Volume { name: e.file_name().to_string_lossy().to_string(), path: p.to_string_lossy().to_string() });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// Every photo, RAW and video on the card with its capture time.
#[tauri::command]
pub async fn archive_scan(root: String) -> Result<Vec<ScanFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root);
        if !root.is_dir() {
            return Err("Il-card m’għadhiex hawn.".to_string());
        }
        let mut paths = vec![];
        walk(&root, 0, &mut paths);
        let mut files: Vec<ScanFile> = paths
            .par_iter()
            .filter_map(|p| {
                let size = fs::metadata(p).ok()?.len();
                if size == 0 {
                    return None;
                }
                let kind = kind_of(p)?;
                let (taken, src) = match if kind == "video" { None } else { exif_taken(p) } {
                    Some(t) => (t, "exif"),
                    None => (mtime_taken(p)?, "mtime"),
                };
                Some(ScanFile { path: p.to_string_lossy().to_string(), name: p.file_name()?.to_string_lossy().to_string(), size, kind, taken, src })
            })
            .collect();
        files.sort_by(|a, b| a.taken.cmp(&b.taken).then(a.name.cmp(&b.name)));
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn archive_cancel() {
    CANCEL_GEN.fetch_add(1, Ordering::Relaxed);
}

#[tauri::command]
pub async fn archive_eject(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = std::process::Command::new("diskutil").arg("eject").arg(&path).output().map_err(|e| e.to_string())?;
        if out.status.success() { Ok(()) } else { Err("Ma setgħetx toħroġ il-card. Agħlaq kull app li qed tużaha.".into()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
struct Progress {
    id: String,
    sent: u64,
    size: u64,
}

#[derive(Serialize)]
pub struct Put {
    /// Drive's id for the finished file.
    file_id: String,
    md5: String,
}

/// "bytes=0-8388607" → next offset to send.
fn next_offset(range: Option<&str>) -> u64 {
    range.and_then(|r| r.rsplit('-').next()).and_then(|n| n.trim().parse::<u64>().ok()).map(|n| n + 1).unwrap_or(0)
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().redirects(0).timeout_connect(Duration::from_secs(20)).timeout_read(Duration::from_secs(120)).timeout_write(Duration::from_secs(120)).build()
}

enum Reply {
    Resume(u64),
    Done(String),
}

fn interpret(r: Result<ureq::Response, ureq::Error>) -> Result<Reply, String> {
    match r {
        Ok(resp) => {
            if resp.status() == 308 {
                return Ok(Reply::Resume(next_offset(resp.header("Range"))));
            }
            let body = resp.into_string().unwrap_or_default();
            let v: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
            Ok(Reply::Done(v["id"].as_str().unwrap_or_default().to_string()))
        }
        Err(ureq::Error::Status(308, resp)) => Ok(Reply::Resume(next_offset(resp.header("Range")))),
        Err(ureq::Error::Status(c, _)) if c == 404 || c == 410 => Err("session-expired".into()),
        Err(ureq::Error::Status(c, _)) if c >= 500 || c == 429 => Err(format!("retry:{c}")),
        Err(ureq::Error::Status(c, _)) => Err(format!("Drive wieġeb {c}.")),
        Err(e) => Err(format!("retry:{e}")),
    }
}

fn put_blocking(progress: &dyn Fn(u64), path: &str, url: &str, size: u64, limit_kbps: u64, cancel_gen: u64) -> Result<Put, String> {
    let ag = agent();
    let mut file = fs::File::open(path).map_err(|_| "Ma nstabx il-fajl fuq il-card.".to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != size {
        return Err("Il-fajl inbidel fuq il-card.".into());
    }
    let mut md5 = Md5::new();
    let mut hashed = 0u64;
    let mut fails = 0u32;
    // Ask where the session stands: a fresh one answers "nothing yet", an interrupted one says how far it got.
    let mut offset = 0u64;
    loop {
        match interpret(ag.put(url).set("Content-Range", &format!("bytes */{size}")).send_bytes(&[])) {
            Ok(Reply::Resume(o)) => { offset = o; break; }
            Ok(Reply::Done(fid)) => {
                return Ok(Put { file_id: fid, md5: hash_file(&mut file, size)? });
            }
            Err(e) if e.starts_with("retry:") && fails < 5 => { fails += 1; std::thread::sleep(Duration::from_secs(2u64 << fails)); }
            Err(e) => return Err(e),
        }
    }
    let mut buf = vec![0u8; CHUNK as usize];
    while offset < size {
        if CANCEL_GEN.load(Ordering::Relaxed) != cancel_gen {
            return Err("cancelled".into());
        }
        // Everything up to `offset` also goes into the checksum (a resumed upload starts mid-file).
        file.seek(SeekFrom::Start(hashed)).map_err(|e| e.to_string())?;
        while hashed < offset {
            let n = ((offset - hashed) as usize).min(buf.len());
            file.read_exact(&mut buf[..n]).map_err(|e| e.to_string())?;
            md5.update(&buf[..n]);
            hashed += n as u64;
        }
        let n = (size - offset).min(CHUNK) as usize;
        file.read_exact(&mut buf[..n]).map_err(|_| "Ma tqrax mill-card (inħarġet?).".to_string())?;
        let started = Instant::now();
        let range = format!("bytes {}-{}/{}", offset, offset + n as u64 - 1, size);
        match interpret(ag.put(url).set("Content-Range", &range).send_bytes(&buf[..n])) {
            Ok(Reply::Resume(next)) => {
                fails = 0;
                // Drive may have kept less than we sent; hash exactly what it kept.
                let kept = next.min(offset + n as u64).max(offset);
                md5.update(&buf[..(kept - offset) as usize]);
                hashed = kept;
                offset = kept;
            }
            Ok(Reply::Done(fid)) => {
                md5.update(&buf[..n]);
                progress(size);
                return Ok(Put { file_id: fid, md5: hex(&md5.finalize()) });
            }
            Err(e) if e.starts_with("retry:") && fails < 5 => {
                fails += 1;
                std::thread::sleep(Duration::from_secs(2u64 << fails));
                // Re-ask Drive where it is (hashing restarts from our position: rewind to what we had hashed).
                if let Ok(Reply::Resume(o)) = interpret(ag.put(url).set("Content-Range", &format!("bytes */{size}")).send_bytes(&[])) {
                    offset = o;
                    // The checksum must cover bytes in order: if Drive is behind us, restart hashing from scratch.
                    if o < hashed { md5 = Md5::new(); hashed = 0; }
                }
                continue;
            }
            Err(e) => return Err(e),
        }
        progress(offset);
        if limit_kbps > 0 {
            let want = Duration::from_secs_f64(n as f64 / (limit_kbps as f64 * 1024.0));
            if let Some(rest) = want.checked_sub(started.elapsed()) {
                std::thread::sleep(rest);
            }
        }
    }
    Err("Drive ma kkonfermax li l-fajl wasal.".into())
}

fn hex(d: &[u8]) -> String {
    d.iter().map(|b| format!("{b:02x}")).collect()
}

fn hash_file(file: &mut fs::File, size: u64) -> Result<String, String> {
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut md5 = Md5::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut left = size;
    while left > 0 {
        let n = (left as usize).min(buf.len());
        file.read_exact(&mut buf[..n]).map_err(|e| e.to_string())?;
        md5.update(&buf[..n]);
        left -= n as u64;
    }
    Ok(hex(&md5.finalize()))
}

/// Send one file to an upload session. Resumes where the session left off; `limit_kbps` 0 = full speed.
#[tauri::command]
pub async fn archive_put(app: AppHandle, id: String, path: String, url: String, size: u64, limit_kbps: Option<u64>) -> Result<Put, String> {
    let cancel_gen = CANCEL_GEN.load(Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let emit = |sent: u64| { let _ = app.emit("archive://progress", Progress { id: id.clone(), sent, size }); };
        put_blocking(&emit, &path, &url, size, limit_kbps.unwrap_or(0), cancel_gen)
    })
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
pub struct CopyItem {
    src: String,
    rel: String,
}

/// Local backup copy: `rel` paths below `dest`; a file already there with the same size is left alone.
#[tauri::command]
pub async fn archive_copy(app: AppHandle, id: String, items: Vec<CopyItem>, dest: String) -> Result<u64, String> {
    let cancel_gen = CANCEL_GEN.load(Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let base = PathBuf::from(dest);
        let total = items.len() as u64;
        let mut copied = 0u64;
        for (i, it) in items.iter().enumerate() {
            if CANCEL_GEN.load(Ordering::Relaxed) != cancel_gen {
                return Err("cancelled".to_string());
            }
            let rel = Path::new(&it.rel);
            if rel.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
                return Err("Mogħdija ħażina.".into());
            }
            let to = base.join(rel);
            let src_len = fs::metadata(&it.src).map_err(|e| e.to_string())?.len();
            if fs::metadata(&to).map(|m| m.len() == src_len).unwrap_or(false) {
                continue;
            }
            if let Some(dir) = to.parent() {
                fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            fs::copy(&it.src, &to).map_err(|e| format!("Ma nħaddmitx il-backup: {e}"))?;
            copied += 1;
            let _ = app.emit("archive://progress", Progress { id: id.clone(), sent: i as u64 + 1, size: total });
        }
        Ok(copied)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;

    #[test]
    fn exif_time_and_civil_days() {
        assert_eq!(parse_exif_time("1970:01:02 00:00:01"), None); // before 1990 = a dead camera battery
        assert_eq!(parse_exif_time("2026:08:15 09:30:05"), Some(days_from_civil(2026, 8, 15) * 86400 + 9 * 3600 + 30 * 60 + 5));
        assert_eq!(days_from_civil(2000, 3, 1) - days_from_civil(2000, 2, 28), 2);
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(parse_exif_time("garbage"), None);
    }

    #[test]
    fn offsets_and_kinds() {
        assert_eq!(next_offset(Some("bytes=0-8388607")), 8388608);
        assert_eq!(next_offset(None), 0);
        assert_eq!(kind_of(Path::new("A.ARW")), Some("raw"));
        assert_eq!(kind_of(Path::new("C1.MP4")), Some("video"));
        assert_eq!(kind_of(Path::new("C1M01.XML")), None);
    }

    /// A pretend Drive session: answers 308 + Range until all bytes arrived, then 200 {"id":"F1"}.
    /// The first data PUT is answered with a 503 to prove the retry path.
    fn fake_session(total: usize) -> (String, std::thread::JoinHandle<Vec<u8>>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/s", l.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let mut got: Vec<u8> = vec![];
            let mut failed_once = false;
            loop {
                let (mut s, _) = l.accept().unwrap();
                let mut head = vec![];
                let mut b = [0u8; 1];
                while !head.ends_with(b"\r\n\r\n") {
                    if s.read(&mut b).unwrap() == 0 { break; }
                    head.push(b[0]);
                }
                let text = String::from_utf8_lossy(&head).to_string();
                let len: usize = text.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap())).unwrap_or(0);
                let mut body = vec![0u8; len];
                s.read_exact(&mut body).unwrap();
                let range = text.lines().find_map(|l| l.strip_prefix("Content-Range: ").or_else(|| l.strip_prefix("content-range: "))).unwrap_or("").to_string();
                let reply = if range.starts_with("bytes */") {
                    if got.is_empty() { "HTTP/1.1 308 Resume Incomplete\r\nContent-Length: 0\r\n\r\n".to_string() } else { format!("HTTP/1.1 308 Resume Incomplete\r\nRange: bytes=0-{}\r\nContent-Length: 0\r\n\r\n", got.len() - 1) }
                } else if !failed_once {
                    failed_once = true;
                    "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n".to_string()
                } else {
                    got.extend_from_slice(&body);
                    if got.len() >= total { let j = r#"{"id":"F1"}"#; format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}", j.len(), j) } else { format!("HTTP/1.1 308 Resume Incomplete\r\nRange: bytes=0-{}\r\nContent-Length: 0\r\n\r\n", got.len() - 1) }
                };
                s.write_all(reply.as_bytes()).unwrap();
                if got.len() >= total { return got; }
            }
        });
        (url, h)
    }

    #[test]
    fn put_sends_all_bytes_retries_and_hashes() {
        let size = (CHUNK as usize) + 12345; // two chunks
        let data: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
        let dir = std::env::temp_dir().join(format!("banditur-arch-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.bin");
        fs::write(&p, &data).unwrap();
        let (url, h) = fake_session(size);
        let r = put_blocking(&|_| {}, p.to_str().unwrap(), &url, size as u64, 0, CANCEL_GEN.load(Ordering::Relaxed)).unwrap();
        assert_eq!(r.file_id, "F1");
        assert_eq!(h.join().unwrap(), data);
        let mut want = Md5::new();
        want.update(&data);
        assert_eq!(r.md5, hex(&want.finalize()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_finds_files_and_skips_thumbnails() {
        let dir = std::env::temp_dir().join(format!("banditur-scan-{}", std::process::id()));
        fs::create_dir_all(dir.join("DCIM/100MSDCF")).unwrap();
        fs::create_dir_all(dir.join("PRIVATE/M4ROOT/THMBNL")).unwrap();
        fs::write(dir.join("DCIM/100MSDCF/A.ARW"), b"x").unwrap();
        fs::write(dir.join("DCIM/100MSDCF/B.XML"), b"x").unwrap();
        fs::write(dir.join("PRIVATE/M4ROOT/THMBNL/T.JPG"), b"x").unwrap();
        fs::write(dir.join("PRIVATE/M4ROOT/C1.MP4"), b"x").unwrap();
        let mut v = vec![];
        walk(&dir, 0, &mut v);
        let mut names: Vec<_> = v.iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();
        names.sort();
        assert_eq!(names, vec!["A.ARW", "C1.MP4"]);
        fs::remove_dir_all(&dir).ok();
    }
}
