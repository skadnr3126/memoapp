use serde::{Deserialize, Serialize};
mod summary;
mod flow_storage;
mod preferences;
use preferences::{save_ui_preferences, load_ui_preferences, restore_editor_preferences, recent_workspaces, workspace_session};
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
    sidebar_collapsed: Option<bool>,
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
    flow_storage::ensure_root(root, false)
}
fn storage_root(root: &Path, standalone: Option<bool>) -> Result<PathBuf, String> {
    flow_storage::ensure_root(root, standalone.unwrap_or(false))
}
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    flow_storage::reject_links(path)?;
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
            let correct_path = safe_path(&file.relative_path, prefix, ext)
                || (prefix == "blocks" && safe_path(&file.relative_path, "flows", ext) && file.relative_path.split('/').nth(2) == Some("blocks"));
            if !correct_path || !paths.insert(&file.relative_path) {
                return Err("잘못되거나 중복된 저장 경로입니다.".into());
            }
        }
    }
    Ok(())
}
fn read_files(directory: &Path, root: &Path, ext: &str) -> Result<Vec<StorageFile>, String> {
    if !directory.exists() { return Ok(Vec::new()); }
    if directory.is_symlink() { return Err("저장 폴더의 심볼릭 링크는 지원하지 않습니다.".into()); }
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
    let nested = snapshot.flow_files.iter().any(|f| f.relative_path.ends_with("/flow.json")) || snapshot.flow_files.is_empty();
    if nested {
        let expected_flows: HashSet<_> = snapshot.flow_files.iter().filter_map(|f| {
            if f.relative_path.ends_with("/flow.json") { f.relative_path.split('/').nth(1) } else { None }
        }).collect();
        for entry in fs::read_dir(memo.join("flows")).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_symlink() { return Err("플로우 심볼릭 링크는 지원하지 않습니다.".into()); }
            if entry.path().is_dir() && entry.path().join("flow.json").is_file() && !expected_flows.contains(entry.file_name().to_str().unwrap_or("")) {
                flow_storage::reject_links(&entry.path())?;
                fs::remove_dir_all(entry.path()).map_err(|e| io_error("플로우 삭제 실패", e))?;
            }
        }
        // Only application-owned Markdown is removed; attachments and summaries stay in their flow.
        let expected: HashSet<_> = snapshot.block_files.iter().map(|f| &f.relative_path).collect();
        for id in expected_flows {
            for file in read_files(&memo.join("flows").join(id).join("blocks"), memo, "md")? {
                if !expected.contains(&file.relative_path) { fs::remove_file(memo.join(file.relative_path)).map_err(|e| e.to_string())?; }
            }
        }
        for entry in fs::read_dir(memo.join("flows")).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.is_file() && path.extension().and_then(|v| v.to_str()) == Some("json") {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
        for file in read_files(&memo.join("blocks"), memo, "md")? {
            fs::remove_file(memo.join(file.relative_path)).map_err(|e| e.to_string())?;
        }
    } else {
        for (files, prefix, ext) in [(&snapshot.block_files, "blocks", "md"), (&snapshot.flow_files, "flows", "json")] {
            let expected: HashSet<_> = files.iter().map(|f| &f.relative_path).collect();
            for file in read_files(&memo.join(prefix), memo, ext)? {
                if !expected.contains(&file.relative_path) { fs::remove_file(memo.join(file.relative_path)).map_err(|e| io_error("삭제 실패", e))?; }
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
    for name in ["blocks", "flows", "ai"] {
        if memo.join(name).is_dir() { flow_storage::copy_tree(&memo.join(name), &target.join(name))?; }
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
fn resolve_workspace_root(workspace_root: String) -> Result<String, String> {
    let path = Path::new(&workspace_root);
    if !path.is_absolute() || !path.is_dir() { return Err("작업공간 폴더가 존재하지 않습니다.".into()); }
    path.canonicalize().map(|root| root.to_string_lossy().into_owned())
        .map_err(|e| io_error("경로 확인 실패", e))
}
#[tauri::command]
fn independent_workspace_root() -> Result<String, String> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok_or("사용자 홈 경로를 찾을 수 없습니다.")?;
    let root = workspace_root(&PathBuf::from(home).join("MemoApp").to_string_lossy())?;
    storage_root(&root, Some(true))?;
    Ok(root.to_string_lossy().into())
}
fn load_storage(root: &Path, memo: &Path, recovery_notice: Option<String>) -> Result<LoadedWorkspace, String> {
    let optional = |name: &str| -> Result<Option<String>, String> {
        if memo.join(name).exists() { Ok(Some(fs::read_to_string(memo.join(name)).map_err(|e| io_error("메타데이터 읽기 실패", e))?)) } else { Ok(None) }
    };
    let mut blocks = read_files(&memo.join("blocks"), memo, "md")?;
    let mut flows = Vec::new();
    let raw_layout = optional("layout.json")?;
    let mut has_layout = raw_layout.is_some();
    let mut layout: serde_json::Value = raw_layout.map(|s| serde_json::from_str(&s)).transpose().map_err(|e| e.to_string())?.unwrap_or(serde_json::json!({"version":2,"nodePositionsByFlow":{},"viewportByFlow":{}}));
    for entry in fs::read_dir(memo.join("flows")).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if entry.file_type().map_err(|e| e.to_string())?.is_symlink() { return Err("플로우 심볼릭 링크는 지원하지 않습니다.".into()); }
        if path.is_dir() && path.join("flow.json").is_file() {
            let id = entry.file_name().to_string_lossy().into_owned();
            flows.push(StorageFile { relative_path: format!("flows/{id}/flow.json"), content: fs::read_to_string(path.join("flow.json")).map_err(|e| e.to_string())? });
            blocks.extend(read_files(&path.join("blocks"), memo, "md")?);
            for name in ["nodePositionsByFlow", "viewportByFlow"] {
                if let Some(map) = layout.get_mut(name).and_then(|v| v.as_object_mut()) { map.remove(&id); }
            }
            if path.join("layout.json").exists() {
                has_layout = true;
                let perflow: serde_json::Value = serde_json::from_str(&fs::read_to_string(path.join("layout.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                for name in ["nodePositionsByFlow", "viewportByFlow"] {
                    if let Some(value) = perflow.get(name).and_then(|v| v.get(&id)) {
                        if !layout.get(name).map(|v| v.is_object()).unwrap_or(false) { layout[name] = serde_json::json!({}); }
                        layout[name][&id] = value.clone();
                    }
                }
                layout["version"] = 2.into();
            }
        } else if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if !memo.join("flows").join(id).join("flow.json").is_file() {
                flows.push(StorageFile { relative_path: format!("flows/{}", entry.file_name().to_string_lossy()), content: fs::read_to_string(path).map_err(|e| e.to_string())? });
            }
        }
    }
    // Legacy Markdown is only used while a legacy flow remains.
    if !flows.iter().any(|f| f.relative_path.matches('/').count() == 1) { blocks.retain(|f| f.relative_path.starts_with("flows/")); }
    blocks.sort_by(|a,b| a.relative_path.cmp(&b.relative_path)); flows.sort_by(|a,b| a.relative_path.cmp(&b.relative_path));
    Ok(LoadedWorkspace { workspace_root:root.to_string_lossy().into(), block_files:blocks, flow_files:flows, workspace:optional("workspace.json")?, layout:if has_layout { Some(serde_json::to_string(&layout).map_err(|e| e.to_string())?) } else { None }, recovery_notice })
}
#[tauri::command]
fn open_workspace(workspace_root: String, standalone: Option<bool>) -> Result<LoadedWorkspace, String> {
    if !Path::new(&workspace_root).is_dir() { return Err("작업공간 폴더가 존재하지 않습니다.".into()); }
    let _lock = STORAGE_LOCK.lock().map_err(|_| "저장 잠금 오류")?;
    let root = self::workspace_root(&workspace_root)?;
    let memo = storage_root(&root, standalone)?;
    let moved = flow_storage::recover_moves(&memo)?;
    let notice = recover(&memo)?.or_else(|| moved.then(|| "중단된 플로우 이동을 복구했습니다.".into()));
    load_storage(&root, &memo, notice)
}
#[tauri::command]
fn save_workspace_snapshot(workspace_root: String, snapshot: WorkspaceSnapshot, standalone: Option<bool>) -> Result<(), String> {
    let _lock = STORAGE_LOCK.lock().map_err(|_| "저장 잠금 오류")?;
    let memo = storage_root(&self::workspace_root(&workspace_root)?, standalone)?;
    if flow_storage::recover_moves(&memo)? { return Err("중단된 이동을 복구했습니다. 플로우를 다시 열고 저장하세요.".into()); }
    recover(&memo)?;
    commit(&memo, snapshot, None)
}
#[tauri::command]
fn migrate_workspace(workspace_root: String, mut snapshot: WorkspaceSnapshot, standalone: Option<bool>) -> Result<(), String> {
    let _lock = STORAGE_LOCK.lock().map_err(|_| "저장 잠금 오류")?;
    let memo = storage_root(&self::workspace_root(&workspace_root)?, standalone)?;
    flow_storage::recover_moves(&memo)?; recover(&memo)?; validate(&snapshot)?;
    let original = read_files(&memo.join("blocks"), &memo, "md")?;
    if snapshot.block_files.iter().any(|f| f.relative_path.starts_with("flows/")) {
        for file in &mut snapshot.block_files {
            if let Some(name) = Path::new(&file.relative_path).file_name() {
                let matches: Vec<_> = original.iter().filter(|f| Path::new(&f.relative_path).file_name() == Some(name)).collect();
                if matches.len() > 1 { return Err("동일한 ID의 블록 파일이 여러 개 있어 이전할 수 없습니다.".into()); }
                if let Some(raw) = matches.first() { file.content = raw.content.clone(); }
            }
        }
    } else { snapshot.block_files = original; }
    let backup_path = backup(&memo)?;
    for file in &snapshot.flow_files {
        if file.relative_path.ends_with("/flow.json") {
            let id = file.relative_path.split('/').nth(1).ok_or("플로우 경로 오류")?;
            let summary = memo.join("ai/summaries").join(format!("{id}.md"));
            if summary.is_file() && !memo.join("flows").join(id).join("ai/summary.md").exists() {
                write_atomic(&memo.join("flows").join(id).join("ai/summary.md"), &fs::read_to_string(summary).map_err(|e| e.to_string())?)?;
            }
        }
    }
    commit(&memo, snapshot, Some(backup_path))
}
#[tauri::command]
fn move_flow(source_root: String, target_root: String, flow_id: String, source_standalone: Option<bool>, target_standalone: Option<bool>) -> Result<(), String> {
    let _lock = STORAGE_LOCK.lock().map_err(|_| "저장 잠금 오류")?;
    let source = storage_root(&workspace_root(&source_root)?, source_standalone)?;
    let target = storage_root(&workspace_root(&target_root)?, target_standalone)?;
    recover(&source)?; recover(&target)?;
    flow_storage::move_flow(&source, &target, &flow_id)
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

#[tauri::command]
fn open_summary_folder(window: tauri::Window, workspace_root: String, flow_id: String, standalone: Option<bool>) -> Result<(), String> {
    if window.label() != "main" { return Err("메인 창에서만 실행할 수 있습니다.".into()); }
    let _lock = STORAGE_LOCK.lock().map_err(|_| "저장 잠금 오류")?;
    let root = Path::new(&workspace_root);
    if !root.is_absolute() || !root.is_dir() { return Err("작업공간 경로가 올바르지 않습니다.".into()); }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if !flow_storage::valid_id(&flow_id) { return Err("플로우 ID가 올바르지 않습니다.".into()); }
    let mut directory = storage_root(&root, standalone)?;
    if !directory.join("flows").join(&flow_id).join("flow.json").is_file() {
        return Err("플로우가 이동되거나 삭제되었습니다. 다시 여세요.".into());
    }
    for part in ["flows", &flow_id, "ai"] {
        directory.push(part);
        flow_storage::reject_links(&directory)?;
        fs::create_dir_all(&directory).map_err(|e| format!("요약 폴더 생성 실패: {e}"))?;
        if !directory.canonicalize().map_err(|e| e.to_string())?.starts_with(&root) {
            return Err("요약 폴더가 작업공간 밖을 가리킵니다.".into());
        }
    }
    std::process::Command::new("explorer.exe").arg(directory).spawn()
        .map_err(|e| io_error("요약 폴더 열기 실패", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(preferences::WindowCache::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) { preferences::debug_window_event(window, event); }
            if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::CloseRequested { .. }) { preferences::track(window); }
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) { preferences::save_editor_on_close(window); }
            if matches!(event, tauri::WindowEvent::Destroyed) { preferences::forget_window(window); }
        })
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            independent_workspace_root,
            move_flow,
            resolve_workspace_root,
            save_workspace_snapshot,
            migrate_workspace,
            save_ui_preferences,
            load_ui_preferences,
            restore_editor_preferences,
            recent_workspaces,
            workspace_session,
            summary::has_openrouter_api_key,
            summary::delete_openrouter_api_key,
            summary::save_openrouter_api_key,
            summary::summarize_flow,
            summary::load_flow_summary,
            open_codex,
            open_code,
            open_summary_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_identity_resolves_aliases_without_creating_missing_folders() {
        let temp = Temp::new();
        let root = temp.0.join("Workspace");
        fs::create_dir(&root).unwrap();
        let canonical = resolve_workspace_root(root.to_string_lossy().into()).unwrap();
        assert_eq!(resolve_workspace_root(root.join(".").to_string_lossy().into()).unwrap(), canonical);
        #[cfg(windows)]
        assert_eq!(resolve_workspace_root(root.to_string_lossy().to_lowercase()).unwrap(), canonical);
        let missing = root.join("missing");
        assert!(resolve_workspace_root(missing.to_string_lossy().into()).is_err());
        assert!(!missing.exists());
        assert!(resolve_workspace_root("relative".into()).is_err());
    }
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
    pub(super) struct Temp(pub(super) PathBuf);
    impl Temp {
        pub(super) fn new() -> Self {
            static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "memo-graph-test-{}-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
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
        migrate_workspace(temp.0.to_string_lossy().into(), snapshot(), None).unwrap();
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
    pub(super) fn nested_snapshot() -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            block_files: vec![StorageFile { relative_path:"flows/F/blocks/2026/10/A.md".into(), content:"serialized markdown".into() }],
            flow_files:vec![
                StorageFile { relative_path:"flows/F/flow.json".into(), content:r#"{"version":2,"id":"F","title":"Flow","blocks":["A"],"links":[]}"#.into() },
                StorageFile { relative_path:"flows/F/layout.json".into(), content:r#"{"version":2,"nodePositionsByFlow":{"F":{"A":{"x":42,"y":17,"width":390,"height":180}}},"viewportByFlow":{"F":{"scrollLeft":3,"scrollTop":4,"zoom":0.7}}}"#.into() }
            ],
            workspace:r#"{"version":1,"activeFlowId":"F"}"#.into(),
            layout:r#"{"version":2,"nodePositionsByFlow":{"F":{"A":{"x":0,"y":0}}},"viewportByFlow":{}}"#.into(),
        }
    }
    #[test]
    fn nested_migration_preserves_raw_markdown_summary_and_backup() {
        let temp = Temp::new(); let memo = ensure_memo(&temp.0).unwrap();
        write_atomic(&memo.join("blocks/A.md"), "raw metadata\r\n\r\nbody").unwrap();
        write_atomic(&memo.join("flows/F.json"), r#"{"version":1,"root":{}}"#).unwrap();
        write_atomic(&memo.join("ai/summaries/F.md"), "old summary").unwrap();
        migrate_workspace(temp.0.to_string_lossy().into(), nested_snapshot(), None).unwrap();
        let backup = fs::read_dir(memo.join("backups")).unwrap().next().unwrap().unwrap().path();
        assert_eq!(fs::read_to_string(backup.join("blocks/A.md")).unwrap(), "raw metadata\r\n\r\nbody");
        assert_eq!(fs::read_to_string(memo.join("flows/F/blocks/2026/10/A.md")).unwrap(), "raw metadata\r\n\r\nbody");
        assert_eq!(fs::read_to_string(memo.join("flows/F/ai/summary.md")).unwrap(), "old summary");
        let loaded = load_storage(&temp.0, &memo, None).unwrap();
        assert_eq!(loaded.flow_files.len(), 1); assert_eq!(loaded.block_files.len(), 1);
        let layout:serde_json::Value = serde_json::from_str(&loaded.layout.unwrap()).unwrap();
        assert_eq!(layout["nodePositionsByFlow"]["F"]["A"]["x"], 42);
        assert!(!memo.join("flows/F.json").exists());
    }
    #[test]
    fn legacy_workspace_without_layout_remains_importable() {
        let temp = Temp::new(); let memo = ensure_memo(&temp.0).unwrap();
        write_atomic(&memo.join("flows/F.json"), r#"{"version":1,"id":"F","title":"Flow","root":{}}"#).unwrap();
        let loaded = load_storage(&temp.0, &memo, None).unwrap();
        assert!(loaded.layout.is_none()); assert_eq!(loaded.flow_files.len(), 1);
    }
    #[test]
    fn migrated_flow_round_trips_native_storage_with_layout_summary_and_other_flow() {
        let temp = Temp::new(); let workspace = temp.0.join("workspace"); let independent = temp.0.join("independent");
        fs::create_dir_all(&workspace).unwrap(); fs::create_dir_all(&independent).unwrap();
        let memo = ensure_memo(&workspace).unwrap();
        write_atomic(&memo.join("blocks/A.md"), "A raw bytes\r\nbody").unwrap();
        write_atomic(&memo.join("blocks/B.md"), "B raw bytes\r\nbody").unwrap();
        write_atomic(&memo.join("flows/F.json"), r#"{"version":1,"id":"F","title":"Flow","root":{}}"#).unwrap();
        write_atomic(&memo.join("flows/G.json"), r#"{"version":1,"id":"G","title":"Other","root":{}}"#).unwrap();
        write_atomic(&memo.join("ai/summaries/F.md"), "legacy summary").unwrap();
        let mut migrated = nested_snapshot();
        migrated.block_files.push(StorageFile { relative_path:"flows/G/blocks/2026/10/B.md".into(), content:"generated B".into() });
        migrated.flow_files.push(StorageFile { relative_path:"flows/G/flow.json".into(), content:r#"{"version":2,"id":"G","title":"Other","blocks":["B"],"links":[]}"#.into() });
        migrated.flow_files.push(StorageFile { relative_path:"flows/G/layout.json".into(), content:r#"{"version":2,"nodePositionsByFlow":{"G":{"B":{"x":99,"y":88}}},"viewportByFlow":{}}"#.into() });
        migrate_workspace(workspace.to_string_lossy().into(), migrated, None).unwrap();
        write_atomic(&memo.join("flows/F/ai/cache.json"), r#"{"cached":"preserved"}"#).unwrap();
        let before = open_workspace(workspace.to_string_lossy().into(), None).unwrap();
        assert_eq!(before.flow_files.len(), 2);
        move_flow(workspace.to_string_lossy().into(), independent.to_string_lossy().into(), "F".into(), None, Some(true)).unwrap();
        let target = open_workspace(independent.to_string_lossy().into(), Some(true)).unwrap();
        let source = open_workspace(workspace.to_string_lossy().into(), None).unwrap();
        assert_eq!(source.flow_files.len(), 1); assert_eq!(source.flow_files[0].relative_path, "flows/G/flow.json");
        assert_eq!(source.block_files[0].content, "B raw bytes\r\nbody");
        assert_eq!(target.block_files[0].content, "A raw bytes\r\nbody"); assert_eq!(target.flow_files.len(), 1);
        let target_layout:serde_json::Value = serde_json::from_str(&target.layout.unwrap()).unwrap();
        assert_eq!(target_layout["nodePositionsByFlow"]["F"]["A"], serde_json::json!({"x":42,"y":17,"width":390,"height":180}));
        assert_eq!(target_layout["viewportByFlow"]["F"], serde_json::json!({"scrollLeft":3,"scrollTop":4,"zoom":0.7}));
        assert_eq!(fs::read_to_string(independent.join("flows/F/ai/summary.md")).unwrap(), "legacy summary");
        assert_eq!(fs::read_to_string(independent.join("flows/F/ai/cache.json")).unwrap(), r#"{"cached":"preserved"}"#);
        move_flow(independent.to_string_lossy().into(), workspace.to_string_lossy().into(), "F".into(), Some(true), None).unwrap();
        let returned = open_workspace(workspace.to_string_lossy().into(), None).unwrap();
        assert_eq!(returned.flow_files.len(), 2); assert_eq!(returned.block_files.len(), 2);
        assert_eq!(fs::read(memo.join("flows/F/blocks/2026/10/A.md")).unwrap(), b"A raw bytes\r\nbody");
    }
    #[test]
    fn nested_save_preserves_owned_extras_and_deletes_removed_flow_completely() {
        let temp = Temp::new(); let memo = ensure_memo(&temp.0).unwrap();
        commit(&memo, nested_snapshot(), None).unwrap();
        write_atomic(&memo.join("flows/F/ai/summary.md"), "summary").unwrap();
        fs::write(memo.join("flows/F/attachment.bin"), [0,255]).unwrap();
        commit(&memo, nested_snapshot(), None).unwrap();
        assert_eq!(fs::read(memo.join("flows/F/attachment.bin")).unwrap(), [0,255]);
        let mut empty = nested_snapshot(); empty.flow_files.clear(); empty.block_files.clear();
        commit(&memo, empty, None).unwrap();
        assert!(!memo.join("flows/F").exists());
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
