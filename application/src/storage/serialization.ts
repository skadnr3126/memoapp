import { Block, Flow, Link, WorkspaceState, validateWorkspace } from "../domain/flow";
import { PersistedFlow, PersistedLayout, PersistedWorkspace, BLOCK_SCHEMA_VERSION, FLOW_SCHEMA_VERSION, LAYOUT_SCHEMA_VERSION, WORKSPACE_SCHEMA_VERSION } from "./types";
const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}이(가) 없습니다.`);
  return value;
};

const requiredVersion = (value: unknown, label: string): number => {
  if (value !== BLOCK_SCHEMA_VERSION) throw new Error(`${label} 버전을 읽을 수 없습니다.`);
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
    `version: ${BLOCK_SCHEMA_VERSION}`,
    `id: ${JSON.stringify(block.id)}`,
    ...(block.title !== undefined ? [`title: ${JSON.stringify(block.title)}`] : []),
    `createdAt: ${JSON.stringify(block.createdAt)}`,
    `updatedAt: ${JSON.stringify(block.updatedAt)}`,
    "---",
    "",
  ];
  return `${lines.join("\n")}${block.markdown}`;
};

export const deserializeBlock = (source: string): Block => {
  const content = source.trimStart();
  const opening = /^---\r?\n/.exec(content);
  if (!opening) throw new Error("Block frontmatter가 없습니다.");
  const closing = /\r?\n---(?=\r?\n|$)/.exec(content.slice(opening[0].length));
  if (!closing) throw new Error("Block frontmatter가 닫히지 않았습니다.");
  const closingOffset = opening[0].length + closing.index;

  const metadata: Record<string, string> = {};
  content.slice(opening[0].length, closingOffset).split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error("Block frontmatter 항목이 올바르지 않습니다.");
    metadata[line.slice(0, separator).trim()] = parseFrontmatterValue(line.slice(separator + 1));
  });

  requiredVersion(Number(metadata.version), "Block schema");
  const id = requiredString(metadata.id, "Block ID");
  const createdAt = requiredString(metadata.createdAt, "Block 생성 시각");
  const updatedAt = requiredString(metadata.updatedAt, "Block 수정 시각");
  const title = metadata.title;
  const afterClosing = content.slice(closingOffset + closing[0].length);
  const markdown = afterClosing.replace(/^\r?\n/, "");

  return { id, title, markdown, createdAt, updatedAt };
};

export const serializeFlow = (flow: Flow): PersistedFlow => ({
  version: FLOW_SCHEMA_VERSION, id: flow.id, title: flow.title,
  blocks: [...flow.blockIds], links: [...flow.links.values()].map((link) => ({ ...link })),
});

const stringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) throw new Error(label + " 목록이 올바르지 않습니다.");
  return value.map((id) => requiredString(id, label));
};

// Legacy tree traversal is confined to the import boundary. Coordinates use scale 1.
export const importFlow = (value: unknown): { flow: Flow; legacyPositions?: Record<string, { x: number; y: number }> } => {
  const source = asRecord(value, "Flow");
  const id = requiredString(source.id, "Flow ID");
  if (typeof source.title !== "string") throw new Error("Flow 제목 형식이 올바르지 않습니다.");
  const title = source.title;
  if (source.version === FLOW_SCHEMA_VERSION) {
    if (!Array.isArray(source.links)) throw new Error("links 목록이 올바르지 않습니다.");
    const links = new Map<string, Link>();
    for (const raw of source.links) {
      const item = asRecord(raw, "Link");
      const link = { id: requiredString(item.id, "Link ID"), source: requiredString(item.source, "source"), target: requiredString(item.target, "target") };
      if (links.has(link.id)) throw new Error("중복 Link ID입니다.");
      links.set(link.id, link);
    }
    return { flow: { id, title, blockIds: stringArray(source.blocks, "Block ID"), links } };
  }
  if (source.version !== 1) throw new Error("Flow 버전을 읽을 수 없습니다.");
  const flow: Flow = { id, title, blockIds: [], links: new Map() };
  const positions: Record<string, { x: number; y: number }> = Object.create(null);
  const branchIds = new Set<string>();
  const blockIds = new Set<string>();
  let lane = 0;
  const addLink = (a: string, b: string) => {
    const linkId = "link_legacy_" + flow.links.size;
    flow.links.set(linkId, { id: linkId, source: a, target: b });
  };
  const visit = (raw: unknown, column: number, parent?: string) => {
    const branch = asRecord(raw, "Branch");
    const branchId = requiredString(branch.id, "Branch ID");
    if (branchIds.has(branchId)) throw new Error("중복 Branch ID입니다.");
    branchIds.add(branchId);
    const items = stringArray(branch.items, "Branch items");
    const children = asRecord(branch.branches, "branches");
    const row = lane++;
    items.forEach((blockId, index) => {
      if (blockIds.has(blockId)) throw new Error("중복 Block ID입니다.");
      blockIds.add(blockId);
      flow.blockIds.push(blockId);
      positions[blockId] = { x: 36 + (column + index) * 262, y: 71 + row * 117 };
      if (index) addLink(items[index - 1], blockId);
    });
    if (parent && items.length) addLink(parent, items[0]);
    for (const [blockId, rawChildren] of Object.entries(children)) {
      if (!items.includes(blockId) || !Array.isArray(rawChildren)) throw new Error("잘못된 Branch 부모 참조입니다.");
    }
    items.forEach((blockId, index) => {
      ((children[blockId] as unknown[] | undefined) ?? []).forEach((child) => visit(child, column + index, blockId));
    });
  };
  visit(source.root, 0);
  return { flow, legacyPositions: positions };
};
export const deserializeFlow = (value: unknown): Flow => importFlow(value).flow;

export const serializeWorkspaceMetadata = (workspace: WorkspaceState): PersistedWorkspace => ({
  version: WORKSPACE_SCHEMA_VERSION,
  ...(workspace.activeFlowId ? { activeFlowId: workspace.activeFlowId } : {}),
});

export const deserializeWorkspaceMetadata = (value: unknown): PersistedWorkspace => {
  const source = asRecord(value, "workspace.json");
  if (source.version !== WORKSPACE_SCHEMA_VERSION) throw new Error("Workspace 버전을 읽을 수 없습니다.");
  if (source.activeFlowId !== undefined && typeof source.activeFlowId !== "string") {
    throw new Error("활성 Flow ID 형식이 올바르지 않습니다.");
  }
  return { version: WORKSPACE_SCHEMA_VERSION, ...(source.activeFlowId ? { activeFlowId: source.activeFlowId } : {}) };
};

export const emptyLayout = (): PersistedLayout => ({ version: LAYOUT_SCHEMA_VERSION, nodePositionsByFlow: {} });

export const deserializeLayout = (value: unknown): PersistedLayout => {
  const source = asRecord(value, "layout.json");
  if (source.version !== 1 && source.version !== LAYOUT_SCHEMA_VERSION) throw new Error("Layout 버전을 읽을 수 없습니다.");
  const rawPositions = asRecord(source.nodePositionsByFlow, "layout의 좌표");
  const nodePositionsByFlow: PersistedLayout["nodePositionsByFlow"] = Object.create(null);
  Object.entries(rawPositions).forEach(([flowId, positions]) => {
    const rawFlowPositions = asRecord(positions, `${flowId}의 좌표`);
    nodePositionsByFlow[flowId] = Object.create(null);
    Object.entries(rawFlowPositions).forEach(([blockId, position]) => {
      const point = asRecord(position, `${blockId}의 좌표`);
      if (typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`${blockId}의 좌표 형식이 올바르지 않습니다.`);
      nodePositionsByFlow[flowId][blockId] = { x: point.x, y: point.y };
      for (const dimension of ["width", "height"] as const) {
        const size = point[dimension];
        if (size === undefined) continue;
        if (typeof size !== "number" || !Number.isFinite(size) || size < (dimension === "width" ? 80 : 72)) throw new Error(`${blockId}의 크기가 올바르지 않습니다.`);
        nodePositionsByFlow[flowId][blockId]![dimension] = size;
      }
    });
  });
  return { version: source.version, nodePositionsByFlow };
};

export const restoreWorkspace = (
  blocks: Iterable<Block>,
  flows: Iterable<Flow>,
  metadata: PersistedWorkspace,
): WorkspaceState => {
  const blockList = [...blocks];
  const flowList = [...flows];
  if (new Set(blockList.map((b) => b.id)).size !== blockList.length || new Set(flowList.map((f) => f.id)).size !== flowList.length) throw new Error("중복 파일 ID입니다.");
  const workspace: WorkspaceState = {
    blocks: new Map(blockList.map((block) => [block.id, block])),
    flows: new Map(flowList.map((flow) => [flow.id, flow])),
    ...(metadata.activeFlowId ? { activeFlowId: metadata.activeFlowId } : {}),
  };
  const errors = validateWorkspace(workspace);
  if (errors.length) throw new Error(`저장된 Flow 구조가 올바르지 않습니다: ${errors.join(" ")}`);
  return workspace;
};
