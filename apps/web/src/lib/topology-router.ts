import type { Topology, TopologyEdge } from "@steed/api/shared";
import { TOPOLOGY_FRAME_HEADER, TOPOLOGY_ROUTE_STROKE_MARGIN, TOPOLOGY_SECTION_HEADER, topologyHeaderObstacle, topologyRouteObstacle, type TopologyLayoutFrame, type TopologyLayoutLane, type TopologyLayoutResult } from "./topology-layout";
import { resolveStyles } from "./topology-style";
import { ROUTING_GRID_BYTE_LIMIT, RoutingGrid, RoutingGridLimit, RoutingGridTimeout, type RoutingPoint, type RoutingRect } from "./topology-routing-grid";
import {
  buildTopologyLayerPairBundles,
  placeTopologyRouteLabels,
  type TopologyLayerPairBundleResult,
  type TopologyRouteLabelResult,
} from "./topology-route-extras";

export type RouteSide = "top" | "right" | "bottom" | "left";
export type RouteFailureReason = "no_path" | "timeout";
export type TopologyRouteStatus = "routed" | "fallback";
export type TopologyRoutingStatus = "complete" | "fallback" | "timeout" | "resource-limit";
export interface TopologyRoute {
  status: TopologyRouteStatus;
  renderMode?: "straight";
  fallbackStyle?: "dashed" | "faded";
  edgeId: string;
  source: string;
  target: string;
  points: RoutingPoint[];
  sourceSide: RouteSide;
  targetSide: RouteSide;
  fallback?: RouteFailureReason;
}
export interface RouteFailure { edgeId: string; reason: RouteFailureReason }
export interface UnresolvedTwoPointSharedChannel { edgeIds: string[]; channel: string; length: number }
export interface TopologyRouteResult {
  routes: Record<string, TopologyRoute>;
  labels: TopologyRouteLabelResult;
  bundles: TopologyLayerPairBundleResult;
  diagnostics: {
    unresolvedTwoPointSharedChannels: UnresolvedTwoPointSharedChannel[];
    status: TopologyRoutingStatus;
    routeFailures: RouteFailure[];
    fallbackCount: number;
    unroutedEdgeIds: string[];
    elapsedMs: number;
    resourceLimit?: true;
    bundleFailures: Array<{ bundleId: string; reason: "no_path" | "timeout" }>;
  };
}
export interface RouterOptions {
  clock?: () => number;
  cooperativeChunkClock?: () => number;
  cooperativeChunkWallMs?: number;
  layoutTimeoutMs?: number;
  edgeTimeoutMs?: number;
  maxBytes?: number;
  bundleMaxBytes?: number;
}
export const ROUTE_MARGIN = 12;
export const ROUTE_LAYOUT_TIMEOUT_MS = 1500;
export const ROUTE_EDGE_TIMEOUT_MS = 20;

interface Endpoint {
  nodeId: string;
  edgeId: string;
  other: RoutingPoint;
  side: RouteSide;
  port: RoutingPoint;
  stub: RoutingPoint;
  valid: boolean;
  alternatives: Array<{ side: RouteSide; port: RoutingPoint; stub: RoutingPoint }>;
}
interface EdgeEndpoints { edge: TopologyEdge; source: Endpoint; target: Endpoint }
interface Section {
  lane: TopologyLayoutLane;
  frames: TopologyLayoutFrame[];
  cards: Array<{ id: string; rect: RoutingRect }>;
  gateways: Record<"left" | "right" | "bottom", RoutingPoint>;
  grid: RoutingGrid;
}
interface ValidationContext {
  cards: Array<{ id: string; rect: RoutingRect }>;
  headers: RoutingRect[];
  otherLanes: RoutingRect[];
  endpointLanes: TopologyLayoutLane[];
  frames: Array<{ frame: TopologyLayoutFrame; sourceInside: boolean; targetInside: boolean }>;
}

