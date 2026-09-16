import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { EditorWindow } from "./EditorWindow";

const isEditorWindow = window.location.hash === "#editor";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isEditorWindow ? <EditorWindow /> : <App />}
  </React.StrictMode>,
);
