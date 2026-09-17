import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  BlockId,
  CommandResult,
  WorkspaceState,
  createBlock,
  connectBlocks,
  disconnectBlocks,
  connectionError,
  createFlow,
  createWorkspace,
  deleteBlock,
  deleteFlow,
  renameFlow,
  updateBlock,
  validateWorkspace,
} from "./domain/flow";
import { ConnectionState, startConnection, chooseConnectionBlock } from "./domain/connection";
import { defaultPosition, findFreePosition, NODE_WIDTH } from "./domain/layout";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FlowCanvas } from "./components/FlowCanvas";
import { EDITOR_CLEAR, EDITOR_LOAD, EDITOR_READY, EDITOR_SAVE, EDITOR_SAVED, type EditorSaveRequest, type EditorSession } from "./editorProtocol";
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
  const [connection, setConnection] = useState<ConnectionState>({ kind: "idle" });
  const [selectedLinkId, setSelectedLinkId] = useState<string>();
  const workspaceSessionRef = useRef(crypto.randomUUID());
  const [workspaceRoot, setWorkspaceRoot] = useState<string>();
  const [storageState, setStorageState] = useState<"checking" | "needs-workspace" | "loading" | "ready" | "pending" | "saving" | "error">("checking");
  const [storageError, setStorageError] = useState<string>();
  const [sidebarWidth, setSidebarWidth] = useState(292);
  const hydratedRef = useRef(false);
  const transitioningRef = useRef(false);
  const saveSequenceRef = useRef(Promise.resolve());
  const sidebarResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | undefined>(undefined);
  const editorReadyRef = useRef(false);
  const editorOpeningRef = useRef<Promise<void> | undefined>(undefined);
  const editorSessionRef = useRef<EditorSession | undefined>(undefined);
  const issuedEditorSessionsRef = useRef(new Map<string, string>());
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const latestRef = useRef({ workspace, nodePositionsByFlow, workspaceRoot });
  latestRef.current = { workspace, nodePositionsByFlow, workspaceRoot };
  const saveRevisionRef = useRef(0);
  const savedStateRef = useRef<{ workspace: WorkspaceState; positions: NodePositionsByFlow } | undefined>(undefined);
  const saveCurrent = async () => {
    const current = latestRef.current;
    if (!current.workspaceRoot || !hydratedRef.current || !isDesktopRuntime()) return;
    const revision = ++saveRevisionRef.current;
    setStorageState("saving");
    const pending = saveSequenceRef.current.catch(() => undefined).then(() => saveNativeWorkspace(current.workspaceRoot!, current.workspace, current.nodePositionsByFlow));
    saveSequenceRef.current = pending;
    try {
      await pending;
      savedStateRef.current = { workspace: current.workspace, positions: current.nodePositionsByFlow };
      if (revision === saveRevisionRef.current && latestRef.current.workspaceRoot === current.workspaceRoot) {
        const isCurrent = latestRef.current.workspace === current.workspace && latestRef.current.nodePositionsByFlow === current.nodePositionsByFlow;
        setStorageState(isCurrent ? "ready" : "pending"); setStorageError(undefined);
      }
    } catch (error) {
      if (latestRef.current.workspaceRoot === current.workspaceRoot) {
        setStorageError(error instanceof Error ? error.message : "저장하지 못했습니다."); setStorageState("error");
      }
      throw error;
    }
  };
  const flushRef = useRef(saveCurrent);
  flushRef.current = saveCurrent;
  const clearEditor = () => {
    issuedEditorSessionsRef.current.clear();
    editorSessionRef.current = undefined;
    if (isDesktopRuntime()) void emitTo("editor", EDITOR_CLEAR);
  };
  const resetInteraction = () => { setConnection({ kind: "idle" }); setSelectedLinkId(undefined); setSelectedBlockIds([]); };

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
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    setStorageState("loading");
    try { await saveCurrent(); } catch { transitioningRef.current = false; return; }
    setStorageState("loading");
    setStorageError(undefined);
    hydratedRef.current = false;
    clearEditor();
    try {
      const loaded = await openNativeWorkspace(path.trim());
      workspaceSessionRef.current = crypto.randomUUID();
      clearEditor(); resetInteraction();
      workspaceRef.current = loaded.workspace;
      savedStateRef.current = { workspace: loaded.workspace, positions: loaded.nodePositionsByFlow };
      setWorkspace(loaded.workspace);
      setNodePositionsByFlow(loaded.nodePositionsByFlow);
      setSelectedBlockIds([]);
      setWorkspaceRoot(loaded.workspaceRoot);
      setMessage(loaded.recoveryNotice ?? "작업공간을 열었습니다.");
      setStorageState("ready");
      hydratedRef.current = true;
    } catch (error) {
      setWorkspaceRoot(undefined);
      setStorageError(error instanceof Error ? error.message : "작업공간을 열 수 없습니다.");
      setStorageState("error");
    } finally {
      transitioningRef.current = false;
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

  const returnToWorkspaceSelection = async () => {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    try { await saveCurrent(); } catch { transitioningRef.current = false; return; }
    hydratedRef.current = false;
    clearEditor(); resetInteraction();
    setWorkspaceRoot(undefined);
    setStorageError(undefined);
    setStorageState("needs-workspace");
    transitioningRef.current = false;
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

  const retrySave = () => saveCurrent().catch(() => undefined);

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
        if (transitioningRef.current || issuedEditorSessionsRef.current.get(payload.sessionId) !== payload.blockId || payload.workspaceSession !== workspaceSessionRef.current) throw new Error("만료된 편집 세션입니다. 블록을 다시 선택하세요.");
        const result = updateBlock(workspaceRef.current, payload.blockId, {
          title: workspaceRef.current.blocks.get(payload.blockId)?.title,
          markdown: payload.markdown,
        });
        workspaceRef.current = result.workspace;
        setWorkspace(result.workspace);
        setMessage("노드 내용 저장 완료");
        const block = result.workspace.blocks.get(payload.blockId);
        if (block && editorSessionRef.current?.sessionId === payload.sessionId) {
          editorSessionRef.current = {
            sessionId: payload.sessionId, workspaceSession: payload.workspaceSession,
            blockId: block.id,
            title: block.title ?? "",
            markdown: block.markdown,
            updatedAt: block.updatedAt,
          };
        }
        void emitTo("editor", EDITOR_SAVED, { request: payload });
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "노드 내용을 저장하지 못했습니다.");
        void emitTo("editor", EDITOR_SAVED, { request: payload, error: error instanceof Error ? error.message : "저장 실패" });
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
    if (savedStateRef.current?.workspace === workspace && savedStateRef.current.positions === nodePositionsByFlow) return;
    setStorageState("pending");
    const timer = window.setTimeout(() => { void saveCurrent().catch(() => undefined); }, 650);
    return () => window.clearTimeout(timer);
  }, [workspace, workspaceRoot, nodePositionsByFlow]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let disposed = false;
    let closing = false;
    let stop: UnlistenFn | undefined;
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (closing || transitioningRef.current) return;
      closing = true;
      transitioningRef.current = true;
      try { await flushRef.current(); await getCurrentWindow().destroy(); }
      catch { closing = false; transitioningRef.current = false; }
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; });
    return () => { disposed = true; stop?.(); };
  }, []);

  useEffect(() => { resetInteraction(); }, [workspace.activeFlowId, workspaceRoot]);
  useEffect(() => {
    if (editorSessionRef.current && !workspace.blocks.has(editorSessionRef.current.blockId)) clearEditor();
    if (connection.kind !== "idle" && (!activeFlow || connection.flowId !== activeFlow.id ||
      (connection.kind !== "first" && !activeFlow.blockIds.includes(connection.first)) ||
      (connection.kind === "ready" && !activeFlow.blockIds.includes(connection.second)))) setConnection({ kind: "idle" });
  }, [workspace, connection]);

  const runCommand = <T extends CommandResult>(label: string, operation: (current: WorkspaceState) => T): T | undefined => {
    if (transitioningRef.current) return undefined;
    try {
      const result = operation(workspaceRef.current);
      const errors = validateWorkspace(result.workspace);
      if (errors.length) throw new Error(errors.join(" "));
      workspaceRef.current = result.workspace;
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
    setSelectedBlockIds([blockId]);
    if (editorSessionRef.current?.blockId === blockId) return;
    const session: EditorSession = {
      sessionId: crypto.randomUUID(), workspaceSession: workspaceSessionRef.current,
      blockId: block.id,
      title: block.title ?? "",
      markdown: block.markdown,
      updatedAt: block.updatedAt,
    };
    editorSessionRef.current = session;
    issuedEditorSessionsRef.current.set(session.sessionId, blockId);
    void ensureEditorWindow()
      .then(() => {
        if (editorSessionRef.current?.sessionId === session.sessionId && workspaceSessionRef.current === session.workspaceSession && workspaceRef.current.blocks.has(blockId)) return sendEditorSession(session);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "편집 창을 열지 못했습니다."));
  };

  const addBlock = (position?: { x: number; y: number }) => {
    if (!activeFlow || connection.kind !== "idle") return;
    const result = runCommand("블록 추가", (current) => createBlock(current, activeFlow.id));
    if (!result) return;
    const positions = activeFlow.blockIds.map((id, index) => nodePositionsByFlow[activeFlow.id]?.[id] ?? defaultPosition(index));
    const selected = selectedBlockIds.length === 1 ? activeFlow.blockIds.indexOf(selectedBlockIds[0]) : -1;
    const preferred = selected >= 0 ? { x: positions[selected].x + NODE_WIDTH + 48, y: positions[selected].y } : defaultPosition(activeFlow.blockIds.length);
    const point = position ?? findFreePosition(positions, preferred);
    setNodePositionsByFlow((current) => ({ ...current, [activeFlow.id]: { ...current[activeFlow.id], [result.blockId]: point } }));
    setSelectedBlockIds([result.blockId]); setSelectedLinkId(undefined);
  };
  const beginConnection = () => {
    if (!activeFlow || connection.kind !== "idle") return;
    setSelectedLinkId(undefined); setConnection(startConnection(activeFlow, selectedBlockIds));
  };
  const confirmConnection = () => {
    if (connection.kind !== "ready" || !activeFlow || activeFlow.id !== connection.flowId) return;
    const result = runCommand("연결", (current) => connectBlocks(current, connection.flowId, connection.first, connection.second));
    if (result) { setSelectedBlockIds([connection.second]); setConnection({ kind: "idle" }); }
  };
  const deleteLink = (id: string) => {
    if (!activeFlow) return;
    if (runCommand("연결 해제", (current) => disconnectBlocks(current, activeFlow.id, id))) setSelectedLinkId(undefined);
  };
  const deleteSelectedLink = () => { if (selectedLinkId) deleteLink(selectedLinkId); };

  const renameBlockTitle = (blockId: BlockId, title: string) => {
    const result = runCommand("블록 요약 변경", (current) => {
      const block = current.blocks.get(blockId);
      return updateBlock(current, blockId, { title, markdown: block?.markdown ?? "" });
    });
    const session = editorSessionRef.current;
    if (result && session?.blockId === blockId) {
      void sendEditorSession({ ...session, title: result.workspace.blocks.get(blockId)?.title ?? "" })
        .catch(() => setMessage("에디터의 블록 요약 표시를 갱신하지 못했습니다."));
    }
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
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (transitioningRef.current || event.repeat || event.isComposing || !activeFlow || storageState === "loading" || storageState === "needs-workspace") return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "d") { event.preventDefault(); beginConnection(); return; }
      if (connection.kind !== "idle") {
        if (event.key === "Escape") { event.preventDefault(); setConnection({ kind: "idle" }); }
        if (event.key === "Enter" && connection.kind === "ready" && !(event.target instanceof Element && event.target.closest("button"))) { event.preventDefault(); confirmConnection(); }
        return;
      }
      if (event.key === "Escape") {
        setSelectedBlockIds([]); setSelectedLinkId(undefined);
        if (document.activeElement instanceof HTMLElement && document.activeElement.closest(".flow-canvas")) document.activeElement.blur();
      }
      if (event.key === "Delete") {
        if (selectedLinkId) { event.preventDefault(); deleteSelectedLink(); }
        else if (selectedBlockIds.length === 1) { event.preventDefault(); deleteSelectedBlock(selectedBlockIds[0]); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connection, selectedLinkId, selectedBlockIds, workspace, activeFlow, storageState]);

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

  if (transitioningRef.current || storageState === "checking" || storageState === "loading") {
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
      : storageState === "pending" ? "저장 대기" : storageState === "error"
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
          setWorkspace({ ...workspace, activeFlowId: flowId });
          resetInteraction();
          setSelectedBlockIds([]);
          setMessage(`${flow?.title ?? "Flow"} 열기`);
        }}
        onDeleteFlow={deleteSelectedFlow}
        onReturnToWorkspaceSelection={() => void returnToWorkspaceSelection()}
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
                <p className="eyebrow">FLOW CANVAS</p>
                <input className="flow-title-input" value={activeFlow.title} onChange={(event) => runCommand("Flow 이름 변경", (current) => renameFlow(current, activeFlow.id, event.currentTarget.value))} aria-label="Flow 이름" />
              </div>
              <div className="workspace-header-actions">
                <button className="button button-quiet editor-toggle" type="button" onClick={() => void ensureEditorWindow().catch((error) => setMessage(error instanceof Error ? error.message : "편집 창을 열지 못했습니다."))}>편집 창 열기</button>
                <div className={`runtime-badge ${storageState === "error" ? "has-error" : ""}`}>{storageBadge}</div>
              </div>
            </header>
            <div className="command-status" role="status">{message}</div>
            {storageError && <div className="storage-error" role="alert">{storageError} <button className="storage-retry" type="button" onClick={() => void retrySave()}>다시 시도</button></div>}
            <div className="graph-toolbar">
              <button className="button" onClick={() => addBlock()} disabled={connection.kind !== "idle"}>블록 추가</button>
              <button className="button" onClick={beginConnection} disabled={connection.kind !== "idle"}>연결 (Ctrl+D)</button>
              {connection.kind !== "idle" && <>
                <span role="status">{connection.kind === "first" ? "첫 번째 블록을 선택하세요" : connection.kind === "second" ? "두 번째 블록을 선택하세요" : connectionError(activeFlow, connection.first, connection.second) ?? "Enter 또는 연결 확정으로 완료하세요"}</span>
                <button className="button button-primary" disabled={connection.kind !== "ready" || !!connectionError(activeFlow, connection.first, connection.second)} onClick={confirmConnection}>연결 확정</button>
                <button className="button" onClick={() => setConnection({ kind: "idle" })}>취소 (Esc)</button>
              </>}
              {selectedLinkId && connection.kind === "idle" && <button className="button button-danger" onClick={deleteSelectedLink}>연결 삭제</button>}
            </div>
            <div className="flow-work-area">
              <FlowCanvas key={activeFlow.id}
                onCreateBlock={addBlock}
                onDeleteBlock={deleteSelectedBlock}
                onDeleteLink={deleteLink}
                onBeginConnection={(id) => {
                  if (connection.kind !== "idle") return;
                  setSelectedBlockIds([id]); setSelectedLinkId(undefined);
                  setConnection(startConnection(activeFlow, [id]));
                }}
                workspace={workspace}
                flow={activeFlow}
                onOpenBlock={openBlockEditor}
                onRenameBlock={renameBlockTitle}
                nodePositions={nodePositionsByFlow[activeFlow.id] ?? {}}
                selectedBlockIds={selectedBlockIds}
                onSelectedBlockIdsChange={(ids) => { setSelectedBlockIds(ids); setSelectedLinkId(undefined); }}
                onNodePositionsChange={(positions) => setNodePositionsByFlow((current) => ({ ...current, [activeFlow.id]: { ...current[activeFlow.id], ...positions } }))}
                connection={connection}
                onChooseConnectionBlock={(id) => setConnection((current) => chooseConnectionBlock(current, id))}
                selectedLinkId={selectedLinkId}
                onSelectLink={(id) => { setSelectedLinkId(id); setSelectedBlockIds([]); }}
              />

            </div>
          </>
        ) : (
          <section className="empty-workspace"><p className="eyebrow">FLOW MEMO</p><h2>생각이 시작되는 흐름을 만드세요.</h2><p>Flow를 만든 뒤 블록을 자유롭게 배치하고 필요한 블록끼리 연결하세요.</p></section>
        )}
      </section>
    </main>
  );
}

export default App;
