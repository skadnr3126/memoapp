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
import { invoke } from "@tauri-apps/api/core";
import { FlowCanvas } from "./components/FlowCanvas";
import { EDITOR_CLEAR, EDITOR_LOAD, EDITOR_READY, EDITOR_SAVE, EDITOR_SAVED, type EditorSaveRequest, type EditorSession } from "./editorProtocol";
import { EDITOR_LOCK, EDITOR_LOCKED, type EditorLockState } from "./editorProtocol";
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
import { FlowSummary } from "./components/FlowSummary";
import { flowSummaryInput, flushEditor } from "./flowSummary";
import { BLOCK_CLIPBOARD_TYPE, parseCopiedBlock, serializeCopiedBlock } from "./blockClipboard";

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createWorkspace());
  const [message, setMessage] = useState("새 Flow를 만들어 구조를 시작하세요.");
  const [nodePositionsByFlow, setNodePositionsByFlow] = useState<NodePositionsByFlow>({});
  const [selectedBlockIds, setSelectedBlockIds] = useState<BlockId[]>([]);
  const [connection, setConnection] = useState<ConnectionState>({ kind: "idle" });
  const [selectedLinkId, setSelectedLinkId] = useState<string>();
  const workspaceSessionRef = useRef(crypto.randomUUID());
  const [workspaceRoot, setWorkspaceRoot] = useState<string>();
  const [storageState, setStorageState] = useState<"checking" | "needs-workspace" | "loading" | "ready" | "error">("checking");
  const [storageError, setStorageError] = useState<string>();
  const [sidebarWidth, setSidebarWidth] = useState(292);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const preferencesRef = useRef({ sidebarWidth, workspaceRoot });
  preferencesRef.current = { sidebarWidth, workspaceRoot };
  const savePreferencesRef = useRef<() => Promise<void>>(async () => {});
  savePreferencesRef.current = async () => {
    if (preferencesLoaded && isDesktopRuntime()) await invoke("save_ui_preferences", { preferences: preferencesRef.current });
  };
  const hydratedRef = useRef(false);
  const transitioningRef = useRef(false);
  const saveSequenceRef = useRef(Promise.resolve());
  const sidebarResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | undefined>(undefined);
  const editorReadyRef = useRef(false);
  const editorOpeningRef = useRef<Promise<void> | undefined>(undefined);
  const editorSessionRef = useRef<EditorSession | undefined>(undefined);
  const editorLockedRef = useRef(false);
  const issuedEditorSessionsRef = useRef(new Map<string, string>());
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const undoRef = useRef<{ workspace: WorkspaceState; positions: NodePositionsByFlow } | undefined>(undefined);

  const latestRef = useRef({ workspace, nodePositionsByFlow, workspaceRoot });
  latestRef.current = { workspace, nodePositionsByFlow, workspaceRoot };
  const saveRevisionRef = useRef(0);
  const savedStateRef = useRef<{ workspace: WorkspaceState; positions: NodePositionsByFlow } | undefined>(undefined);
  const saveCurrent = async () => {
    const current = { ...latestRef.current, workspace: workspaceRef.current };
    if (!current.workspaceRoot || !hydratedRef.current || !isDesktopRuntime()) return;
    const revision = ++saveRevisionRef.current;
    const pending = saveSequenceRef.current.catch(() => undefined).then(() => saveNativeWorkspace(current.workspaceRoot!, current.workspace, current.nodePositionsByFlow));
    saveSequenceRef.current = pending;
    try {
      await pending;
      savedStateRef.current = { workspace: current.workspace, positions: current.nodePositionsByFlow };
      if (revision === saveRevisionRef.current && latestRef.current.workspaceRoot === current.workspaceRoot) {
        setStorageState("ready"); setStorageError(undefined);
      }
      return current;
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
    editorLockedRef.current = false;
    issuedEditorSessionsRef.current.clear();
    editorSessionRef.current = undefined;
    if (isDesktopRuntime()) void emitTo("editor", EDITOR_CLEAR);
  };
  const resetInteraction = () => { setConnection({ kind: "idle" }); setSelectedLinkId(undefined); setSelectedBlockIds([]); };

  const activeFlow = workspace.activeFlowId ? workspace.flows.get(workspace.activeFlowId) : undefined;
  const validationErrors = useMemo(() => validateWorkspace(workspace), [workspace]);
  const prepareSavedWorkspace = async () => {
    const session = workspaceSessionRef.current;
    const root = latestRef.current.workspaceRoot;
    if (!root || transitioningRef.current) throw new Error("작업공간을 먼저 선택하세요.");
    if (await WebviewWindow.getByLabel("editor")) await flushEditor();
    if (session !== workspaceSessionRef.current || root !== latestRef.current.workspaceRoot || transitioningRef.current) throw new Error("작업공간이 변경되었습니다. 다시 시도하세요.");
    const saved = await saveCurrent();
    if (!saved || session !== workspaceSessionRef.current || root !== latestRef.current.workspaceRoot || transitioningRef.current) throw new Error("작업공간이 변경되었습니다. 다시 시도하세요.");
    return saved;
  };
  const prepareSummary = async () => {
    const flowId = workspaceRef.current.activeFlowId;
    if (!flowId) throw new Error("Flow를 먼저 선택하세요.");
    const saved = await prepareSavedWorkspace();
    return { workspaceRoot: saved.workspaceRoot!, input: flowSummaryInput(saved.workspace, flowId) };
  };

  const sendEditorSession = async (session: EditorSession) => {
    editorSessionRef.current = session;
    if (!editorReadyRef.current || !isDesktopRuntime()) return;
    await emitTo("editor", EDITOR_LOAD, session);
  };

  const openCodex = async () => {
    try {
      const { workspaceRoot } = await prepareSavedWorkspace();
      await invoke("open_codex", { workspaceRoot });
      setMessage("현재 작업공간에서 Codex CLI를 열었습니다.");
    } catch (error) {
      setMessage(`Codex CLI 실행 실패: ${String(error)}`);
    }
  };

  const openCode = async () => {
    try {
      const { workspaceRoot } = await prepareSavedWorkspace();
      await invoke("open_code", { workspaceRoot });
      setMessage("현재 작업공간을 VS Code로 열었습니다.");
    } catch (error) {
      setMessage(`VS Code 실행 실패: ${String(error)}`);
    }
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
      await invoke("restore_editor_preferences", { workspaceRoot: latestRef.current.workspaceRoot });
    } finally {
      editorOpeningRef.current = undefined;
    }
  };

  const openWorkspace = async (path: string) => {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    setStorageState("loading");
    try { await saveCurrent(); await savePreferencesRef.current(); } catch (error) { transitioningRef.current = false; setStorageState("error"); setStorageError(String(error)); return; }
    setStorageState("loading");
    setStorageError(undefined);
    hydratedRef.current = false;
    clearEditor();
    try {
      const loaded = await openNativeWorkspace(path.trim());
      const preferences = await invoke<{ sidebarWidth?: number }>("load_workspace_preferences", { workspaceRoot: loaded.workspaceRoot });
      setSidebarWidth(clampSidebarWidth(preferences?.sidebarWidth ?? 292));
      setSidebarCollapsed(false);
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
      try { setRecentWorkspaces(await invoke<string[]>("recent_workspaces", { opened: loaded.workspaceRoot })); }
      catch (error) { setStorageError(`최근 폴더 저장 실패: ${String(error)}`); }
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
    try { await saveCurrent(); await savePreferencesRef.current(); } catch (error) { transitioningRef.current = false; setStorageError(String(error)); return; }
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
    void invoke<string[]>("recent_workspaces").then(items => {
      if (cancelled) return;
      setRecentWorkspaces(items ?? []);
      setStorageState("needs-workspace");
      if (!cancelled) setPreferencesLoaded(true);
    }).catch(error => {
      if (cancelled) return;
      setStorageState("needs-workspace");
      setStorageError(`화면 설정을 불러오지 못했습니다: ${String(error)}`);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!preferencesLoaded || storageState === "loading" || storageState === "checking" || storageState === "error") return;
    const timer = window.setTimeout(() => { void savePreferencesRef.current().catch(error => setStorageError(`화면 설정 저장 실패: ${String(error)}`)); }, 350);
    return () => window.clearTimeout(timer);
  }, [sidebarWidth, workspaceRoot, preferencesLoaded, storageState]);

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
      editorLockedRef.current = false;
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
    if (!isDesktopRuntime()) return;
    let disposed = false;
    const stops: UnlistenFn[] = [];
    const listeners = [
      listen<EditorLockState>(EDITOR_LOCK, ({ payload }) => {
        const session = editorSessionRef.current;
        if (!session) return;
        if (session.sessionId === payload.sessionId && typeof payload.locked === "boolean") {
          editorLockedRef.current = payload.locked;
        }
        void emitTo("editor", EDITOR_LOCKED, { sessionId: session.sessionId, locked: editorLockedRef.current });
      }),
      listen("tauri://destroyed", () => {
        editorLockedRef.current = false;
        editorReadyRef.current = false;
        editorSessionRef.current = undefined;
      }, { target: { kind: "WebviewWindow", label: "editor" } }),
    ];
    for (const listener of listeners) void listener.then(stop => { if (disposed) stop(); else stops.push(stop); });
    return () => { disposed = true; for (const stop of stops) stop(); };
  }, []);

  useEffect(() => {
    void ensureEditorWindow().catch((error) => {
      setMessage(error instanceof Error ? error.message : "편집 창을 열지 못했습니다.");
    });
  }, []);

  useEffect(() => {
    if (!workspaceRoot || !hydratedRef.current || !isDesktopRuntime()) return;
    if (savedStateRef.current?.workspace === workspace && savedStateRef.current.positions === nodePositionsByFlow) return;
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
      try { await flushRef.current(); await savePreferencesRef.current(); await getCurrentWindow().destroy(); }
      catch (error) { setStorageError(`종료 전 저장 실패: ${String(error)}`); closing = false; transitioningRef.current = false; }
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
      undoRef.current = { workspace: workspaceRef.current, positions: latestRef.current.nodePositionsByFlow };
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
    if (editorLockedRef.current) return;
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
    const preferred = selected >= 0 ? { x: positions[selected].x + (positions[selected].width ?? NODE_WIDTH) + 48, y: positions[selected].y } : defaultPosition(activeFlow.blockIds.length);
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

  const pasteBlock = (title: string, markdown: string) => {
    if (!activeFlow || connection.kind !== "idle") return;
    const created = runCommand("블록 붙여넣기", (current) => {
      const result = createBlock(current, activeFlow.id);
      return { ...updateBlock(result.workspace, result.blockId, { title, markdown }), blockId: result.blockId };
    });
    if (!created) return;
    const positions = activeFlow.blockIds.map((id, index) => nodePositionsByFlow[activeFlow.id]?.[id] ?? defaultPosition(index));
    const selected = selectedBlockIds.length === 1 ? activeFlow.blockIds.indexOf(selectedBlockIds[0]) : -1;
    const preferred = selected >= 0 ? { x: positions[selected].x + (positions[selected].width ?? NODE_WIDTH) + 48, y: positions[selected].y } : defaultPosition(activeFlow.blockIds.length);
    setNodePositionsByFlow((current) => ({ ...current, [activeFlow.id]: { ...current[activeFlow.id], [created.blockId]: findFreePosition(positions, preferred) } }));
    setSelectedBlockIds([created.blockId]); setSelectedLinkId(undefined);
  };

  useEffect(() => {
    const editingText = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
    const copy = (event: ClipboardEvent) => {
      if (editingText(event.target) || selectedBlockIds.length !== 1 || !event.clipboardData) return false;
      const block = workspace.blocks.get(selectedBlockIds[0]);
      if (!block) return false;
      event.clipboardData.setData(BLOCK_CLIPBOARD_TYPE, serializeCopiedBlock(block));
      event.clipboardData.setData("text/plain", block.markdown || block.title || "");
      event.preventDefault();
      return true;
    };
    const onCopy = (event: ClipboardEvent) => { copy(event); };
    const onCut = (event: ClipboardEvent) => {
      const blockId = selectedBlockIds[0];
      if (blockId && copy(event)) deleteSelectedBlock(blockId);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (editingText(event.target) || !event.clipboardData) return;
      const block = parseCopiedBlock(event.clipboardData.getData(BLOCK_CLIPBOARD_TYPE));
      if (!block) return;
      event.preventDefault(); pasteBlock(block.title, block.markdown);
    };
    window.addEventListener("copy", onCopy); window.addEventListener("cut", onCut); window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("copy", onCopy); window.removeEventListener("cut", onCut); window.removeEventListener("paste", onPaste); };
  }, [workspace, activeFlow, selectedBlockIds, nodePositionsByFlow, connection]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (transitioningRef.current || event.repeat || event.isComposing || !activeFlow || storageState === "loading" || storageState === "needs-workspace") return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "z" && undoRef.current) {
        event.preventDefault();
        const previous = undoRef.current; undoRef.current = undefined;
        workspaceRef.current = previous.workspace; setWorkspace(previous.workspace); setNodePositionsByFlow(previous.positions);
        setSelectedBlockIds([]); setSelectedLinkId(undefined); setConnection({ kind: "idle" }); setMessage("실행 취소 완료");
        return;
      }
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
        {recentWorkspaces.length > 0 && <section aria-label="최근 폴더"><h3>최근 폴더</h3><ul className="recent-workspaces">
          {recentWorkspaces.map(path => <li key={path}>
            <button className="button" onClick={() => void openWorkspace(path)}>{path}</button>
            <button className="button button-quiet" aria-label={`${path} 목록에서 제거`} onClick={() => {
              void invoke<string[]>("recent_workspaces", { removed: path }).then(setRecentWorkspaces).catch(error => setStorageError(String(error)));
            }}>제거</button>
          </li>)}
        </ul></section>}
        {storageError && <p className="storage-error" role="alert">{storageError}</p>}
        <p className="workspace-setup-note">브라우저 개발 모드에서는 기존처럼 메모리에서만 동작합니다.</p>
      </main>
    );
  }

  return (
    <main className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`} style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <Sidebar
        collapsed={sidebarCollapsed}
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
        hidden={sidebarCollapsed}
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
            <header className="workspace-header">
              <div className="workspace-title-row">
                <button className="button button-quiet sidebar-toggle" type="button"
                  aria-label={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
                  title={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
                  aria-expanded={!sidebarCollapsed} aria-controls="flow-sidebar"
                  onClick={() => setSidebarCollapsed(current => !current)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" />
                    <path d={sidebarCollapsed ? "m13 9 3 3-3 3" : "m17 9-3 3 3 3"} />
                  </svg>
                </button>
                {activeFlow && <>
                <input className="flow-title-input" value={activeFlow.title} onChange={(event) => runCommand("Flow 이름 변경", (current) => renameFlow(current, activeFlow.id, event.currentTarget.value))} aria-label="Flow 이름" />
                <FlowSummary key={workspaceRoot} prepare={prepareSummary} />
                </>}
              </div>
              {activeFlow && <div className="workspace-header-actions">
                <button className="button button-quiet editor-toggle" type="button" aria-label="Codex CLI 열기" title="Codex CLI 열기" disabled={!isDesktopRuntime() || !workspaceRoot} onClick={() => void openCodex()}>Codex</button>
                <button className="button button-quiet editor-toggle" type="button" aria-label="VS Code 열기" title="VS Code 열기" disabled={!isDesktopRuntime() || !workspaceRoot} onClick={() => void openCode()}>Code</button>
              </div>}
            </header>
        {activeFlow ? (
          <>
            <div className="visually-hidden" role="status">{message}</div>
            {storageError && <div className="storage-error" role="alert">{storageError} <button className="storage-retry" type="button" onClick={() => void retrySave()}>다시 시도</button></div>}
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
