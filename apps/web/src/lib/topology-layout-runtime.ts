import type { Topology } from "@steed/api/shared";
import type { TopologyLayoutOptions, TopologyLayoutPosition, TopologyLayoutResult } from "./topology-layout";
import type { LayoutWorkerFailure, LayoutWorkerRequest, LayoutWorkerResponse } from "./layout.worker";
import { computeStraightTopologyLayout } from "./topology-layout-preview";
import type { RouterOptions } from "./topology-router";

export const LAYOUT_VERSION = 1;
export const TOPOLOGY_LAYOUT_CACHE_SIZE = 4;
export const TOPOLOGY_LAYOUT_PREVIEW_MS = 120;
export const TOPOLOGY_SYNC_NODE_LIMIT = 120;
export const TOPOLOGY_SYNC_LAYOUT_TIMEOUT_MS = 1500;
export const TOPOLOGY_SYNC_EDGE_TIMEOUT_MS = 20;
export const TOPOLOGY_COOPERATIVE_BATCH_SIZE = 20;

export interface LayoutWorkerLike {
  postMessage: (message: LayoutWorkerRequest) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<LayoutWorkerResponse | LayoutWorkerFailure>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type LayoutWorkerFactory = () => LayoutWorkerLike | undefined;
export type LayoutSyncFunction = (topology: Topology, options: TopologyLayoutOptions, routerOptions?: RouterOptions) => TopologyLayoutResult;
export type LayoutCooperativeFunction = (
  topology: Topology,
  options: TopologyLayoutOptions,
  cooperative?: {
    batchSize?: number;
    routerOptions?: RouterOptions;
    clock?: () => number;
    yieldControl?: () => Promise<void>;
    isCancelled?: () => boolean;
    onProgress?: (progress: { phase: "prepared" | "edges" | "extras" | "complete"; routedEdges: number; totalEdges: number; elapsedMs: number }) => void;
  },
) => Promise<TopologyLayoutResult | undefined>;

export interface LayoutRuntimeRequest {
  topology: Topology;
  routerOptions?: RouterOptions;
  viewId?: string;
  pins?: Record<string, { x: number; y: number }>;
  options?: TopologyLayoutOptions;
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function topologyLayoutPinsHash(pins: Record<string, { x: number; y: number }> | undefined): string {
  const entries = Object.entries(pins ?? {})
    .sort(([a], [b]) => compareId(a, b))
    .map(([id, point]) => [id, point.x, point.y]);
  return JSON.stringify(entries);
}

export function topologyLayoutCacheKey(topology: Topology, viewId: string | undefined, pins: Record<string, { x: number; y: number }> | undefined, options: TopologyLayoutOptions = {}): string {
  const effectiveViewId = viewId || options.viewId || options.view?.id || "";
  return JSON.stringify([
    topology.revision,
    effectiveViewId,
    topologyLayoutPinsHash(pins ?? options.view?.pins),
    LAYOUT_VERSION,
    options.origin?.x ?? "",
    options.origin?.y ?? "",
    options.aspect ?? "",
    options.view?.id ?? "",
    topologyLayoutPinsHash(options.view?.pins),
    JSON.stringify(options.view?.filter ?? null),
  ]);
}

export class TopologyLayoutLruCache {
  private readonly entries = new Map<string, TopologyLayoutResult>();

  constructor(private readonly size = TOPOLOGY_LAYOUT_CACHE_SIZE) {}

  get(key: string): TopologyLayoutResult | undefined {
    const result = this.entries.get(key);
    if (!result) return undefined;
    this.entries.delete(key);
    this.entries.set(key, result);
    return result;
  }

