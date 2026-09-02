export const STORAGE_SCHEMA_VERSION = 1;

export type PersistedBranch = {
  id: string;
  title?: string;
  items: string[];
  branches: Record<string, PersistedBranch[]>;
};

export type PersistedFlow = {
  version: number;
  id: string;
  title: string;
  root: PersistedBranch;
};

export type PersistedWorkspace = {
  version: number;
  activeFlowId?: string;
};

export type PersistedNodePosition = {
  x: number;
  y: number;
};

export type PersistedLayout = {
  version: number;
  nodePositionsByFlow: Record<string, Record<string, PersistedNodePosition | undefined>>;
};

export type PersistedWorkspaceSnapshot = {
  blocks: Record<string, string>;
  flows: PersistedFlow[];
  workspace: PersistedWorkspace;
  layout: PersistedLayout;
};
