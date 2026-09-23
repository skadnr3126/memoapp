import type { Block } from "./domain/flow";
import type { Point } from "./domain/layout";

export const BLOCK_CLIPBOARD_TYPE = "application/x-flow-memo-block+json";

export type CopiedBlock = { title: string; markdown: string; width?: number; height?: number };

export const serializeCopiedBlock = (block: Block, position?: Point) => JSON.stringify({ version: 1, title: block.title ?? "", markdown: block.markdown, width: position?.width, height: position?.height });

export const parseCopiedBlock = (value: string): CopiedBlock | undefined => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return undefined;
    const block = parsed as Record<string, unknown>;
    if (block.version !== 1 || typeof block.title !== "string" || typeof block.markdown !== "string") return undefined;
    for (const [size, minimum] of [["width", 80], ["height", 72]] as const) {
      if (block[size] !== undefined && (typeof block[size] !== "number" || !Number.isFinite(block[size]) || block[size] < minimum)) return undefined;
    }
    return { title: block.title, markdown: block.markdown, ...(block.width !== undefined && { width: block.width as number }), ...(block.height !== undefined && { height: block.height as number }) };
  } catch {
    return undefined;
  }
};
