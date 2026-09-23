import { describe, expect, it } from "vitest";
import { parseCopiedBlock, serializeCopiedBlock } from "./blockClipboard";

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
});
