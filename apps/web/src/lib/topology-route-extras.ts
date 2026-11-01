import type { Topology, TopologyEdge } from "@steed/api/shared";
import { TOPOLOGY_FRAME_HEADER, TOPOLOGY_SECTION_HEADER, topologyHeaderObstacle, topologyRouteObstacle, type TopologyLayoutResult } from "./topology-layout";
import {
  RoutingGrid,
  RoutingGridLimit,
  RoutingGridTimeout,
  type RoutingPoint,
  type RoutingRect,
} from "./topology-routing-grid";
import type { TopologyRoute } from "./topology-router";

export type RouteLabelFailure = "no_horizontal_segment" | "no_available_position" | "timeout";

export interface RouteLabelOptions {
  charWidth?: number;
  protocolCharWidth?: number;
  paddingX?: number;
  height?: number;
  cardMargin?: number;
  labelMargin?: number;
  positionStep?: number;
  measureText?: (text: string) => number;
  clock?: () => number;
  deadline?: number;
  layoutTimeoutMs?: number;
}

export interface RouteLabelDimensions {
  width: number;
  height: number;
  text: string;
}

export interface TopologyRouteLabel {
  edgeId: string;
  text: string;
  rect: RoutingRect | null;
  segmentIndex: number | null;
  hidden: boolean;
  reason?: RouteLabelFailure;
}

export interface TopologyRouteLabelResult {
  labels: Record<string, TopologyRouteLabel>;
  hiddenEdgeIds: string[];
}

export type BundleRouteFailureReason = "no_path" | "timeout";

export interface TopologyLayerPairBundle {
  id: string;
  layerIds: [string, string];
  count: number;
  edgeIds: string[];
  kindCounts: Record<string, number>;
  route: RoutingPoint[] | null;
  fallback?: BundleRouteFailureReason;
}

export interface TopologyLayerPairBundleResult {
  bundles: TopologyLayerPairBundle[];
  diagnostics: {
    routeFailures: Array<{ bundleId: string; reason: BundleRouteFailureReason }>;
    elapsedMs: number;
    resourceLimit?: true;
  };
}

export interface BundleRouteOptions {
  clock?: () => number;
  layoutTimeoutMs?: number;
  bundleTimeoutMs?: number;
  obstacleMargin?: number;
  deadline?: number;
  maxBytes?: number;
}

export interface TopologyBundleRouteContext {
  readonly layout: TopologyLayoutResult;
  readonly grid: RoutingGrid | null;
  readonly obstacleMargin: number;
  readonly failure?: "timeout" | "no_path";
  readonly resourceLimit?: true;
}

export const ROUTE_LABEL_HEIGHT = 22;
export const ROUTE_LABEL_PADDING_X = 8;
export const ROUTE_LABEL_CARD_MARGIN = 6;
export const ROUTE_BUNDLE_LAYOUT_TIMEOUT_MS = 1500;
export const ROUTE_BUNDLE_EDGE_TIMEOUT_MS = 20;
export const ROUTE_BUNDLE_STROKE_MARGIN = 5;
const RECT_INDEX_MAX_CELL_COUNT = 64;
const ROUTE_LABEL_MAX_CANDIDATE_STEPS = 4096;

const EDGE_KINDS = ["traffic", "dns", "binding", "deploy", "auth", "monitor", "uses", "tunnel"] as const;

