import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { BlockId, WorkspaceState, validateWorkspace } from "../domain/flow";
import { defaultPosition, findFreePosition } from "../domain/layout";
import {
  deserializeBlock,
  importFlow,
  deserializeLayout,
  deserializeWorkspaceMetadata,
  emptyLayout,
  restoreWorkspace,
  serializeBlock,
  serializeFlow,
  serializeWorkspaceMetadata,
} from "./serialization";
import { PersistedLayout, PersistedNodePosition, ViewportsByFlow } from "./types";

export type NodePositionsByFlow = Record<string, Record<BlockId, PersistedNodePosition | undefined>>;

type StorageFile = {
  relativePath: string;
  content: string;
};

export type LoadedWorkspace = {
  workspaceRoot: string;
  blockFiles: StorageFile[];
  flowFiles: StorageFile[];
  workspace?: string;
  layout?: string;
  recoveryNotice?: string;
};

type WorkspaceSnapshot = {
  blockFiles: StorageFile[];
  flowFiles: StorageFile[];
  workspace: string;
  layout: string;
};

export type LoadedWorkspaceState = {
  workspaceRoot: string;
  workspace: WorkspaceState;
  nodePositionsByFlow: NodePositionsByFlow;
  viewportByFlow: ViewportsByFlow;
  recoveryNotice?: string;
};

export const isDesktopRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const parseJson = (source: string, label: string): unknown => {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} JSON을 읽을 수 없습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
  }
};

const safeId = (id: string, label: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`${label}에 허용되지 않은 문자가 있습니다.`);
  return id;
};

const blockRelativePath = (id: string, createdAt: string): string => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.valueOf())) throw new Error(`Block ${id}의 생성 시각이 올바르지 않습니다.`);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `blocks/${year}/${month}/${safeId(id, "Block ID")}.md`;
};

const flowDirectory = (id: string): string => `flows/${safeId(id, "Flow ID")}`;

const cleanLayout = (layout: PersistedLayout, workspace: WorkspaceState): NodePositionsByFlow => {
  const result: NodePositionsByFlow = Object.create(null);
  workspace.flows.forEach((flow, flowId) => {
    const positions = layout.nodePositionsByFlow[flowId] ?? {};
    const validBlockIds = new Set(flow.blockIds);
    const entries = Object.entries(positions).filter(([blockId]) => validBlockIds.has(blockId));
    const resolved = Object.fromEntries(entries);
    flow.blockIds.forEach((id, index) => {
      if (!resolved[id]) resolved[id] = findFreePosition(Object.values(resolved).filter((p): p is PersistedNodePosition => !!p), defaultPosition(index));
    });
    result[flowId] = resolved;
  });
  return result;
};

export const snapshotFor = (workspace: WorkspaceState, nodePositionsByFlow: NodePositionsByFlow, viewportByFlow: ViewportsByFlow = {}): WorkspaceSnapshot => {
  const errors = validateWorkspace(workspace);
  if (errors.length) throw new Error(errors.join(" "));
  const layout = deserializeLayout({ version: 2, nodePositionsByFlow, viewportByFlow: Object.fromEntries(Object.entries(viewportByFlow).filter(([id]) => workspace.flows.has(id))) });
  layout.nodePositionsByFlow = cleanLayout(layout, workspace);
  return {
    blockFiles: [...workspace.flows.values()].flatMap(flow => flow.blockIds.map(id => {
      const block = workspace.blocks.get(id)!;
      return { relativePath: `${flowDirectory(flow.id)}/${blockRelativePath(block.id, block.createdAt)}`, content: serializeBlock(block) };
    })),
    flowFiles: [...workspace.flows.values()].flatMap(flow => [
      { relativePath: `${flowDirectory(flow.id)}/flow.json`, content: `${JSON.stringify(serializeFlow(flow), null, 2)}\n` },
      { relativePath: `${flowDirectory(flow.id)}/layout.json`, content: `${JSON.stringify({ version: 2,
        nodePositionsByFlow: { [flow.id]: layout.nodePositionsByFlow[flow.id] },
        viewportByFlow: layout.viewportByFlow[flow.id] ? { [flow.id]: layout.viewportByFlow[flow.id] } : {},
      }, null, 2)}\n` },
    ]),
    workspace: `${JSON.stringify(serializeWorkspaceMetadata(workspace), null, 2)}\n`,
    layout: `${JSON.stringify(layout, null, 2)}\n`,
  };
};

export const chooseNativeWorkspace = async (): Promise<string | undefined> => {
  if (!isDesktopRuntime()) return undefined;
  const selection = await open({
    directory: true,
    multiple: false,
    title: "Flow Memo 작업공간 폴더 선택",
  });
  return typeof selection === "string" ? selection : undefined;
};

