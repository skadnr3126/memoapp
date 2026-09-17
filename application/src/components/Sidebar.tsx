import { FormEvent, useState } from "react";
import { Flow, FlowId } from "../domain/flow";

type SidebarProps = {
  flows: Flow[];
  activeFlowId?: FlowId;
  validationErrors: string[];
  workspaceRoot?: string;
  onCreateFlow: (title: string) => void;
  onSelectFlow: (flowId: FlowId) => void;
  onDeleteFlow: (flowId: FlowId) => void;
  onReturnToWorkspaceSelection?: () => void;
  onChooseWorkspace?: () => void;
};

const getNodeCount = (flow: Flow) =>
  flow.blockIds.length;

export function Sidebar({ flows, activeFlowId, validationErrors, workspaceRoot, onCreateFlow, onSelectFlow, onDeleteFlow, onReturnToWorkspaceSelection ,onChooseWorkspace}: SidebarProps) {
  const [newFlowTitle, setNewFlowTitle] = useState("");
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onCreateFlow(newFlowTitle);
    setNewFlowTitle("");
  };

  return (
    <aside className="sidebar">
      <button className="button workspace-switch-button" type="button" onClick={onReturnToWorkspaceSelection}>처음으로 돌아가기</button>
      <div className="brand">
        <span className="brand-mark">M</span>
        <div><p className="eyebrow">FLOW MEMO · CANVAS</p><h1>생각의 흐름</h1></div>
      </div>
      <form className="new-flow-form" onSubmit={handleSubmit}>
        <label htmlFor="new-flow-title">새 Flow</label>
        <div className="new-flow-row">
          <input id="new-flow-title" value={newFlowTitle} onChange={(event) => setNewFlowTitle(event.target.value)} placeholder="예: 저장 구조 고민" />
          <button className="button button-primary" type="submit">만들기</button>
        </div>
      </form>
      <nav className="flow-list" aria-label="Flow 목록">
        <p className="section-label">FLOWS · {flows.length}</p>
        {flows.map((flow) => (
          <div className="flow-list-row" key={flow.id}>
            <button className={`flow-list-item ${flow.id === activeFlowId ? "is-active" : ""}`} type="button" onClick={() => onSelectFlow(flow.id)}>
              <span>{flow.title}</span><small>{getNodeCount(flow)} nodes</small>
            </button>
            <button className="button button-danger flow-delete-button" type="button" aria-label={`${flow.title} 삭제`} onClick={() => onDeleteFlow(flow.id)}>삭제</button>
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        {workspaceRoot && onReturnToWorkspaceSelection && (
          <section className="workspace-switcher" aria-label="작업 폴더">
            <p className="section-label">WORKSPACE</p>
            <p className="workspace-path" title={workspaceRoot}>{workspaceRoot}</p>
            
            <button className="button workspace-select-button" type="button" onClick={onChooseWorkspace}>작업공간 선택하기</button>
          </section>
        )}
      <div className={`validation-panel ${validationErrors.length ? "has-errors" : ""}`}>
        <p className="section-label">FLOW CHECK</p>
        {validationErrors.length === 0 ? <p>✓ 구조가 올바릅니다</p> : <ul>{validationErrors.map((error) => <li key={error}>{error}</li>)}</ul>}
      </div>
      </div>
    </aside>
  );
}
