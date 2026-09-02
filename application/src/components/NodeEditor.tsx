import { FormEvent, useState } from "react";
import { Block, BlockId, Branch, BranchId, Flow } from "../domain/flow";

type NodeEditorProps = {
  flow: Flow;
  block?: Block;
  draftTitle: string;
  draftMarkdown: string;
  onClose: () => void;
  onDraftTitleChange: (title: string) => void;
  onDraftMarkdownChange: (markdown: string) => void;
  onSave: (blockId: BlockId, title: string, markdown: string) => void;
  onAddAfter: (blockId: BlockId) => void;
  onCreateBranch: (blockId: BlockId) => void;
  onMoveByOffset: (blockId: BlockId, offset: -1 | 1) => void;
  onMove: (blockId: BlockId, targetBranchId: BranchId) => void;
  onDelete: (blockId: BlockId) => void;
};

const getBranchLabel = (flow: Flow, branch: Branch) =>
  branch.id === flow.rootBranchId ? "주 흐름" : branch.title?.trim() || "이름 없는 갈래";

export function NodeEditor({ flow, block, draftTitle, draftMarkdown, onClose, onDraftTitleChange, onDraftMarkdownChange, onSave, onAddAfter, onCreateBranch, onMoveByOffset, onMove, onDelete }: NodeEditorProps) {
  const [blockMoveTarget, setBlockMoveTarget] = useState<BranchId>("");

  if (!block) {
    return (
      <aside className="node-editor node-editor-empty" aria-label="빈 노드 편집 창">
        <header className="node-editor-header"><div><p className="eyebrow">NODE EDITOR</p><h2>노드 내용 편집</h2></div><button className="editor-close" type="button" onClick={onClose} aria-label="편집 창 닫기">×</button></header>
        <div className="editor-empty-state"><span aria-hidden="true">○</span><p>선택된 노드가 없습니다.</p><small>왼쪽 플로우에서 노드를 선택하면 이곳에서 내용을 편집할 수 있습니다.</small></div>
      </aside>
    );
  }

  const saveBlock = (event: FormEvent) => { event.preventDefault(); onSave(block.id, draftTitle, draftMarkdown); };
  return (
    <form className="node-editor" aria-labelledby="node-editor-title" onSubmit={saveBlock}>
      <header className="node-editor-header"><div><p className="eyebrow">NODE EDITOR</p><h2 id="node-editor-title">노드 내용 편집</h2></div><button className="editor-close" type="button" onClick={onClose} aria-label="편집 창 닫기">×</button></header>
      <label className="editor-field"><span>제목</span><input value={draftTitle} onChange={(event) => onDraftTitleChange(event.currentTarget.value)} placeholder="노드 제목" /></label>
      <label className="editor-field"><span>내용</span><textarea value={draftMarkdown} onChange={(event) => onDraftMarkdownChange(event.currentTarget.value)} placeholder="생각을 자세히 적어보세요…" rows={12} /></label>
      <div className="editor-structure-actions">
        <button className="button button-quiet" type="button" onClick={() => onAddAfter(block.id)}>다음 노드</button>
        <button className="button button-quiet" type="button" onClick={() => onCreateBranch(block.id)}>갈래 만들기</button>
        <button className="button button-quiet" type="button" onClick={() => onMoveByOffset(block.id, -1)}>← 순서</button>
        <button className="button button-quiet" type="button" onClick={() => onMoveByOffset(block.id, 1)}>순서 →</button>
      </div>
      <div className="editor-move-row">
        <select value={blockMoveTarget} onChange={(event) => setBlockMoveTarget(event.target.value)} aria-label="노드 이동 대상 갈래">
          <option value="">다른 갈래로 이동…</option>
          {[...flow.branches.values()].map((branch) => <option key={branch.id} value={branch.id}>{getBranchLabel(flow, branch)}</option>)}
        </select>
        <button className="button button-quiet" type="button" disabled={!blockMoveTarget} onClick={() => blockMoveTarget && onMove(block.id, blockMoveTarget)}>이동</button>
      </div>
      <footer className="node-editor-footer">
        <button className="button button-danger" type="button" onClick={() => { if (window.confirm("이 노드부터 이어지는 흐름을 삭제할까요?")) onDelete(block.id); }}>삭제</button>
        <div><button className="button button-quiet" type="button" onClick={onClose}>닫기</button><button className="button button-primary" type="submit">저장</button></div>
      </footer>
    </form>
  );
}