function compareId(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function normalizeGridLimit(value: number | undefined): number {
  if (value === undefined || value === Number.POSITIVE_INFINITY) return ROUTING_GRID_BYTE_LIMIT;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(ROUTING_GRID_BYTE_LIMIT, Math.floor(value));
}
function inflate(rect: RoutingRect, margin = ROUTE_MARGIN): RoutingRect {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
}
function midpoint(rect: RoutingRect): RoutingPoint { return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }
function intersects(a: RoutingPoint, b: RoutingPoint, rect: RoutingRect): boolean {
  if (a.x === b.x) return a.x > rect.x && a.x < rect.x + rect.width && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height;
  if (a.y === b.y) return a.y > rect.y && a.y < rect.y + rect.height && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width;
  return true;
}
function port(rect: RoutingRect, side: RouteSide, fraction = 0.5): RoutingPoint {
  if (side === "left") return { x: rect.x, y: Math.round(rect.y + rect.height * fraction) };
  if (side === "right") return { x: rect.x + rect.width, y: Math.round(rect.y + rect.height * fraction) };
  if (side === "top") return { x: Math.round(rect.x + rect.width * fraction), y: rect.y };
  return { x: Math.round(rect.x + rect.width * fraction), y: rect.y + rect.height };
}
function stub(point: RoutingPoint, side: RouteSide): RoutingPoint {
  if (side === "left") return { x: point.x - ROUTE_MARGIN, y: point.y };
  if (side === "right") return { x: point.x + ROUTE_MARGIN, y: point.y };
  if (side === "top") return { x: point.x, y: point.y - ROUTE_MARGIN };
  return { x: point.x, y: point.y + ROUTE_MARGIN };
}
function directions(from: RoutingRect, to: RoutingRect): RouteSide[] {
  const a = midpoint(from); const b = midpoint(to);
  const dx = b.x - a.x; const dy = b.y - a.y;
  const horizontal: RouteSide = dx >= 0 ? "right" : "left";
  const vertical: RouteSide = dy >= 0 ? "bottom" : "top";
  const oppositeH: RouteSide = horizontal === "right" ? "left" : "right";
  const oppositeV: RouteSide = vertical === "bottom" ? "top" : "bottom";
  return Math.abs(dx) >= Math.abs(dy) ? [horizontal, vertical, oppositeV, oppositeH] : [vertical, horizontal, oppositeH, oppositeV];
}
function header(rect: RoutingRect, height: number): RoutingRect { return topologyHeaderObstacle(rect, height); }
export function topologySectionTitleObstacle(lane: TopologyLayoutLane): RoutingRect {
  const legacyHeader = topologyHeaderObstacle(lane, TOPOLOGY_SECTION_HEADER);
  const renderedHeader = topologyHeaderObstacle({ x: lane.x, y: lane.y + 2, width: lane.width, height: TOPOLOGY_SECTION_HEADER }, TOPOLOGY_SECTION_HEADER);
  return {
    x: Math.min(legacyHeader.x, renderedHeader.x),
    y: Math.min(legacyHeader.y, renderedHeader.y),
    width: Math.max(legacyHeader.x + legacyHeader.width, renderedHeader.x + renderedHeader.width) - Math.min(legacyHeader.x, renderedHeader.x),
    height: Math.max(legacyHeader.y + legacyHeader.height, renderedHeader.y + renderedHeader.height) - Math.min(legacyHeader.y, renderedHeader.y),
  };
}
function endpoint(edgeId: string, nodeId: string, rect: RoutingRect, other: RoutingRect, cards: Array<{ id: string; rect: RoutingRect }>, headers: RoutingRect[]): Endpoint {
  const candidates = directions(rect, other);
  const attachments: Endpoint["alternatives"] = [];
  for (const side of candidates) {
    const point = port(rect, side);
    const outside = stub(point, side);
    if (cards.some((card) => card.id !== nodeId && intersects(point, outside, inflate(card.rect)))) continue;
    if (headers.some((item) => intersects(point, outside, item))) continue;
    attachments.push({ side, port: point, stub: outside });
  }
  const first = attachments.shift();
  if (first) return { edgeId, nodeId, other: midpoint(other), ...first, valid: true, alternatives: attachments };
  const side = (candidates[0] as RouteSide);
  const point = port(rect, side);
  return { edgeId, nodeId, other: midpoint(other), side, port: point, stub: stub(point, side), valid: false, alternatives: [] };
}
function simplify(points: RoutingPoint[]): RoutingPoint[] {
  const result: RoutingPoint[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && last.x === point.x && last.y === point.y) continue;
    const previous = result.at(-2);
    if (previous && last && ((previous.x === last.x && last.x === point.x) || (previous.y === last.y && last.y === point.y))) result.pop();
    result.push(point);
  }
  return result;
}
function masks(section: Section, source: string, target?: string): { forbidden: Uint32Array; required: Uint32Array } {
  const forbidden = new Uint32Array(section.grid.words);
  const required = new Uint32Array(section.grid.words);
  section.frames.forEach((frame, index) => {
    const sourceInside = frame.nodeIds.includes(source);
    const targetInside = target !== undefined && frame.nodeIds.includes(target);
    const word = index >>> 5; const bit = 1 << (index & 31);
    if (!sourceInside && !targetInside) (forbidden[word] as number) |= bit;
    if (sourceInside && targetInside) (required[word] as number) |= bit;
  });
  return { forbidden, required };
}
function gateway(lane: TopologyLayoutLane, other: TopologyLayoutLane): "left" | "right" | "bottom" {
  const a = midpoint(lane); const b = midpoint(other);
  const dx = b.x - a.x; const dy = b.y - a.y;
  if (dy > 0 && Math.abs(dy) > Math.abs(dx)) return "bottom";
  return dx >= 0 ? "right" : "left";
}
function gateways(lane: TopologyLayoutLane): Section["gateways"] {
  const y = Math.max(lane.y + TOPOLOGY_SECTION_HEADER + 1, Math.round(lane.y + lane.height / 2));
  return {
    left: { x: lane.x, y }, right: { x: lane.x + lane.width, y },
    bottom: { x: Math.round(lane.x + lane.width / 2), y: lane.y + lane.height },
  };
}
function outsideGateway(lane: TopologyLayoutLane, side: "left" | "right" | "bottom"): RoutingPoint {
  const point = gateways(lane)[side];
  const clearance = TOPOLOGY_ROUTE_STROKE_MARGIN + 1;
  if (side === "left") return { x: point.x - clearance, y: point.y };
  if (side === "right") return { x: point.x + clearance, y: point.y };
  return { x: point.x, y: point.y + clearance };
}
function frameCrossings(points: RoutingPoint[], frame: RoutingRect): number {
  let inside: boolean | undefined;
  let crossings = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = (points[i] as RoutingPoint); const b = (points[i + 1] as RoutingPoint);
    const horizontal = a.y === b.y;
    const start = horizontal ? a.x : a.y;
    const end = horizontal ? b.x : b.y;
    const min = Math.min(start, end); const max = Math.max(start, end);
    const boundaries = horizontal ? [frame.x, frame.x + frame.width] : [frame.y, frame.y + frame.height];
    const cuts = [min, ...boundaries.filter((value) => value > min && value < max), max].sort((x, y) => x - y);
    if (start > end) cuts.reverse();
    for (let j = 0; j + 1 < cuts.length; j++) {
      const middle = ((cuts[j] as number) + (cuts[j + 1] as number)) / 2;
      const x = horizontal ? middle : a.x; const y = horizontal ? a.y : middle;
      const onBorder = ((x === frame.x || x === frame.x + frame.width) && y >= frame.y && y <= frame.y + frame.height)
        || ((y === frame.y || y === frame.y + frame.height) && x >= frame.x && x <= frame.x + frame.width);
      if (onBorder) continue;
      const next = x > frame.x && x < frame.x + frame.width && y > frame.y && y < frame.y + frame.height;
      if (inside !== undefined && inside !== next) crossings++;
      inside = next;
    }
  }
  return crossings;
}
function safeRoute(points: RoutingPoint[], edge: TopologyEdge, context: ValidationContext): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = (points[i] as RoutingPoint); const b = (points[i + 1] as RoutingPoint);
    if (a.x !== b.x && a.y !== b.y) return false;
    for (const { id, rect } of context.cards) {
      if (id !== edge.source && id !== edge.target && intersects(a, b, inflate(rect))) return false;
      if ((id === edge.source || id === edge.target) && intersects(a, b, rect)) return false;
    }
    for (const item of context.headers) if (intersects(a, b, item)) return false;
    for (const lane of context.otherLanes) if (intersects(a, b, lane)) return false;
    for (const { frame, sourceInside, targetInside } of context.frames) {
      if (intersects(a, b, header(frame, TOPOLOGY_FRAME_HEADER))) return false;
      if (!sourceInside && !targetInside && intersects(a, b, topologyRouteObstacle(frame, TOPOLOGY_ROUTE_STROKE_MARGIN))) return false;
    }
  }
  for (const { frame, sourceInside, targetInside } of context.frames) {
    if ((sourceInside || targetInside) && frameCrossings(points, frame) !== Number(sourceInside !== targetInside)) return false;
  }
  for (const lane of context.endpointLanes) if (frameCrossings(points, lane) !== Number(context.endpointLanes.length > 1)) return false;
  return true;
}

