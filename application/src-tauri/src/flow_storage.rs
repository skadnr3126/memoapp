use super::{io_error, write_atomic};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::{Path, PathBuf}};

pub fn reject_links(path: &Path) -> Result<(), String> {
    let mut cursor = PathBuf::new();
    for part in path.components() {
        cursor.push(part);
        if let Ok(metadata) = fs::symlink_metadata(&cursor) {
            let linked = metadata.file_type().is_symlink();
            #[cfg(windows)]
            let linked = {
                use std::os::windows::fs::MetadataExt;
                linked || metadata.file_attributes() & 0x400 != 0
            };
            if linked { return Err("저장 경로의 심볼릭 링크와 연결 폴더는 지원하지 않습니다.".into()); }
        }
    }
    Ok(())
}

pub fn ensure_root(root: &Path, standalone: bool) -> Result<PathBuf, String> {
    let storage = if standalone { root.to_path_buf() } else { root.join(".memo") };
    reject_links(&storage)?;
    if storage.is_symlink() { return Err("저장 폴더의 심볼릭 링크는 지원하지 않습니다.".into()); }
    for name in ["blocks", "flows", "operations"] {
        let path = storage.join(name);
        if path.is_symlink() { return Err("저장 폴더의 심볼릭 링크는 지원하지 않습니다.".into()); }
        fs::create_dir_all(path).map_err(|e| io_error("폴더 생성 실패", e))?;
    }
    storage.canonicalize().map_err(|e| io_error("저장 경로 확인 실패", e))
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn flow_blocks(path: &Path, expected_id: &str) -> Result<HashSet<String>, String> {
    reject_links(path)?;
    let flow: serde_json::Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if flow["version"] != 2 || flow["id"].as_str() != Some(expected_id) || !flow["title"].is_string() {
        return Err("이동할 플로우의 형식이 올바르지 않습니다. 먼저 플로우를 열어 이전하세요.".into());
    }
    let mut blocks = HashSet::new();
    for block in flow["blocks"].as_array().ok_or("플로우 블록 목록이 없습니다.")? {
        let id = block.as_str().ok_or("블록 ID가 올바르지 않습니다.")?;
        if !valid_id(id) || !blocks.insert(id.to_owned()) { return Err("플로우의 블록 ID가 잘못되거나 중복되었습니다.".into()); }
    }
    let mut links = HashSet::new(); let mut pairs = HashSet::new();
    for link in flow["links"].as_array().ok_or("플로우 연결 목록이 없습니다.")? {
        let id = link["id"].as_str().ok_or("연결 ID가 없습니다.")?;
        let a = link["source"].as_str().ok_or("연결 시작점이 없습니다.")?;
        let b = link["target"].as_str().ok_or("연결 끝점이 없습니다.")?;
        let pair = if a < b { (a,b) } else { (b,a) };
        if id.is_empty() || !links.insert(id) || !blocks.contains(a) || !blocks.contains(b) || a == b || !pairs.insert(pair) {
            return Err("플로우 연결이 잘못되거나 중복되었습니다.".into());
        }
    }
    Ok(blocks)
}

fn validate_transfer(source: &Path, target: &Path, id: &str) -> Result<(), String> {
    let blocks = flow_blocks(&source.join("flows").join(id).join("flow.json"), id)?;
    let files = super::read_files(&source.join("flows").join(id).join("blocks"), source, "md")?;
    let mut stored = HashSet::new();
    for file in files {
        let filename = Path::new(&file.relative_path).file_stem().and_then(|v| v.to_str()).ok_or("블록 파일명 오류")?.to_owned();
        if !stored.insert(filename) { return Err("플로우 안에 중복된 블록 파일이 있습니다.".into()); }
    }
    if stored != blocks { return Err("플로우 블록 목록과 저장된 데이터가 일치하지 않습니다.".into()); }
    for entry in fs::read_dir(target.join("flows")).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        reject_links(&entry.path())?;
        let path = entry.path();
        let (path, other_id) = if path.is_dir() && path.join("flow.json").is_file() {
            (path.join("flow.json"), entry.file_name().to_string_lossy().into_owned())
        } else if path.is_file() && path.extension().and_then(|v| v.to_str()) == Some("json") {
            (path.clone(), path.file_stem().and_then(|v| v.to_str()).unwrap_or("").to_owned())
        } else { continue; };
        let other = flow_blocks(&path, &other_id)?;
        if !blocks.is_disjoint(&other) { return Err("대상 작업공간에 동일한 ID의 블록이 있습니다. 이동을 취소했습니다.".into()); }
    }
    Ok(())
}

