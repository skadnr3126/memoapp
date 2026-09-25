import { describe, expect, it } from "vitest";
import { parseCopiedBlock, serializeCopiedBlock, parseCopiedBlocks, serializeCopiedBlocks } from "./blockClipboard";
import { createWorkspace, createFlow, createBlock, connectBlocks } from "./domain/flow";

describe("block clipboard", () => {
  it("round-trips blocks and rejects ordinary or malformed text", () => {
    const block = { id: "b", title: "제목", markdown: "# 내용", createdAt: "", updatedAt: "" };
    expect(parseCopiedBlock(serializeCopiedBlock(block))).toEqual({ title: "제목", markdown: "# 내용" });
    expect(parseCopiedBlock("일반 텍스트")).toBeUndefined();
    expect(parseCopiedBlock('{"version":1,"title":3}')).toBeUndefined();
  });
  it("copies resized geometry and accepts older clipboard data", () => {
    const block = { id: "b", title: "제목", markdown: "내용", createdAt: "", updatedAt: "" };
    expect(parseCopiedBlock(serializeCopiedBlock(block, { x: 10, y: 20, width: 480, height: 220 })))
      .toEqual({ title: "제목", markdown: "내용", width: 480, height: 220 });
    expect(parseCopiedBlock('{"version":1,"title":"제목","markdown":"내용"}'))
      .toEqual({ title: "제목", markdown: "내용" });
    expect(parseCopiedBlock('{"version":1,"title":"제목","markdown":"내용","width":-1}')).toBeUndefined();
  });
  it("copies relative positions and internal links only, and supports the old single-block format", () => {
    const flow = createFlow(createWorkspace());
    const a = createBlock(flow.workspace, flow.flowId);
    const b = createBlock(a.workspace, flow.flowId);
    const c = createBlock(b.workspace, flow.flowId);
    let workspace = connectBlocks(c.workspace, flow.flowId, a.blockId, b.blockId).workspace;
    workspace = connectBlocks(workspace, flow.flowId, b.blockId, c.blockId).workspace;
    const copied = parseCopiedBlocks(serializeCopiedBlocks(workspace, workspace.flows.get(flow.flowId)!, [b.blockId, a.blockId], {
      [a.blockId]: { x: -100, y: 40, width: 480, height: 220 }, [b.blockId]: { x: 500, y: 200 },
    }))!;
    expect(copied.blocks).toMatchObject([{ id: a.blockId, x: 0, y: 0, width: 480, height: 220 }, { id: b.blockId, x: 600, y: 160 }]);
    expect(copied.links).toEqual([{ source: a.blockId, target: b.blockId }]);
    expect(parseCopiedBlocks(serializeCopiedBlock(workspace.blocks.get(a.blockId)!))?.blocks).toHaveLength(1);
    for (const patch of [
      { blocks: [] }, { blocks: [copied.blocks[0], copied.blocks[0]] },
      { blocks: [{ ...copied.blocks[0], x: "0" }] },
      { blocks: [{ ...copied.blocks[0], y: -1 }] },
      { blocks: [{ ...copied.blocks[0], width: 1e300 }] },
      { links: [{ source: a.blockId, target: c.blockId }] },
      { links: [{ source: a.blockId, target: a.blockId }] },
      { links: [...copied.links, { source: b.blockId, target: a.blockId }] },
    ]) expect(parseCopiedBlocks(JSON.stringify({ version: 2, ...copied, ...patch }))).toBeUndefined();
  });
});
