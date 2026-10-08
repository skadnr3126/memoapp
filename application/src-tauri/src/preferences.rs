use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::Path, sync::Mutex};
use tauri::{Manager, PhysicalPosition, PhysicalSize};

macro_rules! diagnostic {
    ($app:expr, $event:expr, $details:expr) => {
        #[cfg(debug_assertions)]
        debug_log($app, $event, $details);
    };
}

#[cfg(debug_assertions)]
fn debug_log(app: &tauri::AppHandle, event: &str, details: serde_json::Value) {
    use std::io::Write;
    let Ok(directory) = app.path().app_config_dir() else { return; };
    let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(directory.join("ui-state-debug.log")) else { return; };
    let record = serde_json::json!({
        "timeMs": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or_default(),
        "pid": std::process::id(), "event": event, "details": details,
    });
    let _ = writeln!(file, "{record}");
}

pub fn debug_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    diagnostic!(window.app_handle(), "window-event", serde_json::json!({"label": window.label(), "event": format!("{event:?}")}));
    #[cfg(not(debug_assertions))]
    let _ = (window, event);
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Geometry {
    x: i32, y: i32, width: u32, height: u32, maximized: bool,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    sidebar_width: Option<f64>,
    sidebar_collapsed: Option<bool>,
    #[serde(default)]
    windows: HashMap<String, Geometry>,
}
#[derive(Default)]
pub struct WindowCache(pub Mutex<CachedPreferences>);

#[derive(Default)]
pub struct CachedPreferences {
    value: Option<Preferences>,
    ready_windows: std::collections::HashSet<String>,
    restoring: std::collections::HashSet<String>,
}

