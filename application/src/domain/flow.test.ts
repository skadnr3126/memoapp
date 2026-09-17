import { describe, expect, it } from "vitest";
import { createWorkspace, createFlow, createBlock, connectBlocks, disconnectBlocks, deleteBlock, deleteFlow, updateBlock, getDisplayTitle, validateWorkspace } from "./flow";
const fixture = () => {
  const f = createFlow(createWorkspace(), "Graph");
  const a = createBlock(f.workspace, f.flowId);
  const b = createBlock(a.workspace, f.flowId);
  const c = createBlock(b.workspace, f.flowId);
  return { workspace: c.workspace, flowId: f.flowId, a: a.blockId, b: b.blockId, c: c.blockId };
};
describe("undirected flow", () => {
  it("creates independent blocks and allows cycles and isolated blocks", () => {
    const f = fixture(); let w = f.workspace;
    expect(w.flows.get(f.flowId)!.links.size).toBe(0);
    for (const [a,b] of [[f.a,f.b],[f.b,f.c],[f.c,f.a]]) w = connectBlocks(w,f.flowId,a,b).workspace;
    w = createBlock(w,f.flowId).workspace;
    expect(validateWorkspace(w)).toEqual([]);
    expect(f.workspace.flows.get(f.flowId)!.links.size).toBe(0);
  });
  it("rejects reverse duplicates, self links and foreign endpoints", () => {
    const f = fixture(); const w = connectBlocks(f.workspace,f.flowId,f.a,f.b).workspace;
    expect(() => connectBlocks(w,f.flowId,f.b,f.a)).toThrow("이미");
    expect(() => connectBlocks(w,f.flowId,f.a,f.a)).toThrow("같은");
    expect(() => connectBlocks(w,f.flowId,f.a,"missing")).toThrow("없는");
    const other = createFlow(w); const block = createBlock(other.workspace,other.flowId);
    expect(() => connectBlocks(block.workspace,f.flowId,f.a,block.blockId)).toThrow();
  });
  it("deletes only the block and its incident links, preserving neighbors", () => {
    const f = fixture(); let w = connectBlocks(f.workspace,f.flowId,f.a,f.b).workspace;
    w = connectBlocks(w,f.flowId,f.b,f.c).workspace;
    w = deleteBlock(w,f.flowId,f.a).workspace;
    expect([...w.blocks.keys()]).toEqual([f.b,f.c]);
    expect([...w.flows.get(f.flowId)!.links.values()].map(l=>[l.source,l.target])).toEqual([[f.b,f.c]]);
    const link = [...w.flows.get(f.flowId)!.links.keys()][0];
    w = disconnectBlocks(w,f.flowId,link).workspace;
    expect(w.blocks.size).toBe(2); expect(validateWorkspace(w)).toEqual([]);
  });
  it("deletes a flow and retains the other flow", () => {
    const f=fixture(); const other=createFlow(f.workspace);
    const w=deleteFlow(other.workspace,f.flowId).workspace;
    expect(w.blocks.size).toBe(0); expect(w.activeFlowId).toBe(other.flowId); expect(validateWorkspace(w)).toEqual([]);
  });
  it("preserves Markdown and explicit titles", () => {
    const f=fixture(); const w=updateBlock(f.workspace,f.a,{title:"Title",markdown:"# Body"}).workspace;
    expect(getDisplayTitle(w.blocks.get(f.a)!)).toBe("Title");
    expect(getDisplayTitle({...w.blocks.get(f.a)!,title:undefined})).toBe("Body");
    expect(f.workspace.blocks.get(f.a)!.markdown).toBe("");
  });
  it("validates invalid membership and duplicate undirected links", () => {
    const f=fixture(); const flow=f.workspace.flows.get(f.flowId)!;
    flow.blockIds.push(f.a);
    flow.links.set("1",{id:"1",source:f.a,target:f.b});flow.links.set("2",{id:"2",source:f.b,target:f.a});
    expect(validateWorkspace(f.workspace).length).toBe(2);
  });
});
