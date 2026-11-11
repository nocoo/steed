import { describe, it, expect } from "vitest";
import {
  NAV_GROUPS,
  getAllNavItems,
  findNavItemByHref,
  getHeaderTrail,
  getAppHeaderBreadcrumbs,
  isNavActive,
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

    it("builds breadcrumbs for multi-segment unknown paths", () => {
      expect(getHeaderTrail("/foo/bar/baz")).toEqual({
        breadcrumbs: [{ label: "foo" }, { label: "foo/bar" }],
        title: "baz",
      });
    });
  });

  describe("isNavActive", () => {
    it("matches exact and child paths", () => {
      expect(isNavActive("/connect", "/connect")).toBe(true);
      expect(isNavActive("/connect/settings", "/connect")).toBe(true);
      expect(isNavActive("/topology", "/connect")).toBe(false);
    });

    it("does not treat similar prefixes as active", () => {
      expect(isNavActive("/connector", "/connect")).toBe(false);
      expect(isNavActive("/connection", "/connect")).toBe(false);
    });

    it.each([
      ["/topology", "/topology", true],
      ["/topology/live", "/topology", true],
      ["/connect", "/topology", false],
      ["/", "/topology", false],
    ] as const)("marks %s against %s as %s", (pathname, href, expected) => {
      expect(isNavActive(pathname, href)).toBe(expected);
    });
  });

  describe("getAppHeaderBreadcrumbs", () => {
    it("includes the page title as the final crumb", () => {
      expect(getAppHeaderBreadcrumbs("/connect", false)).toEqual([{ label: "Connect" }]);
    });

    it("includes the home title when the trail is empty", () => {
      expect(getAppHeaderBreadcrumbs("/", false)).toEqual([{ label: "Steed" }]);
    });

    it("does not duplicate a trailing title", () => {
      expect(getAppHeaderBreadcrumbs("/topology", false)).toEqual([{ label: "Topology" }]);
    });

    it("keeps diagram ancestry on desktop", () => {
      expect(getAppHeaderBreadcrumbs("/topology/example", false)).toEqual([
        { href: "/topology", label: "Topology" },
        { label: "Topology diagram" },
      ]);
    });

    it("shows only the current page on mobile", () => {
      expect(getAppHeaderBreadcrumbs("/topology/example", true)).toEqual([
        { label: "Topology diagram" },
      ]);
    });

    it("keeps a single mobile crumb without slicing", () => {
      expect(getAppHeaderBreadcrumbs("/connect", true)).toEqual([{ label: "Connect" }]);
    });
  });
});