export const decodeWorkspace = (loaded: LoadedWorkspace): LoadedWorkspaceState & { needsMigration: boolean } => {
  const blocks = loaded.blockFiles.map((file) => deserializeBlock(file.content));
  const blockPaths = new Map(blocks.map((block, index) => [block.id, loaded.blockFiles[index].relativePath]));
  const files = loaded.flowFiles.filter(file => !file.relativePath.endsWith("/layout.json"));
  const imports = files.map((file) => importFlow(parseJson(file.content, file.relativePath)));
  const metadata = loaded.workspace ? deserializeWorkspaceMetadata(parseJson(loaded.workspace, "workspace.json")) : { version: 1 };
  const workspace = restoreWorkspace(blocks, imports.map((item) => item.flow), metadata);
  for (const [index, file] of files.entries()) {
    if (!file.relativePath.endsWith("/flow.json")) continue;
    const flow = imports[index].flow;
    if (file.relativePath !== `${flowDirectory(flow.id)}/flow.json`) throw new Error("플로우 폴더와 데이터의 ID가 일치하지 않습니다.");
    for (const id of flow.blockIds) {
      if (!blockPaths.get(id)?.startsWith(`${flowDirectory(flow.id)}/blocks/`)) throw new Error("플로우의 블록이 다른 저장 폴더에 있습니다.");
    }
  }
  const layout = loaded.layout ? deserializeLayout(parseJson(loaded.layout, "layout.json")) : emptyLayout();
  for (const file of loaded.flowFiles.filter(file => file.relativePath.endsWith("/layout.json"))) {
    const individual = deserializeLayout(parseJson(file.content, file.relativePath));
    Object.assign(layout.nodePositionsByFlow, individual.nodePositionsByFlow);
    Object.assign(layout.viewportByFlow, individual.viewportByFlow);
  }
  const legacy = imports.filter((item) => item.legacyPositions);
  if (loaded.layout && ((legacy.length && layout.version !== 1) || (layout.version === 1 && imports.some((item) => !item.legacyPositions)))) {
    throw new Error("Flow와 layout 버전이 혼재되어 있습니다. 변환 백업을 확인하세요.");
  }
  for (const { flow, legacyPositions } of legacy) {
    const offsets = layout.nodePositionsByFlow[flow.id] ?? {};
    layout.nodePositionsByFlow[flow.id] = Object.fromEntries(Object.entries(legacyPositions!).map(([id, base]) => [id, {
      x: base.x + (offsets[id]?.x ?? 0), y: base.y + (offsets[id]?.y ?? 0),
    }]));
  }
  return { workspaceRoot: loaded.workspaceRoot, workspace, nodePositionsByFlow: cleanLayout(layout, workspace),
    viewportByFlow: layout.viewportByFlow, recoveryNotice: loaded.recoveryNotice, needsMigration: legacy.length > 0 || layout.version === 1 ||
      loaded.flowFiles.some(file => /^flows\/[^/]+\.json$/.test(file.relativePath)) || loaded.blockFiles.some(file => file.relativePath.startsWith("blocks/")) };
};
export const openNativeWorkspace = async (workspaceRoot: string, standalone = false): Promise<LoadedWorkspaceState> => {
  if (!isDesktopRuntime()) throw new Error("파일 저장은 데스크톱 앱에서만 사용할 수 있습니다.");
  const loaded = await invoke<LoadedWorkspace>("open_workspace", { workspaceRoot, standalone });
  const decoded = decodeWorkspace(loaded);
  if (decoded.needsMigration) {
    await invoke("migrate_workspace", { workspaceRoot, standalone, snapshot: snapshotFor(decoded.workspace, decoded.nodePositionsByFlow, decoded.viewportByFlow) });
    const verified = decodeWorkspace(await invoke<LoadedWorkspace>("open_workspace", { workspaceRoot, standalone }));
    if (verified.needsMigration) throw new Error("변환 결과를 확인할 수 없습니다.");
    const expected = snapshotFor(decoded.workspace, decoded.nodePositionsByFlow, decoded.viewportByFlow);
    const actual = snapshotFor(verified.workspace, verified.nodePositionsByFlow, verified.viewportByFlow);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("변환 후 데이터가 원래 내용과 일치하지 않습니다. .memo/backups를 확인하세요.");
    return { ...verified, recoveryNotice: "기존 블록과 연결을 변환했습니다. 원본은 .memo/backups에 보관했습니다." };
  }
  return decoded;
};

export const saveNativeWorkspace = async (
  workspaceRoot: string,
  workspace: WorkspaceState,
  nodePositionsByFlow: NodePositionsByFlow,
  viewportByFlow: ViewportsByFlow = {},
  standalone = false,
): Promise<void> => {
  if (!isDesktopRuntime()) return;
  await invoke("save_workspace_snapshot", { workspaceRoot, standalone, snapshot: snapshotFor(workspace, nodePositionsByFlow, viewportByFlow) });
};
