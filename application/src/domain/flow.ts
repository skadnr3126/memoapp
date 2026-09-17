export type BlockId = string;
export type FlowId = string;
export type LinkId = string;
export type Block = { id: BlockId; title?: string; markdown: string; createdAt: string; updatedAt: string };
export type Link = { id: LinkId; source: BlockId; target: BlockId };
export type Flow = { id: FlowId; title: string; blockIds: BlockId[]; links: Map<LinkId, Link> };
export type WorkspaceState = { blocks: Map<BlockId, Block>; flows: Map<FlowId, Flow>; activeFlowId?: FlowId };
export type CommandResult = { workspace: WorkspaceState };
export type BlockCommandResult = CommandResult & { blockId: BlockId };
export const createId = (prefix: string) => `${prefix}_${(globalThis.crypto?.randomUUID?.().split("-").join("") ?? Math.random().toString(36).slice(2)).slice(0, 12)}`;
export const linkPair = (a: string, b: string) => JSON.stringify([a, b].sort());
const cloneWorkspace = (workspace: WorkspaceState): WorkspaceState => ({
  ...workspace,
  blocks: new Map([...workspace.blocks].map(([id, block]) => [id, { ...block }])),
  flows: new Map([...workspace.flows].map(([id, flow]) => [id, {
    ...flow, blockIds: [...flow.blockIds], links: new Map([...flow.links].map(([key, link]) => [key, { ...link }])),
  }])),
});
const getFlow = (workspace: WorkspaceState, id: FlowId) => {
  const flow = workspace.flows.get(id);
  if (!flow) throw new Error("Flow를 찾을 수 없습니다.");
  return flow;
};
export const createWorkspace = (): WorkspaceState => ({ blocks: new Map(), flows: new Map() });
export const getDisplayTitle = (block: Block) => block.title?.trim() || block.markdown.split("\n")
  .map((line) => line.replace(/^#{1,6}\s*/, "").trim()).find(Boolean) || "제목 없음";
export const createFlow = (workspace: WorkspaceState, title = "새 Flow"): CommandResult & { flowId: FlowId } => {
  const next = cloneWorkspace(workspace);
  const flowId = createId("flow");
  next.flows.set(flowId, { id: flowId, title: title.trim() || "제목 없는 Flow", blockIds: [], links: new Map() });
  next.activeFlowId = flowId;
  return { workspace: next, flowId };
};
export const renameFlow = (workspace: WorkspaceState, flowId: FlowId, title: string): CommandResult => {
  const next = cloneWorkspace(workspace);
  getFlow(next, flowId).title = title.trim() || "제목 없는 Flow";
  return { workspace: next };
};
export const createBlock = (workspace: WorkspaceState, flowId: FlowId): BlockCommandResult => {
  const next = cloneWorkspace(workspace);
  const blockId = createId("blk");
  const timestamp = new Date().toISOString();
  getFlow(next, flowId).blockIds.push(blockId);
  next.blocks.set(blockId, { id: blockId, markdown: "", createdAt: timestamp, updatedAt: timestamp });
  return { workspace: next, blockId };
};
export const updateBlock = (workspace: WorkspaceState, blockId: BlockId, changes: Pick<Block, "title" | "markdown">): CommandResult => {
  const next = cloneWorkspace(workspace);
  const block = next.blocks.get(blockId);
  if (!block) throw new Error("Block을 찾을 수 없습니다.");
  Object.assign(block, changes, { title: changes.title?.trim() || undefined, updatedAt: new Date().toISOString() });
  return { workspace: next };
};
export const connectionError = (flow: Flow, source: BlockId, target: BlockId): string | undefined => {
  if (!flow.blockIds.includes(source) || !flow.blockIds.includes(target)) return "현재 Flow에 없는 블록입니다.";
  if (source === target) return "같은 블록끼리는 연결할 수 없습니다.";
  if ([...flow.links.values()].some((link) => linkPair(link.source, link.target) === linkPair(source, target))) return "이미 연결된 블록입니다.";
  return undefined;
};
export const connectBlocks = (workspace: WorkspaceState, flowId: FlowId, source: BlockId, target: BlockId): CommandResult => {
  const next = cloneWorkspace(workspace);
  const flow = getFlow(next, flowId);
  const error = connectionError(flow, source, target);
  if (error) throw new Error(error);
  const id = createId("link");
  flow.links.set(id, { id, source, target });
  return { workspace: next };
};
export const disconnectBlocks = (workspace: WorkspaceState, flowId: FlowId, linkId: LinkId): CommandResult => {
  const next = cloneWorkspace(workspace);
  if (!getFlow(next, flowId).links.delete(linkId)) throw new Error("연결을 찾을 수 없습니다.");
  return { workspace: next };
};
export const deleteBlock = (workspace: WorkspaceState, flowId: FlowId, blockId: BlockId): CommandResult => {
  const next = cloneWorkspace(workspace);
  const flow = getFlow(next, flowId);
  if (!flow.blockIds.includes(blockId)) throw new Error("현재 Flow에 없는 블록입니다.");
  flow.blockIds = flow.blockIds.filter((id) => id !== blockId);
  flow.links.forEach((link, id) => { if (link.source === blockId || link.target === blockId) flow.links.delete(id); });
  next.blocks.delete(blockId);
  return { workspace: next };
};
export const deleteFlow = (workspace: WorkspaceState, flowId: FlowId): CommandResult => {
  const next = cloneWorkspace(workspace);
  getFlow(next, flowId).blockIds.forEach((id) => next.blocks.delete(id));
  next.flows.delete(flowId);
  if (next.activeFlowId === flowId) next.activeFlowId = next.flows.keys().next().value;
  return { workspace: next };
};
export const validateWorkspace = (workspace: WorkspaceState): string[] => {
  const errors: string[] = [];
  const seen = new Set<string>();
  if (workspace.activeFlowId && !workspace.flows.has(workspace.activeFlowId)) errors.push("활성 Flow가 없습니다.");
  workspace.flows.forEach((flow, id) => {
    if (flow.id !== id) errors.push("Flow ID가 일치하지 않습니다.");
    const members = new Set(flow.blockIds);
    flow.blockIds.forEach((blockId) => {
      if (!workspace.blocks.has(blockId)) errors.push(`Block ${blockId}의 데이터가 없습니다.`);
      if (seen.has(blockId)) errors.push(`Block ${blockId}가 중복 배치되었습니다.`);
      seen.add(blockId);
    });
    const pairs = new Set<string>();
    flow.links.forEach((link, linkId) => {
      if (link.id !== linkId) errors.push("Link ID가 일치하지 않습니다.");
      if (!members.has(link.source) || !members.has(link.target)) errors.push(`Link ${linkId}의 끝점이 Flow에 없습니다.`);
      if (link.source === link.target) errors.push("자기 연결은 허용되지 않습니다.");
      const pair = linkPair(link.source, link.target);
      if (pairs.has(pair)) errors.push("중복 연결입니다.");
      pairs.add(pair);
    });
  });
  workspace.blocks.forEach((block, id) => {
    if (block.id !== id) errors.push("Block ID가 일치하지 않습니다.");
    if (!seen.has(id)) errors.push(`Block ${id}가 Flow에 없습니다.`);
  });
  return errors;
};