  set(key: string, result: TopologyLayoutResult): void {
    this.entries.delete(key);
    this.entries.set(key, result);
    while (this.entries.size > this.size) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get sizeValue(): number {
    return this.entries.size;
  }
}

export function topologyLayoutCanonicalHash(layout: TopologyLayoutResult): string {
  const positions = Object.entries(layout.positions)
    .sort(([a], [b]) => compareId(a, b))
    .map(([id, position]: [string, TopologyLayoutPosition]) => [id, position.x, position.y, position.width, position.height]);
  const lanes = [...layout.lanes].sort((a, b) => a.order - b.order || compareId(a.id, b.id)).map((lane) => [lane.id, lane.x, lane.y, lane.width, lane.height]);
  const frames = [...layout.frames].sort((a, b) => compareId(a.id, b.id)).map((frame) => [frame.id, frame.x, frame.y, frame.width, frame.height]);
  const routes = Object.entries(layout.routes ?? {})
    .sort(([a], [b]) => compareId(a, b))
    .map(([id, route]) => [id, route.sourceSide, route.targetSide, route.points, route.fallback ?? null]);
  const bundles = [...(layout.bundles ?? [])].sort((a, b) => compareId(a.id, b.id)).map((bundle) => [bundle.id, bundle.count, bundle.route, bundle.fallback ?? null]);
  return JSON.stringify([positions, lanes, frames, routes, bundles, layout.routeDiagnostics?.routeFailures ?? [], layout.width, layout.height]);
}

export class TopologyLayoutRuntime {
  private worker: LayoutWorkerLike | undefined;
  private latestRequestId = 0;
  private readonly cache = new TopologyLayoutLruCache();
  private readonly pending = new Map<string, {
    requestId: string;
    topology: Topology;
    options: TopologyLayoutOptions;
    key: string;
    onResult: (result: TopologyLayoutResult) => void;
    onError?: (error: Error) => void;
    previewTimer?: ReturnType<typeof setTimeout>;
    syncTimer?: ReturnType<typeof setTimeout>;
    routerOptions?: RouterOptions;
  }>();
  private straightWarningLogged = false;

  constructor(
    private readonly workerFactory: LayoutWorkerFactory = defaultTopologyLayoutWorker,
    private readonly syncLayout: LayoutSyncFunction | undefined = undefined,
    private readonly straightLayout: LayoutSyncFunction = computeStraightTopologyLayout,
    private readonly cooperativeLayout: LayoutCooperativeFunction | undefined = undefined,
  ) {}

  request(input: LayoutRuntimeRequest, onResult: (result: TopologyLayoutResult) => void, onError?: (error: Error) => void): string {
    const requestId = `layout-${++this.latestRequestId}`;
    for (const [pendingId, pendingEntry] of this.pending.entries()) {
      if (pendingEntry.previewTimer) clearTimeout(pendingEntry.previewTimer);
      if (pendingEntry.syncTimer) clearTimeout(pendingEntry.syncTimer);
      this.pending.delete(pendingId);
    }
    const pins = input.pins ?? input.options?.pins;
    const effectiveViewId = input.viewId || input.options?.viewId || input.options?.view?.id || "";
    const effectiveOptions: TopologyLayoutOptions = {
      ...(input.options ?? {}),
      ...(effectiveViewId ? { viewId: effectiveViewId } : {}),
      ...(pins ? { pins } : {}),
    };
    const key = topologyLayoutCacheKey(input.topology, effectiveViewId, pins, effectiveOptions);
    const cached = this.cache.get(key);
    if (cached) {
      onResult(cached);
      return requestId;
    }

    const options = effectiveOptions;

    let worker: LayoutWorkerLike | undefined;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      this.fallbackStraightAndSync(requestId, input.topology, options, key, onResult, onError, error, input.routerOptions);
      return requestId;
    }

    if (!worker) {
      this.fallbackStraightAndSync(requestId, input.topology, options, key, onResult, onError, undefined, input.routerOptions);
      return requestId;
    }

    const message: LayoutWorkerRequest = {
      requestId,
      layoutVersion: LAYOUT_VERSION,
      topology: input.topology,
      viewId: effectiveViewId || undefined,
      pins,
      options,
      routerOptions: input.routerOptions,
    };

    const pending = { requestId, topology: input.topology, options, key, onResult, onError, routerOptions: input.routerOptions };
    this.pending.set(requestId, pending);
    try {
      worker.postMessage(message);
      const previewTimer = setTimeout(() => {
        const current = this.pending.get(requestId);
        if (!current || requestId !== `layout-${this.latestRequestId}`) return;
        this.fallbackStraightPreview(current.topology, current.options, current.onResult, current.onError);
      }, TOPOLOGY_LAYOUT_PREVIEW_MS);
      this.pending.set(requestId, { ...pending, previewTimer });
    } catch (error) {
      if (this.worker !== worker) return requestId;
      const pendingEntry = this.pending.get(requestId);
      if (pendingEntry?.previewTimer) clearTimeout(pendingEntry.previewTimer);
      if (pendingEntry?.syncTimer) clearTimeout(pendingEntry.syncTimer);
      this.pending.delete(requestId);
      worker.terminate();
      this.worker = undefined;
      this.fallbackStraightAndSync(requestId, input.topology, options, key, onResult, onError, error, input.routerOptions);
    }
    return requestId;
  }

