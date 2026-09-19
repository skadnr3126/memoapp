import { emitTo, listen } from "@tauri-apps/api/event";
import { EDITOR_FLUSH, EDITOR_FLUSHED, type EditorFlushResult } from "./editorProtocol";
import { type WorkspaceState, validateWorkspace } from "./domain/flow";

export function flowSummaryInput(workspace: WorkspaceState, flowId: string) {
  const errors = validateWorkspace(workspace);
  if (errors.length) throw new Error(errors.join(" "));
  const flow = workspace.flows.get(flowId);
  if (!flow) throw new Error("요약할 Flow가 없습니다.");
  return { id: flow.id, title: flow.title,
    blocks: flow.blockIds.map(id => ({ ...workspace.blocks.get(id)! })),
    links: [...flow.links.values()].map(link => ({ ...link })),
  };
}

export async function flushEditor() {
  const requestId = crypto.randomUUID();
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const completed = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  const stop = await listen<EditorFlushResult>(EDITOR_FLUSHED, ({ payload }) => {
    if (payload.requestId !== requestId) return;
    if (payload.error) reject(new Error(payload.error)); else resolve();
  });
  const timer = window.setTimeout(() => reject(new Error("편집 창 저장 확인 시간이 초과되었습니다. 편집 내용을 저장한 뒤 다시 시도하세요.")), 10000);
  try {
    await Promise.all([completed, emitTo("editor", EDITOR_FLUSH, { requestId })]);
  } finally { window.clearTimeout(timer); stop(); }
}
