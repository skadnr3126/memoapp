use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

const MEMO_DIRECTORY: &str = ".memo";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageFile {
    relative_path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
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

fn io_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}

fn canonical_workspace_root(path: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(path);
    if !requested.is_absolute() {
        return Err("작업공간 경로는 절대 경로여야 합니다.".into());
    }
    fs::create_dir_all(&requested).map_err(|error| io_error("작업공간 폴더를 만들 수 없습니다", error))?;
    requested
        .canonicalize()
        .map_err(|error| io_error("작업공간 경로를 확인할 수 없습니다", error))
}

fn memo_path(root: &Path) -> PathBuf {
    root.join(MEMO_DIRECTORY)
}

fn ensure_memo_directories(root: &Path) -> Result<PathBuf, String> {
    let memo = memo_path(root);
    for directory in [memo.join("blocks"), memo.join("flows"), memo.join("operations")] {
        fs::create_dir_all(directory).map_err(|error| io_error("저장 폴더를 만들 수 없습니다", error))?;
    }
    Ok(memo)
}

fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "저장 대상 폴더가 없습니다.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| io_error("저장 폴더를 만들 수 없습니다", error))?;
    let file_name = path.file_name().and_then(|value| value.to_str()).ok_or_else(|| "저장 파일명이 올바르지 않습니다.".to_string())?;
    let temporary = parent.join(format!(".{file_name}.tmp"));
    fs::write(&temporary, content).map_err(|error| io_error("임시 파일을 쓸 수 없습니다", error))?;
    fs::rename(&temporary, path).map_err(|error| io_error("임시 파일을 교체할 수 없습니다", error))
}

fn is_safe_relative_path(path: &str, required_prefix: &str, extension: &str) -> bool {
    let candidate = Path::new(path);
    candidate.starts_with(required_prefix)
        && candidate.extension().and_then(|value| value.to_str()) == Some(extension)
        && candidate.components().all(|component| matches!(component, std::path::Component::Normal(_)))
}

fn validate_storage_file(file: &StorageFile, prefix: &str, extension: &str) -> Result<(), String> {
    if is_safe_relative_path(&file.relative_path, prefix, extension) {
        Ok(())
    } else {
        Err(format!("허용되지 않은 저장 경로입니다: {}", file.relative_path))
    }
}

fn read_files_recursively(directory: &Path, root: &Path) -> Result<Vec<StorageFile>, String> {
    let mut files = Vec::new();
    if !directory.exists() {
        return Ok(files);
    }
    for entry in fs::read_dir(directory).map_err(|error| io_error("저장 파일을 읽을 수 없습니다", error))? {
        let entry = entry.map_err(|error| io_error("저장 파일 항목을 읽을 수 없습니다", error))?;
        let path = entry.path();
        if path.is_dir() {
            files.extend(read_files_recursively(&path, root)?);
        } else if path.is_file() {
            let relative_path = path
                .strip_prefix(root)
                .map_err(|error| io_error("저장 파일 경로를 계산할 수 없습니다", error))?
                .to_string_lossy()
                .replace('\\', "/");
            let content = fs::read_to_string(&path).map_err(|error| io_error("저장 파일 내용을 읽을 수 없습니다", error))?;
            files.push(StorageFile { relative_path, content });
        }
    }
    Ok(files)
}

fn remove_files_not_in(directory: &Path, memo: &Path, expected: &HashSet<String>) -> Result<(), String> {
    for file in read_files_recursively(directory, memo)? {
        if !expected.contains(&file.relative_path) {
            fs::remove_file(memo.join(&file.relative_path))
                .map_err(|error| io_error("더 이상 쓰이지 않는 저장 파일을 제거할 수 없습니다", error))?;
        }
    }
    Ok(())
}

fn active_operation_notice(memo: &Path) -> Result<Option<String>, String> {
    let operations = memo.join("operations");
    let mut leftovers = Vec::new();
    for entry in fs::read_dir(operations).map_err(|error| io_error("복구 기록을 읽을 수 없습니다", error))? {
        let entry = entry.map_err(|error| io_error("복구 기록 항목을 읽을 수 없습니다", error))?;
        if entry.path().is_file() {
            leftovers.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    if leftovers.is_empty() {
        Ok(None)
    } else {
        Ok(Some(format!("완료되지 않은 저장 작업이 있습니다: {}. 원본 파일을 확인한 뒤 저장을 다시 시도하세요.", leftovers.join(", "))))
    }
}

#[tauri::command]
fn open_workspace(workspace_root: String) -> Result<LoadedWorkspace, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let memo = ensure_memo_directories(&root)?;
    let workspace = memo.join("workspace.json");
    let layout = memo.join("layout.json");
    Ok(LoadedWorkspace {
        workspace_root: root.to_string_lossy().to_string(),
        block_files: read_files_recursively(&memo.join("blocks"), &memo)?,
        flow_files: read_files_recursively(&memo.join("flows"), &memo)?,
        workspace: workspace.exists().then(|| fs::read_to_string(&workspace)).transpose().map_err(|error| io_error("workspace.json을 읽을 수 없습니다", error))?,
        layout: layout.exists().then(|| fs::read_to_string(&layout)).transpose().map_err(|error| io_error("layout.json을 읽을 수 없습니다", error))?,
        recovery_notice: active_operation_notice(&memo)?,
    })
}

#[tauri::command]
fn save_workspace_snapshot(workspace_root: String, snapshot: WorkspaceSnapshot) -> Result<(), String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let memo = ensure_memo_directories(&root)?;
    snapshot.block_files.iter().try_for_each(|file| validate_storage_file(file, "blocks", "md"))?;
    snapshot.flow_files.iter().try_for_each(|file| validate_storage_file(file, "flows", "json"))?;

    let operation_path = memo.join("operations").join("active-save.json");
    write_atomic(&operation_path, &serde_json::json!({ "version": 1, "kind": "save-workspace", "state": "prepared" }).to_string())?;
    let result = (|| -> Result<(), String> {
        for file in snapshot.block_files.iter().chain(snapshot.flow_files.iter()) {
            write_atomic(&memo.join(&file.relative_path), &file.content)?;
        }
        write_atomic(&memo.join("workspace.json"), &snapshot.workspace)?;
        write_atomic(&memo.join("layout.json"), &snapshot.layout)?;

        let expected_blocks = snapshot.block_files.iter().map(|file| file.relative_path.clone()).collect();
        let expected_flows = snapshot.flow_files.iter().map(|file| file.relative_path.clone()).collect();
        remove_files_not_in(&memo.join("blocks"), &memo, &expected_blocks)?;
        remove_files_not_in(&memo.join("flows"), &memo, &expected_flows)?;
        Ok(())
    })();
    if result.is_ok() {
        fs::remove_file(&operation_path).map_err(|error| io_error("저장 작업 기록을 정리할 수 없습니다", error))?;
    }
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            save_workspace_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
