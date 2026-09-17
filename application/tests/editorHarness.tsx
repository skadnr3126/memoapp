import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownDocument } from "../src/components/MarkdownDocument";
import "../src/App.css";
import "../src/EditorWindow.css";

function Harness() {
  const [markdown, setMarkdown] = useState("");
  return <main className="editor-window"><div className="editor-window-content">
    <MarkdownDocument markdown={markdown} onChange={setMarkdown} />
    <output data-testid="saved" hidden>{markdown}</output>
  </div></main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><Harness /></React.StrictMode>);