function compareId(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function strictOverlap(a: RoutingRect, b: RoutingRect, margin = 0): boolean {
  return a.x < b.x + b.width + margin
    && a.x + a.width + margin > b.x
    && a.y < b.y + b.height + margin
    && a.y + a.height + margin > b.y;
}

function inflateRect(rect: RoutingRect, margin: number): RoutingRect {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
}

class RectSpatialIndex {
  private readonly cellSize: number;
  private readonly cells = new Map<string, RoutingRect[]>();
  private readonly allRects: RoutingRect[] = [];
  private readonly overflowRects: RoutingRect[] = [];

  constructor(cellSize = 128) {
    this.cellSize = Math.max(1, cellSize);
  }

  add(rect: RoutingRect): void {
    this.allRects.push(rect);
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
      this.overflowRects.push(rect);
      return;
    }

    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + rect.width) / this.cellSize);
    const y1 = Math.floor((rect.y + rect.height) / this.cellSize);
    const cellCount = (Math.max(0, x1 - x0 + 1)) * (Math.max(0, y1 - y0 + 1));
    if (cellCount > RECT_INDEX_MAX_CELL_COUNT) {
      this.overflowRects.push(rect);
      return;
    }

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = `${x}:${y}`;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(rect);
        else this.cells.set(key, [rect]);
      }
    }
  }

  overlaps(
    rect: RoutingRect,
    clock?: () => number,
    deadline?: number,
  ): boolean | null {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return false;
    if (clock && deadline !== undefined && clock() >= deadline) return null;

    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + rect.width) / this.cellSize);
    const y1 = Math.floor((rect.y + rect.height) / this.cellSize);
    const candidateCellCount = (Math.max(0, x1 - x0 + 1)) * (Math.max(0, y1 - y0 + 1));

    if (candidateCellCount > RECT_INDEX_MAX_CELL_COUNT) {
      for (let index = 0; index < this.allRects.length; index++) {
        if (index % 64 === 0 && clock && deadline !== undefined && clock() >= deadline) return null;
        const obstacle = this.allRects[index];
        if (obstacle && strictOverlap(rect, obstacle, 0)) return true;
      }
      return false;
    }

    const seen = new Set<RoutingRect>();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const bucket = this.cells.get(`${x}:${y}`);
        if (!bucket) continue;
        for (let index = 0; index < bucket.length; index++) {
          if (clock && deadline !== undefined && index % 64 === 0 && clock() >= deadline) return null;
          const obstacle = bucket[index];
          if (!obstacle || seen.has(obstacle)) continue;
          seen.add(obstacle);
          if (strictOverlap(rect, obstacle, 0)) return true;
        }
      }
    }

    for (let index = 0; index < this.overflowRects.length; index++) {
      if (clock && deadline !== undefined && index % 64 === 0 && clock() >= deadline) return null;
      const obstacle = this.overflowRects[index];
      if (obstacle && strictOverlap(rect, obstacle, 0)) return true;
    }
    return false;
  }
}

