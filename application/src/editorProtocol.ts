import type { BlockId } from "./domain/flow";

export const EDITOR_CLEAR = "editor:clear";
export const EDITOR_READY = "editor:ready";
export const EDITOR_LOAD = "editor:load";
export const EDITOR_LOCK = "editor:lock";
export const EDITOR_LOCKED = "editor:locked";
export type EditorLockState = { sessionId: string; locked: boolean };
export const EDITOR_SAVE = "editor:save";
export const EDITOR_SAVED = "editor:saved";
export const EDITOR_FLUSH = "editor:flush";
export const EDITOR_FLUSHED = "editor:flushed";
export type EditorFlushResult = { requestId: string; error?: string };
export type EditorSaveResult = { request: EditorSaveRequest; error?: string };

export type EditorSession = {
  sessionId: string;
  workspaceSession: string;
  blockId: BlockId;
  title: string;
  markdown: string;
  updatedAt: string;
};

export type EditorSaveRequest = Pick<EditorSession, "sessionId" | "workspaceSession" | "blockId" | "markdown">;
