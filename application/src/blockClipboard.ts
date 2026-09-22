import type { Block } from "./domain/flow";

export const BLOCK_CLIPBOARD_TYPE = "application/x-flow-memo-block+json";

export type CopiedBlock = { title: string; markdown: string };

export const serializeCopiedBlock = (block: Block) => JSON.stringify({ version: 1, title: block.title ?? "", markdown: block.markdown });

export const parseCopiedBlock = (value: string): CopiedBlock | undefined => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return undefined;
    const block = parsed as Record<string, unknown>;
    if (block.version !== 1 || typeof block.title !== "string" || typeof block.markdown !== "string") return undefined;
    return { title: block.title, markdown: block.markdown };
  } catch {
    return undefined;
  }
};
