import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { BlockId, WorkspaceState, createWorkspace } from "../domain/flow";
import {
  deserializeBlock,
  deserializeFlow,
  deserializeLayout,
  deserializeWorkspaceMetadata,
  emptyLayout,
  restoreWorkspace,
  serializeBlock,
  serializeFlow,
  serializeWorkspaceMetadata,
} from "./serialization";
import { PersistedLayout, PersistedNodePosition } from "./types";

export type NodePositionsByFlow = Record<string, Record<BlockId, PersistedNodePosition | undefined>>;

type StorageFile = {
  relativePath: string;
  content: string;
};

type LoadedWorkspace = {
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

const flowRelativePath = (id: string): string => `flows/${safeId(id, "Flow ID")}.json`;

const cleanLayout = (layout: PersistedLayout, workspace: WorkspaceState): NodePositionsByFlow => {
  const result: NodePositionsByFlow = {};
  workspace.flows.forEach((flow, flowId) => {
    const positions = layout.nodePositionsByFlow[flowId];
    if (!positions) return;
    const validBlockIds = new Set<string>();
    flow.branches.forEach((branch) => branch.itemIds.forEach((blockId) => validBlockIds.add(blockId)));
    const entries = Object.entries(positions).filter(([blockId]) => validBlockIds.has(blockId));
    if (entries.length) result[flowId] = Object.fromEntries(entries);
  });
  return result;
};

const snapshotFor = (workspace: WorkspaceState, nodePositionsByFlow: NodePositionsByFlow): WorkspaceSnapshot => {
  const layout: PersistedLayout = { version: 1, nodePositionsByFlow };
  return {
    blockFiles: [...workspace.blocks.values()].map((block) => ({
      relativePath: blockRelativePath(block.id, block.createdAt),
      content: serializeBlock(block),
    })),
    flowFiles: [...workspace.flows.values()].map((flow) => ({
      relativePath: flowRelativePath(flow.id),
      content: `${JSON.stringify(serializeFlow(flow), null, 2)}\n`,
    })),
    workspace: `${JSON.stringify(serializeWorkspaceMetadata(workspace), null, 2)}\n`,
    layout: `${JSON.stringify(layout, null, 2)}\n`,
  };
};

export const getLastNativeWorkspace = async (): Promise<string | undefined> => {
  if (!isDesktopRuntime()) return undefined;
  return (await invoke<string | null>("get_last_workspace")) ?? undefined;
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

export const openNativeWorkspace = async (workspaceRoot: string): Promise<LoadedWorkspaceState> => {
  if (!isDesktopRuntime()) throw new Error("파일 저장은 Tauri 데스크톱 앱에서만 사용할 수 있습니다.");
  const loaded = await invoke<LoadedWorkspace>("open_workspace", { workspaceRoot });
  const blocks = loaded.blockFiles.map((file) => deserializeBlock(file.content));
  const flows = loaded.flowFiles.map((file) => deserializeFlow(parseJson(file.content, file.relativePath)));
  const metadata = loaded.workspace
    ? deserializeWorkspaceMetadata(parseJson(loaded.workspace, "workspace.json"))
    : { version: 1 };
  const workspace = blocks.length || flows.length ? restoreWorkspace(blocks, flows, metadata) : createWorkspace();
  const layout = loaded.layout ? deserializeLayout(parseJson(loaded.layout, "layout.json")) : emptyLayout();
  return {
    workspaceRoot: loaded.workspaceRoot,
    workspace,
    nodePositionsByFlow: cleanLayout(layout, workspace),
    ...(loaded.recoveryNotice ? { recoveryNotice: loaded.recoveryNotice } : {}),
  };
};

export const saveNativeWorkspace = async (
  workspaceRoot: string,
  workspace: WorkspaceState,
  nodePositionsByFlow: NodePositionsByFlow,
): Promise<void> => {
  if (!isDesktopRuntime()) return;
  await invoke("save_workspace_snapshot", { workspaceRoot, snapshot: snapshotFor(workspace, nodePositionsByFlow) });
};