function header(rect: RoutingRect, height: number): RoutingRect {
  return topologyHeaderObstacle(rect, height);
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

function intersects(a: RoutingPoint, b: RoutingPoint, rect: RoutingRect): boolean {
  if (a.x === b.x) {
    return a.x > rect.x && a.x < rect.x + rect.width
      && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height;
  }
  if (a.y === b.y) {
    return a.y > rect.y && a.y < rect.y + rect.height
      && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width;
  }
  return true;
}

export function formatRouteLabelText(edge: TopologyEdge): string {
  const base = edge.label.trim() || edge.kind;
  const protocol = edge.protocol?.trim();
  const protocolPort = protocol
    ? `${protocol}${edge.port !== undefined ? ` :${edge.port}` : ""}`
    : edge.port !== undefined
      ? `:${edge.port}`
      : "";
  return protocolPort ? `${base} · ${protocolPort}` : base;
}

export function reserveRouteLabelDimensions(edge: TopologyEdge, options: RouteLabelOptions = {}): RouteLabelDimensions {
  const text = formatRouteLabelText(edge);
  const height = options.height ?? ROUTE_LABEL_HEIGHT;
  const paddingX = options.paddingX ?? ROUTE_LABEL_PADDING_X;
  if (options.measureText) {
    return { width: Math.ceil(options.measureText(text)) + paddingX * 2, height, text };
  }
  const charWidth = options.charWidth ?? 7;
  const protocolCharWidth = options.protocolCharWidth ?? 8;
  const base = edge.label.trim() || edge.kind;
  const protocolPort = edge.protocol?.trim()
    ? `${edge.protocol.trim()}${edge.port !== undefined ? ` :${edge.port}` : ""}`
    : edge.port !== undefined
      ? `:${edge.port}`
      : "";
  const width = base.length * charWidth
    + (protocolPort ? 3 * charWidth + protocolPort.length * protocolCharWidth : 0)
    + paddingX * 2;
  return { width: Math.ceil(width), height, text };
}

function timeoutRouteLabelResult(
  edges: readonly TopologyEdge[],
): TopologyRouteLabelResult {
  const labels = Object.create(null) as Record<string, TopologyRouteLabel>;
  const hiddenEdgeIds: string[] = [];
  for (const edge of [...edges].sort((a, b) => compareId(a.id, b.id))) {
    labels[edge.id] = {
      edgeId: edge.id,
      text: formatRouteLabelText(edge),
      rect: null,
      segmentIndex: null,
      hidden: true,
      reason: "timeout",
    };
    hiddenEdgeIds.push(edge.id);
  }
  return { labels, hiddenEdgeIds };
}

function boundedLabelCandidates(
  left: number,
  right: number,
  centerOffset: number,
  positionStep: number,
  clock: () => number,
  deadline: number,
): number[] | null {
  const candidates = new Set<number>([Math.round(centerOffset), Math.round(left), Math.round(right)]);
  let iterations = 0;
  for (let x = left; x <= right; x += positionStep) {
    if (clock() >= deadline) return null;
    iterations++;
    if (iterations > ROUTE_LABEL_MAX_CANDIDATE_STEPS) return null;
    candidates.add(Math.round(x));
    if (candidates.size > ROUTE_LABEL_MAX_CANDIDATE_STEPS) return null;
  }
  return [...candidates]
    .filter((x) => x >= left && x <= right)
    .sort((a, b) => Math.abs(a - centerOffset) - Math.abs(b - centerOffset) || a - b);
}

export function placeTopologyRouteLabels(
  edges: readonly TopologyEdge[],
  routes: Record<string, TopologyRoute>,
  layout: TopologyLayoutResult,
  options: RouteLabelOptions = {},
): TopologyRouteLabelResult {
  const cardMargin = options.cardMargin ?? ROUTE_LABEL_CARD_MARGIN;
  const labelMargin = options.labelMargin ?? 6;
  const positionStep = Number.isFinite(options.positionStep) && (options.positionStep ?? 0) > 0
    ? options.positionStep ?? 8
    : 8;
  const clock = options.clock ?? (() => performance.now());
  const labelStart = clock();
  const deadline = options.deadline ?? labelStart + (options.layoutTimeoutMs ?? ROUTE_BUNDLE_LAYOUT_TIMEOUT_MS);
  const labels = Object.create(null) as Record<string, TopologyRouteLabel>;
  const routeLookup = Object.assign(Object.create(null) as Record<string, TopologyRoute>, routes);
  const hiddenEdgeIds: string[] = [];
  const sortedEdges = [...edges].sort((a, b) => compareId(a.id, b.id));
  if (clock() >= deadline) return timeoutRouteLabelResult(sortedEdges);
  const cards = Object.values(layout.positions).map((position) => inflateRect(position, cardMargin));
  const headers = [
    ...layout.lanes.map((lane) => header(lane, TOPOLOGY_SECTION_HEADER)),
    ...layout.frames.map((frame) => header(frame, TOPOLOGY_FRAME_HEADER)),
  ];
  const obstacleIndex = new RectSpatialIndex();
  for (const obstacle of [...cards, ...headers]) {
    if (clock() >= deadline) return timeoutRouteLabelResult(sortedEdges);
    obstacleIndex.add(obstacle);
  }

  for (const edge of sortedEdges) {
    if (clock() >= deadline) {
      const timeoutLabel: TopologyRouteLabel = {
        edgeId: edge.id,
        text: formatRouteLabelText(edge),
        rect: null,
        segmentIndex: null,
        hidden: true,
        reason: "timeout",
      };
      labels[edge.id] = timeoutLabel;
      hiddenEdgeIds.push(edge.id);
      continue;
    }
    const route = routeLookup[edge.id];
    const textDimensions = reserveRouteLabelDimensions(edge, options);
    let result: TopologyRouteLabel = {
      edgeId: edge.id,
      text: textDimensions.text,
      rect: null,
      segmentIndex: null,
      hidden: true,
      reason: "no_horizontal_segment",
    };

    if (![textDimensions.width, textDimensions.height].every(Number.isFinite)
      || textDimensions.width <= 0
      || textDimensions.height <= 0
      || textDimensions.width > layout.width
      || textDimensions.height > layout.height) {
      result.reason = "no_available_position";
      labels[edge.id] = result;
      hiddenEdgeIds.push(edge.id);
      continue;
    }

    if (route && route.fallback === undefined) {
      if (clock() >= deadline) {
        result.reason = "timeout";
        labels[edge.id] = result;
        hiddenEdgeIds.push(edge.id);
        continue;
      }
      const horizontal = route.points
        .map((point, index) => ({ point, index }))
        .slice(0, -1)
        .flatMap(({ point, index }) => {
          const next = route.points[index + 1];
          if (!next || point.y !== next.y) return [];
          const length = Math.abs(next.x - point.x);
          if (length < textDimensions.width) return [];
          if (![point.x, point.y, next.x, next.y, length].every(Number.isFinite)) return [];
          if (Math.min(point.x, next.x) < 0
            || Math.max(point.x, next.x) > layout.width
            || point.y < 0
            || point.y > layout.height
            || next.y < 0
            || next.y > layout.height) return [];
          return [{ index, y: point.y, x0: Math.min(point.x, next.x), x1: Math.max(point.x, next.x), length }];
        })
        .sort((a, b) => b.length - a.length || a.y - b.y || a.x0 - b.x0 || a.index - b.index);

      if (horizontal.length) {
        let placed = false;
        for (const segment of horizontal) {
          if (clock() >= deadline) {
            result.reason = "timeout";
            break;
          }
          const center = segment.x0 + (segment.x1 - segment.x0) / 2;
          const left = segment.x0;
          const right = segment.x1 - textDimensions.width;
          const sorted = boundedLabelCandidates(
            left,
            right,
            center - textDimensions.width / 2,
            positionStep,
            clock,
            deadline,
          );
          if (sorted === null) {
            result.reason = "timeout";
            break;
          }

          for (const x of sorted) {
            if (clock() >= deadline) {
              result.reason = "timeout";
              break;
            }
            const rect: RoutingRect = { x, y: segment.y - textDimensions.height / 2, width: textDimensions.width, height: textDimensions.height };
            if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
              || rect.width <= 0
              || rect.height <= 0
              || rect.x < 0
              || rect.y < 0
              || rect.x + rect.width > layout.width
              || rect.y + rect.height > layout.height) continue;
            if (obstacleIndex.overlaps(rect)) continue;
            result = { edgeId: edge.id, text: textDimensions.text, rect, segmentIndex: segment.index, hidden: false };
            if (clock() >= deadline) {
              result = { edgeId: edge.id, text: textDimensions.text, rect: null, segmentIndex: null, hidden: true, reason: "timeout" };
              break;
            }
            obstacleIndex.add(inflateRect(rect, labelMargin));
            placed = true;
            break;
          }
          if (placed || result.reason === "timeout") break;
        }
        if (!placed && result.reason !== "timeout") result.reason = "no_available_position";
      }
    }

    if (clock() >= deadline && result.reason !== "timeout") {
      result = { edgeId: edge.id, text: result.text, rect: null, segmentIndex: null, hidden: true, reason: "timeout" };
    }
    labels[edge.id] = result;
    if (result.hidden && !hiddenEdgeIds.includes(edge.id)) hiddenEdgeIds.push(edge.id);
  }

  return { labels, hiddenEdgeIds };
}

