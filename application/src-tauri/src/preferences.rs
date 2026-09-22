use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::Path, sync::Mutex};
use tauri::{Manager, PhysicalPosition, PhysicalSize};

#[derive(Clone, Deserialize, Serialize)]
pub struct Geometry {
    x: i32, y: i32, width: u32, height: u32, maximized: bool,
}
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    sidebar_width: Option<f64>,
    #[serde(default)]
    windows: HashMap<String, Geometry>,
}
#[derive(Default)]
pub struct WindowCache(pub Mutex<HashMap<String, Geometry>>);

fn read<T: serde::de::DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn settings_path(root: &str) -> Result<std::path::PathBuf, String> {
    let root = Path::new(root);
    if !root.is_absolute() || !root.is_dir() { return Err("작업공간 폴더가 존재하지 않습니다.".into()); }
    Ok(root.join(".memo/ui-state.json"))
}
fn apply(window: &tauri::WebviewWindow, g: &Geometry) -> Result<(), String> {
    if g.width < 100 || g.height < 100 || g.width > 20000 || g.height > 20000 { return Err("잘못된 창 크기입니다.".into()); }
    window.unmaximize().map_err(|e| e.to_string())?;
    window.set_size(PhysicalSize::new(g.width, g.height)).map_err(|e| e.to_string())?;
    let visible = window.available_monitors().map_err(|e| e.to_string())?.iter().any(|m| {
        let p = m.position(); let s = m.size();
        i64::from(g.x) < i64::from(p.x) + i64::from(s.width) && i64::from(g.x) + i64::from(g.width) > i64::from(p.x)
            && i64::from(g.y) < i64::from(p.y) + i64::from(s.height) && i64::from(g.y) + i64::from(g.height) > i64::from(p.y)
    });
    if visible { window.set_position(PhysicalPosition::new(g.x, g.y)).map_err(|e| e.to_string())?; }
    else { window.center().map_err(|e| e.to_string())?; }
    if g.maximized { window.maximize().map_err(|e| e.to_string())?; }
    Ok(())
}
pub fn track(window: &tauri::Window) {
    if window.is_minimized().unwrap_or(true) { return; }
    let maximized = window.is_maximized().unwrap_or(false);
    let cache = window.state::<WindowCache>();
    let mut cache = cache.0.lock().unwrap();
    if maximized {
        if let Some(g) = cache.get_mut(window.label()) { g.maximized = true; }
    } else if let (Ok(p), Ok(s)) = (window.outer_position(), window.inner_size()) {
        cache.insert(window.label().into(), Geometry { x: p.x, y: p.y, width: s.width, height: s.height, maximized });
    }
}
#[tauri::command]
pub fn restore_editor_preferences(app: tauri::AppHandle, workspace_root: String) -> Result<(), String> {
    let preferences: Preferences = read(&settings_path(&workspace_root)?)?;
    let geometry = preferences.windows.get("editor").cloned();
    if let (Some(g), Some(window)) = (geometry, app.get_webview_window("editor")) { apply(&window, &g)?; }
    Ok(())
}
#[tauri::command]
pub fn load_workspace_preferences(app: tauri::AppHandle, workspace_root: String) -> Result<Preferences, String> {
    let preferences: Preferences = read(&settings_path(&workspace_root)?)?;
    if preferences.sidebar_width.is_some_and(|w| !w.is_finite() || !(8.0..=480.0).contains(&w)) { return Err("잘못된 사이드바 너비입니다.".into()); }
    for label in ["main", "editor"] {
        if let Some(window) = app.get_webview_window(label) {
            let fallback = Geometry { x: 100, y: 100, width: if label == "main" {800} else {720}, height: if label == "main" {600} else {900}, maximized: false };
            apply(&window, preferences.windows.get(label).unwrap_or(&fallback))?;
        }
    }
    *app.state::<WindowCache>().0.lock().unwrap() = preferences.windows.clone();
    Ok(preferences)
}
#[tauri::command]
pub fn save_ui_preferences(app: tauri::AppHandle, preferences: super::UiPreferences) -> Result<(), String> {
    let Some(root) = preferences.workspace_root else { return Ok(()); };
    if preferences.sidebar_width.is_some_and(|w| !w.is_finite() || !(8.0..=480.0).contains(&w)) { return Err("잘못된 사이드바 너비입니다.".into()); }
    for window in app.webview_windows().values() { track(&window.as_ref().window()); }
    let value = Preferences { sidebar_width: preferences.sidebar_width, windows: app.state::<WindowCache>().0.lock().unwrap().clone() };
    let _lock = super::STORAGE_LOCK.lock().map_err(|e| e.to_string())?;
    super::write_atomic(&settings_path(&root)?, &serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?)
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_settings_are_isolated_and_round_trip() {
        let temp = std::env::temp_dir().join(format!("memo-preferences-test-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let a = temp.join("a/.memo/ui-state.json");
        let b = temp.join("b/.memo/ui-state.json");
        super::super::write_atomic(&a, r#"{"sidebarWidth":360,"windows":{"main":{"x":-100,"y":20,"width":900,"height":700,"maximized":true}}}"#).unwrap();
        let prefs: Preferences = read(&a).unwrap();
        assert_eq!(prefs.sidebar_width, Some(360.0));
        assert!(prefs.windows["main"].maximized);
        assert_eq!(prefs.windows["main"].x, -100);
        let missing: Preferences = read(&b).unwrap();
        assert!(missing.windows.is_empty());
        assert_eq!(missing.sidebar_width, None);
        super::super::write_atomic(&b, "broken json").unwrap();
        assert!(read::<Preferences>(&b).is_err());
        fs::remove_dir_all(temp).unwrap();
    }
}
