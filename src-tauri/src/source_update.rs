//! In-app updates from GitHub (Settings → Aġġornamenti).
//!
//! `npm run build:local` records the clone it was run from in `<components>/source.json`.
//! The commands here look at that clone (`git fetch`, how far behind the upstream of its
//! checked-out branch it is), pull it (`git stash` → `git pull --ff-only` → `git stash pop`, so
//! local edits to tracked files are kept; ignored files such as the model are never touched), and
//! start `scripts/update.mjs`, which runs `npm install` and `build:local`.
//! Two paths: build in the background while the app keeps running (interface, engine, model
//! only), or hand over to a detached helper that waits for the app to quit, builds, installs
//! and reopens it (the app core changed). See README → Updates on the shared Mac.
//!
//! Every git call sets `GIT_TERMINAL_PROMPT=0` so a missing credential fails at once instead
//! of waiting for input. Node tools run through a login shell (an app opened from Finder has
//! a minimal PATH); the root is passed as an environment variable, never put in the shell string.
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const GIT: &str = "/usr/bin/git";
const DEFAULT_APP: &str = "/Applications/Banditur.app";

const NOT_SET_UP: &str =
    "L-aġġornamenti mhumiex issettjati. Ħaddem “npm run build:local” darba mill-clone tal-proġett.";
const NO_UPSTREAM: &str =
    "Il-fergħa preżenti ma ssegwi ebda fergħa fuq GitHub. Ikklona l-proġett b’“git clone -b stable”.";
const STASH_KEPT: &str =
    "Il-kodiċi ġie aġġornat, imma l-bidliet lokali tiegħek ma setgħux jerġgħu jitqiegħdu fuqu (jaħbtu mal-bidliet il-ġodda). Huma miżmuma f’“git stash” (ara “git stash list”). Agħfas Aġġorna mill-ġdid biex tispiċċa l-bini.";
const STASH_MSG: &str = "banditur-update: local changes kept during an update";
const DIVERGED: &str =
    "Il-fergħa lokali u dik fuq GitHub marru f’direzzjonijiet differenti. L-aġġornament awtomatiku ma jistax jgħaqqadhom.";
const BUSY: &str = "Aġġornament ieħor diġà għaddej.";
const AUTH: &str =
    "GitHub ma ħalliex nidħol. Ara r-README (“Updates on the shared Mac”) biex issettja t-token.";
const OFFLINE: &str = "Ma stajtx nilħaq GitHub. Iċċekkja l-internet.";
const NO_RESULT: &str =
    "L-aġġornament ma ħalla ebda riżultat (jista’ jkun li node ma nstabx). Ara .build-cache/update.log.";

// ── Types ─────────────────────────────────────────────────────────────────────

/// What `build-local --dry-run --json` prints.
#[derive(Debug, Default, PartialEq, Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct Plan {
    pub(crate) work: bool,
    pub(crate) core: bool,
    pub(crate) ui: bool,
    pub(crate) engine: bool,
    pub(crate) model: bool,
}

#[derive(Debug, PartialEq, Clone, Serialize)]
pub(crate) struct Commit {
    pub(crate) hash: String,
    pub(crate) subject: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    configured: bool,
    root: Option<String>,
    branch: Option<String>,
    upstream: Option<String>,
    /// Short hash of the checked-out commit.
    head: Option<String>,
    behind: u32,
    ahead: u32,
    commits: Vec<Commit>,
    /// Tracked files have local changes (updates refuse to run).
    dirty: bool,
    /// Built from the checkout but not yet installed (`build-local` would still do work).
    pending: bool,
    /// An update is running now (live pid in the lock file).
    building: bool,
    last_result: Option<serde_json::Value>,
    fetch_error: Option<String>,
    error: Option<String>,
}

// ── Pure helpers (tested below) ───────────────────────────────────────────────

/// `source.json` → the clone's root. Must be an absolute path.
pub(crate) fn parse_source(text: &str) -> Option<PathBuf> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let root = v.get("root")?.as_str()?;
    root.starts_with('/').then(|| PathBuf::from(root))
}

pub(crate) fn parse_count(text: &str) -> u32 {
    text.trim().parse().unwrap_or(0)
}