export const placeRouteLabels = placeTopologyRouteLabels;

function laneMidpoint(lane: { x: number; y: number; width: number; height: number }): RoutingPoint {
  return { x: lane.x + lane.width / 2, y: lane.y + lane.height / 2 };
}

function bundlePorts(source: { x: number; y: number; width: number; height: number }, target: { x: number; y: number; width: number; height: number }): [RoutingPoint, RoutingPoint] {
  const a = laneMidpoint(source);
  const b = laneMidpoint(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (!horizontal && dy > 0) {
    const targetRight = dx >= 0;
    const targetY = Math.max(target.y + TOPOLOGY_SECTION_HEADER + 1, Math.round(b.y));
    return [
      { x: Math.round(a.x), y: source.y + source.height },
      { x: targetRight ? target.x : target.x + target.width, y: targetY },
    ];
  }
  if (!horizontal && dy < 0) {
    const sourceRight = dx >= 0;
    const sourceY = Math.max(source.y + TOPOLOGY_SECTION_HEADER + 1, Math.round(a.y));
    return [
      { x: sourceRight ? source.x + source.width : source.x, y: sourceY },
      { x: Math.round(b.x), y: target.y + target.height },
    ];
  }
  const sourceRight = dx >= 0;
  const y = Math.max(source.y + TOPOLOGY_SECTION_HEADER + 1, Math.round(a.y));
  const targetY = Math.max(target.y + TOPOLOGY_SECTION_HEADER + 1, Math.round(b.y));
  return [
    { x: sourceRight ? source.x + source.width : source.x, y },
    { x: sourceRight ? target.x : target.x + target.width, y: targetY },
  ];
}

function outsideBundlePort(lane: { x: number; y: number; width: number; height: number }, port: RoutingPoint): RoutingPoint {
  const clearance = ROUTE_BUNDLE_STROKE_MARGIN + 1;
  if (port.x === lane.x) return { x: port.x - clearance, y: port.y };
  if (port.x === lane.x + lane.width) return { x: port.x + clearance, y: port.y };
  if (port.y === lane.y + lane.height) return { x: port.x, y: port.y + clearance };
  return { x: port.x, y: port.y - clearance };
}

function fallbackBundleRoute(sourceLane: { x: number; y: number; width: number; height: number }, targetLane: { x: number; y: number; width: number; height: number }): RoutingPoint[] {
  const [sourcePort, targetPort] = bundlePorts(sourceLane, targetLane);
  return [sourcePort, targetPort];
}

function safeBundleRoute(
  points: RoutingPoint[],
  layout: TopologyLayoutResult,
  sourceLaneId: string,
  targetLaneId: string,
): boolean {
  const sourceLane = layout.lanes.find((lane) => lane.id === sourceLaneId);
  const targetLane = layout.lanes.find((lane) => lane.id === targetLaneId);
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) return false;
    if (a.x !== b.x && a.y !== b.y) return false;

    for (const lane of layout.lanes) {
      if (lane.id === sourceLaneId || lane.id === targetLaneId) continue;
      if (intersects(a, b, topologyRouteObstacle(lane, ROUTE_BUNDLE_STROKE_MARGIN))) return false;
      if (intersects(a, b, topologyRouteObstacle({ ...lane, height: TOPOLOGY_SECTION_HEADER }, ROUTE_BUNDLE_STROKE_MARGIN))) return false;
    }
    for (const frame of layout.frames) {
      if (intersects(a, b, topologyRouteObstacle({ ...frame, height: TOPOLOGY_FRAME_HEADER }, ROUTE_BUNDLE_STROKE_MARGIN))) return false;
      if (intersects(a, b, topologyRouteObstacle(frame, ROUTE_BUNDLE_STROKE_MARGIN))) return false;
    }
    for (const rect of Object.values(layout.positions)) {
      if (intersects(a, b, inflateRect(rect, ROUTE_LABEL_CARD_MARGIN))) return false;
    }

    if (sourceLane && intersects(a, b, topologyRouteObstacle({ ...sourceLane, height: TOPOLOGY_SECTION_HEADER }, ROUTE_BUNDLE_STROKE_MARGIN))) return false;
    if (targetLane && intersects(a, b, topologyRouteObstacle({ ...targetLane, height: TOPOLOGY_SECTION_HEADER }, ROUTE_BUNDLE_STROKE_MARGIN))) return false;
  }
  return true;
}

