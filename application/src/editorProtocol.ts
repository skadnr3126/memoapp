import type { BlockId } from "./domain/flow";

export const EDITOR_READY = "editor:ready";
export const EDITOR_LOAD = "editor:load";
export const EDITOR_SAVE = "editor:save";

export type EditorSession = {
  blockId: BlockId;
  title: string;
  markdown: string;
  updatedAt: string;
};

export type EditorSaveRequest = Pick<EditorSession, "blockId" | "title" | "markdown">;
