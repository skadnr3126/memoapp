use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
static STORAGE_LOCK: Mutex<()> = Mutex::new(());
use tauri::Manager;
use tauri_plugin_window_state::AppHandleExt;

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UiPreferences {
    sidebar_width: Option<f64>,
    workspace_root: Option<String>,
}

#[tauri::command]
fn load_ui_preferences(app: tauri::AppHandle) -> Result<UiPreferences, String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("ui-preferences.json");
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).map_err(|e| io_error("화면 설정 읽기 실패", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(UiPreferences::default()),
        Err(e) => Err(io_error("화면 설정 읽기 실패", e)),
    }
}

#[tauri::command]
fn save_ui_preferences(app: tauri::AppHandle, preferences: UiPreferences) -> Result<(), String> {
    if preferences.sidebar_width.is_some_and(|width| !width.is_finite() || !(8.0..=480.0).contains(&width)) {
        return Err("사이드바 너비가 올바르지 않습니다.".into());
    }
    let _lock = STORAGE_LOCK.lock().map_err(|_| "저장 잠금 오류")?;
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("ui-preferences.json");
    write_atomic(&path, &serde_json::to_string_pretty(&preferences).map_err(|e| e.to_string())?)?;
    app.save_window_state(tauri_plugin_window_state::StateFlags::all()).map_err(|e| e.to_string())
}
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StorageFile {
    relative_path: String,
    content: String,
}
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    block_files: Vec<StorageFile>,
    flow_files: Vec<StorageFile>,
    workspace: String,
    layout: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadedWorkspace {
    workspace_root: String,
    block_files: Vec<StorageFile>,
    flow_files: Vec<StorageFile>,
    workspace: Option<String>,
    layout: Option<String>,
    recovery_notice: Option<String>,
}
#[derive(Deserialize, Serialize)]
struct Operation {
    version: u32,
    kind: String,
    backup: Option<String>,
    snapshot: WorkspaceSnapshot,
}
fn io_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}
fn workspace_root(path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(path);
    if !root.is_absolute() {
        return Err("작업공간 경로는 절대 경로여야 합니다.".into());
    }
    fs::create_dir_all(&root).map_err(|e| io_error("폴더 생성 실패", e))?;
    root.canonicalize()
        .map_err(|e| io_error("경로 확인 실패", e))
}
fn ensure_memo(root: &Path) -> Result<PathBuf, String> {
    let memo = root.join(".memo");
    for name in ["blocks", "flows", "operations"] {
        fs::create_dir_all(memo.join(name)).map_err(|e| io_error("폴더 생성 실패", e))?;
    }
    Ok(memo)
}
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("부모 경로가 없습니다.")?;
    fs::create_dir_all(parent).map_err(|e| io_error("폴더 생성 실패", e))?;
    let temp = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .ok_or("파일명이 없습니다.")?
            .to_string_lossy()
    ));
    let mut file = fs::File::create(&temp).map_err(|e| io_error("임시 파일 생성 실패", e))?;
    file.write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| io_error("파일 쓰기 실패", e))?;
    drop(file);
    fs::rename(&temp, path).map_err(|e| io_error("파일 교체 실패", e))
}
fn safe_path(path: &str, prefix: &str, extension: &str) -> bool {
    let p = Path::new(path);
    p.starts_with(prefix)
        && p.extension().and_then(|e| e.to_str()) == Some(extension)
        && p.components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
}
fn validate(snapshot: &WorkspaceSnapshot) -> Result<(), String> {
    let mut paths = HashSet::new();
    for (files, prefix, ext) in [
        (&snapshot.block_files, "blocks", "md"),
        (&snapshot.flow_files, "flows", "json"),
    ] {
        for file in files {
            if !safe_path(&file.relative_path, prefix, ext) || !paths.insert(&file.relative_path) {
                return Err("잘못되거나 중복된 저장 경로입니다.".into());
            }
        }
    }
    Ok(())
}
fn read_files(directory: &Path, root: &Path, ext: &str) -> Result<Vec<StorageFile>, String> {
    let mut files = Vec::new();
    for entry in fs::read_dir(directory).map_err(|e| io_error("폴더 읽기 실패", e))? {
        let entry = entry.map_err(|e| io_error("파일 읽기 실패", e))?;
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|e| io_error("파일 종류 확인 실패", e))?
            .is_symlink()
        {
            return Err("저장 폴더 안의 심볼릭 링크는 지원하지 않습니다.".into());
        }
        if path.is_dir() {
            files.extend(read_files(&path, root, ext)?);
        } else if path.extension().and_then(|e| e.to_str()) == Some(ext) {
            files.push(StorageFile {
                relative_path: path
                    .strip_prefix(root)
                    .map_err(|e| io_error("경로 오류", e))?
                    .to_string_lossy()
                    .replace('\\', "/"),
                content: fs::read_to_string(&path).map_err(|e| io_error("파일 읽기 실패", e))?,
            });
        }
    }
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(files)
}
fn apply_snapshot(memo: &Path, snapshot: &WorkspaceSnapshot) -> Result<(), String> {
    validate(snapshot)?;
    for file in snapshot.block_files.iter().chain(&snapshot.flow_files) {
        write_atomic(&memo.join(&file.relative_path), &file.content)?;
    }
    write_atomic(&memo.join("workspace.json"), &snapshot.workspace)?;
    write_atomic(&memo.join("layout.json"), &snapshot.layout)?;
    for file in snapshot.block_files.iter().chain(&snapshot.flow_files) {
        if fs::read_to_string(memo.join(&file.relative_path))
            .map_err(|e| io_error("저장 확인 실패", e))?
            != file.content
        {
            return Err("저장 결과가 일치하지 않습니다.".into());
        }
    }
    for (files, prefix, ext) in [
        (&snapshot.block_files, "blocks", "md"),
        (&snapshot.flow_files, "flows", "json"),
    ] {
        let expected: HashSet<_> = files.iter().map(|f| &f.relative_path).collect();
        for file in read_files(&memo.join(prefix), memo, ext)? {
            if !expected.contains(&file.relative_path) {
                fs::remove_file(memo.join(&file.relative_path))
                    .map_err(|e| io_error("삭제 실패", e))?;
            }
        }
    }
    Ok(())
}
fn recover(memo: &Path) -> Result<Option<String>, String> {
    let path = memo.join("operations/active-save.json");
    if !path.exists() {
        return Ok(None);
    }
    let operation: Operation = serde_json::from_str(
        &fs::read_to_string(&path).map_err(|e| io_error("복구 기록 읽기 실패", e))?,
    )
    .map_err(|e| {
        io_error(
            "자동 복구할 수 없는 저장 기록입니다. 원본/백업을 확인하세요",
            e,
        )
    })?;
    if operation.version != 2 {
        return Err("지원하지 않는 복구 기록입니다.".into());
    }
    apply_snapshot(memo, &operation.snapshot)?;
    fs::remove_file(path).map_err(|e| io_error("복구 완료 기록 실패", e))?;
    Ok(Some("중단된 저장 작업을 복구했습니다.".into()))
}
fn commit(memo: &Path, snapshot: WorkspaceSnapshot, backup: Option<String>) -> Result<(), String> {
    validate(&snapshot)?;
    let operation = Operation {
        version: 2,
        kind: if backup.is_some() { "migrate" } else { "save" }.into(),
        backup,
        snapshot,
    };
    let path = memo.join("operations/active-save.json");
    write_atomic(
        &path,
        &serde_json::to_string(&operation).map_err(|e| io_error("작업 기록 실패", e))?,
    )?;
    apply_snapshot(memo, &operation.snapshot)?;
    fs::remove_file(path).map_err(|e| io_error("작업 완료 기록 실패", e))
}
fn backup(memo: &Path) -> Result<String, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| io_error("시간 오류", e))?
        .as_nanos();
    let name = format!("backups/pre-graph-{stamp}");
    let target = memo.join(&name);
    fs::create_dir_all(&target).map_err(|e| io_error("백업 폴더 생성 실패", e))?;
    for file in read_files(&memo.join("blocks"), memo, "md")?
        .into_iter()
        .chain(read_files(&memo.join("flows"), memo, "json")?)
    {
        write_atomic(&target.join(file.relative_path), &file.content)?;
    }
    for name in ["workspace.json", "layout.json"] {
        if memo.join(name).exists() {
            write_atomic(
                &target.join(name),
                &fs::read_to_string(memo.join(name)).map_err(|e| io_error("백업 읽기 실패", e))?,
            )?;
        }
    }
    Ok(name)
}
#[tauri::command]
fn open_workspace(workspace_root: String) -> Result<LoadedWorkspace, String> {
    let _lock = STORAGE_LOCK.lock().map_err(|_| "저장 잠금 오류")?;
    let root = self::workspace_root(&workspace_root)?;
    let memo = ensure_memo(&root)?;
    let recovery_notice = recover(&memo)?;
    let read_optional = |name: &str| -> Result<Option<String>, String> {
        if memo.join(name).exists() {
            Ok(Some(
                fs::read_to_string(memo.join(name))
                    .map_err(|e| io_error("메타데이터 읽기 실패", e))?,
            ))
        } else {
            Ok(None)
        }
    };
    Ok(LoadedWorkspace {
        workspace_root: root.to_string_lossy().into(),
        block_files: read_files(&memo.join("blocks"), &memo, "md")?,
        flow_files: read_files(&memo.join("flows"), &memo, "json")?,
        workspace: read_optional("workspace.json")?,
        layout: read_optional("layout.json")?,
        recovery_notice,
    })
}
#[tauri::command]
fn save_workspace_snapshot(
    workspace_root: String,
    snapshot: WorkspaceSnapshot,
) -> Result<(), String> {
    let _lock = STORAGE_LOCK.lock().map_err(|_| "저장 잠금 오류")?;
    let memo = ensure_memo(&self::workspace_root(&workspace_root)?)?;
    recover(&memo)?;
    commit(&memo, snapshot, None)
}
#[tauri::command]
fn migrate_workspace(
    workspace_root: String,
    mut snapshot: WorkspaceSnapshot,
) -> Result<(), String> {
    let _lock = STORAGE_LOCK.lock().map_err(|_| "저장 잠금 오류")?;
    let memo = ensure_memo(&self::workspace_root(&workspace_root)?)?;
    recover(&memo)?;
    validate(&snapshot)?;
    // Migration never rewrites Markdown metadata or changes its original paths.
    snapshot.block_files = read_files(&memo.join("blocks"), &memo, "md")?;
    let backup_path = backup(&memo)?;
    commit(&memo, snapshot, Some(backup_path))
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            save_workspace_snapshot,
            migrate_workspace,
            load_ui_preferences,
            save_ui_preferences
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "memo-graph-test-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn snapshot() -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            block_files: vec![StorageFile {
                relative_path: "blocks/2026/09/A.md".into(),
                content: "original markdown".into(),
            }],
            flow_files: vec![StorageFile {
                relative_path: "flows/F.json".into(),
                content: r#"{"version":2,"id":"F","blocks":["A"],"links":[]}"#.into(),
            }],
            workspace: r#"{"version":1}"#.into(),
            layout: r#"{"version":2,"nodePositionsByFlow":{}}"#.into(),
        }
    }
    #[test]
    fn save_replays_partial_commit_and_ignores_temporary_files() {
        let temp = Temp::new();
        let memo = ensure_memo(&temp.0).unwrap();
        let snap = snapshot();
        write_atomic(&memo.join("flows/old.json"), "old").unwrap();
        write_atomic(&memo.join("blocks/.A.md.tmp"), "interrupted write").unwrap();
        let op = Operation {
            version: 2,
            kind: "save".into(),
            backup: None,
            snapshot: snap.clone(),
        };
        write_atomic(
            &memo.join("operations/active-save.json"),
            &serde_json::to_string(&op).unwrap(),
        )
        .unwrap();
        write_atomic(&memo.join("flows/F.json"), &snap.flow_files[0].content).unwrap();
        assert!(recover(&memo).unwrap().is_some());
        assert_eq!(
            fs::read_to_string(memo.join("blocks/2026/09/A.md")).unwrap(),
            "original markdown"
        );
        assert!(!memo.join("flows/old.json").exists());
        assert_eq!(
            read_files(&memo.join("blocks"), &memo, "md").unwrap().len(),
            1
        );
        assert!(recover(&memo).unwrap().is_none());
    }
    #[test]
    fn migration_backs_up_original_files_and_preserves_markdown() {
        let temp = Temp::new();
        let memo = ensure_memo(&temp.0).unwrap();
        write_atomic(&memo.join("flows/F.json"), r#"{"version":1,"root":{}}"#).unwrap();
        write_atomic(&memo.join("blocks/A.md"), "unchanged original\r\nbody").unwrap();
        migrate_workspace(temp.0.to_string_lossy().into(), snapshot()).unwrap();
        let backups = fs::read_dir(memo.join("backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            fs::read_to_string(backups.join("flows/F.json")).unwrap(),
            r#"{"version":1,"root":{}}"#
        );
        assert_eq!(
            fs::read_to_string(memo.join("blocks/A.md")).unwrap(),
            "unchanged original\r\nbody"
        );
        assert!(!memo.join("blocks/2026/09/A.md").exists());
        assert!(!memo.join("operations/active-save.json").exists());
    }
    #[test]
    fn failed_apply_retains_journal_and_can_resume() {
        let temp = Temp::new();
        let memo = ensure_memo(&temp.0).unwrap();
        write_atomic(&memo.join("blocks/2026"), "blocks directory creation").unwrap();
        assert!(commit(&memo, snapshot(), None).is_err());
        assert!(memo.join("operations/active-save.json").exists());
        fs::remove_file(memo.join("blocks/2026")).unwrap();
        assert!(recover(&memo).unwrap().is_some());
    }
    #[test]
    fn rejects_unsafe_paths_and_unknown_old_journals_without_overwriting() {
        let temp = Temp::new();
        let memo = ensure_memo(&temp.0).unwrap();
        let mut snap = snapshot();
        snap.block_files[0].relative_path = "blocks/../../outside.md".into();
        assert!(commit(&memo, snap, None).is_err());
        write_atomic(
            &memo.join("operations/active-save.json"),
            r#"{"version":1,"state":"prepared"}"#,
        )
        .unwrap();
        assert!(recover(&memo).is_err());
        assert!(memo.join("operations/active-save.json").exists());
    }
}
