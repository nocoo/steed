import type { Topology } from "@steed/api/shared";
import { layoutTopology, type TopologyLayoutOptions, type TopologyLayoutResult } from "./topology-layout";
import type { TopologyRoute } from "./topology-router";
import type { RoutingPoint, RoutingRect } from "./topology-routing-grid";

function straightPort(rect: RoutingRect, side: "top" | "right" | "bottom" | "left"): RoutingPoint {
  if (side === "left") return { x: rect.x, y: rect.y + rect.height / 2 };
  if (side === "right") return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  if (side === "top") return { x: rect.x + rect.width / 2, y: rect.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
}

function straightSide(source: RoutingRect, target: RoutingRect): ["top" | "right" | "bottom" | "left", "top" | "right" | "bottom" | "left"] {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

export function computeStraightTopologyLayout(topology: Topology, options: TopologyLayoutOptions = {}): TopologyLayoutResult {
  const layout = layoutTopology(topology, options);
  const routes: Record<string, TopologyRoute> = Object.create(null);
  const failures: Array<{ edgeId: string; reason: "timeout" }> = [];

  for (const edge of [...topology.edges].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const source = layout.positions[edge.source];
    const target = layout.positions[edge.target];
    if (!source || !target) {
      routes[edge.id] = {
        edgeId: edge.id,
        source: edge.source,
        target: edge.target,
        sourceSide: "top",
        targetSide: "top",
        points: [],
        status: "fallback",
        renderMode: "straight",
        fallbackStyle: "dashed",
        fallback: "timeout",
      };
      failures.push({ edgeId: edge.id, reason: "timeout" });
      continue;
    }

    const [sourceSide, targetSide] = straightSide(source, target);
    const sourcePort = straightPort(source, sourceSide);
    const targetPort = straightPort(target, targetSide);
    const points = [sourcePort, targetPort];
    routes[edge.id] = {
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      sourceSide,
      targetSide,
      points,
      status: "fallback",
      renderMode: "straight",
      fallbackStyle: "dashed",
      fallback: "timeout",
    };
    failures.push({ edgeId: edge.id, reason: "timeout" });
  }

  layout.routes = routes;
  layout.routeDiagnostics = {
    status: "timeout",
    routeFailures: failures,
    fallbackCount: failures.length,
    unroutedEdgeIds: [...topology.edges.map((edge) => edge.id)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
    unresolvedTwoPointSharedChannels: [],
    elapsedMs: 0,
    bundleFailures: [],
  };
  layout.labels = { labels: {}, hiddenEdgeIds: [] };
  layout.hiddenEdgeIds = [];
  layout.layoutPhase = "preview";
  layout.bundles = [];
  layout.bundleDiagnostics = { routeFailures: [], elapsedMs: 0 };
  return layout;
}
