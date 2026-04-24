import { describe, it, expect } from "vitest";
import { LANE_COLORS } from "../map-data";

describe("map-data", () => {
  it("has all lane colors defined", () => {
    expect(LANE_COLORS.work).toBeDefined();
    expect(LANE_COLORS.life).toBeDefined();
    expect(LANE_COLORS.learning).toBeDefined();
    expect(LANE_COLORS.unassigned).toBeDefined();
  });

  it("has correct color structure for each lane", () => {
    for (const lane of ["work", "life", "learning", "unassigned"] as const) {
      const colors = LANE_COLORS[lane];
      expect(colors.bg).toBeTruthy();
      expect(colors.border).toBeTruthy();
      expect(colors.stroke).toBeTruthy();
      expect(colors.text).toBeTruthy();
    }
  });

  it("has stroke as hex color", () => {
    expect(LANE_COLORS.work.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(LANE_COLORS.life.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(LANE_COLORS.learning.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(LANE_COLORS.unassigned.stroke).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
