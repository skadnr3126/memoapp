import { useEffect, useState } from "react";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isDesktopRuntime } from "./storage/repository";
import { EDITOR_LOAD, EDITOR_READY, EDITOR_SAVE, type EditorSaveRequest, type EditorSession } from "./editorProtocol";
import "./EditorWindow.css";

export function EditorWindow() {
  const [session, setSession] = useState<EditorSession>();
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    void listen<EditorSession>(EDITOR_LOAD, ({ payload }) => {
      setSession(payload);
      setTitle(payload.title);
      setMarkdown(payload.markdown);
    }).then((stop) => {
      if (disposed) {
        void stop();
        return;
      }
      unlisten = stop;
      void emitTo("main", EDITOR_READY);
    });

    return () => {
      disposed = true;
      void unlisten?.();
    };
  }, []);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!session) return;
    const request: EditorSaveRequest = { blockId: session.blockId, title, markdown };
    void emitTo("main", EDITOR_SAVE, request);
  };

  return (
    <main className="editor-window">
      <header className="editor-window-header">
        <p className="editor-window-eyebrow">FLOW MEMO</p>
        <h1>Node Editor</h1>
      </header>
      {session ? (
        <form className="editor-window-content" onSubmit={save}>
          <p className="editor-window-meta">{session.blockId}</p>
          <label>제목<input value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="노드 제목" /></label>
          <label>내용<textarea value={markdown} onChange={(event) => setMarkdown(event.currentTarget.value)} placeholder="생각을 자세히 적어보세요…" rows={16} /></label>
          <footer><small>메인 창이 저장과 자동 저장을 처리합니다.</small><button type="submit">저장</button></footer>
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