interface ChannelSegment { start: number; end: number }
const NUDGE_OFFSETS = [6, -6, 12, -12, 18, -18, 24, -24, 30, -30, 36, -36, 42, -42, 48, -48];
function channel(points: RoutingPoint[], index: number): { key: string; segment: ChannelSegment } {
  const a = (points[index] as RoutingPoint); const b = (points[index + 1] as RoutingPoint);
  const horizontal = a.y === b.y;
  const start = horizontal ? a.x : a.y; const end = horizontal ? b.x : b.y;
  return { key: `${horizontal ? "h" : "v"}:${horizontal ? a.y : a.x}`, segment: { start: Math.min(start, end), end: Math.max(start, end) } };
}
function occupied(channels: Map<string, ChannelSegment[]>, points: RoutingPoint[], index: number): boolean {
  const { key, segment } = channel(points, index);
  return (channels.get(key) ?? []).some((other) => segment.start < other.end && segment.end > other.start);
}
function ordinaryUnresolvedChannel(points: RoutingPoint[], horizontal: boolean): { key: string; length: number } | null {
  if (points.length !== 2) return null;
  const a = points[0]; const b = points[1];
  if (!a || !b) return null;
  if (horizontal) {
    const distance = Math.abs(b.x - a.x);
    if (distance <= ROUTE_MARGIN * 2) return null;
    const direction = Math.sign(b.x - a.x);
    const low = Math.min(a.x + direction * ROUTE_MARGIN, b.x - direction * ROUTE_MARGIN);
    const high = Math.max(a.x + direction * ROUTE_MARGIN, b.x - direction * ROUTE_MARGIN);
    return low < high ? { key: `h:${a.y}:${low}:${high}`, length: high - low } : null;
  }
  const distance = Math.abs(b.y - a.y);
  if (distance <= ROUTE_MARGIN * 2) return null;
  const direction = Math.sign(b.y - a.y);
  const low = Math.min(a.y + direction * ROUTE_MARGIN, b.y - direction * ROUTE_MARGIN);
  const high = Math.max(a.y + direction * ROUTE_MARGIN, b.y - direction * ROUTE_MARGIN);
  return low < high ? { key: `v:${a.x}:${low}:${high}`, length: high - low } : null;
}
function nudgeRoute(points: RoutingPoint[], edge: TopologyEdge, context: ValidationContext, channels: Map<string, ChannelSegment[]>, clock: () => number, deadline: number, slotIndex: number): { points: RoutingPoint[]; unresolved: Array<{ channel: string; length: number }> } {
  let result = points.map((point) => ({ ...point }));
  const unresolved: Array<{ channel: string; length: number }> = [];
  let resolvedStraightTwoPoint = false;
  if (result.length === 2 && occupied(channels, result, 0) && clock() < deadline) {
    const a = (result[0] as RoutingPoint); const b = (result[1] as RoutingPoint);
    const horizontal = a.y === b.y;
    const distance = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    let resolved = false;
    const preferredOffset = NUDGE_OFFSETS[slotIndex];
    const candidateOffsets = preferredOffset !== undefined
      ? [preferredOffset, ...NUDGE_OFFSETS.filter((offset) => offset !== preferredOffset)]
      : NUDGE_OFFSETS;
    if (distance > ROUTE_MARGIN * 2) for (const offset of candidateOffsets) {
      const direction = Math.sign(horizontal ? b.x - a.x : b.y - a.y);
      const first = horizontal ? { x: a.x + direction * ROUTE_MARGIN, y: a.y } : { x: a.x, y: a.y + direction * ROUTE_MARGIN };
      const last = horizontal ? { x: b.x - direction * ROUTE_MARGIN, y: b.y } : { x: b.x, y: b.y - direction * ROUTE_MARGIN };
      const shiftedFirst = horizontal ? { x: first.x, y: first.y + offset } : { x: first.x + offset, y: first.y };
      const shiftedLast = horizontal ? { x: last.x, y: last.y + offset } : { x: last.x + offset, y: last.y };
      const candidate = [a, first, shiftedFirst, shiftedLast, last, b];
      if (!occupied(channels, candidate, 2) && safeRoute(candidate, edge, context)) { result = candidate; resolved = true; resolvedStraightTwoPoint = true; break; }
    }
    if (!resolved && occupied(channels, [a, b], 0)) {
      const channelInfo = ordinaryUnresolvedChannel([a, b], horizontal);
      if (channelInfo) unresolved.push({ channel: channelInfo.key, length: channelInfo.length });
    }
  }
  for (let i = 1; i + 2 < result.length && !resolvedStraightTwoPoint && clock() < deadline; i++) {
    if (!occupied(channels, result, i)) continue;
    const a = (result[i] as RoutingPoint); const b = (result[i + 1] as RoutingPoint);
    const previous = (result[i - 1] as RoutingPoint); const next = (result[i + 2] as RoutingPoint);
    const horizontal = a.y === b.y;
    for (const offset of NUDGE_OFFSETS) {
      const old = horizontal ? a.y : a.x;
      const before = horizontal ? previous.y : previous.x;
      const after = horizontal ? next.y : next.x;
      if ((old - before) * (old + offset - before) <= 0 || (old - after) * (old + offset - after) <= 0) continue;
      if ((i === 1 && Math.abs(old + offset - before) < ROUTE_MARGIN) || (i + 2 === result.length - 1 && Math.abs(old + offset - after) < ROUTE_MARGIN)) continue;
      const candidate = result.map((point) => ({ ...point }));
      if (horizontal) { (candidate[i] as RoutingPoint).y += offset; (candidate[i + 1] as RoutingPoint).y += offset; }
      else { (candidate[i] as RoutingPoint).x += offset; (candidate[i + 1] as RoutingPoint).x += offset; }
      if (occupied(channels, candidate, i) || !safeRoute(candidate, edge, context)) continue;
      result = candidate;
      break;
    }
  }
  result = simplify(result);
  for (let i = 0; i + 1 < result.length; i++) {
    const { key, segment } = channel(result, i);
    const group = channels.get(key) ?? [];
    group.push(segment); channels.set(key, group);
  }
  return { points: result, unresolved };
}

