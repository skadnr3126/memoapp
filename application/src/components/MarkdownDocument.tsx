import { useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { markdownLexer } from "./markdownToggle";
import { documentExtensions, requiresSource } from "./markdownConfig";

type Props = { markdown: string; title?: string; onChange: (markdown: string) => void; toolbar?: ReactNode };

export function MarkdownDocument({ markdown, title = "", onChange, toolbar }: Props) {
  const fullTitle = title.replace(/\s+/g, " ").trim();
  const prefix = Array.from(fullTitle.split(" ").slice(0, 2).join(" ")).slice(0, 18).join("");
  const titleHint = fullTitle ? prefix + (prefix.length < fullTitle.length ? "..." : "") : "요약 없는 블록";
  const [source, setSource] = useState(() => requiresSource(markdown));
  const [help, setHelp] = useState(false);
  const onChangeRef = useRef(onChange);
  const pageMouseDownRef = useRef(false);
  const renderedMarkdownRef = useRef(markdown);
  onChangeRef.current = onChange;
  const unsupported = useMemo(() => requiresSource(markdown), [markdown]);
  const extensions = useMemo(documentExtensions, []);
  const editor = useEditor({
    extensions,
    content: unsupported ? "" : markdown,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "scription-document", role: "textbox", "aria-label": "Scription 문서", "aria-multiline": "true" },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text || !editor || editor.isActive("codeBlock")) return false;
        event.preventDefault();
        const tokens = markdownLexer.lexer(text);
        if (requiresSource(text) || (tokens.length === 1 && tokens[0].type === "paragraph" && tokens[0].tokens?.every(token => token.type === "text"))) {
          editor.commands.insertContent({ type: "text", text });
        }
        else editor.commands.insertContent(text, { contentType: "markdown" });
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = current.getMarkdown();
      renderedMarkdownRef.current = next;
      onChangeRef.current(next);
    },
  });

  const switchMode = () => {
    if (source) {
      if (unsupported) return;
      if (unsupported || !editor) return;
      if (renderedMarkdownRef.current !== markdown || editor.isEmpty && markdown.length > 0) {
        editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
        renderedMarkdownRef.current = markdown;
      }
    }
    setSource(!source);
  };

  return <>
    <div className="scription-tools">
      <span className="scription-block-hint" title={fullTitle || titleHint}>{titleHint}</span>
      <div>
        {toolbar}
        <button type="button" disabled={source || !editor} onClick={() => editor?.chain().focus().insertContent({
          type: "toggle", content: [
            { type: "toggleTitle", content: [{ type: "text", text: "토글 제목" }] },
            { type: "toggleBody", content: [{ type: "paragraph" }] },
          ],
        }).run()}>토글 추가</button>
        <button type="button" aria-expanded={help} onClick={() => setHelp(!help)}>문법 안내</button>
        <button type="button" onClick={switchMode} disabled={source && unsupported} aria-pressed={source}>
          {source ? "문서 보기" : "마크다운 원문"}
        </button>
      </div>
    </div>
    {help && <aside className="scription-help">
      <p><code># </code>제목 · <code>## </code>소제목 · <code>- </code>목록 · <code>1. </code>번호 목록 · <code>[ ] </code>체크리스트</p>
      <p><code>**굵게**</code> · <code>*기울임*</code> · <code>~~취소선~~</code> · <code>`코드`</code> · <code>&gt; </code>인용 · <code>```</code>코드 블록 · <code>---</code>구분선</p>
      <p>Ctrl+B / Ctrl+I 강조 · Ctrl+Z 되돌리기 · 빈 목록에서 Enter로 목록 종료 · 링크는 원문에서 [이름](주소)</p>
      <p>토글은 빈 줄에서 <code>&gt; </code>를 입력하거나 토글 추가 버튼으로 만듭니다. 제목에서 Enter를 누르면 본문으로 이동합니다.</p>
      <p>원문에서는 <code>:::toggle 제목</code> 다음 줄부터 내용을 쓰고 <code>:::</code>로 닫습니다. 제목 옆 화살표로 접고 펼칩니다.</p>
    </aside>}
    {source && unsupported && <p className="scription-source-note">표·이미지·HTML이 포함된 문서는 내용을 보존하기 위해 원문으로 편집합니다.</p>}
    {source ? <textarea className="scription-source" aria-label="Scription 마크다운 원문" value={markdown}
      onChange={event => onChange(event.currentTarget.value)} spellCheck={false}
      placeholder="생각을 자세히 적어보세요…" /> :
      <div className="scription-page" onMouseDown={event => { pageMouseDownRef.current = event.target === event.currentTarget; }} onClick={event => {
        if (event.target !== event.currentTarget || !pageMouseDownRef.current || !editor) return;
        const rect = editor.view.dom.getBoundingClientRect();
        const position = editor.view.posAtCoords({ left: Math.max(rect.left, Math.min(event.clientX, rect.right)), top: Math.max(rect.top, Math.min(event.clientY, rect.bottom)) });
        editor.chain().focus().setTextSelection(position?.pos ?? editor.state.doc.content.size).run();
      }}>
        <EditorContent editor={editor} />
        {editor?.isEmpty && <span className="scription-placeholder">생각을 자세히 적어보세요…</span>}
      </div>}
  </>;
}
