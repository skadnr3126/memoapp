import { linkPair, type Block, type Flow, type WorkspaceState } from "./domain/flow";
import { defaultPosition, NODE_WIDTH, NODE_HEIGHT, type Point } from "./domain/layout";

export const BLOCK_CLIPBOARD_TYPE = "application/x-flow-memo-block+json";

export type CopiedBlock = { title: string; markdown: string; width?: number; height?: number };
export type CopiedBlocks = {
  blocks: (CopiedBlock & { id: string; x: number; y: number })[];
  links: { source: string; target: string }[];
};

export const serializeCopiedBlock = (block: Block, position?: Point) => JSON.stringify({ version: 1, title: block.title ?? "", markdown: block.markdown, width: position?.width, height: position?.height });

export const parseCopiedBlock = (value: string): CopiedBlock | undefined => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return undefined;
    const block = parsed as Record<string, unknown>;
    if (block.version !== 1 || typeof block.title !== "string" || typeof block.markdown !== "string") return undefined;
    for (const [size, minimum] of [["width", 80], ["height", 72]] as const) {
      if (block[size] !== undefined && (typeof block[size] !== "number" || !Number.isFinite(block[size]) || block[size] < minimum || block[size] > 1_000_000)) return undefined;
    }
    return { title: block.title, markdown: block.markdown, ...(block.width !== undefined && { width: block.width as number }), ...(block.height !== undefined && { height: block.height as number }) };
  } catch {
    return undefined;
  }
};

export const serializeCopiedBlocks = (workspace: WorkspaceState, flow: Flow, ids: string[], positions: Record<string, Point | undefined>): string => {
  const selected = new Set(ids);
  const blocks = flow.blockIds.flatMap((id, index) => {
    const block = workspace.blocks.get(id);
    return selected.has(id) && block ? [{ id, title: block.title ?? "", markdown: block.markdown, ...(positions[id] ?? defaultPosition(index)) }] : [];
  });
  const left = Math.min(...blocks.map(block => block.x));
  const top = Math.min(...blocks.map(block => block.y));
  return JSON.stringify({ version: 2,
    blocks: blocks.map(block => ({ ...block, x: block.x - left, y: block.y - top })),
    links: [...flow.links.values()].filter(link => selected.has(link.source) && selected.has(link.target))
      .map(({ source, target }) => ({ source, target })),
  });
};

export const parseCopiedBlocks = (value: string): CopiedBlocks | undefined => {
  try {
    const data = JSON.parse(value);
    if (data?.version === 1) {
      const block = parseCopiedBlock(value);
      return block ? { blocks: [{ ...block, id: "legacy", x: 0, y: 0 }], links: [] } : undefined;
    }
    if (data?.version !== 2 || !Array.isArray(data.blocks) || !data.blocks.length || !Array.isArray(data.links)) return undefined;
    const blocks: CopiedBlocks["blocks"] = [];
    const ids = new Set<string>();
    for (const item of data.blocks) {
      if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
        typeof item.x !== "number" || !Number.isFinite(item.x) || item.x < 0 ||
        typeof item.y !== "number" || !Number.isFinite(item.y) || item.y < 0) return undefined;
      const block = parseCopiedBlock(JSON.stringify({ ...item, version: 1 }));
      if (!block || item.x + (block.width ?? NODE_WIDTH) > 1_000_000 || item.y + (block.height ?? NODE_HEIGHT) > 1_000_000) return undefined;
      ids.add(item.id);
      blocks.push({ ...block, id: item.id, x: item.x, y: item.y });
    }
    const pairs = new Set<string>();
    const links: CopiedBlocks["links"] = [];
    for (const link of data.links) {
      if (!link || !ids.has(link.source) || !ids.has(link.target) || link.source === link.target) return undefined;
      const pair = linkPair(link.source, link.target);
      if (pairs.has(pair)) return undefined;
      pairs.add(pair);
      links.push({ source: link.source, target: link.target });
    }
    return { blocks, links };
  } catch { return undefined; }
};
