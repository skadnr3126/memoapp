import { describe, expect, it } from "vitest";
import { boundsOverlap, clampScroll, findDirectionalNeighbor, getAutoScrollDelta, getPannedScroll } from "./FlowCanvas";

describe("getPannedScroll", () => {
  it("moves the viewport opposite to the right-drag direction", () => {
    expect(getPannedScroll({ startX: 100, startY: 80, scrollLeft: 240, scrollTop: 120 }, 140, 50))
      .toEqual({ left: 200, top: 150 });
  });
});

describe("boundsOverlap", () => {
  it("selects blocks touched by the drag rectangle", () => {
    expect(boundsOverlap({ left: 10, top: 10, right: 40, bottom: 40 }, { left: 35, top: 35, right: 80, bottom: 80 })).toBe(true);
    expect(boundsOverlap({ left: 10, top: 10, right: 40, bottom: 40 }, { left: 41, top: 10, right: 80, bottom: 40 })).toBe(false);
  });
});

describe("getAutoScrollDelta", () => {
  it("scrolls toward the pointer only near an edge", () => {
    expect(getAutoScrollDelta(120, 100, 500)).toBe(-18);
    expect(getAutoScrollDelta(300, 100, 500)).toBe(0);
    expect(getAutoScrollDelta(490, 100, 500)).toBe(18);
  });
});

describe("clampScroll", () => {
  it("never moves beyond the original scroll range", () => {
    expect(clampScroll(-20, 300)).toBe(0);
    expect(clampScroll(180, 300)).toBe(180);
    expect(clampScroll(480, 300)).toBe(300);
  });
});

describe("findDirectionalNeighbor", () => {
  const positions = {
    a: { x: 100, y: 100 }, b: { x: 360, y: 108 }, c: { x: 360, y: 260 }, d: { x: 100, y: 270 },
  };
  it("chooses the nearest node in the requested direction", () => {
    expect(findDirectionalNeighbor("a", "ArrowRight", positions, ["a", "b", "c", "d"])).toBe("b");
    expect(findDirectionalNeighbor("a", "ArrowDown", positions, ["a", "b", "c", "d"])).toBe("d");
    expect(findDirectionalNeighbor("a", "ArrowLeft", positions, ["a", "b", "c", "d"])).toBeUndefined();
  });
});
