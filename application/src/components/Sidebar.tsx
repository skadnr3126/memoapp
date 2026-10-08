import { useRef, useState, type PointerEvent } from "react";
import type { Flow } from "../domain/flow";

export type FlowGroup = { root: string; title: string; flows: Flow[]; independent: boolean };
type Props = {
  collapsed?: boolean; groups: FlowGroup[]; activeRoot?: string; activeFlowId?: string; validationErrors: string[];
  onCreateFlow: (root: string) => void;
  onSelectFlow: (root: string, flowId: string) => void;
  onDeleteFlow: (root: string, flowId: string) => void;
  onMoveFlow: (sourceRoot: string, targetRoot: string, flowId: string) => void;
  onAddWorkspace: () => void;
  onChooseWorkspace?: () => void;
};

export function Sidebar({ collapsed = false, groups, activeRoot, activeFlowId, validationErrors, onCreateFlow, onSelectFlow, onDeleteFlow, onMoveFlow, onAddWorkspace, onChooseWorkspace }: Props) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [workspacesFolded, setWorkspacesFolded] = useState(false);
  const [dropTarget, setDropTarget] = useState<string>();
  const drag = useRef<{ root: string; id: string; pointer: number; x: number; y: number; moved: boolean; target?: string } | undefined>(undefined);
  const suppressClick = useRef(false);
  const independent = groups.find(group => group.independent);
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    current.moved = true;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-flow-target]")?.dataset.flowTarget;
    current.target = target !== current.root ? target : undefined;
    setDropTarget(current.target);
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    suppressClick.current = current.moved;
    drag.current = undefined; setDropTarget(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && current.moved && current.target) onMoveFlow(current.root, current.target, current.id);
  };
  const groupSection = (group: FlowGroup) => <section key={group.root} className={`flow-group${dropTarget === group.root ? " is-drop-target" : ""}`} data-flow-target={group.root} aria-label={group.title}>
    <div className="flow-group-heading">
      <button className="flow-group-toggle" type="button" aria-expanded={!folded.has(group.root)} onClick={() => setFolded(current => {
        const next = new Set(current); if (next.has(group.root)) next.delete(group.root); else next.add(group.root); return next;
      })}><span aria-hidden="true">{folded.has(group.root) ? "▸" : "▾"}</span> {group.title} <small>{group.flows.length}</small></button>
      {!group.independent && <button className="button flow-group-add" type="button" aria-label={`${group.title}에 새 플로우`} onClick={() => onCreateFlow(group.root)}>+</button>}
    </div>
    {!folded.has(group.root) && <div className="flow-group-items">
      {group.flows.length === 0 && <p className="flow-group-empty">{group.independent ? "새 플로우를 만들거나 여기로 옮기세요." : "플로우를 여기로 옮길 수 있습니다."}</p>}
      {group.flows.map(flow => <div className="flow-list-row" key={flow.id}>
        <button className={`flow-list-item ${group.root === activeRoot && flow.id === activeFlowId ? "is-active" : ""}`} type="button"
          data-flow-id={flow.id} title="드래그하여 다른 작업공간으로 이동"
          onPointerDown={event => {
            suppressClick.current = false;
            if (event.button !== 0) return;
            drag.current = { root: group.root, id: flow.id, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
          onDragStart={event => event.preventDefault()}
          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelectFlow(group.root, flow.id); }}>
          <span>{flow.title}</span><small>{flow.blockIds.length} nodes</small>
        </button>
        <button className="button button-danger flow-delete-button" type="button" aria-label={`${flow.title} 삭제`} onClick={() => onDeleteFlow(group.root, flow.id)}>삭제</button>
      </div>)}
    </div>}
  </section>;

  return <aside id="flow-sidebar" className="sidebar" hidden={collapsed}>
    <button className="button button-primary independent-create" type="button" disabled={!independent} onClick={() => independent && onCreateFlow(independent.root)}>+ 새 플로우</button>
    <nav className="flow-list" aria-label="Flow 목록">
      {independent && groupSection(independent)}
      <button className="flow-group-toggle workspace-groups-toggle" type="button" aria-expanded={!workspacesFolded} onClick={() => setWorkspacesFolded(current => !current)}><span aria-hidden="true">{workspacesFolded ? "▸" : "▾"}</span> 작업공간 <small>{groups.filter(group => !group.independent).length}</small></button>
      {!workspacesFolded && groups.filter(group => !group.independent).map(groupSection)}
    </nav>
    <div className="sidebar-footer">
      <button className="button workspace-add-button" type="button" onClick={onAddWorkspace}>작업공간 추가하기</button>
      {onChooseWorkspace && <button className="button workspace-select-button" type="button" onClick={onChooseWorkspace}>현재 작업공간 바꾸기</button>}
      <div className={`validation-panel ${validationErrors.length ? "has-errors" : ""}`}><p className="section-label">FLOW CHECK</p>
        {validationErrors.length === 0 ? <p>✓ 구조가 올바릅니다</p> : <ul>{validationErrors.map(error => <li key={error}>{error}</li>)}</ul>}
      </div>
    </div>
  </aside>;
}
