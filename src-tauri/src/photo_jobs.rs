use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
static ACTIVE: Mutex<Option<(String, Arc<AtomicBool>)>> = Mutex::new(None);
pub(crate) struct Run;
impl Drop for Run {
    fn drop(&mut self) {
        *ACTIVE.lock().unwrap() = None;
    }
}
pub(crate) fn begin(id: String) -> Result<Run, String> {
    let mut active = ACTIVE.lock().unwrap();
    if active.is_some() {
        return Err("Diġà hemm xogħol tar-ritratti għaddej.".into());
    }
    *active = Some((id, Arc::new(AtomicBool::new(false))));
    Ok(Run)
}
pub(crate) fn cancelled() -> bool {
    ACTIVE
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|(_, c)| c.load(Ordering::Relaxed))
}
#[tauri::command]
pub(crate) fn cancel_photo_job(id: String) -> Result<(), String> {
    if let Some((active, c)) = ACTIVE.lock().unwrap().as_ref() {
        if active == &id {
            c.store(true, Ordering::Relaxed);
            return Ok(());
        }
    }
    Err("Dan ix-xogħol m’għadux għaddej.".into())
}
pub(crate) fn file(app: &tauri::AppHandle, path: &std::path::Path, ok: bool) {
    use tauri::Emitter;
    let id = ACTIVE.lock().unwrap().as_ref().map(|(id, _)| id.clone());
    app.emit(
        "photo-file",
        serde_json::json!({"id":id,"path":path.to_string_lossy(),"ok":ok}),
    )
    .ok();
}