pub fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    reject_links(source)?; reject_links(target)?;
    if source.is_symlink() || target.is_symlink() { return Err("플로우 안의 심볼릭 링크는 지원하지 않습니다.".into()); }
    fs::create_dir_all(target).map_err(|e| io_error("복사 폴더 생성 실패", e))?;
    for entry in fs::read_dir(source).map_err(|e| io_error("플로우 읽기 실패", e))? {
        let entry = entry.map_err(|e| io_error("플로우 읽기 실패", e))?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let destination = target.join(entry.file_name());
        if kind.is_symlink() || destination.is_symlink() { return Err("플로우 안의 심볼릭 링크는 지원하지 않습니다.".into()); }
        if kind.is_dir() { copy_tree(&entry.path(), &destination)?; }
        else if kind.is_file() {
            fs::copy(entry.path(), &destination).map_err(|e| io_error("플로우 복사 실패", e))?;
            fs::OpenOptions::new().write(true).open(&destination).and_then(|f| f.sync_all()).map_err(|e| io_error("복사 저장 실패", e))?;
        } else { return Err("지원하지 않는 플로우 파일입니다.".into()); }
    }
    Ok(())
}

fn verify_tree(source: &Path, target: &Path) -> Result<(), String> {
    reject_links(source)?; reject_links(target)?;
    if source.is_symlink() || target.is_symlink() { return Err("플로우 안의 심볼릭 링크는 지원하지 않습니다.".into()); }
    let mut names = fs::read_dir(source).map_err(|e| e.to_string())?
        .map(|e| e.map(|e| e.file_name())).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let mut other = fs::read_dir(target).map_err(|e| e.to_string())?
        .map(|e| e.map(|e| e.file_name())).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    names.sort(); other.sort();
    if names != other { return Err("플로우 복사 파일 목록이 일치하지 않습니다.".into()); }
    for name in names {
        let a = source.join(&name); let b = target.join(&name);
        if a.is_symlink() || b.is_symlink() { return Err("플로우 안의 심볼릭 링크는 지원하지 않습니다.".into()); }
        if a.is_dir() && b.is_dir() { verify_tree(&a, &b)?; }
        else if a.is_file() && b.is_file() && fs::read(&a).map_err(|e| e.to_string())? == fs::read(&b).map_err(|e| e.to_string())? { }
        else { return Err("플로우 복사 내용이 일치하지 않습니다.".into()); }
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
struct FileFingerprint { path: PathBuf, length: u64, checksum: u64 }

fn fingerprint(root: &Path) -> Result<Vec<FileFingerprint>, String> {
    fn visit(root: &Path, directory: &Path, files: &mut Vec<FileFingerprint>) -> Result<(), String> {
        reject_links(directory)?;
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            reject_links(&path)?;
            if path.is_dir() { visit(root, &path, files)?; }
            else {
                let bytes = fs::read(&path).map_err(|e| e.to_string())?;
                let checksum = bytes.iter().fold(0xcbf29ce484222325u64, |sum, byte| (sum ^ u64::from(*byte)).wrapping_mul(0x100000001b3));
                files.push(FileFingerprint { path:path.strip_prefix(root).map_err(|e| e.to_string())?.into(), length:bytes.len() as u64, checksum });
            }
        }
        Ok(())
    }
    let mut files = Vec::new(); visit(root, root, &mut files)?; files.sort_by(|a,b| a.path.cmp(&b.path)); Ok(files)
}

#[derive(Clone, Serialize, Deserialize)]
struct MoveOperation {
    version: u32,
    source: PathBuf,
    target: PathBuf,
    flow_id: String,
    published: bool,
    files: Vec<FileFingerprint>,
}

impl MoveOperation {
    fn journal(&self, root: &Path) -> PathBuf { root.join("operations").join(format!("move-{}.json", self.flow_id)) }
    fn stage(&self) -> PathBuf { self.target.join("operations").join(format!("move-{}-stage", self.flow_id)) }
    fn source_flow(&self) -> PathBuf { self.source.join("flows").join(&self.flow_id) }
    fn target_flow(&self) -> PathBuf { self.target.join("flows").join(&self.flow_id) }
    fn record(&self) -> Result<(), String> {
        let json = serde_json::to_string(self).map_err(|e| e.to_string())?;
        write_atomic(&self.journal(&self.source), &json)?;
        write_atomic(&self.journal(&self.target), &json)
    }
}

fn update_metadata(root: &Path, flow_id: &str, target: bool) -> Result<(), String> {
    let path = root.join("workspace.json");
    let mut metadata: serde_json::Value = if path.exists() {
        serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?
    } else { serde_json::json!({"version":1}) };
    if target { metadata["activeFlowId"] = flow_id.into(); }
    else if metadata.get("activeFlowId").and_then(|v| v.as_str()) == Some(flow_id) {
        metadata.as_object_mut().ok_or("작업공간 정보가 올바르지 않습니다.")?.remove("activeFlowId");
    }
    write_atomic(&path, &serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?)?;
    let path = root.join("layout.json");
    if path.exists() {
        let mut layout: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        for name in ["nodePositionsByFlow", "viewportByFlow"] {
            if let Some(map) = layout.get_mut(name).and_then(|v| v.as_object_mut()) { map.remove(flow_id); }
        }
        write_atomic(&path, &serde_json::to_string_pretty(&layout).map_err(|e| e.to_string())?)?;
    }
    Ok(())
}

fn finish(mut operation: MoveOperation) -> Result<(), String> {
    if operation.version != 1 || !valid_id(&operation.flow_id) || !operation.source.is_absolute() || !operation.target.is_absolute() || operation.source == operation.target {
        return Err("잘못된 플로우 이동 복구 기록입니다.".into());
    }
    reject_links(&operation.source_flow())?; reject_links(&operation.target_flow())?; reject_links(&operation.stage())?;
    if !operation.published {
        if operation.target_flow().exists() {
            if operation.stage().exists() { return Err("대상에 같은 ID의 플로우가 있습니다. 덮어쓸 수 없습니다.".into()); }
            verify_tree(&operation.source_flow(), &operation.target_flow())?;
        } else {
            if operation.stage().exists() { fs::remove_dir_all(operation.stage()).map_err(|e| e.to_string())?; }
            copy_tree(&operation.source_flow(), &operation.stage())?;
            verify_tree(&operation.source_flow(), &operation.stage())?;
            fs::rename(operation.stage(), operation.target_flow()).map_err(|e| io_error("플로우 게시 실패", e))?;
        }
        operation.published = true;
        operation.record()?;
    }
    if !operation.target_flow().join("flow.json").is_file() { return Err("이동된 플로우 데이터가 없습니다. 원본을 유지합니다.".into()); }
    let target_files = fingerprint(&operation.target_flow())?;
    if target_files.len() != operation.files.len() || target_files.iter().zip(&operation.files).any(|(a,b)| a.path != b.path || a.length != b.length || a.checksum != b.checksum) {
        return Err("이동된 플로우 검증에 실패했습니다. 원본과 복구 기록을 유지합니다.".into());
    }
    update_metadata(&operation.source, &operation.flow_id, false)?;
    update_metadata(&operation.target, &operation.flow_id, true)?;
    if operation.source_flow().exists() {
        if operation.source_flow().is_symlink() { return Err("원본 플로우의 심볼릭 링크는 지원하지 않습니다.".into()); }
        fs::remove_dir_all(operation.source_flow()).map_err(|e| io_error("플로우 원본 정리 실패", e))?;
    }
    for root in [&operation.target, &operation.source] {
        let path = operation.journal(root);
        if path.exists() { fs::remove_file(path).map_err(|e| io_error("이동 기록 정리 실패", e))?; }
    }
    Ok(())
}

pub fn recover_moves(root: &Path) -> Result<bool, String> {
    let mut recovered = false;
    for entry in fs::read_dir(root.join("operations")).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let name = path.file_name().and_then(|v| v.to_str()).unwrap_or("");
        if name.starts_with("move-") && name.ends_with(".json") {
            let operation: MoveOperation = serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            if root != operation.source && root != operation.target { return Err("이동 기록의 저장 위치가 일치하지 않습니다.".into()); }
            finish(operation)?; recovered = true;
        }
    }
    Ok(recovered)
}

