import type { Link } from "../domain/flow";
export const BLOCK_SCHEMA_VERSION = 1;
export const WORKSPACE_SCHEMA_VERSION = 1;
export const FLOW_SCHEMA_VERSION = 2;
export const LAYOUT_SCHEMA_VERSION = 2;
export type PersistedFlow = { version: number; id: string; title: string; blocks: string[]; links: Link[] };
export type PersistedWorkspace = { version: number; activeFlowId?: string };
export type PersistedNodePosition = { x: number; y: number };
export type PersistedLayout = { version: number; nodePositionsByFlow: Record<string, Record<string, PersistedNodePosition | undefined>> };
