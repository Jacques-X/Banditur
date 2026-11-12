//! Serving the interface from the components folder.
//!
//! `npm run build:local` copies a built interface (`dist/`) to
//! `<components>/ui/<n>/` (with a `ui.json`: `{"version":"<n>","needsCoreApi":N}`)
//! and records `"ui": "<n>"` in `installed.json`. At launch the app serves the
//! newest usable one instead of the interface embedded in the app. It does this
//! by wrapping Tauri's own asset store, so the page keeps its address
//! (`tauri://localhost`): saved settings, IPC permissions, the `asset:` protocol
//! and the CSP are all unchanged.
//!
//! Safety net: the version being tried is written to `ui-state.json` and cleared
//! by `interface_ready` once the interface has drawn. A version still marked
//! "trying" at the next launch never reported ready, so it is marked bad and the
//! app falls back to the next older installed interface, then to the embedded one.
use crate::components::{Installed, CORE_API};
use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Runtime};

#[derive(Debug, Default, PartialEq, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct UiState {
    /// The version started at the last launch that has not yet reported ready.
    #[serde(default)]
    pub(crate) trying: Option<String>,
    /// Versions that never reported ready, or were refused. Never tried again.
    #[serde(default)]
    pub(crate) bad: Vec<String>,
}

pub(crate) fn read_state(base: &Path) -> UiState {
    std::fs::read_to_string(base.join("ui-state.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub(crate) fn write_state(base: &Path, state: &UiState) {
    let _ = std::fs::create_dir_all(base);
    let tmp = base.join("ui-state.json.tmp");
    if let Ok(text) = serde_json::to_string_pretty(state) {
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, base.join("ui-state.json"));
        }
    }
}

/// `ui.json` → needsCoreApi. A folder without a readable `ui.json` (a copy cut off) is not usable.
fn needs_core_api(dir: &Path) -> Option<u32> {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("ui.json")).ok()?).ok()?;
    v.get("needsCoreApi")?.as_u64().and_then(|n| u32::try_from(n).ok())
}

/// An installed interface this app can serve: it has an index.html and does not need a newer core.
pub(crate) fn usable(base: &Path, version: &str, core_api: u32) -> bool {
    if version.is_empty() || version.contains(['/', '\\']) || version.starts_with('.') {
        return false;
    }
    let dir = base.join("ui").join(version);
    dir.join("index.html").is_file() && needs_core_api(&dir).is_some_and(|n| n <= core_api)
}