export interface TopologyRouterSessionProgress {
  phase: "prepared" | "edges" | "extras" | "complete";
  routedEdges: number;
  totalEdges: number;
  elapsedMs: number;
}

export interface TopologyRouterSessionNext {
  done: boolean;
  result?: TopologyRouteResult;
  progress: TopologyRouterSessionProgress;
}

export class TopologyRouterSession {
  readonly clock: () => number;
  readonly layoutStart: number;
  readonly layoutDeadline: number;
  readonly edgeTimeout: number;
  readonly totalGridLimit: number;
  readonly normalizedBundleLimit: number;
  gridBytes = 0;
  readonly laneByNode = new Map<string, TopologyLayoutLane>();
  readonly edges: TopologyEdge[];
  readonly routes: Record<string, TopologyRoute> = Object.create(null);
  readonly failures: RouteFailure[] = [];
  readonly channels = new Map<string, ChannelSegment[]>();
  readonly twoPointSlotCounts = new Map<string, number>();
  readonly unresolvedTwoPointSharedChannels = new Map<string, { edgeIds: Set<string>; length: number }>();
  readonly outsideMasks = { forbidden: new Uint32Array(), required: new Uint32Array() };
  timedOut = false;
  edgeIndex = 0;
  private prepared = false;
  private cancelled = false;
  private finished = false;
  private styles: Record<string, { shape: string }> | undefined;
  private sections = new Map<string, Section>();
  private descriptors = new Map<string, { lane: TopologyLayoutLane; frames: TopologyLayoutFrame[]; cards: Array<{ id: string; rect: RoutingRect }>; gateways: Record<"left" | "right" | "bottom", RoutingPoint> }>();
  endpoints: EdgeEndpoints[] = [];
  private outside: RoutingGrid | undefined;
  private resourceLimit = false;

  constructor(
    readonly topology: Topology,
    readonly layout: TopologyLayoutResult,
    readonly options: RouterOptions = {},
  ) {
    this.clock = options.clock ?? (() => performance.now());
    this.layoutStart = this.clock();
    this.layoutDeadline = this.layoutStart + (options.layoutTimeoutMs ?? ROUTE_LAYOUT_TIMEOUT_MS);
    this.edgeTimeout = options.edgeTimeoutMs ?? ROUTE_EDGE_TIMEOUT_MS;
    this.totalGridLimit = normalizeGridLimit(options.maxBytes);
    this.normalizedBundleLimit = normalizeGridLimit(options.bundleMaxBytes);
    for (const lane of layout.lanes) for (const id of lane.nodeIds) this.laneByNode.set(id, lane);
    this.edges = [...topology.edges].sort((a, b) => {
      const aSame = this.laneByNode.get(a.source)?.id === this.laneByNode.get(a.target)?.id;
      const bSame = this.laneByNode.get(b.source)?.id === this.laneByNode.get(b.target)?.id;
      return Number(bSame) - Number(aSame) || compareId(a.source, b.source) || compareId(a.target, b.target) || compareId(a.id, b.id);
    });
  }

