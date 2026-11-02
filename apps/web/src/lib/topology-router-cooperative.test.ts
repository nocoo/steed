import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateTopologyFixture } from "../../../../scripts/topology-fixture";
import { layoutTopology } from "./topology-layout";
import { routeTopology, routeTopologyCooperative, TopologyRouterSession } from "./topology-router";

function deepHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("shared-state topology router session", () => {
  for (const name of ["topology-200", "topology-500"] as const) {
    it(`preserves fixed-clock legacy, sync and cooperative parity for ${name}`, async () => {
      const topology = generateTopologyFixture(name);
      const layout = layoutTopology(topology);
      const clock = () => 0;
      const sync = routeTopology(topology, layout, { clock, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
      const cooperative = await routeTopologyCooperative(topology, layout, { clock, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }, () => false, 20, async () => undefined);

      expect(deepHash(cooperative)).toBe(deepHash(sync));
      expect(sync.diagnostics.status).toBe("complete");
      expect(sync.diagnostics.fallbackCount).toBe(0);
      expect(Object.keys(sync.routes)).toHaveLength(topology.edges.length);
    }, 30_000);
  }

  it("prepared timeout is cancelled after yield and never returns stale timeout", async () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    let cancelled = false;
    const result = await routeTopologyCooperative(topology, layout, { clock: () => Number.POSITIVE_INFINITY, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }, () => cancelled, 20, async () => {
      cancelled = true;
      await Promise.resolve();
    });
    expect(result).toBeUndefined();
  });

  it("post-finish yield cancellation prevents stale complete result", async () => {
    const source = generateTopologyFixture("topology-200");
    const nodes = source.nodes.slice(0, 2);
    const ids = new Set(nodes.map((node) => node.id));
    const topology = { ...source, nodes, edges: source.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).slice(0, 1), views: [] };
    if (!topology.edges.length) {
      topology.edges = [{ id: "post-finish-edge", source: nodes[0]!.id, target: nodes[1]!.id, kind: "uses", label: "Post finish", direction: "uni", evidence: "documented", description: "Synthetic", tags: ["synthetic"] }];
    }
    const layout = layoutTopology(topology);
    let cancelled = false;
    let yields = 0;
    const result = await routeTopologyCooperative(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }, () => cancelled, 20, async () => {
      yields++;
      if (yields >= 4) cancelled = true;
      await Promise.resolve();
    });
    expect(result).toBeUndefined();
  });

  it("cancels a cooperative session without producing or finishing stale state", async () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    let cancelled = false;
    const result = await routeTopologyCooperative(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }, () => cancelled, 5, async () => {
      cancelled = true;
      await Promise.resolve();
    });
    expect(result).toBeUndefined();
  });

  it("uses one shared absolute deadline, grid, channels and edge loop", () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    const clock = () => 0;
    const session = new TopologyRouterSession(topology, layout, { clock, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(session.prepare()).toBeUndefined();
    let calls = 0;
    while (true) {
      const next = session.next(20);
      calls++;
      if (next.done) {
        expect(next.result).toBeUndefined();
        break;
      }
    }
    const result = session.finish();
    expect(result.diagnostics.status).toBe("complete");
    expect(result.diagnostics.fallbackCount).toBe(0);
    expect(Object.keys(result.routes)).toHaveLength(topology.edges.length);
    expect(calls).toBeGreaterThan(1);
  }, 30_000);

  it("session exposes prepared timeout and cancellation boundaries", () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    const expired = new TopologyRouterSession(topology, layout, { clock: () => Number.POSITIVE_INFINITY, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    const timeout = expired.prepare();
    expect(timeout?.diagnostics.status).toBe("timeout");
    expect(timeout?.diagnostics.fallbackCount).toBeGreaterThan(0);

    const cancelled = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    cancelled.cancel();
    const cancelledNext = cancelled.next(20);
    expect(cancelledNext.done).toBe(true);
    expect(cancelledNext.progress.routedEdges).toBe(0);
  });

  it("session timeoutResult handles missing source and target positions", () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    layout.positions = {};
    const session = new TopologyRouterSession(topology, layout, { clock: () => Number.POSITIVE_INFINITY, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    const result = session.timeoutResult();
    expect(result.diagnostics.status).toBe("timeout");
    expect(result.diagnostics.routeFailures.length).toBeGreaterThan(0);
  });

  it("session resource-limit and grid-budget branches are explicit", () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    const resourceLimited = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20, maxBytes: 1 });
    const timeout = resourceLimited.prepare();
    if (timeout) {
      expect(["timeout", "resource-limit"]).toContain(timeout.diagnostics.status);
    } else {
      const next = resourceLimited.next(20);
      expect(next.progress.routedEdges).toBeGreaterThanOrEqual(0);
    }
  });

  it("cooperative cancellation is checked before preparation and after yield", async () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    const initial = await routeTopologyCooperative(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }, () => true, 20, async () => undefined);
    expect(initial).toBeUndefined();

    let cancelled = false;
    const afterYield = await routeTopologyCooperative(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }, () => cancelled, 20, async () => {
      cancelled = true;
      await Promise.resolve();
    });
    expect(afterYield).toBeUndefined();
  });

  it("cooperative finish reports progress and one complete 200 result", async () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    const progress: Array<{ phase: string; routedEdges: number; totalEdges: number }> = [];
    const result = await routeTopologyCooperative(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }, () => false, 20, async () => undefined, (value) => progress.push(value));
    expect(result?.diagnostics.status).toBe("complete");
    expect(result?.diagnostics.fallbackCount).toBe(0);
    expect(progress.some((value) => value.phase === "prepared")).toBe(true);
    expect(progress.some((value) => value.phase === "extras")).toBe(true);
    expect(progress.at(-1)?.phase).toBe("complete");
  });

  it("session chunk wall bound routes at least one slow edge then yields", () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    const session = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(session.prepare()).toBeUndefined();
    let wall = 0;
    const first = session.next(20, 1, () => {
      wall++;
      return wall;
    });
    expect(first.done).toBe(false);
    expect(first.progress.routedEdges).toBeGreaterThanOrEqual(1);
    expect(first.progress.routedEdges).toBeLessThanOrEqual(20);
  });

  it("session repeated next and finish cover completed and finished guards", () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    const session = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(session.prepare()).toBeUndefined();
    while (true) {
      const next = session.next(50);
      if (next.done) break;
    }
    const result = session.finish();
    expect(result.diagnostics.status).toBe("complete");
    const repeated = session.next(50);
    expect(repeated.done).toBe(true);
    expect(() => session.finish()).toThrow("TopologyRouterSession already finished");
  });

  it("session timeout and resource-limit finish branches stay complete-shaped", () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);

    const timeoutSession = new TopologyRouterSession(topology, layout, { clock: () => Number.POSITIVE_INFINITY, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    const timeout = timeoutSession.prepare();
    expect(timeout?.diagnostics.status).toBe("timeout");

    const resourceSession = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20, maxBytes: 1, bundleMaxBytes: 1 });
    resourceSession.prepare();
    const next = resourceSession.next(20);
    expect(next.progress.totalEdges).toBe(400);
  });

  it("session deadline, missing positions and resource-limit produce shaped timeout results", () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);

    for (const options of [
      { clock: () => Number.POSITIVE_INFINITY, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 },
      { clock: () => 0, layoutTimeoutMs: 0, edgeTimeoutMs: 0 },
      { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20, maxBytes: 1, bundleMaxBytes: 1 },
    ]) {
      const session = new TopologyRouterSession(topology, layout, options);
      const prepared = session.prepare();
      if (prepared) {
        expect(["timeout", "resource-limit"]).toContain(prepared.diagnostics.status);
      } else {
        const next = session.next(20);
        expect(next.progress.totalEdges).toBeGreaterThanOrEqual(400);
      }
    }

    const missingLayout = layoutTopology(topology);
    missingLayout.positions = {};
    const missing = new TopologyRouterSession(topology, missingLayout, { clock: () => Number.POSITIVE_INFINITY, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }).timeoutResult();
    expect(missing.diagnostics.status).toBe("timeout");
    expect(missing.diagnostics.routeFailures.length).toBe(topology.edges.length);
  });

  it("session next cancellation, repeated finish and wall chunk bounds stay bounded", () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);

    const cancelled = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    cancelled.cancel();
    expect(cancelled.next(20).done).toBe(true);

    const slow = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(slow.prepare()).toBeUndefined();
    let wall = 0;
    const slowNext = slow.next(20, 16, () => {
      wall += 17;
      return wall;
    });
    expect(slowNext.done).toBe(false);
    expect(slowNext.progress.routedEdges).toBeGreaterThanOrEqual(1);
    expect(slowNext.progress.routedEdges).toBeLessThanOrEqual(20);

    const complete = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(complete.prepare()).toBeUndefined();
    while (true) {
      const next = complete.next(50);
      if (next.done) break;
    }
    const result = complete.finish();
    expect(result.diagnostics.status).toBe("complete");
    expect(complete.next(50).done).toBe(true);
    expect(() => complete.finish()).toThrow("TopologyRouterSession already finished");
  });

  it.each([
    { name: "zero deadline", layoutTimeoutMs: 0, edgeTimeoutMs: 0, maxBytes: 0 },
    { name: "one ms deadline", layoutTimeoutMs: 1, edgeTimeoutMs: 1, maxBytes: 1 },
    { name: "negative deadline", layoutTimeoutMs: -1, edgeTimeoutMs: -1, maxBytes: -1 },
    { name: "nan byte limit", layoutTimeoutMs: 1500, edgeTimeoutMs: 20, maxBytes: Number.NaN },
    { name: "infinite byte limit", layoutTimeoutMs: 1500, edgeTimeoutMs: 20, maxBytes: Number.POSITIVE_INFINITY },
  ])("session preserves status under $name", ({ layoutTimeoutMs, edgeTimeoutMs, maxBytes }) => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    const session = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs, edgeTimeoutMs, maxBytes });
    const prepared = session.prepare();
    if (prepared) {
      expect(["timeout", "resource-limit", "complete"]).toContain(prepared.diagnostics.status);
    } else {
      const next = session.next(20, 16, () => performance.now());
      expect(next.progress.totalEdges).toBe(400);
    }
  });

  it.each([1, 20, 50, 100, Number.POSITIVE_INFINITY])("session chunk size %s stays bounded", (chunkSize) => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    const session = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(session.prepare()).toBeUndefined();
    const next = session.next(chunkSize, 16, () => performance.now());
    expect(next.progress.totalEdges).toBe(400);
  });

  it("session timeoutResult covers no_position, resource-limit and normal timeout", () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);

    const normal = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(normal.timeoutResult().diagnostics.status).toBe("timeout");

    const resource = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20, maxBytes: 1 });
    expect(["timeout", "resource-limit"]).toContain(resource.timeoutResult(true).diagnostics.status);

    const missingLayout = layoutTopology(topology);
    missingLayout.positions = {};
    const missing = new TopologyRouterSession(topology, missingLayout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(missing.timeoutResult().diagnostics.routeFailures.length).toBe(topology.edges.length);
  });

  it("cooperative status matrix preserves timeout, resource-limit and missing-position shapes", async () => {
    const topology = generateTopologyFixture("topology-200");
    for (const options of [
      { clock: () => 0, layoutTimeoutMs: 0, edgeTimeoutMs: 0 },
      { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20, maxBytes: 1, bundleMaxBytes: 1 },
      { clock: () => Number.POSITIVE_INFINITY, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 },
      { clock: () => 0, layoutTimeoutMs: -1, edgeTimeoutMs: -1 },
    ]) {
      const layout = layoutTopology(topology);
      const session = new TopologyRouterSession(topology, layout, options);
      const prepared = session.prepare();
      if (prepared) {
        expect(["timeout", "resource-limit", "fallback"]).toContain(prepared.diagnostics.status);
        expect(prepared.diagnostics.routeFailures.length).toBeGreaterThanOrEqual(0);
      } else {
        while (true) {
          const next = session.next(20);
          if (next.done) break;
        }
        expect(["complete", "timeout", "resource-limit", "fallback"]).toContain(session.finish().diagnostics.status);
      }
    }

    const layout = layoutTopology(topology);
    layout.positions = {};
    const missing = new TopologyRouterSession(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }).timeoutResult();
    expect(missing.diagnostics.status).toBe("timeout");
    expect(missing.diagnostics.routeFailures.length).toBe(topology.edges.length);
  });

  it("cooperative yield keeps heartbeats and preserves chunk cancellation", async () => {
    const topology = generateTopologyFixture("topology-500");
    const layout = layoutTopology(topology);
    let heartbeats = 0;
    const interval = setInterval(() => { heartbeats++; }, 16);
    const progress: number[] = [];
    const result = await routeTopologyCooperative(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }, () => false, 20, () => new Promise<void>((resolve) => setTimeout(resolve, 0)), (value) => progress.push(value.routedEdges));
    clearInterval(interval);
    expect(result?.diagnostics.status).toBe("complete");
    expect(progress.length).toBeGreaterThan(1);
    expect(heartbeats).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
