import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Topology } from "@steed/api/shared";

const gridBudgetAudit = vi.hoisted(() => ({
  constructions: [] as Array<{ maxBytes: number | undefined; estimatedBytes: number; obstacleCount: number; regionCount: number }>,
}));

vi.mock("./topology-routing-grid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./topology-routing-grid")>();
  class AuditedRoutingGrid extends actual.RoutingGrid {
    constructor(
      obstacles: Array<{ x: number; y: number; width: number; height: number }>,
      regions: Array<{ id: string; x: number; y: number; width: number; height: number }>,
      points: Array<{ x: number; y: number }>,
      budget?: { clock: () => number; deadline: number; maxBytes?: number },
    ) {
      const record = {
        maxBytes: budget?.maxBytes,
        estimatedBytes: 0,
        obstacleCount: obstacles.length,
        regionCount: regions.length,
      };
      gridBudgetAudit.constructions.push(record);
      super(obstacles, regions, points, budget);
      record.estimatedBytes = this.estimatedBytes;
    }
  }
  return { ...actual, RoutingGrid: AuditedRoutingGrid };
});

import { topologySchema } from "@steed/api/shared";
import { layoutTopology, type TopologyLayoutResult } from "./topology-layout";
import { routeTopology } from "./topology-router";
import { generateTopologyFixture } from "../../../../scripts/topology-fixture";
import { buildTopologyLayerPairBundles } from "./topology-route-extras";
import {
  ROUTING_GRID_BYTE_LIMIT,
  RoutingGrid,
  RoutingGridLimit,
  type RoutingPoint,
  type RoutingRect,
} from "./topology-routing-grid";

function syntheticTopology(): Topology {
  return topologySchema.parse({
    schemaVersion: 2,
    title: "Synthetic budget fixture",
    description: "Synthetic local topology for budget tests.",
    revision: 1,
    layers: [
      { id: "l0", label: "TEST l0", provider: "Synthetic", order: 0, description: "" },
      { id: "l1", label: "TEST l1", provider: "Synthetic", order: 1, description: "" },
    ],
    types: [{ id: "host", label: "TEST host", shape: "rect", description: "", attrs: [] }],
    boundaries: [],
    nodes: [
      { id: "n0", type: "host", label: "TEST n0", layerId: "l0", boundaryIds: [], lifecycle: "active", description: "", tags: ["synthetic"], attrs: {} },
      { id: "n1", type: "host", label: "TEST n1", layerId: "l1", boundaryIds: [], lifecycle: "active", description: "", tags: ["synthetic"], attrs: {} },
    ],
    edges: [{
      id: "e0",
      source: "n0",
      target: "n1",
      kind: "traffic",
      label: "TEST traffic",
      direction: "uni",
      evidence: "documented",
      description: "Synthetic edge.",
      tags: ["synthetic"],
    }],
    views: [],
  });
}

function syntheticLayout(topology: Topology): TopologyLayoutResult {
  const positioned = layoutTopology(topology);
  if (positioned.lanes.length >= 2) return positioned;
  throw new Error("Synthetic layout did not create two lanes.");
}

function pointGrid(maxBytes: number): RoutingGrid {
  const points: RoutingPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const obstacles: RoutingRect[] = [];
  return new RoutingGrid(obstacles, [], points, { clock: () => 0, deadline: 100, maxBytes });
}