  cancel(): void {
    this.cancelled = true;
  }

  private bundleCapacity(remainingBundleBytes?: number): number {
    const remaining = normalizeGridLimit(remainingBundleBytes);
    return this.options.bundleMaxBytes === undefined ? remaining : Math.min(remaining, this.normalizedBundleLimit);
  }

  private extras(routes: Record<string, TopologyRoute>, remainingBundleBytes?: number) {
    return {
      labels: placeTopologyRouteLabels(this.topology.edges, routes, this.layout, {
        clock: this.clock,
        deadline: this.layoutDeadline,
      }),
      bundles: buildTopologyLayerPairBundles(this.topology, this.layout, this.topology.edges, {
        clock: this.clock,
        deadline: this.layoutDeadline,
        layoutTimeoutMs: this.options.layoutTimeoutMs,
        bundleTimeoutMs: this.options.edgeTimeoutMs,
        maxBytes: this.bundleCapacity(remainingBundleBytes ?? this.totalGridLimit - this.gridBytes),
      }),
    };
  }

  timeoutResult(resourceLimit = false): TopologyRouteResult {
    const routes: Record<string, TopologyRoute> = Object.create(null);
    const routeFailures: RouteFailure[] = [];
    for (const edge of this.edges) {
      const source = this.layout.positions[edge.source];
      const target = this.layout.positions[edge.target];
      if (!source || !target) {
        routes[edge.id] = { edgeId: edge.id, source: edge.source, target: edge.target, sourceSide: "top", targetSide: "top", points: [], status: "fallback", renderMode: "straight", fallbackStyle: "dashed", fallback: "no_path" };
        routeFailures.push({ edgeId: edge.id, reason: "no_path" });
        continue;
      }
      const sourceSide = directions(source, target)[0] as RouteSide;
      const targetSide = directions(target, source)[0] as RouteSide;
      routes[edge.id] = { edgeId: edge.id, source: edge.source, target: edge.target, sourceSide, targetSide, points: [port(source, sourceSide), port(target, targetSide)], status: "fallback", renderMode: "straight", fallbackStyle: "dashed", fallback: "timeout" };
      routeFailures.push({ edgeId: edge.id, reason: "timeout" });
    }
    const additional = this.extras(routes, Math.max(0, this.totalGridLimit - this.gridBytes));
    this.resourceLimit = resourceLimit;
    return {
      routes,
      ...additional,
      diagnostics: {
        unresolvedTwoPointSharedChannels: [],
        status: resourceLimit || additional.bundles.diagnostics.resourceLimit ? "resource-limit" : "timeout",
        routeFailures,
        fallbackCount: routeFailures.length,
        unroutedEdgeIds: routeFailures.filter((failure) => failure.reason === "timeout").map((failure) => failure.edgeId),
        elapsedMs: this.clock() - this.layoutStart,
        bundleFailures: additional.bundles.diagnostics.routeFailures,
        ...(resourceLimit || additional.bundles.diagnostics.resourceLimit ? { resourceLimit: true as const } : {}),
      },
    };
  }

