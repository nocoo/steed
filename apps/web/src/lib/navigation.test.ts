import { describe, it, expect } from "vitest";
import {
  NAV_GROUPS,
  getAllNavItems,
  findNavItemByHref,
} from "./navigation";

describe("navigation", () => {
  describe("NAV_GROUPS", () => {
    it("has expected structure", () => {
      expect(NAV_GROUPS).toHaveLength(2);
      expect(NAV_GROUPS[0]!.title).toBe("Dashboard");
      expect(NAV_GROUPS[1]!.title).toBe("Infrastructure");
    });

    it("contains overview in dashboard group", () => {
      const dashboardItems = NAV_GROUPS[0]!.items;
      const overview = dashboardItems.find((item) => item.href === "/overview");
      expect(overview).toBeDefined();
      expect(overview!.title).toBe("Overview");
    });
  });

  describe("getAllNavItems", () => {
    it("returns flattened array of all nav items", () => {
      const items = getAllNavItems();
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((item) => item.href === "/overview")).toBe(true);
      expect(items.some((item) => item.href === "/hosts")).toBe(true);
    });
  });

  describe("findNavItemByHref", () => {
    it("finds nav item by href", () => {
      const item = findNavItemByHref("/overview");
      expect(item).toBeDefined();
      expect(item!.title).toBe("Overview");
    });

    it("returns undefined for non-existent href", () => {
      const item = findNavItemByHref("/non-existent");
      expect(item).toBeUndefined();
    });
  });
});
