import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  BlockId,
  CommandResult,
  WorkspaceState,
  createBlockAfter,
  createBranchWithBlock,
  createFlow,
  createWorkspace,
  deleteBlock,
  deleteFlow,
  renameFlow,
  updateBlock,
  validateWorkspace,
} from "./domain/flow";
import { FlowCanvas } from "./components/FlowCanvas";
import { EDITOR_LOAD, EDITOR_READY, EDITOR_SAVE, type EditorSaveRequest, type EditorSession } from "./editorProtocol";
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
  const [nodePositionsByFlow, setNodePositionsByFlow] = useState<NodePositionsByFlow>({});
  const [selectedBlockIds, setSelectedBlockIds] = useState<BlockId[]>([]);
  const [workspaceRoot, setWorkspaceRoot] = useState<string>();
  const [storageState, setStorageState] = useState<"checking" | "needs-workspace" | "loading" | "ready" | "saving" | "error">("checking");
  const [storageError, setStorageError] = useState<string>();
  const [sidebarWidth, setSidebarWidth] = useState(292);
  const hydratedRef = useRef(false);
  const saveSequenceRef = useRef(Promise.resolve());
  const sidebarResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | undefined>(undefined);
  const editorReadyRef = useRef(false);
  const editorOpeningRef = useRef<Promise<void> | undefined>(undefined);
  const editorSessionRef = useRef<EditorSession | undefined>(undefined);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const activeFlow = workspace.activeFlowId ? workspace.flows.get(workspace.activeFlowId) : undefined;
  const validationErrors = useMemo(() => validateWorkspace(workspace), [workspace]);

  const sendEditorSession = async (session: EditorSession) => {
    editorSessionRef.current = session;
    if (!editorReadyRef.current || !isDesktopRuntime()) return;
    await emitTo("editor", EDITOR_LOAD, session);
  };

  const ensureEditorWindow = async () => {
    if (!isDesktopRuntime()) return;
    const existing = await WebviewWindow.getByLabel("editor");
    if (existing) return;
    if (editorOpeningRef.current) return editorOpeningRef.current;

    editorReadyRef.current = false;
    const opening = new Promise<void>((resolve, reject) => {
      const editor = new WebviewWindow("editor", {
        url: "index.html#editor",
        title: "Node Editor",
        width: 720,
        height: 900,
      });
      void editor.once("tauri://created", () => resolve());
      void editor.once("tauri://error", ({ payload }) => reject(payload));
    });
    editorOpeningRef.current = opening;
    try {
      await opening;
    } finally {
      editorOpeningRef.current = undefined;
    }
  };

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
    if (!isDesktopRuntime()) return;

    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen<EditorSaveRequest>(EDITOR_SAVE, ({ payload }) => {
      try {
        const result = updateBlock(workspaceRef.current, payload.blockId, {
          title: payload.title,
          markdown: payload.markdown,
        });
        workspaceRef.current = result.workspace;
        setWorkspace(result.workspace);
        setMessage("노드 내용 저장 완료");
        const block = result.workspace.blocks.get(payload.blockId);
        if (block) {
          void sendEditorSession({
            blockId: block.id,
            title: block.title ?? "",
            markdown: block.markdown,
            updatedAt: block.updatedAt,
          });
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "노드 내용을 저장하지 못했습니다.");
      }
    }).then((stop) => {
      if (disposed) {
        void stop();
        return;
      }
      unlisten = stop;
    });

    return () => {
      disposed = true;
      void unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen(EDITOR_READY, () => {
      editorReadyRef.current = true;
      const session = editorSessionRef.current;
      if (session) void sendEditorSession(session);
    }).then((stop) => {
      if (disposed) {
        void stop();
        return;
      }
      unlisten = stop;
    });

    return () => {
      disposed = true;
      void unlisten?.();
    };
  }, []);

  useEffect(() => {
    void ensureEditorWindow().catch((error) => {
      setMessage(error instanceof Error ? error.message : "편집 창을 열지 못했습니다.");
    });
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
    const session: EditorSession = {
      blockId: block.id,
      title: block.title ?? "",
      markdown: block.markdown,
      updatedAt: block.updatedAt,
    };
    void ensureEditorWindow()
      .then(() => sendEditorSession(session))
      .catch((error) => setMessage(error instanceof Error ? error.message : "편집 창을 열지 못했습니다."));
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
  };

  const deleteSelectedBlock = (blockId: BlockId) => {
    if (!activeFlow) return;
    const result = runCommand("노드 삭제", (current) => deleteBlock(current, activeFlow.id, blockId));
    if (!result) return;
    const deletedBlockIds = new Set([...workspace.blocks.keys()].filter((id) => !result.workspace.blocks.has(id)));
    setNodePositionsByFlow((current) => ({
      ...current,
      [activeFlow.id]: Object.fromEntries(
        Object.entries(current[activeFlow.id] ?? {}).filter(([id]) => !deletedBlockIds.has(id)),
      ),
    }));
    setSelectedBlockIds([]);
  };

  useEffect(() => {
    const deleteWithKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Delete" || event.repeat) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
      if (selectedBlockIds.length !== 1) return;
      event.preventDefault();
      deleteSelectedBlock(selectedBlockIds[0]);
    };

    window.addEventListener("keydown", deleteWithKey);
    return () => window.removeEventListener("keydown", deleteWithKey);
  }, [selectedBlockIds, workspace, activeFlow]);

  const deleteSelectedFlow = (flowId: string) => {
    const flow = workspace.flows.get(flowId);
    if (!flow || !window.confirm(`\"${flow.title}\" Flow와 내부 노드를 삭제할까요?`)) return;
    const wasActive = flowId === activeFlow?.id;
    const result = runCommand("Flow 삭제", (current) => deleteFlow(current, flowId));
    if (!result) return;

    setNodePositionsByFlow(({ [flowId]: _deleted, ...remaining }) => remaining);
    if (wasActive) {
      setSelectedBlockIds([]);
    }
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
          setMessage(`${flow?.title ?? "Flow"} 열기`);
        }}
        onDeleteFlow={deleteSelectedFlow}
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
                <button className="button button-quiet editor-toggle" type="button" onClick={() => void ensureEditorWindow().catch((error) => setMessage(error instanceof Error ? error.message : "편집 창을 열지 못했습니다."))}>편집 창 열기</button>
                <div className={`runtime-badge ${storageState === "error" ? "has-error" : ""}`}>{storageBadge}</div>
              </div>
            </header>
            <div className="command-status" role="status">{message}</div>
            {storageError && <div className="storage-error" role="alert">{storageError} <button className="storage-retry" type="button" onClick={() => void retrySave()}>다시 시도</button></div>}
            <div className="flow-work-area">
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
