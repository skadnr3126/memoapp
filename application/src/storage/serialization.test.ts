import { describe, expect, it } from "vitest";
import { deserializeBlock, serializeBlock, deserializeFlow, serializeFlow, importFlow, restoreWorkspace, deserializeLayout, emptyLayout } from "./serialization";
import { decodeWorkspace, snapshotFor } from "./repository";
const block = (id: string) => ({id,title:'따옴표 " 제목',markdown:"# 본문\n\n- 항목",createdAt:"2026-07-21T01:00:00.000Z",updatedAt:"2026-07-21T02:00:00.000Z"});
const legacy = {version:1,id:"flow_a",title:"Legacy",root:{id:"root",items:["A","B","C"],branches:{A:[{id:"child",items:["D","E"],branches:{D:[{id:"nested",items:["F"],branches:{}}]}},{id:"empty",items:[],branches:{}}]}}};
describe("storage and migration", () => {
  it("round-trips Markdown without changing content or timestamps",()=>expect(deserializeBlock(serializeBlock(block("A")))).toEqual(block("A")));
  it("accepts CRLF, BOM, and whitespace before block frontmatter",()=>{
    const source=serializeBlock(block("A"));
    expect(deserializeBlock(source.replace(/\n/g,"\r\n")).markdown).toBe("# 본문\r\n\r\n- 항목");
    expect(deserializeBlock("\uFEFF \r\n"+source)).toEqual(block("A"));
  });
  it("collects every nested block and exactly the previously visible links",()=>{
    const {flow,legacyPositions}=importFlow(legacy);
    expect(flow.blockIds).toEqual(["A","B","C","D","E","F"]);
    expect([...flow.links.values()].map(l=>[l.source,l.target])).toEqual([["A","B"],["B","C"],["D","E"],["A","D"],["D","F"]]);
    expect(legacyPositions!.F.y).toBeGreaterThan(legacyPositions!.D.y);
    expect(deserializeFlow(serializeFlow(flow))).toEqual(flow);
    expect(serializeFlow(flow)).not.toHaveProperty("root");
  });
  it("converts offsets once and preserves v2 coordinates on reload",()=>{
    const loaded={workspaceRoot:"D:/test",blockFiles:["A","B","C","D","E","F"].map(id=>({relativePath:`blocks/${id}.md`,content:serializeBlock(block(id))})),flowFiles:[{relativePath:"flows/flow_a.json",content:JSON.stringify(legacy)}],layout:JSON.stringify({version:1,nodePositionsByFlow:{flow_a:{A:{x:-80,y:20}}}})};
    const result=decodeWorkspace(loaded);
    expect(result.needsMigration).toBe(true);expect(result.nodePositionsByFlow.flow_a.A).toEqual({x:-44,y:91});
    const snapshot=snapshotFor(result.workspace,result.nodePositionsByFlow);
    const restored=decodeWorkspace({...snapshot,workspaceRoot:"D:/test"});
    expect(restored.needsMigration).toBe(false);expect(restored.nodePositionsByFlow).toEqual(result.nodePositionsByFlow);
    expect(restored.workspace).toEqual(result.workspace);
    expect(JSON.parse(snapshot.layout).version).toBe(2);expect(JSON.parse(snapshot.workspace).version).toBe(1);
  });
  it("rejects duplicate files before Map conversion",()=>{
    const flow=deserializeFlow({version:2,id:"f",title:"F",blocks:["A"],links:[]});
    expect(()=>restoreWorkspace([block("A"),block("A")],[flow],{version:1})).toThrow("중복");
    expect(()=>restoreWorkspace([block("A")],[flow,flow],{version:1})).toThrow("중복");
  });
  it("rejects damaged trees, future versions, and duplicate link IDs",()=>{
    expect(()=>deserializeFlow({...legacy,version:99})).toThrow("버전");
    expect(()=>deserializeFlow({...legacy,root:{id:"r",items:["A","A"],branches:{}}})).toThrow("중복");
    expect(()=>deserializeFlow({...legacy,root:{id:"r",items:[],branches:{A:[]}}})).toThrow();
    expect(()=>deserializeFlow({version:2,id:"f",title:"F",blocks:["A","B"],links:[{id:"l",source:"A",target:"B"},{id:"l",source:"B",target:"A"}]})).toThrow("중복");
  });
  it("rejects non-finite coordinates and keeps isolated empty flows valid",()=>{
    expect(emptyLayout().version).toBe(2);
    expect(()=>deserializeLayout({version:2,nodePositionsByFlow:{f:{A:{x:Infinity,y:0}}}})).toThrow();
    const flow=deserializeFlow({version:1,id:"f",title:"F",root:{id:"r",items:[],branches:{}}});
    expect(restoreWorkspace([], [flow], {version:1}).flows.size).toBe(1);
  });
});