/// Installed interface versions on disk, newest first (numeric names only).
fn versions_on_disk(base: &Path) -> Vec<String> {
    let mut v: Vec<u64> = std::fs::read_dir(base.join("ui"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str().and_then(|n| n.parse::<u64>().ok()))
        .collect();
    v.sort_unstable_by(|a, b| b.cmp(a));
    v.into_iter().map(|n| n.to_string()).collect()
}

/// Which interface to serve now: `installed.ui`, or — if it crashed, is bad or
/// unusable — the next older installed one, or `None` for the embedded interface.
/// Updates `state` (marks a version that never reported ready as bad; records the
/// version being tried); the caller saves it.
pub(crate) fn choose(base: &Path, installed: &Installed, state: &mut UiState, core_api: u32) -> Option<String> {
    let Some(wanted) = installed.ui.clone() else {
        state.trying = None;
        return None;
    };
    let mut candidates = vec![wanted.clone()];
    if let Ok(n) = wanted.parse::<u64>() {
        candidates.extend(versions_on_disk(base).into_iter().filter(|v| v.parse::<u64>().is_ok_and(|x| x < n)));
    }
    for cand in candidates {
        if state.bad.contains(&cand) {
            continue;
        }
        if state.trying.as_deref() == Some(cand.as_str()) {
            state.bad.push(cand);
            state.trying = None;
            continue;
        }
        if usable(base, &cand, core_api) {
            state.trying = Some(cand.clone());
            return Some(cand);
        }
    }
    state.trying = None;
    None
}

/// `<root>/<key>` for a key like "/assets/app.js"; refuses anything that would leave the folder.
fn safe_join(root: &Path, key: &str) -> Option<PathBuf> {
    let rel = Path::new(key.trim_start_matches('/'));
    if rel.as_os_str().is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(root.join(rel))
}

/// Tauri's asset store with an optional folder in front of it.
pub(crate) struct LayeredAssets<R: Runtime> {
    inner: Box<dyn Assets<R>>,
    root: Arc<RwLock<Option<PathBuf>>>,
}

impl<R: Runtime> LayeredAssets<R> {
    pub(crate) fn new(inner: Box<dyn Assets<R>>, root: Arc<RwLock<Option<PathBuf>>>) -> Self {
        Self { inner, root }
    }
    fn root(&self) -> Option<PathBuf> {
        self.root.read().ok().and_then(|g| g.clone())
    }
}

impl<R: Runtime> Assets<R> for LayeredAssets<R> {
    fn setup(&self, app: &tauri::App<R>) {
        self.inner.setup(app);
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        match self.root() {
            // An installed interface is served alone: never a mix with the embedded one.
            Some(root) => {
                let path = safe_join(&root, key.as_ref())?;
                path.is_file().then(|| std::fs::read(path).ok().map(Cow::Owned))?
            }
            None => self.inner.get(key),
        }
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.inner.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        // Installed pages must not need inline scripts (build:local checks), so no hashes.
        if self.root().is_some() {
            Box::new(std::iter::empty())
        } else {
            self.inner.csp_hashes(html_path)
        }
    }
}

/// A stand-in while the real store is moved into [`LayeredAssets`].
pub(crate) struct NoAssets;
impl<R: Runtime> Assets<R> for NoAssets {
    fn get(&self, _: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

/// Managed state: the components folder and which interface is being served.
pub(crate) struct UiLoader {
    pub(crate) base: PathBuf,
    pub(crate) root: Arc<RwLock<Option<PathBuf>>>,
    pub(crate) active: RwLock<Option<String>>,
}

impl UiLoader {
    /// Pick the interface for this launch (or reload) and point the asset store at it.
    pub(crate) fn select(&self) -> Option<String> {
        let installed = crate::components::read_installed(&self.base);
        let mut state = read_state(&self.base);
        let chosen = choose(&self.base, &installed, &mut state, CORE_API);
        write_state(&self.base, &state);
        if let Ok(mut r) = self.root.write() {
            *r = chosen.as_ref().map(|v| self.base.join("ui").join(v));
        }
        if let Ok(mut a) = self.active.write() {
            *a = chosen.clone();
        }
        chosen
    }
}

/// Called by the interface once it has drawn: this version is good.
#[tauri::command]
pub(crate) fn interface_ready(ui: tauri::State<'_, UiLoader>) {
    let mut state = read_state(&ui.base);
    if state.trying.is_some() {
        state.trying = None;
        write_state(&ui.base, &state);
    }
}

/// Switch to the newest installed interface and reload the window (after `npm run build:local`).
#[tauri::command]
pub(crate) fn reload_interface(ui: tauri::State<'_, UiLoader>, window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    let chosen = ui.select();
    window.eval("window.location.reload()").map_err(|e| e.to_string())?;
    Ok(chosen)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("banditur-ui-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }
    fn install(base: &Path, v: &str, needs: u32) {
        let d = base.join("ui").join(v);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("index.html"), "<html></html>").unwrap();
        std::fs::write(d.join("ui.json"), format!(r#"{{"version":"{v}","needsCoreApi":{needs}}}"#)).unwrap();
    }
    fn with_ui(v: &str) -> Installed {
        Installed { ui: Some(v.into()), ..Default::default() }
    }

    #[test]
    fn nothing_installed_means_the_embedded_interface() {
        let base = scratch("none");
        let mut st = UiState::default();
        assert_eq!(choose(&base, &Installed::default(), &mut st, 1), None);
        assert_eq!(choose(&base, &with_ui("1"), &mut st, 1), None, "recorded but missing on disk");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_usable_interface_is_chosen_and_marked_as_being_tried() {
        let base = scratch("use");
        install(&base, "2", 1);
        let mut st = UiState::default();
        assert_eq!(choose(&base, &with_ui("2"), &mut st, 1), Some("2".into()));
        assert_eq!(st.trying.as_deref(), Some("2"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn one_that_never_reported_ready_is_marked_bad_and_the_older_one_returns() {
        let base = scratch("crash");
        install(&base, "1", 1);
        install(&base, "2", 1);
        let mut st = UiState::default();
        assert_eq!(choose(&base, &with_ui("2"), &mut st, 1), Some("2".into()));
        // The window never called interface_ready; next launch:
        assert_eq!(choose(&base, &with_ui("2"), &mut st, 1), Some("1".into()));
        assert_eq!(st.bad, vec!["2".to_string()]);
        assert_eq!(st.trying.as_deref(), Some("1"));
        // The older one also fails to report: then the embedded interface.
        assert_eq!(choose(&base, &with_ui("2"), &mut st, 1), None);
        assert_eq!(st.bad, vec!["2".to_string(), "1".to_string()]);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_good_interface_stays_good_across_launches() {
        let base = scratch("good");
        install(&base, "3", 1);
        let mut st = UiState::default();
        assert_eq!(choose(&base, &with_ui("3"), &mut st, 1), Some("3".into()));
        st.trying = None; // interface_ready
        assert_eq!(choose(&base, &with_ui("3"), &mut st, 1), Some("3".into()));
        assert!(st.bad.is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn an_interface_needing_a_newer_core_is_skipped_for_an_older_one() {
        let base = scratch("api");
        install(&base, "1", 1);
        install(&base, "2", 2);
        let mut st = UiState::default();
        assert_eq!(choose(&base, &with_ui("2"), &mut st, 1), Some("1".into()));
        assert!(st.bad.is_empty(), "too new is not bad");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_cut_off_copy_is_not_usable() {
        let base = scratch("cut");
        let d = base.join("ui/4");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("index.html"), "x").unwrap();
        assert!(!usable(&base, "4", 1), "no ui.json yet");
        std::fs::write(d.join("ui.json"), "{oops").unwrap();
        assert!(!usable(&base, "4", 1));
        assert!(!usable(&base, "../4", 1));
        assert!(!usable(&base, "", 1));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn keys_cannot_leave_the_folder() {
        let root = Path::new("/r");
        assert_eq!(safe_join(root, "/assets/app.js"), Some(PathBuf::from("/r/assets/app.js")));
        assert_eq!(safe_join(root, "/index.html"), Some(PathBuf::from("/r/index.html")));
        assert_eq!(safe_join(root, "/../secret"), None);
        assert_eq!(safe_join(root, "/a/../../b"), None);
        assert_eq!(safe_join(root, "/"), None);
        assert_eq!(safe_join(root, ""), None);
    }

    #[test]
    fn state_round_trips_and_unreadable_state_is_empty() {
        let base = scratch("state");
        let st = UiState { trying: Some("5".into()), bad: vec!["2".into()] };
        write_state(&base, &st);
        assert_eq!(read_state(&base), st);
        std::fs::write(base.join("ui-state.json"), "{oops").unwrap();
        assert_eq!(read_state(&base), UiState::default());
        let _ = std::fs::remove_dir_all(&base);
    }
}
