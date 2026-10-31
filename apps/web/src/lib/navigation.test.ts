import { describe, it, expect } from "vitest";
import {
  NAV_GROUPS,
  getAllNavItems,
  findNavItemByHref,
  getHeaderTrail,
} from "./navigation";

describe("navigation", () => {
  describe("NAV_GROUPS", () => {
    it("has a single workspace group", () => {
      expect(NAV_GROUPS).toHaveLength(1);
      expect(NAV_GROUPS[0]!.title).toBe("Workspace");
    });
  });

  describe("getAllNavItems", () => {
    it("returns only topology and connect", () => {
      expect(getAllNavItems().map((item) => item.href)).toEqual(["/topology", "/connect"]);
    });
  });

  describe("findNavItemByHref", () => {
    it("finds nav item by href", () => {
      expect(findNavItemByHref("/connect")!.title).toBe("Connect");
    });

    it("returns undefined for removed inventory pages", () => {
      expect(findNavItemByHref("/overview")).toBeUndefined();
      expect(findNavItemByHref("/hosts")).toBeUndefined();
    });
  });

  describe("getHeaderTrail", () => {
    it("links diagram details back to the workspace", () => {
      expect(getHeaderTrail("/topology/example")).toEqual({ breadcrumbs: [{ href: "/topology", label: "Topology" }], title: "Topology diagram" });
    });

    it("uses the app name for the root path", () => {
      expect(getHeaderTrail("/")).toEqual({ breadcrumbs: [], title: "Steed" });
    });

    it("uses the nav title without an overview crumb", () => {
      expect(getHeaderTrail("/connect")).toEqual({ breadcrumbs: [], title: "Connect" });
    });

    it("does not invent hrefs for unknown ancestors", () => {
      expect(getHeaderTrail("/unknown/leaf")).toEqual({ breadcrumbs: [{ label: "unknown" }], title: "leaf" });
    });

    it("links known ancestors", () => {
      expect(getHeaderTrail("/connect/extra")).toEqual({ breadcrumbs: [{ href: "/connect", label: "Connect" }], title: "extra" });
    });
  });
});
