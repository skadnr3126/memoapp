// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openNativeWorkspace, snapshotFor, decodeWorkspace, saveNativeWorkspace } from "./repository";
import { serializeBlock } from "./serialization";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
const mockInvoke=vi.mocked(invoke);
const original={workspaceRoot:"D:/notes",blockFiles:[{relativePath:"blocks/A.md",content:serializeBlock({id:"A",markdown:"body",createdAt:"2026-01-01T00:00:00Z",updatedAt:"2026-01-01T00:00:00Z"})}],flowFiles:[{relativePath:"flows/F.json",content:JSON.stringify({version:1,id:"F",title:"F",root:{id:"root",items:["A"],branches:{}}})}]};
beforeEach(()=>{mockInvoke.mockReset();Object.defineProperty(window,"__TAURI_INTERNALS__",{value:{},configurable:true});});
describe("native migration boundary",()=>{
  it("validates, migrates, then reads back before exposing the workspace",async()=>{
    const decoded=decodeWorkspace(original);
    const migrated={...snapshotFor(decoded.workspace,decoded.nodePositionsByFlow),workspaceRoot:"D:/notes"};
    mockInvoke.mockResolvedValueOnce(original).mockResolvedValueOnce(undefined).mockResolvedValueOnce(migrated);
    const loaded=await openNativeWorkspace("D:/notes");
    expect(mockInvoke.mock.calls.map(c=>c[0])).toEqual(["open_workspace","migrate_workspace","open_workspace"]);
    expect(loaded.workspace.blocks.get("A")!.markdown).toBe("body");
  });
  it("does not write or migrate corrupt data",async()=>{
    mockInvoke.mockResolvedValueOnce({...original,blockFiles:[]});
    await expect(openNativeWorkspace("D:/notes")).rejects.toThrow();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
  it("propagates backup or migration failure without starting normal saving",async()=>{
    mockInvoke.mockResolvedValueOnce(original).mockRejectedValueOnce(new Error("backup failed"));
    await expect(openNativeWorkspace("D:/notes")).rejects.toThrow("backup failed");
    expect(mockInvoke.mock.calls.map(c=>c[0])).toEqual(["open_workspace","migrate_workspace"]);
  });
  it("rejects invalid memory before invoking a file write",async()=>{
    const decoded=decodeWorkspace(original);decoded.workspace.flows.get("F")!.blockIds.push("missing");
    await expect(saveNativeWorkspace("D:/notes",decoded.workspace,decoded.nodePositionsByFlow)).rejects.toThrow();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
