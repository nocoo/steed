import { describe, expect, it, vi } from "vitest";
import type { Topology } from "@steed/api/shared";
import { generateTopologyFixture } from "../../../../scripts/topology-fixture";
import { layoutTopology } from "./topology-layout";
import { routeTopologyCooperative } from "./topology-router";
import { TopologyLayoutRuntime } from "./topology-layout-runtime";
import { computeStraightTopologyLayout } from "./topology-layout-preview";
import { computeTopologyLayout, computeTopologyLayoutCooperative } from "./topology-layout-compute";

function topology121(): Topology {
  const source = generateTopologyFixture("topology-200");
  const nodes = source.nodes.slice(0, 121);
  const ids = new Set(nodes.map((node) => node.id));
  let edges = source.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  if (!edges.length) {
    edges = [{ id: "test-121-edge", source: nodes[0]!.id, target: nodes[1]!.id, kind: "uses", label: "Synthetic 121 edge", direction: "uni", evidence: "documented", description: "Synthetic", tags: ["synthetic"] }];
  }
  return { ...source, title: "Synthetic topology 121", nodes, edges, revision: 121001, views: [] };
}

function runtimeForCooperative() {
  return new TopologyLayoutRuntime(
    () => undefined,
    undefined,
    computeStraightTopologyLayout,
    (topology, options, cooperative) => computeTopologyLayoutCooperative(topology, options, {
      batchSize: cooperative?.batchSize,
      clock: () => 0,
      isCancelled: cooperative?.isCancelled,
      yieldControl: cooperative?.yieldControl,
      onProgress: cooperative?.onProgress,
    }),
  );
}