  prepare(): TopologyRouteResult | undefined {
    if (this.prepared) return undefined;
    this.prepared = true;
    if (this.clock() >= this.layoutDeadline) return this.timeoutResult();
    this.styles = resolveStyles(this.topology);
    this.descriptors = new Map(this.layout.lanes.map((lane) => [lane.id, {
      lane,
      frames: this.layout.frames.filter((frame) => frame.layerId === lane.id),
      cards: lane.nodeIds.flatMap((id) => this.layout.positions[id] ? [{ id, rect: this.layout.positions[id] as RoutingRect }] : []),
      gateways: gateways(lane),
    }]));
    this.endpoints = [];
    for (const edge of this.edges) {
      if (this.clock() >= this.layoutDeadline) return this.timeoutResult();
      const sourceRect = this.layout.positions[edge.source];
      const targetRect = this.layout.positions[edge.target];
      const sourceLane = this.laneByNode.get(edge.source);
      const targetLane = this.laneByNode.get(edge.target);
      if (!sourceRect || !targetRect || !sourceLane || !targetLane) continue;
      const sourceDescriptor = this.descriptors.get(sourceLane.id);
      const targetDescriptor = this.descriptors.get(targetLane.id);
      if (!sourceDescriptor || !targetDescriptor) continue;
      const sourceHeaders = [topologySectionTitleObstacle(sourceDescriptor.lane), ...sourceDescriptor.frames.map((frame) => header(frame, TOPOLOGY_FRAME_HEADER))];
      const targetHeaders = [topologySectionTitleObstacle(targetDescriptor.lane), ...targetDescriptor.frames.map((frame) => header(frame, TOPOLOGY_FRAME_HEADER))];
      this.endpoints.push({ edge, source: endpoint(edge.id, edge.source, sourceRect, targetRect, sourceDescriptor.cards, sourceHeaders), target: endpoint(edge.id, edge.target, targetRect, sourceRect, targetDescriptor.cards, targetHeaders) });
    }
    const portGroups = new Map<string, Endpoint[]>();
    for (const pair of this.endpoints) for (const item of [pair.source, pair.target]) {
      const key = `${item.nodeId}:${item.side}`;
      const group = portGroups.get(key) ?? [];
      group.push(item);
      portGroups.set(key, group);
    }
    for (const group of portGroups.values()) {
      if (this.clock() >= this.layoutDeadline) return this.timeoutResult();
      const first = group[0];
      if (!first) continue;
      const rect = this.layout.positions[first.nodeId] as RoutingRect;
      if (group.length < 2 || this.styles?.[first.nodeId]?.shape !== "rect") continue;
      const horizontalSide = first.side === "top" || first.side === "bottom";
      group.sort((a, b) => (horizontalSide ? a.other.x - b.other.x || a.other.y - b.other.y : a.other.y - b.other.y || a.other.x - b.other.x) || compareId(a.edgeId, b.edgeId));
      const lane = this.laneByNode.get(first.nodeId);
      const section = lane ? this.descriptors.get(lane.id) : undefined;
      if (!lane || !section) continue;
      group.forEach((item, index) => {
        const point = port(rect, item.side, (index + 1) / (group.length + 1));
        const outside = stub(point, item.side);
        if (section.cards.some((card) => card.id !== item.nodeId && intersects(point, outside, inflate(card.rect)))) return;
        if ([topologySectionTitleObstacle(lane), ...section.frames.map((frame) => header(frame, TOPOLOGY_FRAME_HEADER))].some((rect) => intersects(point, outside, rect))) return;
        item.port = point;
        item.stub = outside;
      });
    }
    try {
      for (const descriptor of this.descriptors.values()) {
        if (this.clock() >= this.layoutDeadline) return this.timeoutResult();
        const points = [
          ...Object.values(descriptor.gateways),
          ...this.endpoints.flatMap((pair) => [pair.source, pair.target].filter((item) => this.laneByNode.get(item.nodeId)?.id === descriptor.lane.id).flatMap((item) => [item.stub, ...item.alternatives.map((alternative) => alternative.stub)])),
          { x: descriptor.lane.x, y: descriptor.lane.y },
          { x: descriptor.lane.x + descriptor.lane.width, y: descriptor.lane.y + descriptor.lane.height },
        ];
        const obstacles = [
          ...descriptor.cards.map((card) => inflate(card.rect)),
          topologySectionTitleObstacle(descriptor.lane),
          ...descriptor.frames.map((frame) => header(frame, TOPOLOGY_FRAME_HEADER)),
        ];
        const grid = new RoutingGrid(obstacles, descriptor.frames.map((frame) => ({ ...topologyRouteObstacle(frame, TOPOLOGY_ROUTE_STROKE_MARGIN), id: frame.id })), points, { clock: this.clock, deadline: this.layoutDeadline, maxBytes: this.totalGridLimit - this.gridBytes });
        this.gridBytes += grid.estimatedBytes;
        this.sections.set(descriptor.lane.id, { ...descriptor, grid });
      }
      const outsidePoints = [
        ...[...this.sections.values()].flatMap((section) => (Object.keys(section.gateways) as Array<"left" | "right" | "bottom">).map((side) => outsideGateway(section.lane, side))),
        { x: -160, y: -160 },
        { x: this.layout.width + 160, y: this.layout.height + 160 },
      ];
      if (this.clock() >= this.layoutDeadline) return this.timeoutResult();
      this.outside = new RoutingGrid([
        ...this.layout.lanes.map((lane) => topologyRouteObstacle(lane, TOPOLOGY_ROUTE_STROKE_MARGIN)),
        ...this.layout.lanes.map((lane) => topologySectionTitleObstacle(lane)),
      ], [], outsidePoints, { clock: this.clock, deadline: this.layoutDeadline, maxBytes: this.totalGridLimit - this.gridBytes });
      this.gridBytes += this.outside.estimatedBytes;
    } catch (error) {
      if (error instanceof RoutingGridTimeout) return this.timeoutResult();
      if (error instanceof RoutingGridLimit) return this.timeoutResult(true);
      throw error;
    }
    return undefined;
  }

  next(chunkSize = 20, chunkWallDeadlineMs = Number.POSITIVE_INFINITY, chunkWallClock: () => number = () => performance.now()): TopologyRouterSessionNext {
    if (this.cancelled) return { done: true, progress: { phase: "complete", routedEdges: this.edgeIndex, totalEdges: this.endpoints.length, elapsedMs: this.clock() - this.layoutStart } };
    if (this.finished) return { done: true, progress: { phase: "complete", routedEdges: this.edgeIndex, totalEdges: this.endpoints.length, elapsedMs: this.clock() - this.layoutStart } };
    if (!this.prepared) {
      const timeout = this.prepare();
      if (timeout) {
        this.finished = true;
        return { done: true, result: timeout, progress: { phase: "complete", routedEdges: this.edgeIndex, totalEdges: this.endpoints.length, elapsedMs: this.clock() - this.layoutStart } };
      }
    }
    if (!this.outside) {
      const timeout = this.timeoutResult();
      this.finished = true;
      return { done: true, result: timeout, progress: { phase: "complete", routedEdges: this.edgeIndex, totalEdges: this.endpoints.length, elapsedMs: this.clock() - this.layoutStart } };
    }

    const chunkWallStart = chunkWallClock();
    const chunkEnd = Math.min(this.endpoints.length, this.edgeIndex + Math.max(1, chunkSize));
    let routedInChunk = 0;
    while (this.edgeIndex < chunkEnd) {
      if (this.cancelled) return { done: true, progress: { phase: "complete", routedEdges: this.edgeIndex, totalEdges: this.endpoints.length, elapsedMs: this.clock() - this.layoutStart } };
      const pair = this.endpoints[this.edgeIndex];
      if (!pair) break;
      this.edgeIndex++;
      this.routeOnePair(pair);
      routedInChunk++;
      if (this.clock() >= this.layoutDeadline) this.timedOut = true;
      if (routedInChunk >= 1 && Number.isFinite(chunkWallDeadlineMs) && chunkWallClock() - chunkWallStart >= chunkWallDeadlineMs) break;
    }
    return {
      done: this.edgeIndex >= this.endpoints.length,
      progress: { phase: this.edgeIndex >= this.endpoints.length ? "extras" : "edges", routedEdges: this.edgeIndex, totalEdges: this.endpoints.length, elapsedMs: this.clock() - this.layoutStart },
    };
  }