export function createTopologyBundleRouteContext(
  layout: TopologyLayoutResult,
  options: BundleRouteOptions = {},
): TopologyBundleRouteContext {
  const clock = options.clock ?? (() => performance.now());
  const start = clock();
  const deadline = options.deadline ?? start + (options.layoutTimeoutMs ?? ROUTE_BUNDLE_LAYOUT_TIMEOUT_MS);
  const obstacleMargin = options.obstacleMargin ?? 12;
  if (clock() >= deadline) return { layout, grid: null, obstacleMargin, failure: "timeout" };

  const obstacles: RoutingRect[] = [];
  for (const lane of layout.lanes) obstacles.push(topologyRouteObstacle(lane, ROUTE_BUNDLE_STROKE_MARGIN));
  for (const lane of layout.lanes) obstacles.push(topologyRouteObstacle({ ...lane, height: TOPOLOGY_SECTION_HEADER }, ROUTE_BUNDLE_STROKE_MARGIN));

  const points: RoutingPoint[] = [{ x: -160, y: -160 }, { x: layout.width + 160, y: layout.height + 160 }];
  for (const lane of layout.lanes) {
    points.push({ x: lane.x, y: lane.y }, { x: lane.x + lane.width, y: lane.y + lane.height });
  }
  for (const sourceLane of layout.lanes) {
    for (const targetLane of layout.lanes) {
      if (sourceLane.id === targetLane.id) continue;
      const [sourcePort, targetPort] = bundlePorts(sourceLane, targetLane);
      points.push(outsideBundlePort(sourceLane, sourcePort), outsideBundlePort(targetLane, targetPort));
    }
  }

  try {
    const grid = new RoutingGrid(obstacles, [], points, {
      clock,
      deadline,
      maxBytes: options.maxBytes,
    });
    if (clock() >= deadline) return { layout, grid: null, obstacleMargin, failure: "timeout" };
    return { layout, grid, obstacleMargin };
  } catch (error) {
    if (error instanceof RoutingGridTimeout) return { layout, grid: null, obstacleMargin, failure: "timeout" };
    if (error instanceof RoutingGridLimit) return { layout, grid: null, obstacleMargin, failure: "no_path", resourceLimit: true };
    return { layout, grid: null, obstacleMargin, failure: "no_path" };
  }
}

