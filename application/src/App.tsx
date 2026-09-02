import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import {
  BlockId,
  BranchId,
  CommandResult,
  WorkspaceState,
  createBlockAfter,
  createBranchWithBlock,
  createFlow,
  createWorkspace,
  deleteBlockSubtree,
  moveBlock,
  moveBlockByOffset,
  renameFlow,
  updateBlock,
  validateWorkspace,
} from "./domain/flow";
import { FlowCanvas } from "./components/FlowCanvas";
import { NodeEditor } from "./components/NodeEditor";
import { Sidebar } from "./components/Sidebar";
import {
  NodePositionsByFlow,
  chooseNativeWorkspace,
  isDesktopRuntime,
  openNativeWorkspace,
  saveNativeWorkspace,
} from "./storage/repository";
import { clampSidebarWidth } from "./sidebarWidth";
import "./App.css";

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createWorkspace());
  const [message, setMessage] = useState("새 Flow를 만들어 구조를 시작하세요.");
  const [editingBlockId, setEditingBlockId] = useState<BlockId>();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [nodePositionsByFlow, setNodePositionsByFlow] = useState<NodePositionsByFlow>({});
  const [selectedBlockIds, setSelectedBlockIds] = useState<BlockId[]>([]);
  const [workspaceRoot, setWorkspaceRoot] = useState<string>();
  const [storageState, setStorageState] = useState<"checking" | "needs-workspace" | "loading" | "ready" | "saving" | "error">("checking");
  const [storageError, setStorageError] = useState<string>();
  const [sidebarWidth, setSidebarWidth] = useState(292);
  const hydratedRef = useRef(false);
  const saveSequenceRef = useRef(Promise.resolve());
  const sidebarResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | undefined>(undefined);

  const activeFlow = workspace.activeFlowId ? workspace.flows.get(workspace.activeFlowId) : undefined;
  const editingBlock = editingBlockId ? workspace.blocks.get(editingBlockId) : undefined;
  const validationErrors = useMemo(() => validateWorkspace(workspace), [workspace]);

  const openWorkspace = async (path: string) => {
    setStorageState("loading");
    setStorageError(undefined);
    hydratedRef.current = false;
    try {
      const loaded = await openNativeWorkspace(path.trim());
      setWorkspace(loaded.workspace);
      setNodePositionsByFlow(loaded.nodePositionsByFlow);
      setSelectedBlockIds([]);
      setWorkspaceRoot(loaded.workspaceRoot);
      setEditingBlockId(undefined);
      setIsEditorOpen(false);
      setMessage(loaded.recoveryNotice ?? "작업공간을 열었습니다.");
      setStorageState("ready");
      hydratedRef.current = true;
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "작업공간을 열 수 없습니다.");
      setStorageState("error");
    }
  };

  const chooseWorkspace = async () => {
    setStorageError(undefined);
    try {
      const selected = await chooseNativeWorkspace();
      if (!selected) return;
    
      await openWorkspace(selected);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "폴더 선택 창을 열 수 없습니다.");
      setStorageState("error");
    }
  };

  const returnToWorkspaceSelection = () => {
    setStorageError(undefined);
    setStorageState("needs-workspace");
  };

  const startSidebarResize = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarResizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth };
  };

  const resizeSidebar = (event: PointerEvent<HTMLDivElement>) => {
    const resize = sidebarResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setSidebarWidth(clampSidebarWidth(resize.startWidth + event.clientX - resize.startX));
  };

  const finishSidebarResize = (event: PointerEvent<HTMLDivElement>) => {
    if (sidebarResizeRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    sidebarResizeRef.current = undefined;
  };

  const resizeSidebarWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const offset = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
    if (!offset) return;
    event.preventDefault();
    setSidebarWidth((current) => clampSidebarWidth(current + offset));
  };

  const retrySave = async () => {
    if (!workspaceRoot) return;
    setStorageState("saving");
    try {
      await saveNativeWorkspace(workspaceRoot, workspace, nodePositionsByFlow);
      setStorageState("ready");
      setStorageError(undefined);
      setMessage("저장 완료");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "저장하지 못했습니다.");
      setStorageState("error");
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!isDesktopRuntime()) {
      hydratedRef.current = true;
      setStorageState("ready");
      return () => { cancelled = true; };
    }
    if (!cancelled) setStorageState("needs-workspace");
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!workspaceRoot || !hydratedRef.current || !isDesktopRuntime()) return;
    const timer = window.setTimeout(() => {
      setStorageState("saving");
      saveSequenceRef.current = saveSequenceRef.current
        .catch(() => undefined)
        .then(() => saveNativeWorkspace(workspaceRoot, workspace, nodePositionsByFlow))
        .then(() => {
          setStorageState("ready");
          setStorageError(undefined);
        })
        .catch((error) => {
          setStorageError(error instanceof Error ? error.message : "저장하지 못했습니다.");
          setStorageState("error");
        });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [workspace, workspaceRoot, nodePositionsByFlow]);

  const runCommand = <T extends CommandResult>(label: string, operation: (current: WorkspaceState) => T): T | undefined => {
    try {
      const result = operation(workspace);
      setWorkspace(result.workspace);
      setMessage(`${label} 완료`);
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "작업을 완료하지 못했습니다.");
      return undefined;
    }
  };

  const openBlockEditor = (blockId: BlockId, source = workspace) => {
    const block = source.blocks.get(blockId);
    if (!block) return;
    setWorkspace((current) => ({ ...current, selectedBlockId: blockId }));
    setSelectedBlockIds([blockId]);
    setIsEditorOpen(true);
    setEditingBlockId(blockId);
    setDraftTitle(block.title ?? "");
    setDraftMarkdown(block.markdown);
  };

  const addAfter = (blockId?: BlockId) => {
    console.log("addAfter called with blockId:", blockId);
    if (!activeFlow) return;
    const result = runCommand("다음 노드 추가", (current) => createBlockAfter(current, activeFlow.id, blockId));
    if (result && "blockId" in result && blockId) {
      const sourcePosition = nodePositionsByFlow[activeFlow.id]?.[blockId];
      if (sourcePosition) {
        setNodePositionsByFlow((current) => ({
          ...current,
          [activeFlow.id]: { ...current[activeFlow.id], [result.blockId]: sourcePosition },
        }));
      }
    }
  };

  const createBranch = (blockId: BlockId) => {
    if (!activeFlow) return;
    const result = runCommand("갈래 생성", (current) => createBranchWithBlock(current, activeFlow.id, blockId));
    if (result && "blockId" in result) {
      const sourcePosition = nodePositionsByFlow[activeFlow.id]?.[blockId];
      if (sourcePosition) {
        setNodePositionsByFlow((current) => ({
          ...current,
          [activeFlow.id]: { ...current[activeFlow.id], [result.blockId]: sourcePosition },
        }));
      }
    }
  };

  const renameBlockTitle = (blockId: BlockId, title: string) => {
    runCommand("노드 제목 변경", (current) => {
      const block = current.blocks.get(blockId);
      return updateBlock(current, blockId, { title, markdown: block?.markdown ?? "" });
    });
    if (editingBlockId === blockId) setDraftTitle(title);
  };

  const saveBlock = (blockId: BlockId, title: string, markdown: string) => {
    runCommand("노드 내용 저장", (current) => updateBlock(current, blockId, { title, markdown }));
  };

  const moveBlockToBranch = (blockId: BlockId, targetBranchId: BranchId) => {
    if (!activeFlow) return;
    runCommand("노드 이동", (current) => {
      const targetBranch = current.flows.get(activeFlow.id)?.branches.get(targetBranchId);
      return moveBlock(current, activeFlow.id, blockId, targetBranchId, targetBranch?.itemIds.length ?? 0);
    });
  };

  const deleteBlock = (blockId: BlockId) => {
    if (!activeFlow) return;
    runCommand("노드 흐름 삭제", (current) => deleteBlockSubtree(current, activeFlow.id, blockId));
    setEditingBlockId(undefined);
    setSelectedBlockIds([]);
  };

  if (storageState === "checking" || storageState === "loading") {
    return <main className="workspace-setup"><p className="eyebrow">FLOW MEMO</p><h2>작업공간을 여는 중입니다.</h2><p>저장된 Flow와 Block을 안전하게 불러오고 있습니다.</p></main>;
  }

  if (storageState === "needs-workspace" || (!workspaceRoot && storageState === "error")) {
    return (
      <main className="workspace-setup">
        <p className="eyebrow">FLOW MEMO · LOCAL FILES</p>
        <h2>생각을 저장할 폴더를 선택하세요.</h2>
        <p>선택한 폴더 안에 <code>.memo</code> 작업공간을 만들고, Block과 Flow를 파일로 저장합니다.</p>
        <button className="button button-primary workspace-picker-button" type="button" onClick={() => void chooseWorkspace()}>폴더 선택</button>
        {storageError && <p className="storage-error" role="alert">{storageError}</p>}
        <p className="workspace-setup-note">브라우저 개발 모드에서는 기존처럼 메모리에서만 동작합니다.</p>
      </main>
    );
  }

  const storageBadge = !isDesktopRuntime()
    ? "IN MEMORY · 저장되지 않음"
    : storageState === "saving"
      ? "저장 중"
      : storageState === "error"
        ? "저장 실패"
        : "저장됨";

  return (
    <main className="app-shell" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <Sidebar
        flows={[...workspace.flows.values()]}
        activeFlowId={activeFlow?.id}
        validationErrors={validationErrors}
        workspaceRoot={workspaceRoot}
        onCreateFlow={(title) => runCommand("Flow 생성", (current) => createFlow(current, title))}
        onSelectFlow={(flowId) => {
          const flow = workspace.flows.get(flowId);
          setWorkspace({ ...workspace, activeFlowId: flowId, selectedBlockId: undefined });
          setSelectedBlockIds([]);
          setEditingBlockId(undefined);
          setMessage(`${flow?.title ?? "Flow"} 열기`);
        }}
        onReturnToWorkspaceSelection={returnToWorkspaceSelection}
        onChooseWorkspace={chooseWorkspace}
      />
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="사이드바 너비 조절"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={startSidebarResize}
        onPointerMove={resizeSidebar}
        onPointerUp={finishSidebarResize}
        onPointerCancel={finishSidebarResize}
        onKeyDown={resizeSidebarWithKeyboard}
      />
      <section className="workspace">
        {activeFlow ? (
          <>
            <header className="workspace-header">
              <div>
                <p className="eyebrow">HORIZONTAL FLOW MAP</p>
                <input className="flow-title-input" value={activeFlow.title} onChange={(event) => runCommand("Flow 이름 변경", (current) => renameFlow(current, activeFlow.id, event.currentTarget.value))} aria-label="Flow 이름" />
              </div>
              <div className="workspace-header-actions">
                <button className="button button-quiet editor-toggle" type="button" onClick={() => setIsEditorOpen((current) => !current)}>{isEditorOpen ? "편집 창 닫기" : "편집 창 열기"}</button>
                <div className={`runtime-badge ${storageState === "error" ? "has-error" : ""}`}>{storageBadge}</div>
              </div>
            </header>
            <div className="command-status" role="status">{message}</div>
            {storageError && <div className="storage-error" role="alert">{storageError} <button className="storage-retry" type="button" onClick={() => void retrySave()}>다시 시도</button></div>}
            <div className={`flow-work-area ${isEditorOpen ? "has-editor" : ""}`}>
              <FlowCanvas
                workspace={workspace}
                flow={activeFlow}
                onOpenBlock={openBlockEditor}
                onRenameBlock={renameBlockTitle}
                nodePositions={nodePositionsByFlow[activeFlow.id] ?? {}}
                selectedBlockIds={selectedBlockIds}
                onSelectedBlockIdsChange={setSelectedBlockIds}
                onNodePositionsChange={(positions) => setNodePositionsByFlow((current) => ({ ...current, [activeFlow.id]: { ...current[activeFlow.id], ...positions } }))}
                onAddAfter={addAfter}
                onCreateBranch={createBranch}
              />
              {isEditorOpen && (
                <NodeEditor
                  key={editingBlockId ?? "empty"}
                  flow={activeFlow}
                  block={editingBlock}
                  draftTitle={draftTitle}
                  draftMarkdown={draftMarkdown}
                  onClose={() => setIsEditorOpen(false)}
                  onDraftTitleChange={setDraftTitle}
                  onDraftMarkdownChange={setDraftMarkdown}
                  onSave={saveBlock}
                  onAddAfter={addAfter}
                  onCreateBranch={createBranch}
                  onMoveByOffset={(blockId, offset) => runCommand(offset < 0 ? "노드 앞으로 이동" : "노드 뒤로 이동", (current) => moveBlockByOffset(current, activeFlow.id, blockId, offset))}
                  onMove={moveBlockToBranch}
                  onDelete={deleteBlock}
                />
              )}
            </div>
          </>
        ) : (
          <section className="empty-workspace"><p className="eyebrow">FLOW MEMO</p><h2>생각이 시작되는 흐름을 만드세요.</h2><p>Flow 하나를 만든 뒤, 노드를 오른쪽으로 이어 쓰고 필요한 곳에서 갈래를 만들어 보세요.</p></section>
        )}
      </section>
    </main>
  );
}

export default App;