  private routeOnePair(pair: EdgeEndpoints): void {
    const { edge, source, target } = pair;
    const sourceLane = this.laneByNode.get(edge.source);
    const targetLane = this.laneByNode.get(edge.target);
    const sourceSection = sourceLane ? this.sections.get(sourceLane.id) : undefined;
    const targetSection = targetLane ? this.sections.get(targetLane.id) : undefined;
    if (!sourceLane || !targetLane || !sourceSection || !targetSection) return;
    const edgeDeadline = Math.min(this.layoutDeadline, this.clock() + this.edgeTimeout);
    let reason: RouteFailureReason | undefined;
    let points: RoutingPoint[] | null = null;
    let nudgeUnresolved: Array<{ channel: string; length: number }> = [];

    if (this.timedOut || this.clock() >= this.layoutDeadline || this.clock() >= edgeDeadline) reason = "timeout";
    else if (!source.valid || !target.valid) reason = "no_path";
    else if (sourceLane.id === targetLane.id) {
      const regionMasks = masks(sourceSection, edge.source, edge.target);
      for (const sourcePort of [source, ...source.alternatives]) {
        for (const targetPort of [target, ...target.alternatives]) {
          const result = sourceSection.grid.search(sourcePort.stub, targetPort.stub, { ...regionMasks, clock: this.clock, deadline: edgeDeadline });
          if (result.timeout) { reason = "timeout"; break; }
          if (result.points) {
            points = [sourcePort.port, ...result.points, targetPort.port];
            Object.assign(source, { side: sourcePort.side, port: sourcePort.port, stub: sourcePort.stub });
            Object.assign(target, { side: targetPort.side, port: targetPort.port, stub: targetPort.stub });
            break;
          }
        }
        if (points || reason) break;
      }
      if (!points && !reason) reason = "no_path";
    } else {
      const sourceMasks = masks(sourceSection, edge.source);
      const targetMasks = masks(targetSection, edge.target);
      const sides = ["left", "right", "bottom"] as const;
      const sourceGateway = gateway(sourceLane, targetLane);
      const targetGateway = gateway(targetLane, sourceLane);
      search: for (const sourcePort of [source, ...source.alternatives]) {
        for (const fromSide of [sourceGateway, ...sides.filter((side) => side !== sourceGateway)]) {
          const from = sourceSection.gateways[fromSide];
          const outsideFrom = outsideGateway(sourceLane, fromSide);
          const a = sourceSection.grid.search(sourcePort.stub, from, { ...sourceMasks, clock: this.clock, deadline: edgeDeadline });
          if (a.timeout) { reason = "timeout"; break search; }
          if (!a.points) continue;
          for (const targetPort of [target, ...target.alternatives]) {
            for (const toSide of [targetGateway, ...sides.filter((side) => side !== targetGateway)]) {
              const to = targetSection.gateways[toSide];
              const outsideTo = outsideGateway(targetLane, toSide);
              const b = targetSection.grid.search(targetPort.stub, to, { ...targetMasks, clock: this.clock, deadline: edgeDeadline });
              if (b.timeout) { reason = "timeout"; break search; }
              if (!b.points) continue;
              if (!this.outside) { reason = "no_path"; break search; }
              const c = this.outside.search(outsideFrom, outsideTo, { ...this.outsideMasks, clock: this.clock, deadline: edgeDeadline });
              if (c.timeout) { reason = "timeout"; break search; }
              if (!c.points) continue;
              points = [sourcePort.port, ...a.points, outsideFrom, ...c.points, to, ...b.points.reverse(), targetPort.port];
              Object.assign(source, { side: sourcePort.side, port: sourcePort.port, stub: sourcePort.stub });
              Object.assign(target, { side: targetPort.side, port: targetPort.port, stub: targetPort.stub });
              break search;
            }
          }
        }
      }
      if (!points && !reason) reason = "no_path";
    }

    if (points) {
      points = simplify(points);
      const relevant = sourceSection === targetSection ? [sourceSection] : [sourceSection, targetSection];
      const context: ValidationContext = {
        cards: relevant.flatMap((section) => section.cards),
        headers: this.layout.lanes.map((lane) => topologySectionTitleObstacle(lane)),
        otherLanes: this.layout.lanes.filter((lane) => lane.id !== sourceLane.id && lane.id !== targetLane.id).map((lane) => topologyRouteObstacle(lane, TOPOLOGY_ROUTE_STROKE_MARGIN)),
        endpointLanes: relevant.map((section) => section.lane),
        frames: relevant.flatMap((section) => section.frames.map((frame) => ({ frame, sourceInside: frame.nodeIds.includes(edge.source), targetInside: frame.nodeIds.includes(edge.target) }))),
      };
      if (!safeRoute(points, edge, context)) { points = null; reason = "no_path"; }
      else {
        const slotKey = `${edge.source}:${edge.target}`;
        const slotIndex = this.twoPointSlotCounts.get(slotKey) ?? 0;
        if (points.length === 2) this.twoPointSlotCounts.set(slotKey, slotIndex + 1);
        const nudged = nudgeRoute(points, edge, context, this.channels, this.clock, edgeDeadline, slotIndex);
        points = nudged.points;
        nudgeUnresolved = nudged.unresolved;
      }
    }
    if (this.clock() >= edgeDeadline) { points = null; reason = "timeout"; }
    if (reason === "timeout") this.timedOut = true;
    if (points) {
      sourceSection.grid.record(points);
      if (targetSection !== sourceSection) { targetSection.grid.record(points); this.outside?.record(points); }
    }
    if (this.clock() >= edgeDeadline) { points = null; reason = "timeout"; this.timedOut = true; }
    if (points && !reason) {
      for (const unresolved of nudgeUnresolved) {
        const entry = this.unresolvedTwoPointSharedChannels.get(unresolved.channel) ?? { edgeIds: new Set<string>(), length: unresolved.length };
        entry.edgeIds.add(edge.id);
        entry.length = Math.max(entry.length, unresolved.length);
        this.unresolvedTwoPointSharedChannels.set(unresolved.channel, entry);
      }
    }
    const fallbackPoints = points ?? [source.port, target.port];
    const route: TopologyRoute = {
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      sourceSide: source.side,
      targetSide: target.side,
      points: fallbackPoints,
      status: reason ? "fallback" : "routed",
      ...(reason ? { renderMode: "straight" as const, fallbackStyle: "dashed" as const } : {}),
    };
    if (reason) { route.fallback = reason; this.failures.push({ edgeId: edge.id, reason }); }
    this.routes[edge.id] = route;
  }