export function routeTopologyLayerPairBundleFromContext(
  context: TopologyBundleRouteContext,
  sourceLaneId: string,
  targetLaneId: string,
  options: BundleRouteOptions = {},
): { points: RoutingPoint[] | null; fallback?: BundleRouteFailureReason } {
  const { layout } = context;
  const sourceLane = layout.lanes.find((lane) => lane.id === sourceLaneId);
  const targetLane = layout.lanes.find((lane) => lane.id === targetLaneId);
  if (!context.grid) {
    if (sourceLane && targetLane) return { points: fallbackBundleRoute(sourceLane, targetLane), fallback: context.failure ?? "no_path" };
    return { points: null, fallback: context.failure ?? "no_path" };
  }
  if (!sourceLane || !targetLane) return { points: null, fallback: "no_path" };

  const clock = options.clock ?? (() => performance.now());
  const start = clock();
  const perBundleDeadline = start + (options.bundleTimeoutMs ?? ROUTE_BUNDLE_EDGE_TIMEOUT_MS);
  const deadline = options.deadline === undefined ? perBundleDeadline : Math.min(options.deadline, perBundleDeadline);
  if (clock() >= deadline) return { points: fallbackBundleRoute(sourceLane, targetLane), fallback: "timeout" };
  const [sourcePort, targetPort] = bundlePorts(sourceLane, targetLane);
  const outsideSourcePort = outsideBundlePort(sourceLane, sourcePort);
  const outsideTargetPort = outsideBundlePort(targetLane, targetPort);
  let result: { points: RoutingPoint[] | null; timeout: boolean };
  try {
    result = context.grid.search(outsideSourcePort, outsideTargetPort, {
      forbidden: new Uint32Array(),
      required: new Uint32Array(),
      clock,
      deadline,
    });
  } catch (error) {
    if (error instanceof RoutingGridTimeout) return { points: fallbackBundleRoute(sourceLane, targetLane), fallback: "timeout" };
    if (error instanceof RoutingGridLimit) return { points: fallbackBundleRoute(sourceLane, targetLane), fallback: "no_path" };
    return { points: fallbackBundleRoute(sourceLane, targetLane), fallback: "no_path" };
  }
  if (result.timeout) return { points: fallbackBundleRoute(sourceLane, targetLane), fallback: "timeout" };
  if (!result.points) return { points: fallbackBundleRoute(sourceLane, targetLane), fallback: "no_path" };

  if (clock() >= deadline) return { points: fallbackBundleRoute(sourceLane, targetLane), fallback: "timeout" };
  const route = simplify([sourcePort, outsideSourcePort, ...result.points, outsideTargetPort, targetPort]);
  if (clock() >= deadline) return { points: fallbackBundleRoute(sourceLane, targetLane), fallback: "timeout" };
  if (!safeBundleRoute(route, layout, sourceLaneId, targetLaneId)) return { points: fallbackBundleRoute(sourceLane, targetLane), fallback: "no_path" };
  if (clock() >= deadline) return { points: fallbackBundleRoute(sourceLane, targetLane), fallback: "timeout" };
  return { points: route };
}

