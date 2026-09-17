import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
const EditorWindow = React.lazy(() => import("./EditorWindow").then(module => ({ default: module.EditorWindow })));

const isEditorWindow = window.location.hash === "#editor";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isEditorWindow ? <React.Suspense fallback={<p>문서를 여는 중…</p>}><EditorWindow /></React.Suspense> : <App />}
  </React.StrictMode>,
);
