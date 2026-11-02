import { describe, expect, it, vi } from "vitest";
import type { Topology } from "@steed/api/shared";
import { generateTopologyFixture } from "../../../../scripts/topology-fixture";
import { layoutTopology } from "./topology-layout";
import { computeTopologyLayout } from "./topology-layout-compute";
import { computeStraightTopologyLayout } from "./topology-layout-preview";
import {
  LAYOUT_VERSION,
  TOPOLOGY_SYNC_NODE_LIMIT,
  TOPOLOGY_LAYOUT_PREVIEW_MS,
  TOPOLOGY_SYNC_LAYOUT_TIMEOUT_MS,
  TOPOLOGY_SYNC_EDGE_TIMEOUT_MS,
  TopologyLayoutLruCache,
  TopologyLayoutRuntime,
  defaultTopologyLayoutWorker,
  topologyLayoutCanonicalHash,
  topologyLayoutCacheKey,
  topologyLayoutPinsHash,
  type LayoutWorkerLike,
} from "./topology-layout-runtime";
import type { LayoutWorkerRequest, LayoutWorkerResponse } from "./layout.worker";

function sample(revision = 1): Topology {
  return {
    schemaVersion: 2,
    title: "Worker fixture",
    description: "Synthetic",
    revision,
    layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" }],
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries: [],
    nodes: [
      { id: "a", type: "host", label: "A", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "b", type: "host", label: "B", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
    ],
    edges: [{ id: "a-b", source: "a", target: "b", kind: "uses", label: "Runs", direction: "uni", evidence: "documented", description: "", tags: [] }],
    views: [{ id: "view-a", label: "View A", description: "", filter: { layerIds: [], typeIds: [], boundaryIds: [], tags: [] }, pins: { b: { x: 20, y: 10 } } }],
  };
}

function mockWorker(postMessage: (message: LayoutWorkerRequest, worker: LayoutWorkerLike) => void): LayoutWorkerLike {
  const worker: LayoutWorkerLike = {
    postMessage: vi.fn((message: LayoutWorkerRequest) => postMessage(message, worker)),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
  return worker;
}

describe("topology layout runtime", () => {
  it("reports non-Error preview failures without losing a healthy worker result", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const topology = sample();
    const messages: LayoutWorkerRequest[] = [];
    const worker = mockWorker((message) => messages.push(message));
    const runtime = new TopologyLayoutRuntime(() => worker, undefined, () => { throw "preview failure"; });
    const onResult = vi.fn();
    const onError = vi.fn();
    runtime.request({ topology }, onResult, onError);
    vi.advanceTimersByTime(TOPOLOGY_LAYOUT_PREVIEW_MS);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Straight preview failed" }));
    const result = computeTopologyLayout(topology);
    worker.onmessage?.({ data: { requestId: messages[0]!.requestId, layoutVersion: LAYOUT_VERSION, ok: true, result } } as MessageEvent<LayoutWorkerResponse>);
    expect(onResult).toHaveBeenCalledWith(result);
    runtime.dispose();
    warning.mockRestore();
    vi.useRealTimers();
  });

  it("reports a non-Error fallback failure with the worker cause when available", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const topology = sample();
    const straight = () => { throw "preview failure"; };
    const unavailable = new TopologyLayoutRuntime(() => undefined, undefined, straight);
    const withCause = new TopologyLayoutRuntime(() => { throw new Error("worker unavailable"); }, undefined, straight);
    const unavailableError = vi.fn();
    const causeError = vi.fn();
    unavailable.request({ topology }, vi.fn(), unavailableError);
    withCause.request({ topology }, vi.fn(), causeError);
    expect(unavailableError).toHaveBeenCalledWith(expect.objectContaining({ message: "Straight layout failed" }));
    expect(causeError).toHaveBeenCalledWith(expect.objectContaining({ message: "worker unavailable" }));
    unavailable.dispose();
    withCause.dispose();
    warning.mockRestore();
  });

  it("caches only complete worker results and retries every incomplete status", () => {
    vi.useFakeTimers();
    const topology = sample();
    for (const status of ["complete", "timeout", "fallback", "resource-limit", undefined] as const) {
      const messages: LayoutWorkerRequest[] = [];
      const worker = mockWorker((message) => messages.push(message));
      const runtime = new TopologyLayoutRuntime(() => worker);
      const first = vi.fn();
      runtime.request({ topology, viewId: status ?? "empty" }, first);
      const message = messages[0]!;
      const result = computeTopologyLayout(topology);
      if (status) {
        result.routeDiagnostics = {
          unresolvedTwoPointSharedChannels: [],
          status,
          routeFailures: status === "complete" ? [] : [{ edgeId: "a-b", reason: "timeout" }],
          fallbackCount: status === "complete" ? 0 : 1,
          unroutedEdgeIds: status === "complete" ? [] : ["a-b"],
          elapsedMs: 1,
          bundleFailures: [],
        };
      }
      worker.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION, ok: true, result } } as MessageEvent<LayoutWorkerResponse>);
      expect(first).toHaveBeenCalledTimes(1);
      runtime.request({ topology, viewId: status ?? "empty" }, vi.fn());
      if (status === undefined || status === "complete") expect(messages).toHaveLength(1);
      else expect(messages).toHaveLength(2);
    }
    vi.useRealTimers();
  });

  it("isolates obsolete worker errors, post throws and stale replies", () => {
    vi.useFakeTimers();
    const topology = sample();
    const workers: LayoutWorkerLike[] = [];
    const runtime = new TopologyLayoutRuntime(() => {
      const worker = mockWorker(() => undefined);
      workers.push(worker);
      return worker;
    });
    const newest = vi.fn();
    runtime.request({ topology, viewId: "old" }, vi.fn());
    const oldError = workers[0]!.onerror!;
    const oldWorker = workers[0]!;
    oldWorker.onmessage?.({ data: { requestId: "layout-1", layoutVersion: LAYOUT_VERSION, ok: false, message: "retire" } } as MessageEvent<LayoutWorkerFailure>);
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "new" }, newest);
    oldError({} as ErrorEvent);
    const result = computeTopologyLayout({ ...topology, revision: 2 });
    workers[1]!.onmessage?.({ data: { requestId: "layout-2", layoutVersion: LAYOUT_VERSION, ok: true, result } } as MessageEvent<LayoutWorkerResponse>);
    expect(newest).toHaveBeenCalledWith(result);

    const postWorker = mockWorker(() => undefined);
    postWorker.postMessage = vi.fn(() => { throw new Error("post throw"); });
    const postRuntime = new TopologyLayoutRuntime(() => postWorker);
    const postError = vi.fn();
    postRuntime.request({ topology: { ...topology, revision: 3 } }, vi.fn(), postError);
    vi.runOnlyPendingTimers();
    expect(postWorker.terminate).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it.each(["error", "failure", "post"] as const)("ignores a delayed error after worker retirement by %s", (retirement) => {
    vi.useFakeTimers();
    const topology = sample();
    const workers: LayoutWorkerLike[] = [];
    const callbackB = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => {
      const worker = mockWorker(() => {
        if (workers.length === 1 && retirement === "post") throw new Error("post failed");
      });
      workers.push(worker);
      return worker;
    });

    runtime.request({ topology, viewId: "a" }, vi.fn());
    const oldError = workers[0]!.onerror!;
    if (retirement === "error") oldError({} as ErrorEvent);
    if (retirement === "failure") workers[0]!.onmessage?.({ data: { requestId: "layout-1", layoutVersion: LAYOUT_VERSION, ok: false, message: "failed" } } as MessageEvent);
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "b" }, callbackB);

    oldError({} as ErrorEvent);
    expect(callbackB).not.toHaveBeenCalled();
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1);

    const workerBResult = computeTopologyLayout({ ...topology, revision: 2 }, { viewId: "b" });
    workers[1]!.onmessage?.({ data: { requestId: "layout-2", layoutVersion: LAYOUT_VERSION, ok: true, result: workerBResult } } as MessageEvent<LayoutWorkerResponse>);

    expect(callbackB).toHaveBeenCalledWith(workerBResult);
    runtime.request({ topology: { ...topology, revision: 3 } }, vi.fn());
    expect(workers).toHaveLength(2);
    expect(workers[1]!.postMessage).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("covers worker runtime status matrix and cache retry boundaries", () => {
    vi.useFakeTimers();
    const topology = sample();
    for (const status of ["complete", "timeout", "fallback", "resource-limit", undefined] as const) {
      const worker = mockWorker(() => undefined);
      let callbackCount = 0;
      const runtime = new TopologyLayoutRuntime(() => worker);
      runtime.request({ topology, viewId: "view-a", pins: topology.views[0]!.pins }, (layout) => {
        callbackCount++;
        layout.routeDiagnostics = {
          unresolvedTwoPointSharedChannels: [],
          status: status as never,
          routeFailures: status === "complete" ? [] : [{ edgeId: "a-b", reason: "timeout" }],
          fallbackCount: status === "complete" ? 0 : 1,
          unroutedEdgeIds: status === "complete" ? [] : ["a-b"],
          elapsedMs: 1,
          bundleFailures: [],
        };
      });
      expect(callbackCount).toBe(0);
      vi.runOnlyPendingTimers();
    }
    vi.useRealTimers();
  });

  it("normalizes empty viewId and options viewId in cache identity", () => {
    const topology = sample();
    const pins = topology.views[0]!.pins;

    expect(topologyLayoutCacheKey(topology, "", pins, { viewId: "a-first" }))
      .not.toBe(topologyLayoutCacheKey(topology, "", pins, { viewId: "b-first" }));
    expect(topologyLayoutCacheKey(topology, "", pins, { viewId: "a-first" }))
      .toBe(topologyLayoutCacheKey(topology, "", pins, { viewId: "a-first" }));
  });

  it("routes distinct option views when the top-level view id is empty", () => {
    const topology = sample();
    const view = topology.views[0]!;
    topology.views = [
      { ...view, id: "a-first", pins: { a: { x: 0, y: 0 }, b: { x: 0, y: 100 } } },
      { ...view, id: "b-first", pins: { a: { x: 0, y: 100 }, b: { x: 0, y: 0 } } },
    ];
    const messages: LayoutWorkerRequest[] = [];
    const worker = mockWorker((message) => messages.push(message));
    const runtime = new TopologyLayoutRuntime(() => worker);
    const first = vi.fn();
    const second = vi.fn();

    runtime.request({ topology, viewId: "", options: { viewId: "a-first" } }, first);
    const firstMessage = messages[0]!;
    const firstResult = computeTopologyLayout(topology, firstMessage.options);
    worker.onmessage?.({ data: { requestId: firstMessage.requestId, layoutVersion: LAYOUT_VERSION, ok: true, result: firstResult } } as MessageEvent<LayoutWorkerResponse>);
    runtime.request({ topology, viewId: "", options: { viewId: "b-first" } }, second);
    expect(messages).toHaveLength(2);
    const secondMessage = messages[1]!;
    const secondResult = computeTopologyLayout(topology, secondMessage.options);
    worker.onmessage?.({ data: { requestId: secondMessage.requestId, layoutVersion: LAYOUT_VERSION, ok: true, result: secondResult } } as MessageEvent<LayoutWorkerResponse>);
    expect(second).toHaveBeenCalledWith(secondResult);
    expect(firstResult.positions.a).not.toEqual(secondResult.positions.a);
  });

  it("does not cache partial sync timeout results under the normal completed key", () => {
    vi.useFakeTimers();
    const topology = sample();
    const partial = layoutTopology(topology);
    partial.routeDiagnostics = { unresolvedTwoPointSharedChannels: [], status: "timeout", routeFailures: [{ edgeId: "a-b", reason: "timeout" }], fallbackCount: 1, unroutedEdgeIds: ["a-b"], elapsedMs: 1, bundleFailures: [] };
    const sync = vi.fn(() => partial);
    let available = false;
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => available ? worker : undefined, sync);

    const first = vi.fn();
    runtime.request({ topology, viewId: "view-a" }, first);
    vi.runOnlyPendingTimers();
    expect(sync).toHaveBeenCalledTimes(1);

    available = true;
    runtime.request({ topology, viewId: "view-a" }, vi.fn());
    expect(worker.postMessage).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it.each(["timeout", "resource-limit", "fallback"] as const)("retries a worker %s result instead of caching an incomplete route", (status) => {
    const topology = sample();
    const messages: LayoutWorkerRequest[] = [];
    const worker = mockWorker((message) => messages.push(message));
    const runtime = new TopologyLayoutRuntime(() => worker);
    const partial = layoutTopology(topology);
    partial.routeDiagnostics = { unresolvedTwoPointSharedChannels: [], status, routeFailures: [{ edgeId: "a-b", reason: "timeout" }], fallbackCount: 1, unroutedEdgeIds: ["a-b"], elapsedMs: 1, bundleFailures: [] };
    const first = vi.fn();
    runtime.request({ topology }, first);
    worker.onmessage?.({ data: { requestId: messages[0]!.requestId, layoutVersion: LAYOUT_VERSION, ok: true, result: partial } } as MessageEvent<LayoutWorkerResponse>);
    expect(first).toHaveBeenCalledWith(partial);
    runtime.request({ topology }, vi.fn());
    expect(messages).toHaveLength(2);
    runtime.cancelRequest(messages[1]!.requestId);
  });

  it("includes layout origin, aspect and view filters in cache keys", () => {
    const topology = sample();
    const pins = topology.views[0]!.pins;

    expect(topologyLayoutCacheKey(topology, "view-a", pins, { origin: { x: 0, y: 0 } }))
      .not.toBe(topologyLayoutCacheKey(topology, "view-a", pins, { origin: { x: 100, y: 100 } }));
    expect(topologyLayoutCacheKey(topology, "view-a", pins, { aspect: 1.6 }))
      .not.toBe(topologyLayoutCacheKey(topology, "view-a", pins, { aspect: 2 }));
    expect(topologyLayoutCacheKey(topology, "view-a", pins, { view: topology.views[0] }))
      .not.toBe(topologyLayoutCacheKey(topology, "view-a", pins, { view: { ...topology.views[0]!, pins: { b: { x: 999, y: 999 } } } }));
  });

  it("reuses one worker after repeated requests", () => {
    vi.useFakeTimers();
    const topology = sample();
    const workerFactory = vi.fn(() => mockWorker(() => undefined));
    const runtime = new TopologyLayoutRuntime(workerFactory);

    runtime.request({ topology, viewId: "one" }, vi.fn());
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "two" }, vi.fn());

    expect(workerFactory).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("ignores layout-version mismatch and stale worker reply", () => {
    vi.useFakeTimers();
    const topology = sample();
    const callback = vi.fn();
    const worker = mockWorker((message, current) => {
      current.onmessage?.({ data: {
        requestId: message.requestId,
        layoutVersion: LAYOUT_VERSION + 1,
        ok: true,
        result: computeTopologyLayout(topology),
      } } as never);
      current.onmessage?.({ data: {
        requestId: "layout-stale",
        layoutVersion: LAYOUT_VERSION,
        ok: true,
        result: computeTopologyLayout(topology),
      } } as never);
    });
    const runtime = new TopologyLayoutRuntime(() => worker);

    runtime.request({ topology }, callback);
    vi.runOnlyPendingTimers();
    expect(callback).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("worker onerror after cancel is harmless and clears timers", () => {
    vi.useFakeTimers();
    const topology = sample();
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker);

    const requestId = runtime.request({ topology }, vi.fn());
    runtime.cancelRequest(requestId);
    worker.onerror?.({} as ErrorEvent);
    vi.runOnlyPendingTimers();

    vi.useRealTimers();
  });

  it("dynamic-import fallback computes only the latest small graph", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const first = vi.fn();
    const second = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => undefined);

    runtime.request({ topology, viewId: "old" }, first);
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "new" }, second);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(first.mock.calls.length).toBe(1);
    expect(second.mock.calls.length).toBeGreaterThanOrEqual(2);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("dynamically imports bounded routed compute for a small no-worker fallback", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const runtime = new TopologyLayoutRuntime(() => undefined);
    const callback = vi.fn();

    runtime.request({ topology }, callback);
    vi.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(callback).toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("ignores stale dynamic-import sync replies after supersede", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const runtime = new TopologyLayoutRuntime(() => undefined);
    const first = vi.fn();
    const second = vi.fn();

    runtime.request({ topology, revision: topology.revision } as never, first);
    runtime.request({ topology: { ...topology, revision: 2 } }, second);
    vi.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(second).toHaveBeenCalled();
    expect(first.mock.calls.length).toBeLessThanOrEqual(2);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("ignores delayed injected cooperative rejection after supersede", async () => {
    vi.useFakeTimers();
    const topology = sample();
    let rejectFirst: ((error: unknown) => void) | undefined;
    const cooperative = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectFirst = reject;
    }));
    const firstError = vi.fn();
    const secondError = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => undefined, undefined, computeStraightTopologyLayout, cooperative);

    runtime.request({ topology, viewId: "old" }, vi.fn(), firstError);
    await vi.runOnlyPendingTimersAsync();
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "new" }, vi.fn(), secondError);
    rejectFirst?.(new Error("old cooperative rejection"));
    await Promise.resolve();

    expect(firstError).not.toHaveBeenCalled();
    expect(secondError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("ignores delayed cooperative rejection after cancellation", async () => {
    vi.useFakeTimers();
    const topology = sample();
    let reject: ((error: unknown) => void) | undefined;
    const cooperative = vi.fn(() => new Promise<never>((_resolve, rejection) => {
      reject = rejection;
    }));
    const onError = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => undefined, undefined, computeStraightTopologyLayout, cooperative);

    const requestId = runtime.request({ topology }, vi.fn(), onError);
    await vi.runOnlyPendingTimersAsync();
    runtime.cancelRequest(requestId);
    reject?.(new Error("cancelled cooperative rejection"));
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("discards cooperative completion after disposal without poisoning the cache", async () => {
    vi.useFakeTimers();
    const topology = sample();
    let resolve: ((result: ReturnType<typeof computeTopologyLayout>) => void) | undefined;
    const cooperative = vi.fn(() => new Promise<ReturnType<typeof computeTopologyLayout>>((done) => {
      resolve = done;
    }));
    const onResult = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => undefined, undefined, computeStraightTopologyLayout, cooperative);

    runtime.request({ topology }, onResult);
    await vi.runOnlyPendingTimersAsync();
    expect(onResult).toHaveBeenCalledTimes(1);
    runtime.dispose();
    resolve?.(computeTopologyLayout(topology));
    await Promise.resolve();
    expect(onResult).toHaveBeenCalledTimes(1);

    const replay = vi.fn();
    runtime.request({ topology }, replay);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay.mock.calls[0]?.[0].routeDiagnostics?.status).toBe("timeout");
    await vi.runOnlyPendingTimersAsync();
    expect(cooperative).toHaveBeenCalledTimes(2);
    runtime.dispose();
    vi.useRealTimers();
  });

  it("postMessage throw clears preview/sync timers and still publishes fallback", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const worker: LayoutWorkerLike = {
      postMessage: vi.fn(() => { throw new Error("post throw"); }),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    const sync = vi.fn(computeTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => worker, sync);
    const callback = vi.fn();

    runtime.request({ topology }, callback);
    vi.runOnlyPendingTimers();

    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("worker success clears preview timer and prevents pending sync", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    let sent: LayoutWorkerRequest | undefined;
    const worker = mockWorker((message) => { sent = message; });
    const runtime = new TopologyLayoutRuntime(() => worker);
    const callback = vi.fn();

    runtime.request({ topology }, callback);
    vi.advanceTimersByTime(60);
    expect(callback).not.toHaveBeenCalled();

    worker.onmessage?.({ data: {
      requestId: sent?.requestId ?? "layout-1",
      layoutVersion: LAYOUT_VERSION,
      ok: true,
      result: computeTopologyLayout(topology),
    } } as MessageEvent<LayoutWorkerResponse>);
    vi.runOnlyPendingTimers();

    expect(callback).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("worker failure reply runs straight preview and bounded sync for a small graph", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const worker = mockWorker((message, current) => {
      current.onmessage?.({ data: {
        requestId: message.requestId,
        layoutVersion: message.layoutVersion,
        ok: false,
        message: "worker failed",
      } } as never);
    });
    const runtime = new TopologyLayoutRuntime(() => worker, sync);
    const callback = vi.fn();

    runtime.request({ topology }, callback);
    vi.runOnlyPendingTimers();

    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("stale layout-version and stale request replies do not replace cache or callback", () => {
    const topology = sample();
    const callback = vi.fn();
    const worker = mockWorker((message, current) => {
      current.onmessage?.({ data: {
        requestId: message.requestId,
        layoutVersion: LAYOUT_VERSION + 1,
        ok: true,
        result: computeTopologyLayout(topology),
      } } as never);
      current.onmessage?.({ data: {
        requestId: "layout-999",
        layoutVersion: LAYOUT_VERSION,
        ok: true,
        result: computeTopologyLayout(topology),
      } } as never);
    });
    const runtime = new TopologyLayoutRuntime(() => worker);

    runtime.request({ topology }, callback);
    expect(callback).not.toHaveBeenCalled();
  });

  it("LRU evicts oldest, promotes hits and supports size zero", () => {
    const topology = sample();
    const lru = new TopologyLayoutLruCache(4);
    const layouts = Array.from({ length: 5 }, (_, index) => layoutTopology({ ...topology, revision: index + 1 }));

    layouts.forEach((layout, index) => lru.set(`key-${index}`, layout));
    expect(lru.sizeValue).toBe(4);
    expect(lru.has("key-0")).toBe(false);
    expect(lru.get("key-1")).toBe(layouts[1]);
    lru.set("key-5", layouts[4]!);
    expect(lru.sizeValue).toBe(4);

    const zero = new TopologyLayoutLruCache(0);
    zero.set("zero", layouts[0]!);
    expect(zero.sizeValue).toBe(0);
  });

  it("uses constructor defaults and existing worker reuse branches", () => {
    vi.useFakeTimers();
    const topology = sample();
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker);

    runtime.request({ topology, viewId: "one" }, vi.fn());
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "two" }, vi.fn());

    vi.useRealTimers();
  });

  it("covers cancel preview/sync timers and onerror-without-pending", () => {
    vi.useFakeTimers();
    const topology = sample();
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker);

    const previewRequest = runtime.request({ topology }, vi.fn());
    runtime.cancelRequest(previewRequest);
    worker.onerror?.({} as ErrorEvent);

    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("covers 500 limit and custom sync success/failure branches", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();

    const success = vi.fn(computeTopologyLayout);
    const successRuntime = new TopologyLayoutRuntime(() => undefined, success);
    successRuntime.request({ topology }, vi.fn());
    vi.runOnlyPendingTimers();
    expect(success).toHaveBeenCalledTimes(1);

    const failure = vi.fn(() => { throw new Error("sync branch failure"); });
    const failureRuntime = new TopologyLayoutRuntime(() => undefined, failure);
    const error = vi.fn();
    failureRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn(), error);
    vi.runOnlyPendingTimers();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "sync branch failure" }));

    topology.nodes = Array.from({ length: 500 }, (_, index) => ({ ...sample().nodes[0]!, id: `n-${index}`, label: `N ${index}` }));
    const largeSync = vi.fn(computeTopologyLayout);
    const largeRuntime = new TopologyLayoutRuntime(() => undefined, largeSync);
    largeRuntime.request({ topology }, vi.fn());
    vi.runOnlyPendingTimers();
    expect(largeSync).not.toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers cache origin/aspect/view/filter branches and canonical hash fallback", () => {
    const topology = sample();
    const base = topologyLayoutCacheKey(topology, "view-a", topology.views[0]!.pins, { origin: { x: 0, y: 0 }, aspect: 1.6, view: topology.views[0] });
    const changed = topologyLayoutCacheKey(topology, "view-a", topology.views[0]!.pins, { origin: { x: 10, y: 20 }, aspect: 2, view: { ...topology.views[0]!, filter: { layerIds: ["cloud"], typeIds: [], boundaryIds: [], tags: [] } } });
    expect(changed).not.toBe(base);

    const layout = layoutTopology(topology);
    layout.routes = { "a-b": { edgeId: "a-b", source: "a", target: "b", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], sourceSide: "right", targetSide: "left", status: "fallback", renderMode: "straight", fallbackStyle: "dashed", fallback: "timeout" } };
    layout.bundles = [{ id: "bundle:a-b", layerIds: ["cloud", "edge"], count: 1, edgeIds: ["a-b"], kindCounts: { uses: 1 }, route: null, fallback: "timeout" }];
    expect(topologyLayoutCanonicalHash(layout)).toContain("timeout");
  });

  it("covers dynamic import success and stale request branches", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const first = vi.fn();
    const second = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => undefined);

    runtime.request({ topology, viewId: "old" }, first);
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "new" }, second);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(first.mock.calls.length).toBe(1);
    expect(second.mock.calls.length).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers default Worker success and constructor throw branches", () => {
    vi.stubGlobal("Worker", class {
      onmessage = null;
      onerror = null;
      postMessage() {}
      terminate() {}
    });
    expect(defaultTopologyLayoutWorker()).toBeDefined();

    vi.stubGlobal("Worker", class {
      constructor() { throw new Error("worker constructor"); }
    });
    expect(defaultTopologyLayoutWorker()).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("constructor defaults and existing-worker reuse cover runtime defaults", () => {
    vi.useFakeTimers();
    const topology = sample();
    const runtime = new TopologyLayoutRuntime();
    const workerRuntime = new TopologyLayoutRuntime(() => mockWorker(() => undefined));

    runtime.request({ topology }, vi.fn());
    workerRuntime.request({ topology }, vi.fn());
    workerRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn());
    vi.runOnlyPendingTimers();

    vi.useRealTimers();
  });

  it("cancel clears both preview and sync timers and onerror-without-pending is harmless", () => {
    vi.useFakeTimers();
    const topology = sample();
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker);

    const requestId = runtime.request({ topology }, vi.fn());
    runtime.cancelRequest(requestId);
    worker.onerror?.({} as ErrorEvent);
    vi.runOnlyPendingTimers();

    vi.useRealTimers();
  });

  it("preview throw and bounded sync success/failure cover fallback branches", () => {
    vi.useFakeTimers();
    const topology = sample();
    const previewError = vi.fn();
    const previewRuntime = new TopologyLayoutRuntime(() => undefined, computeTopologyLayout, () => { throw new Error("preview throw"); });
    previewRuntime.request({ topology }, vi.fn(), previewError);
    vi.runOnlyPendingTimers();
    expect(previewError).toHaveBeenCalledWith(expect.objectContaining({ message: "preview throw" }));

    const syncRuntime = new TopologyLayoutRuntime(() => undefined, () => { throw new Error("sync throw"); });
    const syncError = vi.fn();
    syncRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn(), syncError);
    vi.runOnlyPendingTimers();
    expect(syncError).toHaveBeenCalledWith(expect.objectContaining({ message: "sync throw" }));

    vi.useRealTimers();
  });

  it("dynamic import success/failure and 500 limit settle timers", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const first = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => undefined);

    runtime.request({ topology }, first);
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(first).toHaveBeenCalled();

    topology.nodes = Array.from({ length: 500 }, (_, index) => ({ ...sample().nodes[0]!, id: `n-${index}`, label: `N ${index}` }));
    const large = new TopologyLayoutRuntime(() => undefined);
    large.request({ topology }, vi.fn());
    vi.runOnlyPendingTimers();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("default worker success and throw branches are covered", () => {
    vi.stubGlobal("Worker", class {
      onmessage = null;
      onerror = null;
      postMessage() {}
      terminate() {}
    });
    expect(defaultTopologyLayoutWorker()).toBeDefined();

    vi.stubGlobal("Worker", class {
      constructor() { throw new Error("worker constructor throw"); }
    });
    expect(defaultTopologyLayoutWorker()).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("returns a completed cache hit without constructing a preview or worker", () => {
    vi.useFakeTimers();
    const topology = sample();
    const workerFactory = vi.fn(() => undefined);
    const straight = vi.fn(computeStraightTopologyLayout);
    const runtime = new TopologyLayoutRuntime(workerFactory, computeTopologyLayout, straight);
    const callback = vi.fn();

    runtime.request({ topology, viewId: "view-a", pins: topology.views[0]!.pins }, callback);
    vi.runOnlyPendingTimers();
    expect(callback).toHaveBeenCalledTimes(2);

    callback.mockClear();
    runtime.request({ topology, viewId: "view-a", pins: topology.views[0]!.pins }, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(straight).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("bounds and isolates worker/sync fallback after preview and stale supersede", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const straight = vi.fn(computeStraightTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);
    const first = vi.fn();
    const second = vi.fn();

    runtime.request({ topology, viewId: "old" }, first);
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "new" }, second);
    vi.runOnlyPendingTimers();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("keeps straight preview and one warning when straight preview throws", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const straight = vi.fn(() => { throw new Error("preview crash"); });
    const sync = vi.fn(computeTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);
    const error = vi.fn();

    runtime.request({ topology }, vi.fn(), error);
    vi.runOnlyPendingTimers();

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "preview crash" }));
    expect(warning.mock.calls.length).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("records bounded sync failure and retains the straight preview", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const straight = vi.fn(computeStraightTopologyLayout);
    const sync = vi.fn(() => { throw new Error("bounded sync crash"); });
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);
    const callback = vi.fn();
    const error = vi.fn();

    runtime.request({ topology }, callback, error);
    vi.runOnlyPendingTimers();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "bounded sync crash" }));
    expect(warning.mock.calls.flat().join(" ")).toContain("Straight-only");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("rejects layout-version mismatches and stale pending replies", () => {
    const topology = sample();
    const callback = vi.fn();
    const worker = mockWorker((message, current) => {
      current.onmessage?.({ data: {
        requestId: message.requestId,
        layoutVersion: LAYOUT_VERSION + 1,
        ok: true,
        result: computeTopologyLayout(topology),
      } } as never);
    });
    const runtime = new TopologyLayoutRuntime(() => worker);

    runtime.request({ topology }, callback);
    expect(callback).not.toHaveBeenCalled();
  });

  it("real-clock no-worker 500 heartbeat stays responsive and schedules no sync route", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    topology.nodes = Array.from({ length: 500 }, (_, index) => ({
      id: `heartbeat-${index}`,
      type: "host",
      label: `Heartbeat ${index}`,
      layerId: "cloud",
      boundaryIds: [],
      lifecycle: "active" as const,
      description: "",
      tags: [],
      attrs: {},
    }));
    topology.edges = [];

    const sync = vi.fn(computeTopologyLayout);
    const straight = vi.fn(computeStraightTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);
    let beats = 0;
    const interval = setInterval(() => { beats += 1; }, 10);
    const started = performance.now();
    runtime.request({ topology }, vi.fn());
    const elapsed = performance.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 250));
    clearInterval(interval);

    expect(elapsed).toBeLessThan(250);
    expect(beats).toBeGreaterThanOrEqual(5);
    expect(sync).not.toHaveBeenCalled();
    expect(straight).toHaveBeenCalledTimes(1);

    warning.mockRestore();
  });

  it("covers cache key, pins and canonical hash branches", () => {
    const topology = sample();
    expect(topologyLayoutCacheKey(topology, undefined, undefined)).not.toBe(topologyLayoutCacheKey({ ...topology, revision: 2 }, undefined, undefined));
    expect(topologyLayoutPinsHash(undefined)).toBe("[]");

    const layout = layoutTopology(topology);
    layout.routes = {};
    layout.bundles = [];
    layout.routeDiagnostics = { status: "timeout", routeFailures: [], fallbackCount: 0, unroutedEdgeIds: [], elapsedMs: 0, bundleFailures: [] };
    expect(topologyLayoutCanonicalHash(layout)).toBeTruthy();
  });

  it("covers worker mismatch, stale reply and onerror without pending", () => {
    vi.useFakeTimers();
    const topology = sample();
    const callback = vi.fn();
    const worker = mockWorker((message, current) => {
      current.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION + 1, ok: true, result: computeTopologyLayout(topology) } } as never);
      current.onmessage?.({ data: { requestId: "layout-stale", layoutVersion: LAYOUT_VERSION, ok: true, result: computeTopologyLayout(topology) } } as never);
    });
    const runtime = new TopologyLayoutRuntime(() => worker);

    runtime.request({ topology }, callback);
    vi.runOnlyPendingTimers();
    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(1);

    runtime.cancelRequest("layout-999");
    worker.onerror?.({} as ErrorEvent);

    vi.useRealTimers();
  });

  it("covers worker ok-false response and cancellation timer cleanup", () => {
    vi.useFakeTimers();
    const topology = sample();
    const callback = vi.fn();
    const worker = mockWorker((message, current) => {
      current.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION, ok: false, message: "failed" } } as never);
    });
    const runtime = new TopologyLayoutRuntime(() => worker);

    const requestId = runtime.request({ topology }, callback);
    runtime.cancelRequest(requestId);
    vi.runOnlyPendingTimers();

    expect(callback.mock.calls.length).toBeLessThanOrEqual(1);

    vi.useRealTimers();
  });

  it("covers 500-node straight-only and cooperative small sync limits", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const large = sample();
    large.nodes = Array.from({ length: 500 }, (_, index) => ({ ...sample().nodes[0]!, id: `n-${index}`, label: `N ${index}` }));
    const largeSync = vi.fn(computeTopologyLayout);
    const largeRuntime = new TopologyLayoutRuntime(() => undefined, largeSync);

    largeRuntime.request({ topology: large }, vi.fn());
    vi.runOnlyPendingTimers();
    expect(largeSync).not.toHaveBeenCalled();

    const smallSync = vi.fn(computeTopologyLayout);
    const smallRuntime = new TopologyLayoutRuntime(() => undefined, smallSync);
    smallRuntime.request({ topology: sample() }, vi.fn());
    vi.runOnlyPendingTimers();
    expect(smallSync).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers preview throw, bounded sync throw and finally cleanup", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();

    const previewRuntime = new TopologyLayoutRuntime(() => undefined, computeTopologyLayout, () => { throw new Error("preview"); });
    const previewError = vi.fn();
    previewRuntime.request({ topology }, vi.fn(), previewError);
    vi.runOnlyPendingTimers();
    expect(previewError).toHaveBeenCalledWith(expect.objectContaining({ message: "preview" }));

    const syncRuntime = new TopologyLayoutRuntime(() => undefined, () => { throw new Error("sync"); });
    const syncError = vi.fn();
    syncRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn(), syncError);
    vi.runOnlyPendingTimers();
    expect(syncError).toHaveBeenCalledWith(expect.objectContaining({ message: "sync" }));

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers dynamic-import success and stale supersede", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const first = vi.fn();
    const second = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => undefined);

    runtime.request({ topology, viewId: "one" }, first);
    await vi.runAllTimersAsync();
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "two" }, second);
    await vi.runAllTimersAsync();

    expect(first.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(second.mock.calls.length).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("clears preview and sync timers on cancel and stale supersede", () => {
    vi.useFakeTimers();
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const straight = vi.fn(computeStraightTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);

    const first = runtime.request({ topology, viewId: "cancel" }, vi.fn());
    runtime.cancelRequest(first);
    vi.runOnlyPendingTimers();
    expect(sync).not.toHaveBeenCalled();

    runtime.request({ topology, viewId: "old" }, vi.fn());
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "new" }, vi.fn());
    vi.runOnlyPendingTimers();
    expect(sync).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("LRU size zero stops eviction and canonical hash handles empty routes and bundles", () => {
    const topology = sample();
    const lru = new TopologyLayoutLruCache(0);
    const layout = layoutTopology(topology);
    lru.set("zero", layout);
    expect(lru.sizeValue).toBe(0);
    expect(lru.get("zero")).toBeUndefined();

    layout.routes = {};
    layout.bundles = [];
    layout.routeDiagnostics = { status: "timeout", routeFailures: [], fallbackCount: 0, unroutedEdgeIds: [], elapsedMs: 0, bundleFailures: [] };
    expect(topologyLayoutCanonicalHash(layout)).toBeTruthy();
  });

  it("worker success clears preview and sync timers before stale reply", () => {
    vi.useFakeTimers();
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    let sent: LayoutWorkerRequest | undefined;
    const worker = mockWorker((message) => { sent = message; });
    const runtime = new TopologyLayoutRuntime(() => worker, sync);
    const callback = vi.fn();

    runtime.request({ topology }, callback);
    vi.advanceTimersByTime(60);
    worker.onmessage?.({ data: {
      requestId: sent?.requestId ?? "layout-1",
      layoutVersion: LAYOUT_VERSION,
      ok: true,
      result: computeTopologyLayout(topology),
    } } as MessageEvent<LayoutWorkerResponse>);
    vi.runOnlyPendingTimers();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("worker onerror and ok-false both publish straight fallback and settle timers", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);

    const workerError = mockWorker(() => undefined);
    const errorRuntime = new TopologyLayoutRuntime(() => workerError, sync);
    const errorId = errorRuntime.request({ topology }, vi.fn());
    workerError.onerror?.({} as ErrorEvent);
    vi.runOnlyPendingTimers();
    expect(errorId).toBe("layout-1");

    const workerFalse = mockWorker((message, current) => {
      current.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION, ok: false, message: "failed" } } as never);
    });
    const falseRuntime = new TopologyLayoutRuntime(() => workerFalse, sync);
    falseRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn());
    vi.runOnlyPendingTimers();

    expect(warning).toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("postMessage throw clears preview/sync timers and publishes straight then sync", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const worker: LayoutWorkerLike = {
      postMessage: vi.fn(() => { throw new Error("post crash"); }),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    const runtime = new TopologyLayoutRuntime(() => worker, sync);
    const callback = vi.fn();

    runtime.request({ topology }, callback);
    vi.runOnlyPendingTimers();

    expect(callback).toHaveBeenCalled();
    expect(sync).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("preview throw and 500 node limit do not schedule sync", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const previewThrow = vi.fn(() => { throw new Error("preview crash"); });
    const sync = vi.fn(computeTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, previewThrow);
    const error = vi.fn();

    runtime.request({ topology }, vi.fn(), error);
    vi.runOnlyPendingTimers();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "preview crash" }));

    topology.nodes = Array.from({ length: 500 }, (_, index) => ({ ...sample().nodes[0]!, id: `n-${index}`, label: `N ${index}` }));
    const largeRuntime = new TopologyLayoutRuntime(() => undefined, sync);
    largeRuntime.request({ topology }, vi.fn());
    vi.runOnlyPendingTimers();
    expect(sync).not.toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("dynamic import success and stale supersede stay bounded", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const first = vi.fn();
    const second = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => undefined);

    runtime.request({ topology, viewId: "old" }, first);
    await vi.runAllTimersAsync();
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "new" }, second);
    await vi.runAllTimersAsync();

    expect(first.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(second.mock.calls.length).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("runs bounded sync fallback only for small no-worker graphs with exact budgets", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const straight = vi.fn(computeStraightTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);

    runtime.request({ topology }, vi.fn());
    vi.runOnlyPendingTimers();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0]?.[2]).toEqual({
      layoutTimeoutMs: TOPOLOGY_SYNC_LAYOUT_TIMEOUT_MS,
      edgeTimeoutMs: TOPOLOGY_SYNC_EDGE_TIMEOUT_MS,
    });

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers 500 worker-failure straight-only branch without sync", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    topology.nodes = Array.from({ length: 500 }, (_, index) => ({
      id: `failure-${index}`,
      type: "host",
      label: `Failure ${index}`,
      layerId: "cloud",
      boundaryIds: [],
      lifecycle: "active" as const,
      description: "",
      tags: [],
      attrs: {},
    }));
    const sync = vi.fn(computeTopologyLayout);
    const worker = mockWorker((message, current) => {
      current.onmessage?.({ data: {
        requestId: message.requestId,
        layoutVersion: message.layoutVersion,
        ok: false,
        message: "worker failed",
      } } as never);
    });
    const runtime = new TopologyLayoutRuntime(() => worker, sync);

    runtime.request({ topology }, vi.fn());
    vi.runOnlyPendingTimers();

    expect(sync).not.toHaveBeenCalled();
    expect(warning.mock.calls.flat().join(" ").toLowerCase()).toContain("straight-only");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("reports straight preview throw while a healthy worker may still finish", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const straight = vi.fn(() => { throw new Error("preview only crash"); });
    const worker = mockWorker(() => undefined);
    const callback = vi.fn();
    const error = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => worker, computeTopologyLayout, straight);

    runtime.request({ topology }, callback, error);
    vi.advanceTimersByTime(TOPOLOGY_LAYOUT_PREVIEW_MS);

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "preview only crash" }));
    expect(warning.mock.calls.flat().join(" ")).toContain("worker route may still finish normally");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("promotes cache hits and evicts the oldest of four entries", () => {
    const cache = new TopologyLayoutLruCache(4);
    const topology = sample();
    const layouts = Array.from({ length: 5 }, (_, index) => layoutTopology({ ...topology, revision: index + 1 }));

    for (let index = 0; index < 5; index += 1) cache.set(`key-${index}`, layouts[index]!);
    expect(cache.sizeValue).toBe(4);
    expect(cache.has("key-0")).toBe(false);

    expect(cache.get("key-4") === layouts[4]).toBe(true);
    cache.set("key-5", layouts[0]!);
    expect(cache.sizeValue).toBe(4);
  });

  it("runs cooperative full compute for no-worker 500 topology after preview", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = generateTopologyFixture("topology-500");

    const sync = vi.fn(computeTopologyLayout);
    const straight = vi.fn(computeStraightTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);
    const callback = vi.fn();

    runtime.request({ topology }, callback);
    vi.advanceTimersByTime(120);

    expect(topology.nodes.length).toBeGreaterThan(TOPOLOGY_SYNC_NODE_LIMIT);
    expect(straight).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].routes).toBeDefined();
    expect(warning.mock.calls.flat().join(" ").toLowerCase()).toContain("straight-only");

    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(sync).not.toHaveBeenCalled();
    expect(callback.mock.calls.at(-1)?.[0].routeDiagnostics?.status).toBe("complete");
    expect(Object.keys(callback.mock.calls.at(-1)?.[0].routes ?? {})).toHaveLength(topology.edges.length);

    vi.useRealTimers();
    warning.mockRestore();
  }, 60_000);

  it("shows straight preview then bounded sync route when workers are unavailable", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const straight = vi.fn(computeStraightTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);
    const results: unknown[] = [];

    const requestId = runtime.request({ topology, viewId: "view-a", pins: topology.views[0]!.pins }, (result) => results.push(result));

    expect(requestId).toBe("layout-1");
    expect(straight).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);

    vi.runOnlyPendingTimers();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(warning).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers cache promotion, eviction and canonical route and bundle variants", () => {
    const topology = sample();
    const cache = new TopologyLayoutLruCache(1);
    const first = layoutTopology(topology);
    const second = layoutTopology({ ...topology, revision: 2 });
    cache.set("first", first);
    cache.set("second", second);
    expect(cache.get("second")).toBe(second);
    expect(cache.get("missing")).toBeUndefined();

    const layout = computeTopologyLayout(topology);
    const route = Object.values(layout.routes ?? {})[0];
    if (route) {
      route.fallback = "timeout";
    }
    layout.routes = {
      z: { edgeId: "z", source: "b", target: "a", sourceSide: "left", targetSide: "right", points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], fallback: "no_path" },
      a: { edgeId: "a", source: "a", target: "b", sourceSide: "right", targetSide: "left", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
      ...(layout.routes ?? {}),
    };
    layout.bundles = [
      { id: "bundle:z", layerIds: ["edge", "cloud"], count: 2, edgeIds: ["z", "a"], kindCounts: { uses: 2 }, route: [{ x: 0, y: 0 }, { x: 20, y: 20 }], fallback: "no_path" },
      { id: "bundle:a", layerIds: ["cloud", "edge"], count: 1, edgeIds: ["a"], kindCounts: { uses: 1 }, route: null },
    ];
    layout.routeDiagnostics = { routeFailures: [{ edgeId: "z", reason: "no_path" }], elapsedMs: 1 };
    expect(topologyLayoutCanonicalHash(layout)).toContain("no_path");
  });

  it("covers canonical hash variants and non-Error sync failures", () => {
    const topology = sample();
    const layout = computeTopologyLayout(topology);
    const route = Object.values(layout.routes ?? {})[0];
    if (route) {
      route.fallback = "no_path";
    }
    layout.bundles = [{
      id: "bundle:b:a",
      layerIds: ["cloud", "edge"],
      count: 1,
      edgeIds: ["a-b"],
      kindCounts: { uses: 1 },
      route: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      fallback: "timeout",
    }];
    const hash = topologyLayoutCanonicalHash(layout);
    expect(hash).toContain("no_path");
    expect(hash).toContain("timeout");

    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => undefined, () => { throw "string failure"; });
    runtime.request({ topology }, vi.fn(), error);
    vi.runOnlyPendingTimers();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "Synchronous topology route failed" }));
    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers sync exception, response mismatch, zero-size cache and default worker branches", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const error = vi.fn();
    const throwingRuntime = new TopologyLayoutRuntime(() => undefined, () => { throw new Error("sync crash"); });
    throwingRuntime.request({ topology }, vi.fn(), error);
    vi.runOnlyPendingTimers();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "sync crash" }));
    vi.useRealTimers();
    warning.mockRestore();

    const zero = new TopologyLayoutLruCache(0);
    const result = layoutTopology(topology);
    zero.set("zero", result);
    expect(zero.sizeValue).toBe(0);
    expect(zero.get("missing")).toBeUndefined();
    expect(topologyLayoutPinsHash(undefined)).toBe("[]");

    const worker = mockWorker((message, current) => {
      current.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION + 1, ok: true, result: layoutTopology(topology) } } as never);
    });
    const mismatchRuntime = new TopologyLayoutRuntime(() => worker);
    const mismatch = vi.fn();
    mismatchRuntime.request({ topology }, mismatch);
    expect(mismatch).not.toHaveBeenCalled();

    vi.stubGlobal("Worker", undefined);
    expect(defaultTopologyLayoutWorker()).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("keeps only four LRU entries and promotes cache hits", () => {
    const cache = new TopologyLayoutLruCache();
    const topology = sample();
    const results = Array.from({ length: 5 }, (_, index) => layoutTopology({ ...topology, revision: index + 1 }));

    results.forEach((result, index) => cache.set(`key-${index}`, result));
    expect(cache.sizeValue).toBe(4);
    expect(cache.has("key-0")).toBe(false);

    cache.get("key-1");
    cache.set("key-5", results[4]!);
    expect(cache.sizeValue).toBe(4);
    expect(cache.has("key-1")).toBe(true);
    expect(cache.has("key-2")).toBe(false);
  });

  it("uses revision, view, pins and layout version in the cache key", () => {
    const topology = sample();
    const pinsA = { b: { x: 20, y: 10 } };
    const pinsB = { b: { x: 10, y: 20 }, a: { x: 5, y: 5 } };

    expect(topologyLayoutPinsHash(pinsB)).toBe(JSON.stringify([["a", 5, 5], ["b", 10, 20]]));
    expect(topologyLayoutCacheKey(topology, "view-a", pinsA)).not.toBe(topologyLayoutCacheKey({ ...topology, revision: 2 }, "view-a", pinsA));
    expect(topologyLayoutCacheKey(topology, "view-a", pinsA)).not.toBe(topologyLayoutCacheKey(topology, "view-b", pinsA));
    expect(topologyLayoutCacheKey(topology, "view-a", pinsA)).not.toBe(topologyLayoutCacheKey(topology, "view-a", pinsB));
    expect(LAYOUT_VERSION).toBe(1);
  });

  it("drops stale worker replies and accepts only the latest request", () => {
    const topology = sample();
    const messages: LayoutWorkerRequest[] = [];
    const worker = mockWorker((message) => {
      messages.push(message);
    });
    const runtime = new TopologyLayoutRuntime(() => worker);
    const first = vi.fn();
    const second = vi.fn();

    runtime.request({ topology, viewId: "view-a", pins: topology.views[0]!.pins }, first);
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "view-b", pins: {} }, second);

    const stale = messages[0]!;
    worker.onmessage?.({ data: {
      requestId: stale.requestId,
      layoutVersion: LAYOUT_VERSION,
      ok: true,
      result: computeTopologyLayout(topology, { viewId: "view-a", pins: topology.views[0]!.pins }),
    } } as MessageEvent<LayoutWorkerResponse>);
    expect(first).not.toHaveBeenCalled();

    const latest = messages[1]!;
    const latestTopology = { ...topology, revision: 2 };
    worker.onmessage?.({ data: {
      requestId: latest.requestId,
      layoutVersion: LAYOUT_VERSION,
      ok: true,
      result: computeTopologyLayout(latestTopology, { viewId: "view-b", pins: {} }),
    } } as MessageEvent<LayoutWorkerResponse>);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("produces the worker/sync identical layout hash and caches the worker reply", () => {
    const topology = sample();
    const options = { viewId: "view-a", pins: topology.views[0]!.pins };
    const syncResult = computeTopologyLayout(topology, options);
    const worker = mockWorker((message, current) => {
      const result = computeTopologyLayout(message.topology, { viewId: message.viewId, pins: message.pins });
      current.onmessage?.({ data: { requestId: message.requestId, layoutVersion: message.layoutVersion, ok: true, result } } as MessageEvent<LayoutWorkerResponse>);
    });
    const runtime = new TopologyLayoutRuntime(() => worker);
    let workerResult: ReturnType<typeof computeTopologyLayout> | undefined;

    runtime.request({ topology, viewId: "view-a", pins: topology.views[0]!.pins }, (result) => { workerResult = result; });

    expect(workerResult).toBeDefined();
    expect(topologyLayoutCanonicalHash(workerResult!)).toBe(topologyLayoutCanonicalHash(syncResult));

    const syncAfter = vi.fn(computeTopologyLayout);
    const cachedRuntime = new TopologyLayoutRuntime(() => worker, vi.fn(computeTopologyLayout));
    const first = vi.fn();
    const second = vi.fn();
    cachedRuntime.request({ topology, viewId: "view-a", pins: topology.views[0]!.pins }, first);
    cachedRuntime.request({ topology, viewId: "view-a", pins: topology.views[0]!.pins }, second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(syncAfter).not.toHaveBeenCalled();
  });

  it("falls back when cache misses repeat, worker construction throws, and onerror fires", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);

    const constructionRuntime = new TopologyLayoutRuntime(() => { throw new Error("construct failed"); }, sync);
    constructionRuntime.request({ topology }, vi.fn());
    vi.runOnlyPendingTimers();
    expect(sync).toHaveBeenCalledTimes(1);

    const worker = mockWorker(() => undefined);
    const errorRuntime = new TopologyLayoutRuntime(() => worker, sync);
    errorRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn());
    worker.onerror?.({} as ErrorEvent);
    vi.runOnlyPendingTimers();
    expect(sync).toHaveBeenCalledTimes(2);

    const cachedRuntime = new TopologyLayoutRuntime(() => undefined, sync);
    const first = vi.fn();
    const second = vi.fn();
    cachedRuntime.request({ topology: { ...topology, revision: 3 } }, first);
    vi.runOnlyPendingTimers();
    cachedRuntime.request({ topology: { ...topology, revision: 3 } }, second);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    warning.mockRestore();
  });

  it("drops a cancelled request reply", () => {
    const topology = sample();
    const messages: LayoutWorkerRequest[] = [];
    const worker = mockWorker((message) => { messages.push(message); });
    const runtime = new TopologyLayoutRuntime(() => worker);
    const callback = vi.fn();

    const requestId = runtime.request({ topology }, callback);
    runtime.cancelRequest(requestId);
    const response = messages[0]!;
    worker.onmessage?.({ data: {
      requestId: response.requestId,
      layoutVersion: LAYOUT_VERSION,
      ok: true,
      result: computeTopologyLayout(topology),
    } } as MessageEvent<LayoutWorkerResponse>);
    expect(callback).not.toHaveBeenCalled();
  });

  it("executes the layout worker success and failure entry paths", async () => {
    const postMessage = vi.fn();
    const scope = { onmessage: null as null | ((event: MessageEvent<LayoutWorkerRequest>) => void), postMessage };
    vi.stubGlobal("self", scope);
    try {
      await import("./layout.worker");
      const topology = sample();
      const request: LayoutWorkerRequest = {
        requestId: "layout-worker-test",
        layoutVersion: LAYOUT_VERSION,
        topology,
      };
      scope.onmessage?.({ data: request } as MessageEvent<LayoutWorkerRequest>);
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: "layout-worker-test", ok: true }));

      scope.onmessage?.({ data: { ...request, viewId: "view-a", pins: topology.views[0]!.pins, options: { viewId: "view-a", pins: topology.views[0]!.pins }, topology } } as MessageEvent<LayoutWorkerRequest>);
      scope.onmessage?.({ data: { ...request, topology: null } } as unknown as MessageEvent<LayoutWorkerRequest>);
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: "layout-worker-test", ok: false }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("covers worker reuse, stale mismatch, empty canonical hash and default worker success", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker);

    runtime.request({ topology, revision: topology.revision } as never, vi.fn());
    runtime.request({ topology: { ...topology, revision: 2 } }, vi.fn());

    worker.onmessage?.({ data: { requestId: "layout-1", layoutVersion: LAYOUT_VERSION, ok: true, result: layoutTopology(topology) } } as never);
    worker.onmessage?.({ data: { requestId: "layout-999", layoutVersion: LAYOUT_VERSION, ok: true, result: layoutTopology(topology) } } as never);

    const empty = layoutTopology(topology);
    empty.routes = {};
    empty.bundles = [];
    empty.labels = {};
    empty.hiddenEdgeIds = [];
    expect(topologyLayoutCanonicalHash(empty)).not.toBe("");

    vi.stubGlobal("Worker", class {
      onmessage = null;
      onerror = null;
      postMessage() {}
      terminate() {}
    });
    expect(defaultTopologyLayoutWorker()).toBeDefined();
    vi.unstubAllGlobals();

    const postWorker: LayoutWorkerLike = {
      postMessage: vi.fn(() => { throw new Error("post crash"); }),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    const postRuntime = new TopologyLayoutRuntime(() => postWorker, () => { throw "fallback string"; });
    const postError = vi.fn();
    postRuntime.request({ topology }, vi.fn(), postError);
    vi.runOnlyPendingTimers();
    expect(postError).toHaveBeenCalledWith(expect.objectContaining({ message: "post crash" }));
    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers failure replies, onerror without pending, unknown cancellation and constructor throwing paths", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();

    const failureWorker = mockWorker((message, worker) => {
      worker.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION, ok: false, message: "failure" } } as never);
    });
    const error = vi.fn();
    const failureRuntime = new TopologyLayoutRuntime(() => failureWorker, () => { throw new Error("fallback crash"); });
    failureRuntime.request({ topology }, vi.fn(), error);
    vi.runOnlyPendingTimers();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "fallback crash" }));

    const worker = mockWorker(() => undefined);
    const onerrorRuntime = new TopologyLayoutRuntime(() => worker);
    onerrorRuntime.cancelRequest("layout-999");
    worker.onerror?.({} as ErrorEvent);

    vi.stubGlobal("Worker", class {
      constructor() { throw new Error("worker constructor crash"); }
    });
    expect(defaultTopologyLayoutWorker()).toBeUndefined();
    vi.unstubAllGlobals();

    const throwingRuntime = new TopologyLayoutRuntime(() => { throw new Error("factory crash"); }, computeTopologyLayout);
    throwingRuntime.request({ topology }, vi.fn(), vi.fn());
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    warning.mockRestore();
  });

  it("keeps straight preview and sync fallback behind stale and cancel boundaries", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const straight = vi.fn(computeStraightTopologyLayout);
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker, sync, straight);
    const first = vi.fn();
    const second = vi.fn();

    runtime.request({ topology }, first);
    const cancelled = runtime.request({ topology: { ...topology, revision: 2 } }, second);
    runtime.cancelRequest(cancelled);
    vi.runOnlyPendingTimers();

    expect(straight).toHaveBeenCalledTimes(0);
    expect(second).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("clears preview and sync timers when a worker reply wins", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const straight = vi.fn(computeStraightTopologyLayout);
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker, sync, straight);
    const callback = vi.fn();

    runtime.request({ topology }, callback);
    vi.advanceTimersByTime(120);
    expect(straight).toHaveBeenCalledTimes(1);

    const result = computeTopologyLayout(topology);
    worker.onmessage?.({ data: {
      requestId: "layout-1",
      layoutVersion: LAYOUT_VERSION,
      ok: true,
      result,
    } } as MessageEvent<LayoutWorkerResponse>);
    vi.runOnlyPendingTimers();

    expect(callback).toHaveBeenCalledWith(result);
    expect(sync).not.toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("logs one worker fallback warning and stays on straight when both routes fail", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const straight = vi.fn(() => { throw new Error("straight failed"); });
    const sync = vi.fn(() => { throw new Error("sync failed"); });
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);
    const error = vi.fn();

    runtime.request({ topology, revision: topology.revision } as never, vi.fn(), error);
    runtime.request({ topology: { ...topology, revision: 2 } }, vi.fn(), error);
    vi.runOnlyPendingTimers();

    expect(warning.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(warning.mock.calls.flat().join(" ")).toContain("Straight-only");
    expect(error).toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("uses constructor defaults and reuses an existing worker", () => {
    vi.useFakeTimers();
    const topology = sample();
    const defaultRuntime = new TopologyLayoutRuntime();
    defaultRuntime.request({ topology }, vi.fn());

    const workerFactory = vi.fn(() => mockWorker(() => undefined));
    const workerRuntime = new TopologyLayoutRuntime(workerFactory);
    workerRuntime.request({ topology }, vi.fn());
    workerRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn());

    expect(workerFactory).toHaveBeenCalledTimes(1);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("covers cancel, stale sync and onerror-without-pending branches", () => {
    vi.useFakeTimers();
    const topology = sample();
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker);

    const cancelled = runtime.request({ topology }, vi.fn());
    runtime.cancelRequest(cancelled);
    runtime.request({ topology: { ...topology, revision: 2 } }, vi.fn());
    vi.runOnlyPendingTimers();
    worker.onerror?.({} as ErrorEvent);

    vi.useRealTimers();
  });

  it("covers custom sync success and sync failure branches", () => {
    vi.useFakeTimers();
    const topology = sample();

    const success = vi.fn(computeTopologyLayout);
    const successRuntime = new TopologyLayoutRuntime(() => undefined, success);
    const successCallback = vi.fn();
    successRuntime.request({ topology }, successCallback);
    vi.runOnlyPendingTimers();
    expect(success).toHaveBeenCalledTimes(1);
    expect(successCallback.mock.calls.length).toBeGreaterThanOrEqual(1);

    const failure = vi.fn(() => { throw new Error("sync branch fail"); });
    const failureRuntime = new TopologyLayoutRuntime(() => undefined, failure);
    const failureError = vi.fn();
    failureRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn(), failureError);
    vi.runOnlyPendingTimers();
    expect(failureError).toHaveBeenCalledWith(expect.objectContaining({ message: "sync branch fail" }));

    vi.useRealTimers();
  });

  it("covers dynamic import success, stale import and 500 straight-only branches", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const first = vi.fn();
    const second = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => undefined);

    runtime.request({ topology, viewId: "old" }, first);
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "new" }, second);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(first.mock.calls.length).toBe(1);
    expect(second.mock.calls.length).toBeGreaterThanOrEqual(1);

    const large = sample();
    large.nodes = Array.from({ length: 500 }, (_, index) => ({ ...sample().nodes[0]!, id: `n-${index}`, label: `N ${index}` }));
    const largeRuntime = new TopologyLayoutRuntime(() => undefined);
    largeRuntime.request({ topology: large }, vi.fn());
    vi.runOnlyPendingTimers();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("serves straight preview, bounded sync route and subsequent cache hit", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const straight = vi.fn(computeStraightTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);
    const callback = vi.fn();

    runtime.request({ topology }, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.runOnlyPendingTimers();
    expect(callback).toHaveBeenCalledTimes(2);

    callback.mockClear();
    runtime.request({ topology }, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(straight).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("does not execute stale sync timers after supersede", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker, sync);

    runtime.request({ topology }, vi.fn());
    runtime.request({ topology: { ...topology, revision: 2 } }, vi.fn());
    vi.advanceTimersByTime(120);
    vi.advanceTimersByTime(1);

    expect(sync).not.toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("publishes straight preview without caching and worker success replaces it without sync", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const straight = vi.fn(computeStraightTopologyLayout);
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker, sync, straight);
    const callback = vi.fn();

    runtime.request({ topology }, callback);
    vi.advanceTimersByTime(120);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(straight).toHaveBeenCalledTimes(1);

    const routed = computeTopologyLayout(topology);
    worker.onmessage?.({ data: {
      requestId: "layout-1",
      layoutVersion: LAYOUT_VERSION,
      ok: true,
      result: routed,
    } } as MessageEvent<LayoutWorkerResponse>);
    vi.runOnlyPendingTimers();

    expect(callback).toHaveBeenLastCalledWith(routed);
    expect(sync).not.toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("clears preview timer and sync timer after a worker failure reply", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const worker = mockWorker((message, current) => {
      current.onmessage?.({ data: {
        requestId: message.requestId,
        layoutVersion: message.layoutVersion,
        ok: false,
        message: "worker failed",
      } } as never);
    });
    const runtime = new TopologyLayoutRuntime(() => worker, sync);

    runtime.request({ topology }, vi.fn());
    vi.runOnlyPendingTimers();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("handles healthy-worker preview throw without starting sync", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const worker = mockWorker(() => undefined);
    const straight = vi.fn(() => { throw new Error("healthy preview crash"); });
    const sync = vi.fn(computeTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => worker, sync, straight);
    const error = vi.fn();

    runtime.request({ topology }, vi.fn(), error);
    vi.advanceTimersByTime(TOPOLOGY_LAYOUT_PREVIEW_MS);

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "healthy preview crash" }));
    expect(sync).not.toHaveBeenCalled();
    expect(warning.mock.calls.flat().join(" ")).toContain("worker route may still finish normally");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("handles no-worker straight throw as straight-only without sync", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const straight = vi.fn(() => { throw new Error("straight crash"); });
    const sync = vi.fn(computeTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);
    const error = vi.fn();

    runtime.request({ topology }, vi.fn(), error);
    vi.runOnlyPendingTimers();

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "straight crash" }));
    expect(sync).not.toHaveBeenCalled();
    expect(warning.mock.calls.flat().join(" ")).toContain("Straight-only");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("records bounded sync success and clears its timer", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync);
    const callback = vi.fn();

    runtime.request({ topology }, callback);
    vi.runOnlyPendingTimers();

    expect(callback).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("records bounded sync failure and clears its timer", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(() => { throw new Error("bounded crash"); });
    const runtime = new TopologyLayoutRuntime(() => undefined, sync);
    const callback = vi.fn();
    const error = vi.fn();

    runtime.request({ topology }, callback, error);
    vi.runOnlyPendingTimers();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "bounded crash" }));
    expect(warning.mock.calls.flat().join(" ")).toContain("Straight-only");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("reports straight-only when straight preview throws", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const straight = vi.fn(() => { throw new Error("straight crash"); });
    const sync = vi.fn(computeTopologyLayout);
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);
    const error = vi.fn();

    runtime.request({ topology }, vi.fn(), error);
    vi.runOnlyPendingTimers();

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "straight crash" }));
    expect(sync).not.toHaveBeenCalled();
    expect(warning.mock.calls.flat().join(" ")).toContain("Straight-only");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("keeps straight preview when bounded sync route throws", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const straight = vi.fn(computeStraightTopologyLayout);
    const sync = vi.fn(() => { throw new Error("sync crash"); });
    const runtime = new TopologyLayoutRuntime(() => undefined, sync, straight);
    const callback = vi.fn();
    const error = vi.fn();

    runtime.request({ topology }, callback, error);
    vi.runOnlyPendingTimers();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "sync crash" }));
    expect(warning.mock.calls.flat().join(" ")).toContain("Straight-only");

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers canonical cache key, pins hash, cache miss and LRU zero size branches", () => {
    const topology = sample();
    expect(topologyLayoutPinsHash(undefined)).toBe("[]");
    expect(topologyLayoutPinsHash({ z: { x: 1, y: 2 }, a: { x: 3, y: 4 } })).toBe(JSON.stringify([["a", 3, 4], ["z", 1, 2]]));
    expect(topologyLayoutCacheKey(topology, undefined, undefined)).not.toBe(topologyLayoutCacheKey(topology, "view-a", topology.views[0]!.pins));

    const lru = new TopologyLayoutLruCache(0);
    const layout = layoutTopology(topology);
    lru.set("missing", layout);
    expect(lru.get("missing")).toBeUndefined();
    expect(lru.sizeValue).toBe(0);
  });

  it("covers compare ID equality, canonical route/bundle fallback branches and zero values", () => {
    const topology = sample();
    const layout = computeTopologyLayout(topology);
    layout.routes = {
      a: { edgeId: "a", source: "a", target: "b", sourceSide: "right", targetSide: "left", points: [{ x: 0, y: 0 }], status: "routed" },
    };
    layout.bundles = [{ id: "b", layerIds: ["cloud", "edge"], count: 0, edgeIds: [], kindCounts: {}, route: null }];
    layout.routeDiagnostics = { status: "complete", routeFailures: [], fallbackCount: 0, unroutedEdgeIds: [], elapsedMs: 0, bundleFailures: [] };
    expect(topologyLayoutCanonicalHash(layout)).toBeTruthy();
  });

  it("covers postMessage throw, worker ok-false and onerror branches", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();

    const postWorker: LayoutWorkerLike = {
      postMessage: vi.fn(() => { throw new Error("post branch throw"); }),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    const postRuntime = new TopologyLayoutRuntime(() => postWorker);
    postRuntime.request({ topology }, vi.fn(), vi.fn());

    const failedWorker = mockWorker((message, current) => {
      current.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION, ok: false, message: "failed" } } as never);
    });
    const failedRuntime = new TopologyLayoutRuntime(() => failedWorker);
    failedRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn());

    vi.runOnlyPendingTimers();
    expect(warning).toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers stale mismatch, cancel and onerror without pending branches", () => {
    vi.useFakeTimers();
    const topology = sample();
    const worker = mockWorker((message, current) => {
      current.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION + 1, ok: true, result: computeTopologyLayout(topology) } } as never);
      current.onmessage?.({ data: { requestId: "layout-stale", layoutVersion: LAYOUT_VERSION, ok: true, result: computeTopologyLayout(topology) } } as never);
    });
    const runtime = new TopologyLayoutRuntime(() => worker);
    const callback = vi.fn();

    const requestId = runtime.request({ topology }, callback);
    runtime.cancelRequest(requestId);
    worker.onerror?.({} as ErrorEvent);
    vi.runOnlyPendingTimers();

    expect(callback.mock.calls.length).toBeLessThanOrEqual(1);
    vi.useRealTimers();
  });

  it("covers preview throw, sync throw, 500 limit and preview-only success", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();

    const preview = new TopologyLayoutRuntime(() => undefined, computeTopologyLayout, () => { throw new Error("preview branch"); });
    const previewError = vi.fn();
    preview.request({ topology }, vi.fn(), previewError);
    vi.runOnlyPendingTimers();
    expect(previewError).toHaveBeenCalledWith(expect.objectContaining({ message: "preview branch" }));

    const sync = vi.fn(() => { throw new Error("sync branch"); });
    const syncRuntime = new TopologyLayoutRuntime(() => undefined, sync);
    const syncError = vi.fn();
    syncRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn(), syncError);
    vi.runOnlyPendingTimers();
    expect(syncError).toHaveBeenCalledWith(expect.objectContaining({ message: "sync branch" }));

    const large = sample();
    large.nodes = Array.from({ length: 500 }, (_, index) => ({ ...sample().nodes[0]!, id: `n-${index}`, label: `N ${index}` }));
    const largeSync = vi.fn(computeTopologyLayout);
    const largeRuntime = new TopologyLayoutRuntime(() => undefined, largeSync);
    largeRuntime.request({ topology: large }, vi.fn());
    vi.runOnlyPendingTimers();
    expect(largeSync).not.toHaveBeenCalled();

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers dynamic-import success, stale supersede and bounded timers", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const first = vi.fn();
    const second = vi.fn();
    const runtime = new TopologyLayoutRuntime(() => undefined);

    runtime.request({ topology, viewId: "old" }, first);
    runtime.request({ topology: { ...topology, revision: 2 }, viewId: "new" }, second);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(first.mock.calls.length).toBe(1);
    expect(second.mock.calls.length).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
    warning.mockRestore();
  });

  it("covers default worker success and constructor throw", () => {
    vi.stubGlobal("Worker", class {
      onmessage = null;
      onerror = null;
      postMessage() {}
      terminate() {}
    });
    expect(defaultTopologyLayoutWorker()).toBeDefined();

    vi.stubGlobal("Worker", class {
      constructor() { throw new Error("worker constructor"); }
    });
    expect(defaultTopologyLayoutWorker()).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("covers worker construction, preview and synchronous exception branches", () => {
    vi.useFakeTimers();
    const topology = sample();

    const constructionError = vi.fn();
    const constructionRuntime = new TopologyLayoutRuntime(() => { throw new Error("factory failed"); });
    const constructionResult = vi.fn();
    constructionRuntime.request({ topology }, constructionResult, constructionError);
    vi.runOnlyPendingTimers();
    expect(constructionResult).toHaveBeenCalled();

    const previewError = vi.fn();
    const previewRuntime = new TopologyLayoutRuntime(() => undefined, computeTopologyLayout, () => { throw new Error("preview failed"); });
    previewRuntime.request({ topology: { ...topology, revision: 2 } }, vi.fn(), previewError);
    vi.runOnlyPendingTimers();
    expect(previewError).toHaveBeenCalledWith(expect.objectContaining({ message: "preview failed" }));

    const syncError = vi.fn();
    const syncRuntime = new TopologyLayoutRuntime(() => undefined, () => { throw new Error("sync failed"); });
    syncRuntime.request({ topology: { ...topology, revision: 3 } }, vi.fn(), syncError);
    vi.runOnlyPendingTimers();
    expect(syncError).toHaveBeenCalledWith(expect.objectContaining({ message: "sync failed" }));

    vi.useRealTimers();
  });

  it("covers cache-hit, canceled, stale and complete/incomplete worker result boundaries", () => {
    vi.useFakeTimers();
    const topology = sample();
    const worker = mockWorker(() => undefined);
    const runtime = new TopologyLayoutRuntime(() => worker);
    const complete = computeTopologyLayout(topology);

    const first = vi.fn();
    runtime.request({ topology, viewId: "a", pins: topology.views[0]!.pins }, first);
    worker.onmessage?.({ data: { requestId: "layout-1", layoutVersion: LAYOUT_VERSION, ok: true, result: complete } } as MessageEvent<LayoutWorkerResponse>);
    expect(first).toHaveBeenCalledWith(complete);

    const cacheHit = vi.fn();
    runtime.request({ topology, viewId: "a", pins: topology.views[0]!.pins }, cacheHit);
    expect(cacheHit).toHaveBeenCalledWith(complete);

    const canceledId = runtime.request({ topology: { ...topology, revision: 2 }, viewId: "cancel" }, vi.fn());
    runtime.cancelRequest(canceledId);
    worker.onerror?.({} as ErrorEvent);

    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("disposes native worker, clears timers and allows strict replay remount", () => {
    vi.useFakeTimers();
    const topology = sample();
    const workers: LayoutWorkerLike[] = [];
    const runtime = new TopologyLayoutRuntime(() => {
      const worker = mockWorker(() => undefined);
      workers.push(worker);
      return worker;
    });

    const first = vi.fn();
    runtime.request({ topology }, first);
    expect(workers).toHaveLength(1);
    runtime.dispose();
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1);

    const replay = vi.fn();
    runtime.request({ topology: { ...topology, revision: 2 } }, replay);
    expect(workers).toHaveLength(2);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("covers worker status retry, layout-version mismatch and cache alias branches", () => {
    vi.useFakeTimers();
    const topology = sample();
    for (const status of ["timeout", "fallback", "resource-limit"] as const) {
      const messages: LayoutWorkerRequest[] = [];
      const worker = mockWorker((message) => messages.push(message));
      const runtime = new TopologyLayoutRuntime(() => worker);
      const callback = vi.fn();
      runtime.request({ topology, viewId: "", options: { viewId: `view-${status}` } }, callback);
      const message = messages[0]!;
      const result = computeTopologyLayout(topology);
      result.routeDiagnostics = {
        unresolvedTwoPointSharedChannels: [],
        status,
        routeFailures: [{ edgeId: "a-b", reason: "timeout" }],
        fallbackCount: 1,
        unroutedEdgeIds: ["a-b"],
        elapsedMs: 1,
        bundleFailures: [],
      };
      worker.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION, ok: true, result } } as MessageEvent<LayoutWorkerResponse>);
      runtime.request({ topology, viewId: "", options: { viewId: `view-${status}` } }, vi.fn());
      expect(messages).toHaveLength(2);
    }

    const mismatchWorker = mockWorker((message, worker) => {
      worker.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION + 1, ok: true, result: computeTopologyLayout(topology) } } as never);
    });
    const mismatchRuntime = new TopologyLayoutRuntime(() => mismatchWorker);
    const mismatchCallback = vi.fn();
    mismatchRuntime.request({ topology, viewId: "mismatch" }, mismatchCallback);
    expect(mismatchCallback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("covers cache identity option matrix, LRU boundaries and canonical result variants", () => {
    const topology = sample();
    const lruZero = new TopologyLayoutLruCache(0);
    const lruOne = new TopologyLayoutLruCache(1);
    const layout = layoutTopology(topology);
    lruZero.set("zero", layout);
    expect(lruZero.get("zero")).toBeUndefined();
    lruOne.set("one", layout);
    lruOne.set("two", layoutTopology({ ...topology, revision: 2 }));
    expect(lruOne.get("one")).toBeUndefined();
    expect(lruOne.get("two")).toBeDefined();

    for (const origin of [undefined, { x: 0, y: 0 }, { x: 100, y: 200 }]) {
      for (const aspect of [undefined, 1, 1.6, 2]) {
        for (const view of [undefined, topology.views[0], { ...topology.views[0]!, id: "view-b", filter: { layerIds: ["cloud"], typeIds: [], boundaryIds: [], tags: [] } }]) {
          const key = topologyLayoutCacheKey(topology, undefined, undefined, { origin, aspect, view });
          expect(key).toBeTypeOf("string");
        }
      }
    }

    const canonical = computeTopologyLayout(topology);
    canonical.routes = {
      z: { edgeId: "z", source: "b", target: "a", sourceSide: "left", targetSide: "right", points: [{ x: 0, y: 0 }] },
      a: { edgeId: "a", source: "a", target: "b", sourceSide: "right", targetSide: "left", points: [] },
    };
    canonical.bundles = [{ id: "b", layerIds: ["cloud", "edge"], count: 0, edgeIds: [], kindCounts: {}, route: null }];
    canonical.routeDiagnostics = { status: "fallback", routeFailures: [{ edgeId: "z", reason: "no_path" }], fallbackCount: 1, unroutedEdgeIds: ["z"], elapsedMs: 1, bundleFailures: [] };
    expect(topologyLayoutCanonicalHash(canonical)).toContain("no_path");
  });

  it("covers runtime construction, missing-worker, worker-failure, cache and cooperative branch matrix", () => {
    vi.useFakeTimers();
    const topology = sample();

    const constructionError = vi.fn();
    const constructionRuntime = new TopologyLayoutRuntime(() => { throw new Error("construction-failed"); });
    constructionRuntime.request({ topology }, vi.fn(), constructionError);
    vi.runOnlyPendingTimers();

    const missingWorker = new TopologyLayoutRuntime(() => undefined, computeTopologyLayout);
    const missingResult = vi.fn();
    missingWorker.request({ topology: { ...topology, revision: 2 } }, missingResult);
    vi.runOnlyPendingTimers();
    expect(missingResult).toHaveBeenCalled();

    for (const status of ["complete", "timeout", "fallback", "resource-limit"] as const) {
      const messages: LayoutWorkerRequest[] = [];
      const worker = mockWorker((message) => messages.push(message));
      const runtime = new TopologyLayoutRuntime(() => worker);
      const callback = vi.fn();
      runtime.request({ topology, viewId: status }, callback);
      const message = messages[0]!;
      const result = computeTopologyLayout(topology);
      result.routeDiagnostics = {
        unresolvedTwoPointSharedChannels: [],
        status,
        routeFailures: status === "complete" ? [] : [{ edgeId: "a-b", reason: "timeout" }],
        fallbackCount: status === "complete" ? 0 : 1,
        unroutedEdgeIds: status === "complete" ? [] : ["a-b"],
        elapsedMs: 1,
        bundleFailures: [],
      };
      worker.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION, ok: true, result } } as MessageEvent<LayoutWorkerResponse>);
      expect(callback).toHaveBeenCalledWith(result);
    }

    const failedWorker = mockWorker((message, worker) => {
      worker.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION, ok: false, message: "worker-failed" } } as never);
    });
    const failedRuntime = new TopologyLayoutRuntime(() => failedWorker, computeTopologyLayout);
    const failedCallback = vi.fn();
    failedRuntime.request({ topology: { ...topology, revision: 3 } }, failedCallback);
    vi.runOnlyPendingTimers();
    expect(failedCallback).toHaveBeenCalled();

    for (const cooperative of [
      async () => undefined,
      async () => computeTopologyLayout(topology),
      async () => { throw new Error("cooperative-failed"); },
    ]) {
      const cooperativeRuntime = new TopologyLayoutRuntime(() => undefined, undefined, computeStraightTopologyLayout, cooperative);
      const cooperativeCallback = vi.fn();
      cooperativeRuntime.request({ topology: { ...topology, revision: 4 } }, cooperativeCallback);
      vi.runOnlyPendingTimers();
    }

    vi.useRealTimers();
  });

  it("covers cache key option matrix, status cache retry and worker ownership matrix", () => {
    vi.useFakeTimers();
    const topology = sample();
    for (const status of ["complete", "timeout", "fallback", "resource-limit"] as const) {
      const messages: LayoutWorkerRequest[] = [];
      const worker = mockWorker((message) => messages.push(message));
      const runtime = new TopologyLayoutRuntime(() => worker);
      const callback = vi.fn();
      runtime.request({ topology, viewId: "", options: { viewId: `view-${status}`, origin: { x: 1, y: 2 }, aspect: 1.6, view: topology.views[0] } }, callback);
      const message = messages[0]!;
      const result = computeTopologyLayout(topology);
      result.routeDiagnostics = {
        unresolvedTwoPointSharedChannels: [],
        status,
        routeFailures: status === "complete" ? [] : [{ edgeId: "a-b", reason: "timeout" }],
        fallbackCount: status === "complete" ? 0 : 1,
        unroutedEdgeIds: status === "complete" ? [] : ["a-b"],
        elapsedMs: 1,
        bundleFailures: [],
      };
      worker.onmessage?.({ data: { requestId: message.requestId, layoutVersion: LAYOUT_VERSION, ok: true, result } } as MessageEvent<LayoutWorkerResponse>);
      runtime.request({ topology, viewId: "", options: { viewId: `view-${status}`, origin: { x: 1, y: 2 }, aspect: 1.6, view: topology.views[0] } }, vi.fn());
      expect(messages.length).toBe(status === "complete" ? 1 : 2);
    }

    const lru = new TopologyLayoutLruCache(1);
    const layout = layoutTopology(topology);
    lru.set("one", layout);
    lru.set("two", layoutTopology({ ...topology, revision: 2 }));
    expect(lru.get("one")).toBeUndefined();
    expect(lru.get("two")).toBeDefined();

    for (const origin of [undefined, { x: 0, y: 0 }, { x: 100, y: 200 }]) {
      for (const aspect of [undefined, 1, 1.6, 2]) {
        expect(topologyLayoutCacheKey(topology, undefined, undefined, { origin, aspect })).toBeTypeOf("string");
      }
    }
    vi.useRealTimers();
  });

  it("falls back synchronously on worker failure and postMessage faults", () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topology = sample();
    const sync = vi.fn(computeTopologyLayout);

    const failureWorker = mockWorker((message, worker) => {
      worker.onmessage?.({ data: { requestId: message.requestId, layoutVersion: message.layoutVersion, ok: false, message: "worker failed" } } as never);
    });
    const failureRuntime = new TopologyLayoutRuntime(() => failureWorker, sync);
    const failedResult = vi.fn();
    failureRuntime.request({ topology }, failedResult);
    vi.runOnlyPendingTimers();
    expect(failedResult.mock.calls.length).toBeGreaterThanOrEqual(2);

    const postWorker: LayoutWorkerLike = {
      postMessage: vi.fn(() => { throw new Error("post failed"); }),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    const postRuntime = new TopologyLayoutRuntime(() => postWorker, sync);
    postRuntime.request({ topology }, vi.fn());
    vi.runOnlyPendingTimers();
    expect(sync.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
    warning.mockRestore();
  });
});