export function routeTopologyLayerPairBundle(
  sourceLaneId: string,
  targetLaneId: string,
  layout: TopologyLayoutResult,
  options: BundleRouteOptions = {},
): { points: RoutingPoint[] | null; fallback?: BundleRouteFailureReason } {
  const context = createTopologyBundleRouteContext(layout, options);
  return routeTopologyLayerPairBundleFromContext(context, sourceLaneId, targetLaneId, options);
}

export function buildTopologyLayerPairBundles(
  topology: Topology,
  layout: TopologyLayoutResult,
  visibleEdges: readonly TopologyEdge[] = topology.edges,
  options: BundleRouteOptions = {},
): TopologyLayerPairBundleResult {
  const clock = options.clock ?? (() => performance.now());
  const layoutStart = clock();
  const layoutDeadline = options.deadline ?? layoutStart + (options.layoutTimeoutMs ?? ROUTE_BUNDLE_LAYOUT_TIMEOUT_MS);
  const laneByNode = new Map<string, string>();
  for (const lane of layout.lanes) for (const nodeId of lane.nodeIds) laneByNode.set(nodeId, lane.id);

  const grouped = new Map<string, { layerIds: [string, string]; edgeIds: string[]; kindCounts: Record<string, number>; edges: TopologyEdge[] }>();
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node]));
  const laneById = new Map(layout.lanes.map((lane) => [lane.id, lane]));
  const laneByLayer = new Map(layout.lanes.map((lane) => [lane.layerId, lane]));

  for (const edge of visibleEdges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) continue;
    const sourceLaneId = laneByNode.get(edge.source) ?? laneByLayer.get(sourceNode.layerId)?.id;
    const targetLaneId = laneByNode.get(edge.target) ?? laneByLayer.get(targetNode.layerId)?.id;
    if (!sourceLaneId || !targetLaneId || sourceLaneId === targetLaneId) continue;

    const sourceLane = laneById.get(sourceLaneId);
    const targetLane = laneById.get(targetLaneId);
    if (!sourceLane || !targetLane) continue;
    const pair = [sourceLane.layerId, targetLane.layerId].sort(compareId);
    const key = `${pair[0]}:${pair[1]}`;
    const kindCounts = Object.create(null) as Record<string, number>;
    for (const kind of EDGE_KINDS) kindCounts[kind] = 0;
    const group = grouped.get(key) ?? {
      layerIds: pair as [string, string],
      edgeIds: [],
      kindCounts,
      edges: [],
    };
    group.edgeIds.push(edge.id);
    group.kindCounts[edge.kind] = (group.kindCounts[edge.kind] ?? 0) + 1;
    group.edges.push(edge);
    grouped.set(key, group);
  }

  const bundles: TopologyLayerPairBundle[] = [];
  const routeFailures: Array<{ bundleId: string; reason: BundleRouteFailureReason }> = [];
  let resourceLimit = false;
  const bundleContext = clock() >= layoutDeadline
    ? null
    : createTopologyBundleRouteContext(layout, { ...options, clock, deadline: layoutDeadline });
  for (const { layerIds, edgeIds, kindCounts } of [...grouped.values()].sort((a, b) => compareId(a.layerIds[0], b.layerIds[0]) || compareId(a.layerIds[1], b.layerIds[1]))) {
    const edgeIdsSorted = [...new Set(edgeIds)].sort(compareId);
    const id = `bundle:${layerIds[0]}:${layerIds[1]}`;
    const sourceLane = layout.lanes.find((lane) => lane.layerId === layerIds[0]);
    const targetLane = layout.lanes.find((lane) => lane.layerId === layerIds[1]);
    let route: RoutingPoint[] | null = null;
    let fallback: BundleRouteFailureReason | undefined;

    if (clock() >= layoutDeadline) {
      fallback = "timeout";
      if (sourceLane && targetLane) route = fallbackBundleRoute(sourceLane, targetLane);
    } else if (!bundleContext) {
      fallback = "timeout";
      if (sourceLane && targetLane) route = fallbackBundleRoute(sourceLane, targetLane);
    } else if (!bundleContext.grid) {
      fallback = bundleContext.failure ?? "no_path";
      if (sourceLane && targetLane) route = fallbackBundleRoute(sourceLane, targetLane);
      if (bundleContext.resourceLimit) resourceLimit = true;
    } else if (sourceLane && targetLane) {
      const result = routeTopologyLayerPairBundleFromContext(bundleContext, sourceLane.id, targetLane.id, {
        ...options,
        clock,
        deadline: layoutDeadline,
        bundleTimeoutMs: Math.min(options.bundleTimeoutMs ?? ROUTE_BUNDLE_EDGE_TIMEOUT_MS, Math.max(0, layoutDeadline - clock())),
      });
      route = result.points;
      fallback = result.fallback;
    } else {
      fallback = "no_path";
    }

    if (fallback) routeFailures.push({ bundleId: id, reason: fallback });
    bundles.push({ id, layerIds, count: edgeIdsSorted.length, edgeIds: edgeIdsSorted, kindCounts, route, ...(fallback ? { fallback } : {}) });
  }

  return {
    bundles,
    diagnostics: {
      routeFailures,
      elapsedMs: clock() - layoutStart,
      ...(resourceLimit ? { resourceLimit: true as const } : {}),
    },
  };
}

export const buildLayerPairBundles = buildTopologyLayerPairBundles;
