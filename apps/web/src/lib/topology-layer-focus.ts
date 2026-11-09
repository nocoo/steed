import type { Topology, TopologyEdge, TopologyNode } from "@steed/api/shared";
import type { TopologyLayoutLane, TopologyLayoutResult } from "./topology-layout";

export type TopologyLayerFocusSide = "top" | "right" | "bottom" | "left";

export interface TopologyLayerFocusStub {
  id: string;
  remoteLayerId: string;
  remoteLayerLabel: string;
  count: number;
  side: TopologyLayerFocusSide;
  x: number;
  y: number;
}

export interface TopologyLayerFocusProjection {
  focusedLayerId: string;
  lane: TopologyLayoutLane;
  translateExtent: [[number, number], [number, number]];
  stubs: TopologyLayerFocusStub[];
  /** Same-layer edges that must stay individually visible while focused. */
  inSectionEdgeIds: Set<string>;
  /** Cross-layer edges hidden in favour of stubs. */
  suppressedEdgeIds: Set<string>;
}

const FOCUS_PADDING = 80;
const STUB_WIDTH = 220;
const STUB_HEIGHT = 44;
const STUB_GAP = 12;
const STUB_INSET = 24;

export function compareTopologyId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function orderedTopologyLayers(topology: Topology): Topology["layers"] {
  return [...topology.layers].sort((a, b) => a.order - b.order || compareTopologyId(a.id, b.id));
}

export function readTopologyLayerFocusParam(search: string): string {
  const layer = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("layer")?.trim();
  return layer ?? "";
}

export function writeTopologyLayerFocusSearch(layerId: string | undefined, currentSearch: string): string {
  const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  const next = layerId?.trim() ?? "";
  if (next) params.set("layer", next);
  else params.delete("layer");
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export function adjacentTopologyLayerId(layers: Topology["layers"], currentId: string, step: -1 | 1): string | undefined {
  const ordered = orderedTopologyLayers({ layers } as Topology);
  const index = ordered.findIndex((layer) => layer.id === currentId);
  if (index < 0) return undefined;
  return ordered[index + step]?.id;
}

export function topologyLayerVisibleNodeCounts(topology: Topology, visibleNodeIds: ReadonlySet<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of topology.nodes) {
    if (!visibleNodeIds.has(node.id)) continue;
    counts.set(node.layerId, (counts.get(node.layerId) ?? 0) + 1);
  }
  return counts;
}

function hostLayerByNode(layout: TopologyLayoutResult): Map<string, string> {
  const map = new Map<string, string>();
  for (const lane of layout.lanes) for (const id of lane.nodeIds) map.set(id, lane.layerId);
  return map;
}

function laneByLayerId(layout: TopologyLayoutResult): Map<string, TopologyLayoutLane> {
  return new Map(layout.lanes.map((lane) => [lane.layerId, lane]));
}