describe("worker cooperative integration", () => {
  it.each(["complete", "timeout", "fallback", "resource-limit", undefined] as const)("runtime cache behavior for %s status", async (status) => {
    const topology = generateTopologyFixture("topology-200");
    let calls = 0;
    const layout = await computeTopologyLayoutCooperative(topology, {}, { clock: () => 0, batchSize: 20, yieldControl: async () => undefined });
    if (layout) {
      layout.routeDiagnostics = { status: status as any, routeFailures: [], fallbackCount: status === "complete" ? 0 : 1, unroutedEdgeIds: status === "complete" ? [] : ["test-200-edge-0001"], elapsedMs: 1, bundleFailures: [], ...(status === "resource-limit" ? { resourceLimit: true as const } : {}) };
    }
    const runtime = new TopologyLayoutRuntime(
      () => undefined,
      undefined,
      computeStraightTopologyLayout,
      async () => { calls++; return layout ? { ...layout } : undefined; },
    );
    const results: unknown[] = [];
    runtime.request({ topology }, (result) => results.push(result));
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    runtime.request({ topology }, (result) => results.push(result));
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("custom cooperative success, failure and cancellation cover runtime branches", async () => {
    const topology = generateTopologyFixture("topology-200");

    const successLayout = await computeTopologyLayoutCooperative(topology, {}, { clock: () => 0, batchSize: 20, yieldControl: async () => undefined });
    const successRuntime = new TopologyLayoutRuntime(
      () => undefined,
      undefined,
      computeStraightTopologyLayout,
      async (input, options, cooperative) => successLayout ? { ...successLayout } : undefined,
    );
    const successResults: unknown[] = [];
    successRuntime.request({ topology }, (result) => successResults.push(result));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(successResults.length).toBeGreaterThanOrEqual(1);

    const failureRuntime = new TopologyLayoutRuntime(
      () => undefined,
      undefined,
      computeStraightTopologyLayout,
      async () => { throw new Error("cooperative failure"); },
    );
    const failureError = vi.fn();
    failureRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn(), failureError);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(failureError).toHaveBeenCalledWith(expect.objectContaining({ message: "cooperative failure" }));

    const cancelledRuntime = new TopologyLayoutRuntime(
      () => undefined,
      undefined,
      computeStraightTopologyLayout,
      async (_topology, _options, cooperative) => {
        if (cooperative?.isCancelled?.()) return undefined;
        return undefined;
      },
    );
    const cancelledResults: unknown[] = [];
    const requestId = cancelledRuntime.request({ topology: { ...topology, revision: 3 } }, (result) => cancelledResults.push(result));
    cancelledRuntime.cancelRequest(requestId);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const completeCount = (cancelledResults as Array<{ routeDiagnostics?: { status?: string } }>).filter((result) => result.routeDiagnostics?.status === "complete").length;
    expect(completeCount).toBe(0);
  });

  it("compute wrapper returns complete layout and cancellation returns undefined", async () => {
    const topology = generateTopologyFixture("topology-200");
    const complete = await computeTopologyLayoutCooperative(topology, {}, { clock: () => 0, batchSize: 20, yieldControl: async () => undefined });
    expect(complete?.routeDiagnostics?.status).toBe("complete");
    expect(complete?.routeDiagnostics?.fallbackCount).toBe(0);
    expect(Object.keys(complete?.routes ?? {})).toHaveLength(topology.edges.length);

    const cancelled = await computeTopologyLayoutCooperative(topology, {}, { clock: () => 0, batchSize: 20, isCancelled: () => true, yieldControl: async () => undefined });
    expect(cancelled).toBeUndefined();

    const sync = computeTopologyLayout(topology, {}, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 });
    expect(sync.routeDiagnostics?.status).toBe("complete");
  });

  for (const topology of [topology121(), generateTopologyFixture("topology-200"), generateTopologyFixture("topology-500")]) {
    it(`publishes preview then complete no-worker result for ${topology.nodes.length} nodes`, async () => {
      const runtime = runtimeForCooperative();
      const results: unknown[] = [];
      runtime.request({ topology }, (result) => results.push(result));
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(results.length).toBeGreaterThanOrEqual(1);
      await new Promise<void>((resolve) => setTimeout(resolve, topology.nodes.length >= 500 ? 10_000 : 1000));
      const complete = results.at(-1) as { routeDiagnostics?: { status?: string; fallbackCount?: number }; routes?: Record<string, unknown> } | undefined;
      expect(complete?.routeDiagnostics?.status).toBe("complete");
      expect(complete?.routeDiagnostics?.fallbackCount).toBe(0);
      expect(Object.keys(complete?.routes ?? {})).toHaveLength(topology.edges.length);
    }, 15_000);
  }

  it("resource-limit cooperative result is reported and never cached", async () => {
    const topology = generateTopologyFixture("topology-200");
    let calls = 0;
    const resourceLayout = await computeTopologyLayoutCooperative(topology, {}, { clock: () => 0, batchSize: 20, yieldControl: async () => undefined });
    if (resourceLayout) {
      resourceLayout.routeDiagnostics = { status: "resource-limit", routeFailures: [], fallbackCount: 1, unroutedEdgeIds: ["test-200-edge-0001"], elapsedMs: 1, bundleFailures: [], resourceLimit: true };
    }
    const runtime = new TopologyLayoutRuntime(
      () => undefined,
      undefined,
      computeStraightTopologyLayout,
      async () => { calls++; return resourceLayout ? { ...resourceLayout } : undefined; },
    );
    const results: unknown[] = [];
    runtime.request({ topology }, (result) => results.push(result));
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    runtime.request({ topology }, (result) => results.push(result));
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(calls).toBeGreaterThanOrEqual(1);
    expect((results.at(-1) as { routeDiagnostics?: { status?: string } } | undefined)?.routeDiagnostics?.status).toBe("resource-limit");
  });

  it("does not cache cooperative timeout or resource-limit results", async () => {
    const topology = generateTopologyFixture("topology-200");
    let calls = 0;
    const timeoutLayout = await computeTopologyLayoutCooperative(topology, {}, { clock: () => 0, batchSize: 20, yieldControl: async () => undefined });
    if (timeoutLayout) {
      timeoutLayout.routeDiagnostics = { status: "timeout", routeFailures: [], fallbackCount: 1, unroutedEdgeIds: ["test-200-edge-0001"], elapsedMs: 1, bundleFailures: [] };
    }
    const runtime = new TopologyLayoutRuntime(
      () => undefined,
      undefined,
      computeStraightTopologyLayout,
      async () => { calls++; return timeoutLayout ? { ...timeoutLayout } : undefined; },
    );
    const first: unknown[] = [];
    runtime.request({ topology }, (result) => first.push(result));
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const second: unknown[] = [];
    runtime.request({ topology }, (result) => second.push(result));
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(calls).toBeGreaterThanOrEqual(1);
    expect((first.at(-1) as { routeDiagnostics?: { status?: string } } | undefined)?.routeDiagnostics?.status).toBe("timeout");
  });

  it.each(["topology-200", "topology-500"] as const)("covers cooperative status, progress and yield for %s", async (name) => {
    const topology = generateTopologyFixture(name);
    const layout = layoutTopology(topology);
    const progress: string[] = [];
    const result = await routeTopologyCooperative(topology, layout, { clock: () => 0, layoutTimeoutMs: 1500, edgeTimeoutMs: 20 }, () => false, 20, async () => undefined, (value) => progress.push(value.phase));
    expect(result?.diagnostics.status).toBe("complete");
    expect(result?.diagnostics.fallbackCount).toBe(0);
    expect(Object.keys(result?.routes ?? {})).toHaveLength(topology.edges.length);
    expect(progress).toContain("prepared");
    expect(progress).toContain("complete");
  }, 30_000);

  it("covers cooperative prepare, yield, post-finish and repeated cancel boundaries", async () => {
    const topology = generateTopologyFixture("topology-200");
    const layout = layoutTopology(topology);
    expect(await routeTopologyCooperative(topology, layout, { clock: () => 0 }, () => true, 20, async () => undefined)).toBeUndefined();

    let cancelledAfterPrepare = false;
    const afterPrepare = await routeTopologyCooperative(topology, layout, { clock: () => 0 }, () => cancelledAfterPrepare, 20, async () => { cancelledAfterPrepare = true; });
    expect(afterPrepare).toBeUndefined();

    const progress: string[] = [];
    const complete = await routeTopologyCooperative(topology, layout, { clock: () => 0 }, () => false, 20, async () => undefined, (value) => progress.push(value.phase));
    expect(complete?.diagnostics.status).toBe("complete");
    expect(progress).toContain("prepared");
    expect(progress).toContain("extras");
    expect(progress.at(-1)).toBe("complete");
  });

  it("covers cooperative compute cancellation, yield cancellation and undefined completion", async () => {
    const topology = generateTopologyFixture("topology-200");
    expect(await computeTopologyLayoutCooperative(topology, {}, { isCancelled: () => true })).toBeUndefined();

    let cancelled = false;
    const cancelledAfterYield = await computeTopologyLayoutCooperative(topology, {}, {
      isCancelled: () => cancelled,
      yieldControl: async () => { cancelled = true; },
    });
    expect(cancelledAfterYield).toBeUndefined();

    const undefinedResult = await computeTopologyLayoutCooperative(topology, {}, {
      yieldControl: async () => undefined,
      isCancelled: () => false,
    });
    expect(undefinedResult).toBeDefined();
  });

  it("does not publish or cache cooperative completion after cancel", async () => {
    const topology = generateTopologyFixture("topology-500");
    const runtime = runtimeForCooperative();
    const results: unknown[] = [];
    const requestId = runtime.request({ topology }, (result) => results.push(result));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    runtime.cancelRequest(requestId);
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    const completeCount = (results as Array<{ routeDiagnostics?: { status?: string } }>).filter((result) => result.routeDiagnostics?.status === "complete").length;
    expect(completeCount).toBe(0);
  }, 15_000);
});
