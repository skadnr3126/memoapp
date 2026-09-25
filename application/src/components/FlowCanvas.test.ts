import { describe, expect, it } from "vitest";
import { boundsOverlap, centerNodeAt, clampScroll, findDirectionalNeighbor, getAutoScrollDelta, getPannedScroll, keepNodeInside } from "./FlowCanvas";

it("fixes the top-left boundary without limiting growth to the right or bottom", () => {
  expect(keepNodeInside({ x: -20, y: 490, width: 320, height: 144 })).toEqual({ x: 0, y: 490, width: 320, height: 144 });
  expect(keepNodeInside({ x: 700, y: -10, width: 800, height: 600 })).toEqual({ x: 700, y: 0, width: 800, height: 600 });
});

describe("centerNodeAt", () => {
  it("places the default node center at the pointer", () => {
    expect(centerNodeAt({ x: 500, y: 300 })).toEqual({ x: 340, y: 228 });
    expect(centerNodeAt({ x: 500, y: 300, width: 480, height: 220 })).toEqual({ x: 260, y: 190 });
  });
});

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