fn read<T: serde::de::DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("ui-state.json"))
}
fn validate_preferences(preferences: &Preferences) -> Result<(), String> {
    if preferences.sidebar_width.is_some_and(|w| !w.is_finite() || !(8.0..=480.0).contains(&w)) { return Err("잘못된 사이드바 너비입니다.".into()); }
    if preferences.windows.values().any(|g| g.width < 100 || g.height < 100 || g.width > 20000 || g.height > 20000) { return Err("잘못된 창 크기입니다.".into()); }
    Ok(())
}
fn load_shared(path: &Path, legacy: Option<&Path>) -> Result<Preferences, String> {
    if path.exists() {
        let preferences: Preferences = read(path)?;
        validate_preferences(&preferences)?;
        return Ok(preferences);
    }
    let preferences: Preferences = match legacy.filter(|path| path.is_file()) { Some(path) => read(path)?, None => Preferences::default() };
    validate_preferences(&preferences)?;
    super::write_atomic(path, &serde_json::to_string_pretty(&preferences).map_err(|e| e.to_string())?)?;
    Ok(preferences)
}
fn ensure_loaded(app: &tauri::AppHandle) -> Result<Preferences, String> {
    let state = app.state::<WindowCache>();
    let mut cache = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(value) = &cache.value {
        diagnostic!(app, "load", serde_json::json!({"source": "cache", "path": settings_path(app).ok(), "editor": value.windows.get("editor")}));
        return Ok(value.clone());
    }
    let _storage = super::STORAGE_LOCK.lock().map_err(|e| e.to_string())?;
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = settings_path(app)?;
    let legacy = if path.exists() { None } else {
        let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(|home| std::path::PathBuf::from(home).join("MemoApp"));
        legacy_path(&directory, home.as_deref())?
    };
    let value = load_shared(&path, legacy.as_deref())?;
    diagnostic!(app, "load", serde_json::json!({"source": "disk", "path": path, "legacy": legacy, "editor": value.windows.get("editor")}));
    cache.value = Some(value.clone());
    Ok(value)
}
fn legacy_path(directory: &Path, library: Option<&Path>) -> Result<Option<std::path::PathBuf>, String> {
    let session: WorkspaceSession = read(&directory.join("workspace-session.json"))?;
    let active = session.active_workspace_root.map(std::path::PathBuf::from).filter(|root| root.is_absolute()).map(|root| root.join(".memo/ui-state.json"));
    Ok(active.filter(|path| path.is_file()).or_else(|| library.map(|root| root.join(".memo/ui-state.json")).filter(|path| path.is_file())))
}
fn save_shared(path: &Path, preferences: super::UiPreferences, windows: &HashMap<String, Geometry>) -> Result<Preferences, String> {
    let mut value: Preferences = read(path)?;
    validate_preferences(&value)?;
    value.sidebar_width = preferences.sidebar_width;
    value.sidebar_collapsed = preferences.sidebar_collapsed;
    value.windows.extend(windows.clone());
    validate_preferences(&value)?;
    super::write_atomic(path, &serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?)?;
    Ok(value)
}
fn apply(window: &tauri::WebviewWindow, g: &Geometry) -> Result<(), String> {
    macro_rules! native_step {
        ($operation:literal, $call:expr) => {{
            let result = $call;
            diagnostic!(window.app_handle(), "restore-step", serde_json::json!({"label": window.label(), "operation": $operation, "result": result.as_ref().map(|_| ()).map_err(|e| e.to_string())}));
            result.map_err(|e| e.to_string())?
        }};
    }
    if g.width < 100 || g.height < 100 || g.width > 20000 || g.height > 20000 { return Err("잘못된 창 크기입니다.".into()); }
    native_step!("unmaximize", window.unmaximize());
    native_step!("set_size", window.set_size(PhysicalSize::new(g.width, g.height)));
    let visible = native_step!("available_monitors", window.available_monitors()).iter().any(|m| {
        let p = m.position(); let s = m.size();
        i64::from(g.x) < i64::from(p.x) + i64::from(s.width) && i64::from(g.x) + i64::from(g.width) > i64::from(p.x)
            && i64::from(g.y) < i64::from(p.y) + i64::from(s.height) && i64::from(g.y) + i64::from(g.height) > i64::from(p.y)
    });
    diagnostic!(window.app_handle(), "restore-placement", serde_json::json!({"label": window.label(), "visible": visible, "geometry": g}));
    if visible { native_step!("set_position", window.set_position(PhysicalPosition::new(g.x, g.y))); }
    else { native_step!("center", window.center()); }
    if g.maximized { native_step!("maximize", window.maximize()); }
    Ok(())
}
pub fn track(window: &tauri::Window) {
    if window.is_minimized().unwrap_or(true) {
        diagnostic!(window.app_handle(), "track-skip", serde_json::json!({"label": window.label(), "reason": "minimized-or-getter-error"}));
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let cache = window.state::<WindowCache>();
    let Ok(mut cache) = cache.0.lock() else { return; };
    if !cache.ready_windows.contains(window.label()) || cache.restoring.contains(window.label()) {
        diagnostic!(window.app_handle(), "track-skip", serde_json::json!({"label": window.label(), "reason": if !cache.ready_windows.contains(window.label()) { "not-ready" } else { "restoring" }, "ready": cache.ready_windows.contains(window.label()), "restoring": cache.restoring.contains(window.label())}));
        return;
    }
    let Some(value) = cache.value.as_mut() else {
        diagnostic!(window.app_handle(), "track-skip", serde_json::json!({"label": window.label(), "reason": "cache-unloaded"}));
        return;
    };
    if maximized {
        if let Some(g) = value.windows.get_mut(window.label()) { g.maximized = true; }
    } else {
        let position = window.outer_position();
        let size = window.inner_size();
        diagnostic!(window.app_handle(), "track-read", serde_json::json!({"label": window.label(), "position": format!("{position:?}"), "size": format!("{size:?}")}));
        if let (Ok(p), Ok(s)) = (position, size) {
            if s.width >= 100 && s.height >= 100 && s.width <= 20000 && s.height <= 20000 {
                value.windows.insert(window.label().into(), Geometry { x: p.x, y: p.y, width: s.width, height: s.height, maximized });
            }
        }
    }
    diagnostic!(window.app_handle(), "track", serde_json::json!({"label": window.label(), "geometry": value.windows.get(window.label())}));
}
pub fn forget_window(window: &tauri::Window) {
    diagnostic!(window.app_handle(), "forget-window", serde_json::json!({"label": window.label()}));
    if let Ok(mut cache) = window.state::<WindowCache>().0.lock() { cache.ready_windows.remove(window.label()); }
}
pub fn save_editor_on_close(window: &tauri::Window) {
    if window.label() != "editor" { return; }
    let state = window.state::<WindowCache>();
    let preferences = {
        let Ok(cache) = state.0.lock() else { return; };
        if !cache.ready_windows.contains("editor") { return; }
        let Some(value) = &cache.value else { return; };
        value.clone()
    };
    let result = (|| {
        let _storage = super::STORAGE_LOCK.lock().map_err(|e| e.to_string())?;
        save_shared(&settings_path(window.app_handle())?, super::UiPreferences {
            sidebar_width: preferences.sidebar_width,
            sidebar_collapsed: preferences.sidebar_collapsed,
        }, &preferences.windows)?;
        Ok::<(), String>(())
    })();
    diagnostic!(window.app_handle(), "editor-close-save", serde_json::json!({"editor": preferences.windows.get("editor"), "result": result}));
    if let Err(error) = result { eprintln!("편집 창 위치 저장 실패: {error}"); }
}
fn restore_window(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    diagnostic!(app, "restore-request", serde_json::json!({"label": label}));
    let preferences = ensure_loaded(app)?;
    let Some(window) = app.get_webview_window(label) else {
        diagnostic!(app, "restore-window-missing", serde_json::json!({"label": label}));
        return Ok(());
    };
    diagnostic!(app, "restore-start", serde_json::json!({"label": label, "geometry": preferences.windows.get(label)}));
    let state = app.state::<WindowCache>();
    state.0.lock().map_err(|e| e.to_string())?.restoring.insert(label.into());
    let result = if let Some(geometry) = preferences.windows.get(label) { apply(&window, geometry) } else { Ok(()) };
    diagnostic!(app, "restore-result", serde_json::json!({"label": label, "result": result}));
    {
        let mut cache = state.0.lock().map_err(|e| e.to_string())?;
        cache.restoring.remove(label);
        if result.is_ok() { cache.ready_windows.insert(label.into()); }
    }
    result?;
    track(&window.as_ref().window());
    Ok(())
}
#[tauri::command]
pub fn restore_editor_preferences(app: tauri::AppHandle) -> Result<(), String> {
    restore_window(&app, "editor")
}
#[tauri::command]
pub fn load_ui_preferences(app: tauri::AppHandle) -> Result<Preferences, String> {
    let preferences = ensure_loaded(&app)?;
    let ready = app.state::<WindowCache>().0.lock().map_err(|e| e.to_string())?.ready_windows.contains("main");
    if !ready { restore_window(&app, "main")?; }
    Ok(preferences)
}
#[tauri::command]
pub fn save_ui_preferences(app: tauri::AppHandle, preferences: super::UiPreferences) -> Result<(), String> {
    let state = app.state::<WindowCache>();
    if state.0.lock().map_err(|e| e.to_string())?.value.is_none() { return Err("화면 설정을 먼저 불러와야 합니다.".into()); }
    for window in app.webview_windows().values() { track(&window.as_ref().window()); }
    let windows = state.0.lock().map_err(|e| e.to_string())?.value.as_ref().ok_or("화면 설정을 먼저 불러와야 합니다.")?.windows.clone();
    let value = {
        let _lock = super::STORAGE_LOCK.lock().map_err(|e| e.to_string())?;
        save_shared(&settings_path(&app)?, preferences, &windows)?
    };
    diagnostic!(&app, "save", serde_json::json!({"path": settings_path(&app).ok(), "editor": value.windows.get("editor")}));
    let mut cache = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(cached) = &mut cache.value { cached.sidebar_width = value.sidebar_width; cached.sidebar_collapsed = value.sidebar_collapsed; }
    Ok(())
}
#[tauri::command]
pub fn recent_workspaces(app: tauri::AppHandle, opened: Option<String>, removed: Option<String>) -> Result<Vec<String>, String> {
    let _lock = super::STORAGE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("recent-workspaces.json");
    let mut items: Vec<String> = read(&path)?;
    let changed = opened.is_some() || removed.is_some();
    if let Some(root) = opened { items.retain(|p| p != &root); items.insert(0, root); }
    if let Some(root) = removed { items.retain(|p| p != &root); }
    items.truncate(10);
    if changed { super::write_atomic(&path, &serde_json::to_string_pretty(&items).map_err(|e| e.to_string())?)?; }
    Ok(items)
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSession {
    open_workspace_roots: Vec<String>,
    active_workspace_root: Option<String>,
}

#[tauri::command]
pub fn workspace_session(app: tauri::AppHandle, session: Option<WorkspaceSession>) -> Result<WorkspaceSession, String> {
    let _lock = super::STORAGE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("workspace-session.json");
    if let Some(session) = session {
        super::write_atomic(&path, &serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?)?;
        Ok(session)
    } else {
        read(&path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_session_round_trips_order_selection_and_empty_tabs() {
        let temp = std::env::temp_dir().join(format!("memo-session-test-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let path = temp.join("workspace-session.json");
        let missing: WorkspaceSession = read(&path).unwrap();
        assert!(missing.open_workspace_roots.is_empty());
        assert_eq!(missing.active_workspace_root, None);
        let session = WorkspaceSession {
            open_workspace_roots: vec!["D:/메모 A".into(), "D:/B".into()],
            active_workspace_root: Some("D:/B".into()),
        };
        super::super::write_atomic(&path, &serde_json::to_string_pretty(&session).unwrap()).unwrap();
        let restored: WorkspaceSession = read(&path).unwrap();
        assert_eq!(restored.open_workspace_roots, vec!["D:/메모 A", "D:/B"]);
        assert_eq!(restored.active_workspace_root.as_deref(), Some("D:/B"));
        super::super::write_atomic(&path, &serde_json::to_string(&WorkspaceSession::default()).unwrap()).unwrap();
        let closed: WorkspaceSession = read(&path).unwrap();
        assert!(closed.open_workspace_roots.is_empty());
        assert_eq!(closed.active_workspace_root, None);
        super::super::write_atomic(&path, "broken json").unwrap();
        assert!(read::<WorkspaceSession>(&path).is_err());
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn shared_settings_import_once_and_preserve_closed_editor_geometry_on_save() {
        let temp = super::super::tests::Temp::new();
        let legacy = temp.0.join("workspace/.memo/ui-state.json");
        let shared = temp.0.join("app-config/ui-state.json");
        let original = r#"{"sidebarWidth":360,"windows":{"main":{"x":-100,"y":20,"width":900,"height":700,"maximized":true},"editor":{"x":300,"y":60,"width":720,"height":900,"maximized":false}}}"#;
        super::super::write_atomic(&legacy, original).unwrap();
        let imported = load_shared(&shared, Some(&legacy)).unwrap();
        assert_eq!(fs::read_to_string(&legacy).unwrap(), original);
        assert_eq!(imported.sidebar_width, Some(360.0));
        assert!(imported.windows["main"].maximized);
        super::super::write_atomic(&legacy, "broken legacy json").unwrap();
        let windows = HashMap::from([("main".into(), Geometry {x:40,y:50,width:1200,height:800,maximized:false})]);
        save_shared(&shared, super::super::UiPreferences {sidebar_width:Some(420.0),sidebar_collapsed:Some(true)}, &windows).unwrap();
        let restored = load_shared(&shared, Some(&legacy)).unwrap();
        assert_eq!(restored.sidebar_width, Some(420.0));
        assert_eq!(restored.sidebar_collapsed, Some(true));
        assert_eq!(restored.windows["editor"], imported.windows["editor"]);
        assert_eq!(restored.windows["main"].width, 1200);
        assert_eq!(restored.windows["main"].x, 40);
    }

    #[test]
    fn saving_last_editor_geometry_preserves_main_window_and_sidebar() {
        let temp = super::super::tests::Temp::new();
        let path = temp.0.join("config/ui-state.json");
        super::super::write_atomic(&path, r#"{"sidebarWidth":360,"sidebarCollapsed":true,"windows":{"main":{"x":40,"y":50,"width":1200,"height":800,"maximized":false},"editor":{"x":300,"y":60,"width":720,"height":900,"maximized":false}}}"#).unwrap();
        let cached = load_shared(&path, None).unwrap();
        let last_editor = Geometry { x: 600, y: 200, width: 850, height: 700, maximized: false };
        save_shared(&path, super::super::UiPreferences {
            sidebar_width: cached.sidebar_width,
            sidebar_collapsed: cached.sidebar_collapsed,
        }, &HashMap::from([("editor".into(), last_editor.clone())])).unwrap();
        let saved: Preferences = read(&path).unwrap();
        assert_eq!(saved.windows["editor"], last_editor);
        assert_eq!(saved.windows["main"], cached.windows["main"]);
        assert_eq!(saved.sidebar_width, Some(360.0));
        assert_eq!(saved.sidebar_collapsed, Some(true));
    }

    #[test]
    fn legacy_import_prefers_active_workspace_then_falls_back_to_library() {
        let temp = super::super::tests::Temp::new();
        let directory = temp.0.join("config");
        let active = temp.0.join("workspace");
        let library = temp.0.join("library");
        let active_file = active.join(".memo/ui-state.json");
        let library_file = library.join(".memo/ui-state.json");
        super::super::write_atomic(&active_file, "{}").unwrap();
        super::super::write_atomic(&library_file, "{}").unwrap();
        let session = WorkspaceSession {open_workspace_roots:vec![],active_workspace_root:Some(active.to_string_lossy().into())};
        super::super::write_atomic(&directory.join("workspace-session.json"), &serde_json::to_string(&session).unwrap()).unwrap();
        assert_eq!(legacy_path(&directory, Some(&library)).unwrap(), Some(active_file.clone()));
        fs::remove_file(active_file).unwrap();
        assert_eq!(legacy_path(&directory, Some(&library)).unwrap(), Some(library_file));
    }

    #[test]
    fn invalid_shared_or_legacy_settings_are_never_overwritten() {
        let temp = super::super::tests::Temp::new();
        let shared = temp.0.join("config/ui-state.json");
        super::super::write_atomic(&shared, "broken json").unwrap();
        assert!(load_shared(&shared, None).is_err());
        assert!(save_shared(&shared, super::super::UiPreferences::default(), &HashMap::new()).is_err());
        assert_eq!(fs::read_to_string(&shared).unwrap(), "broken json");
        let legacy = temp.0.join("legacy/.memo/ui-state.json");
        super::super::write_atomic(&legacy, r#"{"windows":{"main":{"x":0,"y":0,"width":5,"height":800,"maximized":false}}}"#).unwrap();
        let missing_shared = temp.0.join("other-config/ui-state.json");
        assert!(load_shared(&missing_shared, Some(&legacy)).is_err());
        assert!(!missing_shared.exists());
        assert!(legacy.exists());
    }
}