pub fn move_flow(source: &Path, target: &Path, flow_id: &str) -> Result<(), String> {
    if !valid_id(flow_id) { return Err("플로우 ID가 올바르지 않습니다.".into()); }
    if source == target { return Err("같은 저장 위치로 이동할 수 없습니다.".into()); }
    if target.starts_with(source.join("flows").join(flow_id)) || source.starts_with(target.join("flows").join(flow_id)) {
        return Err("플로우 폴더 내부로 이동하거나 내부의 플로우를 이동할 수 없습니다.".into());
    }
    recover_moves(source)?; recover_moves(target)?;
    let source_flow = source.join("flows").join(flow_id);
    let operation = MoveOperation { version: 1, source: source.into(), target: target.into(), flow_id: flow_id.into(), published: false, files: fingerprint(&source_flow)? };
    if !operation.source_flow().join("flow.json").is_file() { return Err("원본 플로우가 없습니다.".into()); }
    if operation.target_flow().exists() { return Err("대상에 같은 ID의 플로우가 있습니다. 덮어쓸 수 없습니다.".into()); }
    validate_transfer(source, target, flow_id)?;
    operation.record()?;
    finish(operation)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn roots() -> (super::super::tests::Temp, PathBuf, PathBuf) {
        let temp = super::super::tests::Temp::new();
        let a = ensure_root(&temp.0.join("independent"), true).unwrap();
        let b = ensure_root(&temp.0.join("workspace"), false).unwrap();
        (temp, a, b)
    }
    fn populate(root: &Path) {
        write_atomic(&root.join("flows/F/flow.json"), r#"{"id":"F","title":"Flow","version":2,"blocks":["A"],"links":[]}"#).unwrap();
        write_atomic(&root.join("flows/F/blocks/2026/10/A.md"), "original\r\nbody").unwrap();
        write_atomic(&root.join("flows/F/layout.json"), "{\"version\":2}").unwrap();
        write_atomic(&root.join("flows/F/ai/summary.md"), "summary").unwrap();
        fs::write(root.join("flows/F/attachment.bin"), [0, 255, 42]).unwrap();
    }
    #[test]
    fn moves_entire_flow_both_directions_and_rejects_conflicts() {
        let (_temp, a, b) = roots(); populate(&a);
        move_flow(&a, &b, "F").unwrap();
        assert!(!a.join("flows/F").exists());
        assert_eq!(fs::read(b.join("flows/F/attachment.bin")).unwrap(), [0,255,42]);
        assert_eq!(fs::read_to_string(b.join("flows/F/ai/summary.md")).unwrap(), "summary");
        move_flow(&b, &a, "F").unwrap();
        populate(&b);
        assert!(move_flow(&a, &b, "F").is_err());
        assert!(a.join("flows/F/flow.json").exists());
        assert!(b.join("flows/F/flow.json").exists());
        assert!(move_flow(&a, &b, "../F").is_err());
    }
    #[test]
    fn duplicate_block_id_rejects_move_before_any_journal_or_copy() {
        let (_temp, a, b) = roots(); populate(&a);
        write_atomic(&b.join("flows/G/flow.json"), r#"{"id":"G","title":"Other","version":2,"blocks":["A"],"links":[]}"#).unwrap();
        assert!(move_flow(&a, &b, "F").is_err());
        assert!(a.join("flows/F/flow.json").exists()); assert!(!b.join("flows/F").exists());
        assert!(!a.join("operations/move-F.json").exists());
    }
    #[test]
    fn corrupted_published_target_preserves_original_and_journals() {
        let (_temp, a, b) = roots(); populate(&a);
        let op = MoveOperation { version:1, source:a.clone(), target:b.clone(), flow_id:"F".into(), published:true, files:fingerprint(&a.join("flows/F")).unwrap() };
        copy_tree(&op.source_flow(), &op.target_flow()).unwrap(); op.record().unwrap();
        fs::write(op.target_flow().join("attachment.bin"), [1,2,3]).unwrap();
        assert!(recover_moves(&b).is_err());
        assert!(op.source_flow().join("flow.json").exists()); assert!(op.journal(&a).exists());
    }
    #[test]
    fn interrupted_move_recovery_rejects_stale_snapshot_instead_of_recreating_source() {
        let (_temp, a, b) = roots(); populate(&a);
        let op = MoveOperation { version:1, source:a.clone(), target:b.clone(), flow_id:"F".into(), published:false, files:fingerprint(&a.join("flows/F")).unwrap() };
        op.record().unwrap();
        assert!(super::super::save_workspace_snapshot(a.to_string_lossy().into(), super::super::tests::nested_snapshot(), Some(true)).is_err());
        assert!(!a.join("flows/F").exists()); assert!(b.join("flows/F/flow.json").exists());
        assert!(!op.journal(&a).exists());
    }
    #[test]
    fn rejects_move_to_storage_nested_inside_source_flow() {
        let (_temp, a, _b) = roots(); populate(&a);
        let nested = ensure_root(&a.join("flows/F/nested"), false).unwrap();
        assert!(move_flow(&a, &nested, "F").is_err());
        assert!(a.join("flows/F/flow.json").exists());
        assert!(!a.join("operations/move-F.json").exists());
    }
    #[test]
    fn recovers_prepared_copied_published_and_cleanup_phases() {
        for phase in 0..4 {
            let (_temp, a, b) = roots(); populate(&a);
            let mut op = MoveOperation { version:1, source:a.clone(), target:b.clone(), flow_id:"F".into(), published:false, files:fingerprint(&a.join("flows/F")).unwrap() };
            op.record().unwrap();
            if phase > 0 { copy_tree(&op.source_flow(), &op.stage()).unwrap(); }
            if phase > 1 { fs::rename(op.stage(), op.target_flow()).unwrap(); }
            if phase > 2 { op.published = true; op.record().unwrap(); fs::remove_file(op.source_flow().join("attachment.bin")).unwrap(); }
            assert!(recover_moves(&b).unwrap());
            assert!(!a.join("flows/F").exists());
            assert_eq!(fs::read(b.join("flows/F/attachment.bin")).unwrap(), [0,255,42]);
            assert!(!recover_moves(&a).unwrap());
        }
    }
}
