import {
  Block,
  BlockId,
  Branch,
  BranchId,
  Flow,
  WorkspaceState,
  validateWorkspace,
} from "../domain/flow";
import {
  PersistedBranch,
  PersistedFlow,
  PersistedLayout,
  PersistedWorkspace,
  STORAGE_SCHEMA_VERSION,
} from "./types";

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}이(가) 없습니다.`);
  return value;
};

const requiredVersion = (value: unknown, label: string): number => {
  if (value !== STORAGE_SCHEMA_VERSION) throw new Error(`${label} 버전을 읽을 수 없습니다.`);
  return value;
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value as Record<string, unknown>;
};

const parseFrontmatterValue = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Fall through to a plain YAML scalar.
    }
  }
  return trimmed;
};

export const serializeBlock = (block: Block): string => {
  const lines = [
    "---",
    `version: ${STORAGE_SCHEMA_VERSION}`,
    `id: ${JSON.stringify(block.id)}`,
    ...(block.title ? [`title: ${JSON.stringify(block.title)}`] : []),
    `createdAt: ${JSON.stringify(block.createdAt)}`,
    `updatedAt: ${JSON.stringify(block.updatedAt)}`,
    "---",
    "",
  ];
  return `${lines.join("\n")}${block.markdown}`;
};

export const deserializeBlock = (source: string): Block => {
  if (!source.startsWith("---\n")) throw new Error("Block frontmatter가 없습니다.");
  const closingOffset = source.indexOf("\n---", 4);
  if (closingOffset === -1) throw new Error("Block frontmatter가 닫히지 않았습니다.");

  const metadata: Record<string, string> = {};
  source.slice(4, closingOffset).split("\n").forEach((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error("Block frontmatter 항목이 올바르지 않습니다.");
    metadata[line.slice(0, separator).trim()] = parseFrontmatterValue(line.slice(separator + 1));
  });

  requiredVersion(Number(metadata.version), "Block schema");
  const id = requiredString(metadata.id, "Block ID");
  const createdAt = requiredString(metadata.createdAt, "Block 생성 시각");
  const updatedAt = requiredString(metadata.updatedAt, "Block 수정 시각");
  const title = metadata.title?.trim() || undefined;
  const afterClosing = source.slice(closingOffset + 4);
  const markdown = afterClosing.startsWith("\n") ? afterClosing.slice(1) : afterClosing;

  return { id, title, markdown, createdAt, updatedAt };
};

const serializeBranch = (branchId: BranchId, flow: Flow): PersistedBranch => {
  const branch = flow.branches.get(branchId);
  if (!branch) throw new Error(`저장할 Branch ${branchId}를 찾을 수 없습니다.`);
  const branches: Record<string, PersistedBranch[]> = {};
  branch.childBranchIdsByBlockId.forEach((childBranchIds, blockId) => {
    branches[blockId] = childBranchIds.map((childBranchId) => serializeBranch(childBranchId, flow));
  });
  return { id: branch.id, ...(branch.title ? { title: branch.title } : {}), items: [...branch.itemIds], branches };
};

export const serializeFlow = (flow: Flow): PersistedFlow => ({
  version: STORAGE_SCHEMA_VERSION,
  id: flow.id,
  title: flow.title,
  root: serializeBranch(flow.rootBranchId, flow),
});

const parseBranch = (
  value: unknown,
  parentBranchId: BranchId | undefined,
  parentBlockId: BlockId | undefined,
  branches: Map<BranchId, Branch>,
): BranchId => {
  const source = asRecord(value, "Branch");
  const id = requiredString(source.id, "Branch ID");
  if (branches.has(id)) throw new Error(`Branch ID ${id}가 중복되었습니다.`);
  if (!Array.isArray(source.items) || source.items.some((item) => typeof item !== "string" || !item)) {
    throw new Error(`Branch ${id}의 items 형식이 올바르지 않습니다.`);
  }
  const rawBranches = asRecord(source.branches, `Branch ${id}의 branches`);
  const branch: Branch = {
    id,
    ...(typeof source.title === "string" && source.title.trim() ? { title: source.title.trim() } : {}),
    ...(parentBranchId ? { parentBranchId } : {}),
    ...(parentBlockId ? { parentBlockId } : {}),
    itemIds: [...source.items],
    childBranchIdsByBlockId: new Map(),
  };
  branches.set(id, branch);

  Object.entries(rawBranches).forEach(([blockId, rawChildren]) => {
    if (!branch.itemIds.includes(blockId)) throw new Error(`Branch ${id}에 없는 Block ${blockId}의 갈래입니다.`);
    if (!Array.isArray(rawChildren)) throw new Error(`Block ${blockId}의 갈래 목록 형식이 올바르지 않습니다.`);
    const childIds = rawChildren.map((child) => parseBranch(child, id, blockId, branches));
    if (childIds.length) branch.childBranchIdsByBlockId.set(blockId, childIds);
  });
  return id;
};

export const deserializeFlow = (value: unknown): Flow => {
  const source = asRecord(value, "Flow");
  requiredVersion(source.version, "Flow schema");
  const id = requiredString(source.id, "Flow ID");
  const title = requiredString(source.title, "Flow 제목");
  const branches = new Map<BranchId, Branch>();
  const rootBranchId = parseBranch(source.root, undefined, undefined, branches);
  return { id, title, rootBranchId, branches };
};

export const serializeWorkspaceMetadata = (workspace: WorkspaceState): PersistedWorkspace => ({
  version: STORAGE_SCHEMA_VERSION,
  ...(workspace.activeFlowId ? { activeFlowId: workspace.activeFlowId } : {}),
});

export const deserializeWorkspaceMetadata = (value: unknown): PersistedWorkspace => {
  const source = asRecord(value, "workspace.json");
  requiredVersion(source.version, "Workspace schema");
  if (source.activeFlowId !== undefined && typeof source.activeFlowId !== "string") {
    throw new Error("활성 Flow ID 형식이 올바르지 않습니다.");
  }
  return { version: STORAGE_SCHEMA_VERSION, ...(source.activeFlowId ? { activeFlowId: source.activeFlowId } : {}) };
};

export const emptyLayout = (): PersistedLayout => ({ version: STORAGE_SCHEMA_VERSION, nodePositionsByFlow: {} });

export const deserializeLayout = (value: unknown): PersistedLayout => {
  const source = asRecord(value, "layout.json");
  requiredVersion(source.version, "Layout schema");
  const rawPositions = asRecord(source.nodePositionsByFlow, "layout의 좌표");
  const nodePositionsByFlow: PersistedLayout["nodePositionsByFlow"] = {};
  Object.entries(rawPositions).forEach(([flowId, positions]) => {
    const rawFlowPositions = asRecord(positions, `${flowId}의 좌표`);
    nodePositionsByFlow[flowId] = {};
    Object.entries(rawFlowPositions).forEach(([blockId, position]) => {
      const point = asRecord(position, `${blockId}의 좌표`);
      if (typeof point.x !== "number" || typeof point.y !== "number") throw new Error(`${blockId}의 좌표 형식이 올바르지 않습니다.`);
      nodePositionsByFlow[flowId][blockId] = { x: point.x, y: point.y };
    });
  });
  return { version: STORAGE_SCHEMA_VERSION, nodePositionsByFlow };
};

export const restoreWorkspace = (
  blocks: Iterable<Block>,
  flows: Iterable<Flow>,
  metadata: PersistedWorkspace,
): WorkspaceState => {
  const workspace: WorkspaceState = {
    blocks: new Map([...blocks].map((block) => [block.id, block])),
    flows: new Map([...flows].map((flow) => [flow.id, flow])),
    ...(metadata.activeFlowId ? { activeFlowId: metadata.activeFlowId } : {}),
  };
  const errors = validateWorkspace(workspace);
  if (errors.length) throw new Error(`저장된 Flow 구조가 올바르지 않습니다: ${errors.join(" ")}`);
  return workspace;
};
