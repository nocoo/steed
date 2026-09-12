import { describe, it, expect } from "vitest";
import {
  NAV_GROUPS,
  getAllNavItems,
  findNavItemByHref,
  getHeaderTrail,
} from "./navigation";

describe("navigation", () => {
  describe("NAV_GROUPS", () => {
    it("has expected structure", () => {
      expect(NAV_GROUPS).toHaveLength(3);
      expect(NAV_GROUPS[0]!.title).toBe("Workspace");
      expect(NAV_GROUPS[1]!.title).toBe("Dashboard");
      expect(NAV_GROUPS[2]!.title).toBe("Infrastructure");
    });

    it("contains overview in dashboard group", () => {
      const dashboardItems = NAV_GROUPS[1]!.items;
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

  describe("getHeaderTrail", () => {
    it("links diagram details back to the workspace", () => {
      expect(getHeaderTrail("/diagrams/example")).toEqual({ breadcrumbs: [{ href: "/diagrams", label: "Diagrams" }], title: "Architecture diagram" });
    });
    it("treats empty path as Overview", () => {
      expect(getHeaderTrail("/")).toEqual({
        breadcrumbs: [],
        title: "Overview",
      });
    });

    it("uses Overview as title with no crumbs", () => {
      expect(getHeaderTrail("/overview")).toEqual({
        breadcrumbs: [],
        title: "Overview",
      });
    });

    it("puts Overview as a link on list pages", () => {
      expect(getHeaderTrail("/hosts")).toEqual({
        breadcrumbs: [{ href: "/overview", label: "Overview" }],
        title: "Hosts",
      });
    });

    it("keeps raw ids as title, not crumbs", () => {
      expect(getHeaderTrail("/agents/abc-123")).toEqual({
        breadcrumbs: [
          { href: "/overview", label: "Overview" },
          { href: "/agents", label: "Agents" },
        ],
        title: "abc-123",
      });
    });

    it("does not invent hrefs for unknown ancestors", () => {
      expect(getHeaderTrail("/unknown/leaf")).toEqual({
        breadcrumbs: [
          { href: "/overview", label: "Overview" },
          { label: "unknown" },
        ],
        title: "leaf",
      });
    });
  });
});
