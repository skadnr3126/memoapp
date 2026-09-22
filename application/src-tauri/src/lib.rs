use serde::{Deserialize, Serialize};
mod summary;
mod preferences;
use preferences::{save_ui_preferences, load_workspace_preferences, restore_editor_preferences, recent_workspaces};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
static STORAGE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UiPreferences {
    sidebar_width: Option<f64>,
    workspace_root: Option<String>,
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
    if !Path::new(&workspace_root).is_dir() { return Err("작업공간 폴더가 존재하지 않습니다.".into()); }
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
fn codex_terminal(root: &Path) -> Result<std::process::Command, String> {
    if !root.is_absolute() || !root.is_dir() {
        return Err("작업공간 경로가 올바르지 않습니다.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("cmd.exe");
        // Keep the terminal open so CLI errors remain visible; never interpolate the path into shell code.
        command.args(["/d", "/k", "codex"]).current_dir(root).creation_flags(0x00000010); // CREATE_NEW_CONSOLE
        Ok(command)
    }
    #[cfg(not(windows))]
    Err("Codex 터미널 열기는 Windows에서 지원합니다.".into())
}

#[tauri::command]
fn open_codex(window: tauri::Window, workspace_root: String) -> Result<(), String> {
    if window.label() != "main" { return Err("메인 창에서만 실행할 수 있습니다.".into()); }
    codex_terminal(Path::new(&workspace_root))?.spawn()
        .map_err(|e| io_error("Codex 터미널 실행 실패", e))?;
    Ok(())
}

fn code_command(root: &Path) -> Result<std::process::Command, String> {
    if !root.is_absolute() || !root.is_dir() {
        return Err("작업공간 경로가 올바르지 않습니다.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("cmd.exe");
        command.args(["/d", "/c", "code ."]).current_dir(root).creation_flags(0x08000000);
        Ok(command)
    }
    #[cfg(not(windows))]
    {
        let mut command = std::process::Command::new("code");
        command.arg(".").current_dir(root);
        Ok(command)
    }
}

#[tauri::command]
async fn open_code(window: tauri::Window, workspace_root: String) -> Result<(), String> {
    if window.label() != "main" { return Err("메인 창에서만 실행할 수 있습니다.".into()); }
    let output = code_command(Path::new(&workspace_root))?.output()
        .map_err(|e| io_error("VS Code 실행 실패", e))?;
    if !output.status.success() {
        return Err(format!("VS Code 설치와 PATH를 확인하세요: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(preferences::WindowCache::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::CloseRequested { .. }) { preferences::track(window); }
        })
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            save_workspace_snapshot,
            migrate_workspace,
            save_ui_preferences,
            load_workspace_preferences,
            restore_editor_preferences,
            recent_workspaces,
            summary::summarize_flow,
            open_codex,
            open_code
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(windows)]
    fn codex_terminal_keeps_workspace_path_out_of_shell_command() {
        let temp = Temp::new();
        let root = temp.0.join("한글 작업공간 & echo unexpected");
        fs::create_dir(&root).unwrap();
        let command = codex_terminal(&root).unwrap();
        assert_eq!(command.get_current_dir(), Some(root.as_path()));
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["/d", "/k", "codex"]);
        assert!(codex_terminal(Path::new("relative")).is_err());
        assert!(codex_terminal(&root.join("missing")).is_err());
    }
    #[test]
    #[cfg(windows)]
    fn code_command_uses_workspace_without_shell_interpolation() {
        let temp = Temp::new();
        let root = temp.0.join("한글 작업공간 & echo unexpected");
        fs::create_dir(&root).unwrap();
        let command = code_command(&root).unwrap();
        assert_eq!(command.get_current_dir(), Some(root.as_path()));
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["/d", "/c", "code ."]);
        assert!(code_command(Path::new("relative")).is_err());
        assert!(code_command(&root.join("missing")).is_err());
    }
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
        write_atomic(&memo.join("ai/summaries/flow_test.md"), "summary").unwrap();
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
        assert_eq!(fs::read_to_string(memo.join("ai/summaries/flow_test.md")).unwrap(), "summary");
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