/// `git log --format=%h%x09%s` lines → commits. Lines without a tab are skipped.
pub(crate) fn parse_commits(text: &str) -> Vec<Commit> {
    text.lines()
        .filter_map(|line| {
            let (hash, subject) = line.split_once('\t')?;
            let hash = hash.trim();
            (!hash.is_empty()).then(|| Commit { hash: hash.to_string(), subject: subject.trim().to_string() })
        })
        .collect()
}

/// The `{work, core, ui, engine, model}` line from `build-local --dry-run --json`.
/// A login shell may print other lines first, so the last line that starts with `{` counts.
pub(crate) fn parse_plan(stdout: &str) -> Option<Plan> {
    let line = stdout.lines().rev().find(|l| l.trim_start().starts_with('{'))?;
    serde_json::from_str(line.trim()).ok()
}

/// The pid in `update.lock`.
pub(crate) fn lock_pid(text: &str) -> Option<u32> {
    text.trim().parse::<u32>().ok().filter(|p| *p > 0)
}

/// Why a pull must not start, if it must not. Local edits don't block it: they are stashed and popped.
pub(crate) fn pull_blocker(ahead: u32, behind: u32, locked: bool) -> Option<&'static str> {
    if locked {
        Some(BUSY)
    } else if ahead > 0 && behind > 0 {
        Some(DIVERGED)
    } else {
        None
    }
}

/// A short Maltese message for a failed git call, from its stderr.
pub(crate) fn classify_git_error(stderr: &str) -> String {
    let low = stderr.to_lowercase();
    let has = |s: &str| low.contains(s);
    if has("authentication failed")
        || has("could not read username")
        || has("could not read password")
        || has("terminal prompts disabled")
        || has("permission denied")
        || has("repository not found")
        || has("error: 403")
        || has("returned error: 403")
    {
        AUTH.to_string()
    } else if has("could not resolve host")
        || has("unable to access")
        || has("network is unreachable")
        || has("timed out")
        || has("connection refused")
    {
        OFFLINE.to_string()
    } else {
        let first = stderr.lines().find(|l| !l.trim().is_empty()).unwrap_or("git failed");
        format!("git: {}", first.trim())
    }
}

/// `/Applications/Banditur.app/Contents/MacOS/banditur` → `/Applications/Banditur.app`.
pub(crate) fn bundle_from_exe(exe: &Path) -> Option<PathBuf> {
    exe.ancestors()
        .find(|p| p.extension().and_then(|e| e.to_str()) == Some("app"))
        .map(|p| p.to_path_buf())
}

// ── Running things ────────────────────────────────────────────────────────────

struct Captured {
    ok: bool,
    stdout: String,
    stderr: String,
}

/// Run a command, collecting its output, and kill it after `timeout`.
fn run_capture(mut cmd: Command, timeout: Duration) -> Result<Captured, String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();
    let out_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(p) = out_pipe.as_mut() {
            let _ = p.read_to_end(&mut buf);
        }
        String::from_utf8_lossy(&buf).into_owned()
    });
    let err_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(p) = err_pipe.as_mut() {
            let _ = p.read_to_end(&mut buf);
        }
        String::from_utf8_lossy(&buf).into_owned()
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(OFFLINE.to_string());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    Ok(Captured {
        ok: status.success(),
        stdout: out_thread.join().unwrap_or_default(),
        stderr: err_thread.join().unwrap_or_default(),
    })
}

fn git_cmd(root: &Path, args: &[&str]) -> Command {
    let mut c = Command::new(GIT);
    c.arg("-C").arg(root).args(args).env("GIT_TERMINAL_PROMPT", "0");
    c
}

/// Trimmed stdout of a git call, or a short Maltese message.
fn git_out(root: &Path, args: &[&str], secs: u64) -> Result<String, String> {
    let out = run_capture(git_cmd(root, args), Duration::from_secs(secs))?;
    if out.ok {
        Ok(out.stdout.trim().to_string())
    } else {
        Err(classify_git_error(&out.stderr))
    }
}

