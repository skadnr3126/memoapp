import { describe, expect, it } from "vitest";
import { startConnection, chooseConnectionBlock } from "./connection";
import { Flow } from "./flow";
import { defaultPosition, findFreePosition, linkPath } from "./layout";
const flow: Flow = {id:"f",title:"F",blockIds:["A","B"],links:new Map()};
describe("connection state and coordinates", () => {
  it("asks for the first block for zero or multiple selections", () => {
    expect(startConnection(flow,[]).kind).toBe("first");
    expect(startConnection(flow,["A","B"]).kind).toBe("first");
    expect(startConnection(flow,["missing"]).kind).toBe("first");
    const first=chooseConnectionBlock(startConnection(flow,[]),"A");
    expect(first).toEqual({kind:"second",flowId:"f",first:"A"});
    expect(chooseConnectionBlock(first,"B")).toEqual({kind:"ready",flowId:"f",first:"A",second:"B"});
    expect(flow.links.size).toBe(0);
  });
  it("finds unoccupied positions and draws links in any direction",()=>{
    const point=defaultPosition(0);
    expect(findFreePosition([point],point).y).toBeGreaterThan(point.y);
    for (const target of [{x:-400,y:0},{x:0,y:-400},{x:400,y:400},{x:0,y:0}]) {
      expect(linkPath({x:0,y:0},target)).not.toMatch(/NaN|Infinity/);
    }
  });
});