  dispose(): void {
    this.latestRequestId += 1;
    for (const pendingEntry of this.pending.values()) {
      if (pendingEntry.previewTimer) clearTimeout(pendingEntry.previewTimer);
      if (pendingEntry.syncTimer) clearTimeout(pendingEntry.syncTimer);
    }
    this.pending.clear();
    if (this.worker) {
      this.worker.terminate();
      this.worker = undefined;
    }
  }

  cancelRequest(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (pending?.previewTimer) clearTimeout(pending.previewTimer);
    if (pending?.syncTimer) clearTimeout(pending.syncTimer);
    this.pending.delete(requestId);
    if (this.latestRequestId > 0 && requestId === `layout-${this.latestRequestId}`) {
      this.latestRequestId += 1;
    }
  }

  private ensureWorker(): LayoutWorkerLike | undefined {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    if (!worker) return undefined;
    worker.onmessage = (event) => {
      if (this.worker !== worker) return;
      const response = event.data;
      if (response.layoutVersion !== LAYOUT_VERSION) return;
      const pending = this.pending.get(response.requestId);
      if (!pending || response.requestId !== `layout-${this.latestRequestId}`) return;
      if (pending.previewTimer) clearTimeout(pending.previewTimer);
      if (pending.syncTimer) clearTimeout(pending.syncTimer);
      this.pending.delete(response.requestId);

      if (!response.ok) {
        worker.terminate();
        this.worker = undefined;
        this.fallbackStraightAndSync(pending.requestId, pending.topology, pending.options, pending.key, pending.onResult, pending.onError, undefined, pending.routerOptions);
        return;
      }
      response.result.layoutPhase = "worker";
      const status = response.result.routeDiagnostics?.status;
      if (status === undefined || status === "complete") this.cache.set(pending.key, response.result);
      if (status !== undefined && status !== "complete") {
        const failures = response.result.routeDiagnostics?.routeFailures.length ?? 0;
        console.warn(`[steed] Worker routing degraded (${status}); ${failures} route failure${failures === 1 ? "" : "s"} reported.`, response.result.routeDiagnostics);
      }
      pending.onResult(response.result);
    };
    worker.onerror = () => {
      if (this.worker !== worker) return;
      worker.terminate();
      this.worker = undefined;
      const latestId = `layout-${this.latestRequestId}`;
      const pending = this.pending.get(latestId);
      if (pending) {
        if (pending.previewTimer) clearTimeout(pending.previewTimer);
        if (pending.syncTimer) clearTimeout(pending.syncTimer);
        this.pending.delete(latestId);
        this.fallbackStraightAndSync(pending.requestId, pending.topology, pending.options, pending.key, pending.onResult, pending.onError, undefined, pending.routerOptions);
      }
    };
    this.worker = worker;
    return worker;
  }

  private fallbackStraightPreview(
    topology: Topology,
    options: TopologyLayoutOptions,
    onResult: ((result: TopologyLayoutResult) => void) | undefined,
    onError: ((error: Error) => void) | undefined,
  ): void {
    try {
      onResult?.(this.straightLayout(topology, options));
    } catch (error) {
      const resolved = error instanceof Error ? error : new Error("Straight preview failed");
      onError?.(resolved);
      console.warn("[steed] Straight preview unavailable; worker route may still finish normally.");
    }
  }