  finish(): TopologyRouteResult {
    if (this.finished) {
      throw new Error("TopologyRouterSession already finished");
    }
    this.finished = true;
    const additional = this.extras(this.routes, Math.max(0, this.totalGridLimit - this.gridBytes));
    this.resourceLimit = additional.bundles.diagnostics.resourceLimit === true;
    const hasTimeout = this.failures.some((failure) => failure.reason === "timeout")
      || additional.bundles.diagnostics.routeFailures.some((failure) => failure.reason === "timeout")
      || this.resourceLimit;
    const status: TopologyRoutingStatus = this.resourceLimit
      ? "resource-limit"
      : hasTimeout
        ? "timeout"
        : this.failures.length
          ? "fallback"
          : "complete";
    return {
      routes: this.routes,
      ...additional,
      diagnostics: {
        unresolvedTwoPointSharedChannels: [...this.unresolvedTwoPointSharedChannels.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([channel, entry]) => ({ channel, length: entry.length, edgeIds: [...entry.edgeIds].sort(compareId) })),
        status,
        routeFailures: this.failures,
        fallbackCount: this.failures.length,
        unroutedEdgeIds: this.failures.filter((failure) => failure.reason === "timeout").map((failure) => failure.edgeId),
        elapsedMs: this.clock() - this.layoutStart,
        bundleFailures: additional.bundles.diagnostics.routeFailures,
        ...(this.resourceLimit ? { resourceLimit: true as const } : {}),
      },
    };
  }
}

export function routeTopology(topology: Topology, layout: TopologyLayoutResult, options: RouterOptions = {}): TopologyRouteResult {
  const session = new TopologyRouterSession(topology, layout, options);
  const preparedTimeout = session.prepare();
  if (preparedTimeout) return preparedTimeout;
  while (true) {
    const next = session.next(Number.POSITIVE_INFINITY);
    if (next.done) {
      if (next.result) return next.result;
      return session.finish();
    }
  }
}

export async function routeTopologyCooperative(
  topology: Topology,
  layout: TopologyLayoutResult,
  options: RouterOptions = {},
  isCancelled: () => boolean = () => false,
  chunkSize = 20,
  yieldControl: () => Promise<void> = () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  onProgress?: (progress: TopologyRouterSessionProgress) => void,
): Promise<TopologyRouteResult | undefined> {
  if (isCancelled()) return undefined;
  await yieldControl();
  if (isCancelled()) return undefined;
  const session = new TopologyRouterSession(topology, layout, options);
  const preparedTimeout = session.prepare();
  if (preparedTimeout) {
    await yieldControl();
    if (isCancelled()) return undefined;
    return preparedTimeout;
  }
  onProgress?.({ phase: "prepared", routedEdges: 0, totalEdges: session.endpoints.length, elapsedMs: session.clock() - session.layoutStart });
  await yieldControl();
  while (!isCancelled()) {
    const next = session.next(chunkSize, options.cooperativeChunkWallMs ?? 16, options.cooperativeChunkClock ?? (() => performance.now()));
    if (!next.done) onProgress?.(next.progress);
    if (next.done) {
      if (isCancelled()) return undefined;
      if (next.result) return next.result;
      break;
    }
    await yieldControl();
  }
  if (isCancelled()) return undefined;
  await yieldControl();
  if (isCancelled()) return undefined;
  onProgress?.({ phase: "extras", routedEdges: session.edgeIndex, totalEdges: session.endpoints.length, elapsedMs: session.clock() - session.layoutStart });
  const result = session.finish();
  await yieldControl();
  if (isCancelled()) return undefined;
  onProgress?.({ phase: "complete", routedEdges: session.edgeIndex, totalEdges: session.endpoints.length, elapsedMs: session.clock() - session.layoutStart });
  return result;
}
