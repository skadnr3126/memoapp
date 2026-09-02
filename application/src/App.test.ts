import { describe, expect, it } from "vitest";
import { clampSidebarWidth } from "./sidebarWidth";

describe("clampSidebarWidth", () => {
  it("keeps the sidebar between its usable minimum and maximum widths", () => {
    expect(clampSidebarWidth(0)).toBe(8);
    expect(clampSidebarWidth(292)).toBe(292);
    expect(clampSidebarWidth(560)).toBe(480);
  });
});