/// `node <script> <args…>` in `root`, through a login shell so Homebrew/nvm paths are found.
fn login_node(root: &Path, script: &str, args: &[&str]) -> Command {
    let mut c = Command::new("/bin/zsh");
    c.arg("-lc")
        .arg(r#"cd "$BANDITUR_ROOT" && exec node "$@""#)
        .arg("zsh")
        .arg(script)
        .args(args)
        .env("BANDITUR_ROOT", root);
    c
}

fn cache_dir(root: &Path) -> PathBuf {
    root.join(".build-cache")
}

fn pid_alive(pid: u32) -> bool {
    Command::new("/bin/kill")
        .arg("-0")
        .arg(pid.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn is_locked(root: &Path) -> bool {
    std::fs::read_to_string(cache_dir(root).join("update.lock"))
        .ok()
        .and_then(|t| lock_pid(&t))
        .map(pid_alive)
        .unwrap_or(false)
}

fn read_last_result(root: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(cache_dir(root).join("update-result.json")).ok()?;
    serde_json::from_str(&text).ok()
}

fn source_root(base: &Path) -> Result<PathBuf, String> {
    let text = std::fs::read_to_string(base.join("source.json")).map_err(|_| NOT_SET_UP.to_string())?;
    let root = parse_source(&text).ok_or_else(|| NOT_SET_UP.to_string())?;
    if root.join(".git").exists() {
        Ok(root)
    } else {
        Err(NOT_SET_UP.to_string())
    }
}

fn dry_run_plan(root: &Path) -> Result<Plan, String> {
    let out = run_capture(
        login_node(root, "scripts/build-local.mjs", &["--dry-run", "--json"]),
        Duration::from_secs(120),
    )?;
    if !out.ok {
        let first = out.stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("build-local failed");
        return Err(format!("build-local: {}", first.trim()));
    }
    parse_plan(&out.stdout).ok_or_else(|| "build-local ma tax riżultat li nista’ nifhem.".to_string())
}

fn base_of(app: &AppHandle) -> Result<PathBuf, String> {
    crate::components::components_base_for(&app.config().identifier).ok_or_else(|| NOT_SET_UP.to_string())
}

// ── Status ────────────────────────────────────────────────────────────────────

fn status_blocking(base: &Path) -> Status {
    let mut s = Status::default();
    let root = match source_root(base) {
        Ok(r) => r,
        Err(_) => return s, // configured: false
    };
    s.configured = true;
    s.root = Some(root.to_string_lossy().into_owned());
    s.building = is_locked(&root);
    s.last_result = read_last_result(&root);

    if let Err(e) = git_out(&root, &["fetch", "--quiet"], 60) {
        s.fetch_error = Some(e);
    }
    s.head = git_out(&root, &["rev-parse", "--short", "HEAD"], 10).ok();
    s.branch = git_out(&root, &["rev-parse", "--abbrev-ref", "HEAD"], 10).ok();
    s.dirty = git_out(&root, &["status", "--porcelain", "--untracked-files=no"], 30)
        .map(|o| !o.is_empty())
        .unwrap_or(false);

    match git_out(&root, &["rev-parse", "--abbrev-ref", "@{u}"], 10) {
        Ok(u) => {
            s.upstream = Some(u);
            s.behind = git_out(&root, &["rev-list", "--count", "HEAD..@{u}"], 10).map(|o| parse_count(&o)).unwrap_or(0);
            s.ahead = git_out(&root, &["rev-list", "--count", "@{u}..HEAD"], 10).map(|o| parse_count(&o)).unwrap_or(0);
            s.commits = git_out(&root, &["log", "--format=%h%x09%s", "-n", "20", "HEAD..@{u}"], 10)
                .map(|o| parse_commits(&o))
                .unwrap_or_default();
        }
        Err(_) => s.error = Some(NO_UPSTREAM.to_string()),
    }

    if !s.building {
        s.pending = dry_run_plan(&root).map(|p| p.work).unwrap_or(false);
    }
    s
}

#[tauri::command]
pub(crate) async fn update_status(app: AppHandle) -> Result<Status, String> {
    let base = base_of(&app)?;
    tauri::async_runtime::spawn_blocking(move || status_blocking(&base))
        .await
        .map_err(|e| e.to_string())
}

// ── Pull ──────────────────────────────────────────────────────────────────────

fn pull_blocking(base: &Path) -> Result<Plan, String> {
    let root = source_root(base)?;
    git_out(&root, &["fetch", "--quiet"], 60)?;
    git_out(&root, &["rev-parse", "--abbrev-ref", "@{u}"], 10).map_err(|_| NO_UPSTREAM.to_string())?;
    let dirty = !git_out(&root, &["status", "--porcelain", "--untracked-files=no"], 30)?.is_empty();
    let behind = parse_count(&git_out(&root, &["rev-list", "--count", "HEAD..@{u}"], 10)?);
    let ahead = parse_count(&git_out(&root, &["rev-list", "--count", "@{u}..HEAD"], 10)?);
    if let Some(msg) = pull_blocker(ahead, behind, is_locked(&root)) {
        return Err(msg.to_string());
    }
    if behind > 0 {
        // git stash → git pull → git stash pop. Only tracked files are stashed (no -u), so ignored
        // folders (the model, venv, node_modules, config) stay exactly where they are.
        let stashed = dirty && {
            // A stash is a commit: give it a name so it works on a Mac with no git identity set.
            git_out(
                &root,
                &["-c", "user.name=Banditur", "-c", "user.email=update@banditur.local", "stash", "push", "--quiet", "-m", STASH_MSG],
                60,
            )?;
            true
        };
        if let Err(e) = git_out(&root, &["pull", "--ff-only", "--quiet"], 120) {
            if stashed {
                let _ = git_out(&root, &["stash", "pop", "--quiet"], 60);
            }
            return Err(e);
        }
        if stashed && git_out(&root, &["stash", "pop", "--quiet"], 60).is_err() {
            // The edits clash with the new code. A failed pop keeps the stash, so nothing is lost:
            // put the files back to the pulled code (so it can build) and say where the edits are.
            let _ = git_out(&root, &["reset", "--hard", "--quiet", "HEAD"], 60);
            return Err(STASH_KEPT.to_string());
        }
    }
    dry_run_plan(&root)
}

/// Fast-forward the clone to its upstream, then say which pieces the update will touch.
#[tauri::command]
pub(crate) async fn update_pull(app: AppHandle) -> Result<Plan, String> {
    let base = base_of(&app)?;
    tauri::async_runtime::spawn_blocking(move || pull_blocking(&base))
        .await
        .map_err(|e| e.to_string())?
}

// ── Running the update ────────────────────────────────────────────────────────

/// Start `update.mjs` detached: its own process group, no stdio (it logs itself), so it
/// outlives this app when asked to.
fn spawn_update(root: &Path, args: &[&str]) -> Result<std::process::Child, String> {
    let mut cmd = login_node(root, "scripts/update.mjs", args);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd.spawn().map_err(|e| e.to_string())
}

/// Build in the background while the app keeps running; `update://done` carries the result.
#[tauri::command]
pub(crate) async fn update_run_background(app: AppHandle) -> Result<(), String> {
    let base = base_of(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let root = source_root(&base)?;
        if is_locked(&root) {
            return Err(BUSY.to_string());
        }
        // No result file after the child exits means the script never ran.
        let result_file = cache_dir(&root).join("update-result.json");
        let _ = std::fs::remove_file(&result_file);
        let mut child = spawn_update(&root, &["--no-app"])?;
        std::thread::spawn(move || {
            let _ = child.wait();
            let payload = read_last_result(&root).unwrap_or_else(|| serde_json::json!({
                "ok": false,
                "error": NO_RESULT,
            }));
            let _ = app.emit("update://done", payload);
        });
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Hand over to a detached helper that waits for this process to exit, builds, installs and
/// reopens the app, then quit.
#[tauri::command]
pub(crate) async fn update_and_restart(app: AppHandle) -> Result<(), String> {
    let base = base_of(&app)?;
    let exe = std::env::current_exe().ok();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let root = source_root(&base)?;
        if is_locked(&root) {
            return Err(BUSY.to_string());
        }
        let bundle = exe
            .as_deref()
            .and_then(bundle_from_exe)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_APP));
        let pid = std::process::id().to_string();
        let bundle_arg = bundle.to_string_lossy().into_owned();
        let _ = std::fs::remove_file(cache_dir(&root).join("update-result.json"));
        spawn_update(&root, &["--wait-pid", pid.as_str(), "--relaunch", bundle_arg.as_str()])?;
        // Let the answer reach the interface, then quit so the helper can go on.
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(600));
            app.exit(0);
        });
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The interface has shown the last result; forget it.
#[tauri::command]
pub(crate) async fn update_clear_result(app: AppHandle) -> Result<(), String> {
    let base = base_of(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok(root) = source_root(&base) {
            let _ = std::fs::remove_file(cache_dir(&root).join("update-result.json"));
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_json_needs_an_absolute_root() {
        assert_eq!(
            parse_source(r#"{"root":"/Users/x/Banditur","recordedAt":"2026-11-24T10:00:00Z"}"#),
            Some(PathBuf::from("/Users/x/Banditur"))
        );
        assert_eq!(parse_source(r#"{"root":"relative/dir"}"#), None);
        assert_eq!(parse_source(r#"{"root":7}"#), None);
        assert_eq!(parse_source("{oops"), None);
        assert_eq!(parse_source(""), None);
    }

    #[test]
    fn counts_and_commit_lines_are_read_leniently() {
        assert_eq!(parse_count("3\n"), 3);
        assert_eq!(parse_count(""), 0);
        assert_eq!(parse_count("x"), 0);
        let commits = parse_commits("a1b2c3d\tFix the calendar\n\nnotab\n4e5f6a7\tAdd: update button\t(extra)\n");
        assert_eq!(
            commits,
            vec![
                Commit { hash: "a1b2c3d".into(), subject: "Fix the calendar".into() },
                Commit { hash: "4e5f6a7".into(), subject: "Add: update button\t(extra)".into() },
            ]
        );
        assert!(parse_commits("").is_empty());
    }

    #[test]
    fn the_plan_comes_from_the_last_json_line() {
        let out = "Welcome back\n{\"work\":true,\"core\":false,\"ui\":true,\"engine\":false,\"model\":false}\n";
        assert_eq!(
            parse_plan(out),
            Some(Plan { work: true, core: false, ui: true, engine: false, model: false })
        );
        assert_eq!(parse_plan("no json here\n"), None);
        assert_eq!(parse_plan("{broken\n"), None);
        assert_eq!(parse_plan("{}\n"), Some(Plan::default()));
    }

    #[test]
    fn lock_pid_is_a_positive_number() {
        assert_eq!(lock_pid("4242\n"), Some(4242));
        assert_eq!(lock_pid("0"), None);
        assert_eq!(lock_pid("abc"), None);
        assert_eq!(lock_pid(""), None);
    }

    #[test]
    fn a_pull_is_refused_when_busy_or_diverged() {
        assert_eq!(pull_blocker(0, 3, false), None, "local edits no longer block: they are stashed");
        assert_eq!(pull_blocker(2, 0, false), None, "only ahead: nothing to pull, nothing wrong");
        assert_eq!(pull_blocker(0, 3, true), Some(BUSY));
        assert_eq!(pull_blocker(1, 3, false), Some(DIVERGED));
        assert_eq!(pull_blocker(1, 3, true), Some(BUSY), "busy comes first");
    }

    #[test]
    fn git_errors_get_a_short_message() {
        let auth = "fatal: could not read Username for 'https://github.com': terminal prompts disabled";
        assert_eq!(classify_git_error(auth), AUTH);
        assert_eq!(classify_git_error("remote: Repository not found.\nfatal: Authentication failed"), AUTH);
        assert_eq!(classify_git_error("fatal: unable to access 'https://github.com/x/y/': Could not resolve host: github.com"), OFFLINE);
        assert_eq!(classify_git_error("fatal: Not possible to fast-forward, aborting.\n"), "git: fatal: Not possible to fast-forward, aborting.");
        assert_eq!(classify_git_error(""), "git: git failed");
    }

    #[test]
    fn the_app_bundle_is_found_from_the_executable() {
        assert_eq!(
            bundle_from_exe(Path::new("/Applications/Banditur.app/Contents/MacOS/banditur")),
            Some(PathBuf::from("/Applications/Banditur.app"))
        );
        assert_eq!(bundle_from_exe(Path::new("/Users/x/Banditur/src-tauri/target/debug/banditur")), None);
    }

    #[test]
    fn the_status_is_camel_case_for_the_interface() {
        let v = serde_json::to_value(Status::default()).unwrap();
        assert_eq!(v["configured"], false);
        assert!(v.get("lastResult").is_some());
        assert!(v.get("fetchError").is_some());
        assert!(v["commits"].as_array().unwrap().is_empty());
    }

    #[test]
    fn nothing_is_set_up_without_source_json() {
        let base = std::env::temp_dir().join(format!("banditur-update-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        assert!(!status_blocking(&base).configured);
        assert_eq!(pull_blocking(&base), Err(NOT_SET_UP.to_string()));
        std::fs::write(base.join("source.json"), r#"{"root":"/definitely/not/here"}"#).unwrap();
        assert!(!status_blocking(&base).configured, "a root without .git is not a clone");
        let _ = std::fs::remove_dir_all(&base);
    }
}