describe("topology router resource budget regressions", () => {
  beforeEach(() => {
    gridBudgetAudit.constructions.length = 0;
  });

  it("accounts for outside grid when calculating remaining bundle capacity", () => {
    const topology = syntheticTopology();
    const layout = syntheticLayout(topology);

    const result = routeTopology(topology, layout, {
      layoutTimeoutMs: 1500,
      edgeTimeoutMs: 20,
      maxBytes: ROUTING_GRID_BYTE_LIMIT,
    });

    expect(result.routes.e0).toBeDefined();
    expect(result.routes.e0!.status).toBeDefined();
    expect(result.diagnostics.status).toBe("complete");

    const constructions = gridBudgetAudit.constructions;
    expect(constructions.length).toBeGreaterThanOrEqual(4);

    const sectionConstructions = constructions.slice(0, layout.lanes.length);
    const outside = constructions[layout.lanes.length];
    const bundle = constructions.find((_, index) => index > layout.lanes.length);

    expect(outside).toBeDefined();
    expect(bundle).toBeDefined();

    const sectionBytes = sectionConstructions.reduce((sum, item) => sum + item.estimatedBytes, 0);
    const outsideBytes = outside!.estimatedBytes;
    const cumulativeLimit = ROUTING_GRID_BYTE_LIMIT;
    const expectedRemaining = cumulativeLimit - sectionBytes - outsideBytes;

    expect(bundle!.maxBytes).toBe(Math.max(0, expectedRemaining));
  });

  it("normalizes negative, NaN, infinite and over-hard-limit maxBytes", () => {
    expect(() => pointGrid(-1)).toThrow(RoutingGridLimit);
    expect(() => pointGrid(Number.NaN)).toThrow(RoutingGridLimit);

    expect(() => pointGrid(Number.POSITIVE_INFINITY)).not.toThrow();
    expect(() => pointGrid(ROUTING_GRID_BYTE_LIMIT + 1024)).not.toThrow();

    const topology = syntheticTopology();
    const layout = syntheticLayout(topology);
    for (const maxBytes of [-1, Number.NaN, Number.POSITIVE_INFINITY, ROUTING_GRID_BYTE_LIMIT + 1024]) {
      gridBudgetAudit.constructions.length = 0;
      const result = routeTopology(topology, layout, { maxBytes, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
      expect(result.routes.e0).toBeDefined();
      for (const construction of gridBudgetAudit.constructions) {
        expect(construction.maxBytes === undefined || construction.maxBytes <= ROUTING_GRID_BYTE_LIMIT).toBe(true);
      }
    }
  });

  it("uses the minimum of bundleMaxBytes and remaining bundle capacity", () => {
    const topology = syntheticTopology();
    const layout = syntheticLayout(topology);

    const smallBundleLimit = 128;
    const result = routeTopology(topology, layout, {
      layoutTimeoutMs: 1500,
      edgeTimeoutMs: 20,
      maxBytes: ROUTING_GRID_BYTE_LIMIT,
      bundleMaxBytes: smallBundleLimit,
    });

    expect(result.bundles.bundles).toHaveLength(1);
    expect(result.bundles.bundles[0]!.count).toBe(1);

    const bundleGrid = gridBudgetAudit.constructions.at(-1);
    expect(bundleGrid).toBeDefined();
    expect(bundleGrid!.maxBytes).toBe(smallBundleLimit);

    expect(result.bundles.bundles[0]!.route).toHaveLength(2);
    expect(result.bundles.bundles[0]!.fallback).toBe("no_path");
  });

  it("keeps deadline fallback as exact dashed straight routes", () => {
    const topology = syntheticTopology();
    const layout = syntheticLayout(topology);

    const result = routeTopology(topology, layout, {
      clock: () => 100,
      layoutTimeoutMs: 0,
      edgeTimeoutMs: 20,
    });

    expect(result.diagnostics.status).toBe("timeout");
    expect(result.diagnostics.fallbackCount).toBe(1);
    expect(result.diagnostics.unroutedEdgeIds).toEqual(["e0"]);

    const route = result.routes.e0;
    expect(route).toBeDefined();
    expect(route!.status).toBe("fallback");
    expect(route!.renderMode).toBe("straight");
    expect(route!.fallbackStyle).toBe("dashed");
    expect(route!.points).toHaveLength(2);
  });

  it("preserves no_path when one endpoint position is missing under an expired layout deadline", () => {
    const topology = syntheticTopology();
    const layout = syntheticLayout(topology);
    delete layout.positions.n1;

    const result = routeTopology(topology, layout, {
      clock: () => 100,
      layoutTimeoutMs: 0,
      edgeTimeoutMs: 20,
    });

    expect(result.diagnostics.status).toBe("timeout");
    expect(result.diagnostics.routeFailures).toEqual([{ edgeId: "e0", reason: "no_path" }]);
    expect(result.diagnostics.fallbackCount).toBe(1);
    expect(result.diagnostics.unroutedEdgeIds).toEqual([]);
    expect(result.diagnostics.elapsedMs).toBe(0);
    expect(result.routes.e0).toMatchObject({
      status: "fallback",
      fallback: "no_path",
      renderMode: "straight",
      fallbackStyle: "dashed",
      points: [],
    });
  });

  it("stops searching after one timed-out edge and marks later synthetic edges timeout", () => {
    const topology = syntheticTopology();
    topology.edges = ["e0", "e1", "e2"].map((id) => ({
      ...topology.edges[0]!,
      id,
    }));
    const layout = syntheticLayout(topology);
    let now = 0;
    const search = vi.spyOn(RoutingGrid.prototype, "search").mockImplementation((_start, _goal, options) => {
      now = options.deadline;
      return { points: null, timeout: true };
    });

    try {
      const result = routeTopology(topology, layout, {
        clock: () => now,
        layoutTimeoutMs: 1500,
        edgeTimeoutMs: 20,
      });

      expect(search).toHaveBeenCalled();
      expect(result.diagnostics.status).toBe("timeout");
      expect(result.diagnostics.routeFailures).toEqual([
        { edgeId: "e0", reason: "timeout" },
        { edgeId: "e1", reason: "timeout" },
        { edgeId: "e2", reason: "timeout" },
      ]);
      expect(result.diagnostics.unroutedEdgeIds).toEqual(["e0", "e1", "e2"]);
      for (const edge of topology.edges) {
        expect(result.routes[edge.id]).toMatchObject({
          status: "fallback",
          fallback: "timeout",
          renderMode: "straight",
          fallbackStyle: "dashed",
        });
      }
    } finally {
      search.mockRestore();
    }
  });

  it("returns every synthetic 200/500 route promptly under forced 0ms and 1ms budgets", () => {
    for (const fixtureName of ["topology-200", "topology-500"] as const) {
      const topology = generateTopologyFixture(fixtureName);
      const layout = layoutTopology(topology);

      for (const layoutTimeoutMs of [0, 1]) {
        let now = layoutTimeoutMs === 0 ? 0 : -1;
        const clock = () => ++now;
        const started = performance.now();
        const result = routeTopology(topology, layout, {
          clock,
          layoutTimeoutMs,
          edgeTimeoutMs: layoutTimeoutMs === 0 ? 0 : 1,
        });
        const elapsedMs = performance.now() - started;

        expect(Object.keys(result.routes)).toHaveLength(topology.edges.length);
        expect(result.diagnostics.status).toBe("timeout");
        expect(result.diagnostics.routeFailures.length).toBe(topology.edges.length);
        expect(result.diagnostics.fallbackCount).toBe(topology.edges.length);
        expect(result.diagnostics.unroutedEdgeIds).toHaveLength(topology.edges.length);

        for (const edge of topology.edges) {
          const route = result.routes[edge.id];
          expect(route).toBeDefined();
          expect(route!.status).toBe("fallback");
          expect(route!.fallback).toBe("timeout");
          expect(route!.renderMode).toBe("straight");
          expect(route!.fallbackStyle).toBe("dashed");
          expect(route!.points).toHaveLength(2);
        }

        console.log(JSON.stringify({ fixture: fixtureName, layoutTimeoutMs, elapsedMs: Math.round(elapsedMs * 100) / 100, routes: Object.keys(result.routes).length }));
      }
    }
  });

  it("keeps complete counted bundle fallback when remaining capacity is exhausted", () => {
    const topology = syntheticTopology();
    const layout = syntheticLayout(topology);

    const result = buildTopologyLayerPairBundles(topology, layout, topology.edges, {
      layoutTimeoutMs: 1500,
      bundleTimeoutMs: 20,
      maxBytes: 1,
    });

    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]).toMatchObject({
      count: 1,
      edgeIds: ["e0"],
      fallback: "no_path",
    });
    expect(result.bundles[0]!.route).toHaveLength(2);
    expect(result.diagnostics.resourceLimit).toBe(true);
  });
});
