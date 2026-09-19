import { useEffect, useRef, useState } from "react";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isDesktopRuntime } from "./storage/repository";
import { EDITOR_CLEAR, EDITOR_LOAD, EDITOR_READY, EDITOR_SAVE, EDITOR_SAVED, type EditorSaveResult, type EditorSaveRequest, type EditorSession } from "./editorProtocol";
import "./EditorWindow.css";
import { MarkdownDocument } from "./components/MarkdownDocument";
import { EDITOR_FLUSH, EDITOR_FLUSHED } from "./editorProtocol";

export function EditorWindow() {
  const [session, setSession] = useState<EditorSession>();
  const [markdown, setMarkdown] = useState("");
  const [status, setStatus] = useState("변경 내용은 1초마다 자동 저장됩니다.");
  const currentRef = useRef<EditorSession | undefined>(undefined);
  const draftsRef = useRef(new Map<string, EditorSaveRequest>());
  const pendingRef = useRef(new Set<string>());
  const flushRequestsRef = useRef(new Set<string>());
  const confirmFlush = (error?: string) => {
    if (!error && (draftsRef.current.size || pendingRef.current.size)) return;
    for (const requestId of flushRequestsRef.current) {
      void emitTo("main", EDITOR_FLUSHED, { requestId, ...(error ? { error } : {}) });
    }
    flushRequestsRef.current.clear();
  };

  const flush = () => {
    for (const [id, request] of draftsRef.current) {
      if (pendingRef.current.has(id)) continue;
      pendingRef.current.add(id);
      if (currentRef.current?.sessionId === id) setStatus("저장 중…");
      void emitTo("main", EDITOR_SAVE, request).catch(() => {
        pendingRef.current.delete(id);
        setStatus("저장 전송 실패. 자동으로 다시 시도합니다.");
        confirmFlush("편집 내용을 메인 창에 전달하지 못했습니다.");
      });
    }
  };
  const change = (nextMarkdown: string) => {
    const current = currentRef.current;
    if (!current) return;
    setMarkdown(nextMarkdown);
    currentRef.current = { ...current, markdown: nextMarkdown };
    draftsRef.current.set(current.sessionId, { sessionId: current.sessionId, workspaceSession: current.workspaceSession, blockId: current.blockId, markdown: nextMarkdown });
    setStatus("변경 내용 저장 대기 중…");
  };

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    let unlisten: UnlistenFn | undefined;
    let clearListener: UnlistenFn | undefined;
    let savedListener: UnlistenFn | undefined;
    let flushListener: UnlistenFn | undefined;
    let disposed = false;
    const flushReady = listen<{ requestId: string }>(EDITOR_FLUSH, ({ payload }) => {
      flushRequestsRef.current.add(payload.requestId);
      flush(); confirmFlush();
    }).then(stop => { if (disposed) stop(); else flushListener = stop; });
    void listen(EDITOR_CLEAR, () => { confirmFlush("편집 세션이 변경되었습니다. 다시 시도하세요."); currentRef.current = undefined; draftsRef.current.clear(); pendingRef.current.clear(); setSession(undefined); setMarkdown(""); }).then((stop) => { if (disposed) stop(); else clearListener = stop; });
    const ready = listen<EditorSaveResult>(EDITOR_SAVED, ({ payload: { request, error } }) => {
      pendingRef.current.delete(request.sessionId);
      const draft = draftsRef.current.get(request.sessionId);
      if (!error && draft?.markdown === request.markdown) draftsRef.current.delete(request.sessionId);
      if (currentRef.current?.sessionId === request.sessionId) {
        setStatus(error ? `저장 실패: ${error}` : draftsRef.current.has(request.sessionId) ? "변경 내용 저장 대기 중…" : "메인 창에 반영됨 · 파일 자동 저장 진행");
      }
      if (flushRequestsRef.current.size) {
        if (error) confirmFlush(error);
        else { flush(); confirmFlush(); }
      }
    }).then((stop) => { if (disposed) stop(); else savedListener = stop; });

    void listen<EditorSession>(EDITOR_LOAD, ({ payload }) => {
      if (currentRef.current?.sessionId === payload.sessionId) {
        currentRef.current = { ...currentRef.current, title: payload.title };
        setSession(current => current ? { ...current, title: payload.title } : current);
        return;
      }
      flush();
      const previous = [...draftsRef.current.values()].find(draft => draft.workspaceSession === payload.workspaceSession && draft.blockId === payload.blockId);
      if (previous) {
        draftsRef.current.delete(previous.sessionId);
        payload = { ...payload, markdown: previous.markdown };
        draftsRef.current.set(payload.sessionId, { ...payload });
      }
      currentRef.current = payload;
      setSession(payload);
      setMarkdown(payload.markdown);
      setStatus("변경 내용은 1초마다 자동 저장됩니다.");
    }).then((stop) => {
      if (disposed) {
        void stop();
        return;
      }
      unlisten = stop;
      void Promise.all([ready, flushReady]).then(() => { if (!disposed) void emitTo("main", EDITOR_READY); });
    });
    const timer = window.setInterval(flush, 1000);
    window.addEventListener("blur", flush);

    return () => {
      disposed = true;
      void unlisten?.();
      clearListener?.();
      savedListener?.();
      flushListener?.();
      window.clearInterval(timer);
      window.removeEventListener("blur", flush);
    };
  }, []);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    flush();
  };

  return (
    <main className="editor-window" onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); flush(); }
    }}>
      {session ? (
        <form className="editor-window-content" onSubmit={save}>
          <MarkdownDocument key={session.sessionId} title={session.title} markdown={markdown} onChange={change} />
          <footer><small role="status">{status}</small><button type="submit">저장</button></footer>
        </form>
      ) : (
        <section className="editor-window-empty">
          <p>메인 창에서 노드를 선택하세요.</p>
          <small>선택한 노드의 내용이 이 창에 표시됩니다.</small>
        </section>
      )}
    </main>
  );
}