  private fallbackStraightAndSync(
    requestId: string,
    topology: Topology,
    options: TopologyLayoutOptions,
    key: string,
    onResult: ((result: TopologyLayoutResult) => void) | undefined,
    onError: ((error: Error) => void) | undefined,
    cause?: unknown,
    inputRouterOptions?: RouterOptions,
  ): void {
    if (!this.straightWarningLogged) {
      this.straightWarningLogged = true;
      console.warn("[steed] Topology layout worker unavailable or failed; showing straight-only preview before cooperative routed result.");
    }

    try {
      const preview = this.straightLayout(topology, options);
      preview.layoutPhase = "fallback";
      onResult?.(preview);
    } catch (error) {
      const resolved = error instanceof Error ? error : new Error(cause instanceof Error ? cause.message : "Straight layout failed");
      onError?.(resolved);
      console.warn("[steed] Straight-only topology layout is unavoidable; worker and synchronous route both failed.");
      return;
    }

    const syncTimer = setTimeout(() => {
      if (requestId !== `layout-${this.latestRequestId}`) return;
      const routerOptions: RouterOptions = inputRouterOptions ?? {
        layoutTimeoutMs: TOPOLOGY_SYNC_LAYOUT_TIMEOUT_MS,
        edgeTimeoutMs: TOPOLOGY_SYNC_EDGE_TIMEOUT_MS,
      };
      const applyRouted = (routed: TopologyLayoutResult) => {
        if (requestId !== `layout-${this.latestRequestId}`) return;
        const status = routed.routeDiagnostics?.status;
        const complete = status === undefined || status === "complete";
        if (complete) this.cache.set(key, routed);
        routed.layoutPhase = "synchronous";
        onResult?.(routed);
      };
      const failSync = (error: unknown) => {
        if (requestId !== `layout-${this.latestRequestId}`) return;
        const resolved = error instanceof Error ? error : new Error(cause instanceof Error ? cause.message : "Synchronous topology route failed");
        console.warn("[steed] Straight-only topology layout fallback remains active: bounded synchronous route failed.");
        onError?.(resolved);
        const pending = this.pending.get(requestId);
        if (pending?.syncTimer) pending.syncTimer = undefined;
      };

      if (!this.cooperativeLayout && topology.nodes.length > TOPOLOGY_SYNC_NODE_LIMIT) {
        void import("./topology-layout-compute")
          .then(async (module) => {
            if (requestId !== `layout-${this.latestRequestId}`) return;
            const routed = await module.computeTopologyLayoutCooperative(topology, options, {
              batchSize: TOPOLOGY_COOPERATIVE_BATCH_SIZE,
              routerOptions,
              isCancelled: () => requestId !== `layout-${this.latestRequestId}`,
              yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
            });
            if (routed) applyRouted(routed);
          })
          .catch(failSync)
          .finally(() => {
            const pending = this.pending.get(requestId);
            if (pending?.syncTimer) pending.syncTimer = undefined;
          });
        return;
      }

      if (this.cooperativeLayout) {
        void this.cooperativeLayout(topology, options, {
          batchSize: TOPOLOGY_COOPERATIVE_BATCH_SIZE,
          routerOptions,
          isCancelled: () => requestId !== `layout-${this.latestRequestId}`,
          yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
        }).then((routed) => {
          if (routed) applyRouted(routed);
        }).catch(failSync).finally(() => {
          const pending = this.pending.get(requestId);
          if (pending?.syncTimer) pending.syncTimer = undefined;
        });
        return;
      }

      if (this.syncLayout) {
        try {
          applyRouted(this.syncLayout(topology, options, routerOptions));
        } catch (error) {
          failSync(error);
        }
        const pending = this.pending.get(requestId);
        if (pending?.syncTimer) pending.syncTimer = undefined;
        return;
      }

      void import("./topology-layout-compute")
        .then(async (module) => {
          if (requestId !== `layout-${this.latestRequestId}`) return;
          if (module.computeTopologyLayoutCooperative) {
            const routed = await module.computeTopologyLayoutCooperative(topology, options, {
              batchSize: TOPOLOGY_COOPERATIVE_BATCH_SIZE,
              routerOptions,
              isCancelled: () => requestId !== `layout-${this.latestRequestId}`,
              yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
            });
            if (routed) applyRouted(routed);
          } else {
            applyRouted(module.computeTopologyLayout(topology, options, routerOptions));
          }
        })
        .catch((error) => {
          if (requestId !== `layout-${this.latestRequestId}`) return;
          failSync(error);
        })
        .finally(() => {
          const pending = this.pending.get(requestId);
          if (pending?.syncTimer) pending.syncTimer = undefined;
        });
    }, 0);

    const pending = this.pending.get(requestId);
    if (pending) pending.syncTimer = syncTimer;
  }

}

export function defaultTopologyLayoutWorker(): LayoutWorkerLike | undefined {
  if (typeof Worker === "undefined") return undefined;
  try {
    return new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module", name: "topology-layout" }) as unknown as LayoutWorkerLike;
  } catch {
    return undefined;
  }
}
