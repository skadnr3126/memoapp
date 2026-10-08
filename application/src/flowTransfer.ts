import { deleteFlow, validateWorkspace, type WorkspaceState } from "./domain/flow";
import type { NodePositionsByFlow } from "./storage/repository";
import type { ViewportsByFlow } from "./storage/types";

type FlowContainer = { workspace: WorkspaceState; nodePositionsByFlow: NodePositionsByFlow; viewportByFlow: ViewportsByFlow };

export function transferFlow(source: FlowContainer, target: FlowContainer, flowId: string) {
  const flow = source.workspace.flows.get(flowId);
  if (!flow) throw new Error("이동할 플로우가 없습니다.");
  if (target.workspace.flows.has(flowId) || flow.blockIds.some(id => target.workspace.blocks.has(id))) {
    throw new Error("대상에 같은 ID의 데이터가 있습니다. 덮어쓰지 않았습니다.");
  }
  const blocks = new Map(target.workspace.blocks);
  for (const id of flow.blockIds) {
    const block = source.workspace.blocks.get(id);
    if (!block) throw new Error("이동할 블록 데이터가 없습니다.");
    blocks.set(id, block);
  }
  const nextTarget = {
    ...target,
    workspace: { ...target.workspace, blocks, flows: new Map(target.workspace.flows).set(flowId, flow), activeFlowId: flowId },
    nodePositionsByFlow: { ...target.nodePositionsByFlow, [flowId]: source.nodePositionsByFlow[flowId] ?? {} },
    viewportByFlow: { ...target.viewportByFlow, [flowId]: source.viewportByFlow[flowId] },
  };
  const { [flowId]: _positions, ...positions } = source.nodePositionsByFlow;
  const { [flowId]: _viewport, ...viewports } = source.viewportByFlow;
  const nextSource = { ...source, workspace: deleteFlow(source.workspace, flowId).workspace, nodePositionsByFlow: positions, viewportByFlow: viewports };
  const errors = [...validateWorkspace(nextSource.workspace), ...validateWorkspace(nextTarget.workspace)];
  if (errors.length) throw new Error(errors.join(" "));
  return { source: nextSource, target: nextTarget };
}
