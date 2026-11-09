import type { Topology } from "@steed/api/shared";
import { layoutTopology, type TopologyLayoutOptions, type TopologyLayoutResult } from "./topology-layout";
import { routeTopology, routeTopologyCooperative, type RouterOptions, type TopologyRouterSessionProgress } from "./topology-router";

export interface CooperativeLayoutOptions {
  batchSize?: number;
  routerOptions?: RouterOptions;
  clock?: () => number;
  yieldControl?: () => Promise<void>;
  isCancelled?: () => boolean;
  onProgress?: (progress: TopologyRouterSessionProgress) => void;
}

export function computeTopologyLayout(topology: Topology, options: TopologyLayoutOptions = {}, routerOptions: RouterOptions = {}): TopologyLayoutResult {
  const layout = layoutTopology(topology, options);
  const routeResult = routeTopology(topology, layout, routerOptions);

  layout.routes = routeResult.routes;
  layout.routeDiagnostics = routeResult.diagnostics;
  layout.labels = routeResult.labels;
  layout.hiddenEdgeIds = routeResult.labels.hiddenEdgeIds;
  layout.bundles = routeResult.bundles.bundles;
  layout.bundleDiagnostics = routeResult.bundles.diagnostics;
  return layout;
}

export async function computeTopologyLayoutCooperative(
  topology: Topology,
  options: TopologyLayoutOptions = {},
  cooperative: CooperativeLayoutOptions = {},
): Promise<TopologyLayoutResult | undefined> {
  if (cooperative.isCancelled?.()) return undefined;
  const layout = layoutTopology(topology, options);
  const yieldControl = cooperative.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const result = await routeTopologyCooperative(
    topology,
    layout,
    { ...cooperative.routerOptions, clock: cooperative.clock ?? cooperative.routerOptions?.clock, layoutTimeoutMs: cooperative.routerOptions?.layoutTimeoutMs ?? 1500, edgeTimeoutMs: cooperative.routerOptions?.edgeTimeoutMs ?? 20 },
    cooperative.isCancelled,
    cooperative.batchSize ?? 20,
    yieldControl,
    cooperative.onProgress,
  );
  if (!result) return undefined;
  return {
    ...layout,
    routes: result.routes,
    routeDiagnostics: result.diagnostics,
    labels: result.labels,
    hiddenEdgeIds: result.labels.hiddenEdgeIds,
    bundles: result.bundles.bundles,
    bundleDiagnostics: result.bundles.diagnostics,
  };
}