function stubSide(focused: TopologyLayoutLane, remote: TopologyLayoutLane): TopologyLayerFocusSide {
  const focusedCenter = { x: focused.x + focused.width / 2, y: focused.y + focused.height / 2 };
  const remoteCenter = { x: remote.x + remote.width / 2, y: remote.y + remote.height / 2 };
  const dx = remoteCenter.x - focusedCenter.x;
  const dy = remoteCenter.y - focusedCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function stubOrigin(lane: TopologyLayoutLane, side: TopologyLayerFocusSide, index: number, total: number): { x: number; y: number } {
  const stackOffset = index * (STUB_HEIGHT + STUB_GAP) - ((total - 1) * (STUB_HEIGHT + STUB_GAP)) / 2;
  if (side === "right") return { x: lane.x + lane.width - STUB_WIDTH - STUB_INSET, y: lane.y + lane.height / 2 + stackOffset - STUB_HEIGHT / 2 };
  if (side === "left") return { x: lane.x + STUB_INSET, y: lane.y + lane.height / 2 + stackOffset - STUB_HEIGHT / 2 };
  if (side === "bottom") return { x: lane.x + lane.width / 2 + stackOffset - STUB_WIDTH / 2, y: lane.y + lane.height - STUB_HEIGHT - STUB_INSET };
  return { x: lane.x + lane.width / 2 + stackOffset - STUB_WIDTH / 2, y: lane.y + STUB_INSET };
}

export function topologyFocusTranslateExtent(lane: TopologyLayoutLane, padding = FOCUS_PADDING): [[number, number], [number, number]] {
  return [
    [lane.x - padding, lane.y - padding],
    [lane.x + lane.width + padding, lane.y + lane.height + padding],
  ];
}

export function nodeInFocusedLayer(node: TopologyNode, hostLayer: Map<string, string>, focusedLayerId: string): boolean {
  return (hostLayer.get(node.id) ?? node.layerId) === focusedLayerId;
}

export function buildTopologyLayerFocusProjection(
  topology: Topology,
  layout: TopologyLayoutResult,
  visibleNodes: readonly TopologyNode[],
  visibleEdges: readonly TopologyEdge[],
  focusedLayerId: string,
): TopologyLayerFocusProjection | null {
  if (!focusedLayerId) return null;
  const lane = laneByLayerId(layout).get(focusedLayerId);
  if (!lane) return null;

  const layerById = new Map(topology.layers.map((layer) => [layer.id, layer]));
  const hostLayer = hostLayerByNode(layout);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const remoteCounts = new Map<string, { count: number; edgeIds: string[] }>();
  const suppressedEdgeIds = new Set<string>();
  const inSectionEdgeIds = new Set<string>();

  for (const edge of visibleEdges) {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;
    const sourceLayer = hostLayer.get(edge.source);
    const targetLayer = hostLayer.get(edge.target);
    if (!sourceLayer || !targetLayer) continue;
    if (sourceLayer === focusedLayerId && targetLayer === focusedLayerId) {
      inSectionEdgeIds.add(edge.id);
      continue;
    }
    if (sourceLayer === targetLayer) continue;
    if (sourceLayer !== focusedLayerId && targetLayer !== focusedLayerId) continue;
    suppressedEdgeIds.add(edge.id);
    const remoteLayerId = sourceLayer === focusedLayerId ? targetLayer : sourceLayer;
    const bucket = remoteCounts.get(remoteLayerId) ?? { count: 0, edgeIds: [] };
    bucket.count += 1;
    bucket.edgeIds.push(edge.id);
    remoteCounts.set(remoteLayerId, bucket);
  }

  const stubs: TopologyLayerFocusStub[] = [];
  const remoteLayerIds = [...remoteCounts.keys()].sort(compareTopologyId);
  const sideGroups = new Map<TopologyLayerFocusSide, string[]>();
  for (const remoteLayerId of remoteLayerIds) {
    const remoteLane = laneByLayerId(layout).get(remoteLayerId);
    if (!remoteLane) continue;
    const side = stubSide(lane, remoteLane);
    const group = sideGroups.get(side) ?? [];
    group.push(remoteLayerId);
    sideGroups.set(side, group);
  }

  for (const [side, ids] of sideGroups) {
    ids.sort(compareTopologyId);
    ids.forEach((remoteLayerId, index) => {
      const bucket = remoteCounts.get(remoteLayerId);
      if (!bucket) return;
      const { x, y } = stubOrigin(lane, side, index, ids.length);
      stubs.push({
        id: `layer-stub:${remoteLayerId}`,
        remoteLayerId,
        remoteLayerLabel: layerById.get(remoteLayerId)?.label ?? remoteLayerId,
        count: bucket.count,
        side,
        x,
        y,
      });
    });
  }

  stubs.sort((a, b) => compareTopologyId(a.remoteLayerId, b.remoteLayerId));

  return {
    focusedLayerId,
    lane,
    translateExtent: topologyFocusTranslateExtent(lane),
    stubs,
    inSectionEdgeIds,
    suppressedEdgeIds,
  };
}

export function clipRoutePointsToLane(
  points: readonly { x: number; y: number }[],
  lane: TopologyLayoutLane,
): { x: number; y: number }[] {
  if (points.length < 2) return [...points];
  const inside = (point: { x: number; y: number }) =>
    point.x >= lane.x && point.x <= lane.x + lane.width && point.y >= lane.y && point.y <= lane.y + lane.height;
  const clipped: { x: number; y: number }[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!point) continue;
    if (inside(point)) clipped.push(point);
    else if (clipped.length) break;
  }
  if (clipped.length >= 2) return clipped;
  return clipped.length ? clipped : (points[0] ? [points[0]] : []);
}

export const TOPOLOGY_LAYER_STUB_WIDTH = STUB_WIDTH;
export const TOPOLOGY_LAYER_STUB_HEIGHT = STUB_HEIGHT;
