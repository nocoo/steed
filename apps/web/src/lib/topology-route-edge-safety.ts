import { TOPOLOGY_FRAME_HEADER, TOPOLOGY_SECTION_HEADER, type TopologyLayoutFrame, type TopologyLayoutLane, type TopologyLayoutPosition } from "./topology-layout";
import type { RoutingPoint, RoutingRect } from "./topology-routing-grid";

export const TOPOLOGY_FALLBACK_STROKE_MARGIN = 8;
const FALLBACK_SPATIAL_CELL_SIZE = 128;
const FALLBACK_MAX_SEGMENT_COUNT = 4096;
const FALLBACK_MAX_CANDIDATES = 4096;
const FALLBACK_MAX_EDGE_CHECKED_RECT_COUNT = 4096;
const EPSILON = 1e-7;

export type TopologyFallbackStyle = "dashed" | "faded";
export type TopologyFallbackReason = "no_path" | "timeout";

export interface TopologyFallbackSafetyRect extends RoutingRect {
  kind: "section-title" | "frame-title" | "section" | "frame" | "card";
  laneId?: string;
  frameId?: string;
  nodeId?: string;
  edgeId?: string;
  frameNodeIds?: string[];
}

export interface TopologyFallbackSplitOptions {
  strokeMargin?: number;
  clock?: () => number;
  deadline?: number;
  maxCheckedRectCount?: number;
}

export interface TopologyFallbackPreviewOptions extends TopologyFallbackSplitOptions {
  maxCheckedRectCount?: number;
  maxCandidatesPerSegment?: number;
}

export interface TopologyFallbackMarkerOptions {
  index?: TopologyFallbackRectIndex;
  strokeWidth?: number;
  markerWidth?: number;
  markerHeight?: number;
  sourceId?: string;
  targetId?: string;
}

export interface TopologyFallbackSplitResult {
  segments: Array<{ a: RoutingPoint; b: RoutingPoint }>;
  timeout: boolean;
  geometryUnavailable: boolean;
  checkedRectCount: number;
  visibleSegmentCount: number;
  hiddenSegmentCount: number;
}

export interface TopologyFallbackMarkerVisibility {
  markerStart: boolean;
  markerEnd: boolean;
}

function strictFiniteRect(rect: RoutingRect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width >= 0
    && rect.height >= 0;
}

function strictOverlap(a: RoutingRect, b: RoutingRect, margin = 0): boolean {
  return a.x < b.x + b.width + margin
    && a.x + a.width + margin > b.x
    && a.y < b.y + b.height + margin
    && a.y + a.height + margin > b.y;
}

function inflateFallbackRect(rect: RoutingRect, margin: number): RoutingRect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

function rectKey(x: number, y: number): string {
  return `${x}:${y}`;
}

export class TopologyFallbackRectIndex {
  private readonly cells = new Map<string, TopologyFallbackSafetyRect[]>();
  private readonly overflow: TopologyFallbackSafetyRect[] = [];
  private readonly rects: TopologyFallbackSafetyRect[] = [];
  private laneByNode = new Map<string, TopologyLayoutLane>();
  private readonly labelRects = new Map<string, RoutingRect>();
  private readonly labelCells = new Map<string, Array<{ edgeId: string; rect: RoutingRect }>>();

  constructor(private readonly cellSize = FALLBACK_SPATIAL_CELL_SIZE) {}

  rectCount(): number {
    return this.rects.length;
  }

  setLaneByNode(laneByNode: Map<string, TopologyLayoutLane>): void {
    this.laneByNode = laneByNode;
  }

  add(rect: TopologyFallbackSafetyRect): void {
    this.rects.push(rect);
    if (!strictFiniteRect(rect)) {
      this.overflow.push(rect);
      return;
    }
    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + rect.width) / this.cellSize);
    const y1 = Math.floor((rect.y + rect.height) / this.cellSize);
    const count = (Math.max(0, x1 - x0 + 1)) * (Math.max(0, y1 - y0 + 1));
    if (count > 64) {
      this.overflow.push(rect);
      return;
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = rectKey(x, y);
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(rect);
        else this.cells.set(key, [rect]);
      }
    }
  }

  candidates(rect: RoutingRect): TopologyFallbackSafetyRect[] {
    this.candidateLimitExceeded = false;
    if (!strictFiniteRect(rect)) {
      this.candidateLimitExceeded = true;
      return [];
    }
    for (const item of this.overflow) {
      if (!strictFiniteRect(item)) {
        this.candidateLimitExceeded = true;
        return [];
      }
    }

    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + rect.width) / this.cellSize);
    const y1 = Math.floor((rect.y + rect.height) / this.cellSize);
    const cellCount = (Math.max(0, x1 - x0 + 1)) * (Math.max(0, y1 - y0 + 1));
    const result: TopologyFallbackSafetyRect[] = [];
    const seen = new Set<string>();
    const seenItems = new Set<TopologyFallbackSafetyRect>();

    if (cellCount > FALLBACK_MAX_CANDIDATES) {
      for (const item of this.rects) {
        if (!strictFiniteRect(item)) {
          this.candidateLimitExceeded = true;
          return [];
        }
        if (!strictOverlap(item, rect, 0)) continue;
        const key = this.rectIdentity(item);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(item);
        if (result.length > FALLBACK_MAX_CANDIDATES) {
          this.candidateLimitExceeded = true;
          return [];
        }
      }
      return result;
    }

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const bucket = this.cells.get(rectKey(x, y));
        if (!bucket) continue;
        for (const item of bucket) {
          if (!strictFiniteRect(item)) {
            this.candidateLimitExceeded = true;
            return [];
          }
          if (!strictOverlap(item, rect, 0)) continue;
          if (seenItems.has(item)) continue;
          seenItems.add(item);
          const key = this.rectIdentity(item);
          if (seen.has(key)) continue;
          seen.add(key);
          result.push(item);
          if (result.length > FALLBACK_MAX_CANDIDATES) {
            this.candidateLimitExceeded = true;
            return [];
          }
        }
      }
    }

    for (const item of this.overflow) {
      if (!strictFiniteRect(item)) {
        this.candidateLimitExceeded = true;
        return [];
      }
      if (!strictOverlap(item, rect, 0)) continue;
      const key = this.rectIdentity(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
      if (result.length > FALLBACK_MAX_CANDIDATES) {
        this.candidateLimitExceeded = true;
        return [];
      }
    }
    return result;
  }

  candidateLimitExceeded = false;

  private rectIdentity(rect: TopologyFallbackSafetyRect): string {
    return `${rect.kind}:${rect.x}:${rect.y}:${rect.width}:${rect.height}:${rect.laneId ?? ""}:${rect.frameId ?? ""}:${rect.nodeId ?? ""}:${rect.edgeId ?? ""}`;
  }

  private deduplicateRects(rects: readonly TopologyFallbackSafetyRect[]): TopologyFallbackSafetyRect[] {
    const seen = new Set<string>();
    const result: TopologyFallbackSafetyRect[] = [];
    for (const rect of rects) {
      const key = this.rectIdentity(rect);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(rect);
    }
    return result;
  }

  get candidateLimitWasExceeded(): boolean {
    return this.candidateLimitExceeded;
  }

  addLabelRect(edgeId: string, rect: RoutingRect, margin = 2): void {
    this.releaseLabelRect(edgeId);
    if (!strictFiniteRect(rect)) return;
    const labelRect = inflateFallbackRect(rect, margin);
    this.labelRects.set(edgeId, labelRect);
    const x0 = Math.floor(labelRect.x / this.cellSize);
    const y0 = Math.floor(labelRect.y / this.cellSize);
    const x1 = Math.floor((labelRect.x + labelRect.width) / this.cellSize);
    const y1 = Math.floor((labelRect.y + labelRect.height) / this.cellSize);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = rectKey(x, y);
        const bucket = this.labelCells.get(key);
        const item = { edgeId, rect: labelRect };
        if (bucket) bucket.push(item);
        else this.labelCells.set(key, [item]);
      }
    }
  }

  reserveLabelRect(edgeId: string, rect: RoutingRect, margin = 2): void {
    this.addLabelRect(edgeId, rect, margin);
  }

  releaseLabelRect(edgeId: string): void {
    const rect = this.labelRects.get(edgeId);
    if (!rect) return;
    this.labelRects.delete(edgeId);
    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + rect.width) / this.cellSize);
    const y1 = Math.floor((rect.y + rect.height) / this.cellSize);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = rectKey(x, y);
        const bucket = this.labelCells.get(key);
        if (!bucket) continue;
        const remaining = bucket.filter((item) => item.edgeId !== edgeId);
        if (remaining.length) this.labelCells.set(key, remaining);
        else this.labelCells.delete(key);
      }
    }
  }

  labelRectCount(): number {
    return this.labelRects.size;
  }

  private labelCandidates(rect: RoutingRect): Array<{ edgeId: string; rect: RoutingRect }> {
    if (!strictFiniteRect(rect)) return [];
    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + rect.width) / this.cellSize);
    const y1 = Math.floor((rect.y + rect.height) / this.cellSize);
    const result: Array<{ edgeId: string; rect: RoutingRect }> = [];
    const seen = new Set<string>();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        for (const item of this.labelCells.get(rectKey(x, y)) ?? []) {
          if (seen.has(item.edgeId)) continue;
          seen.add(item.edgeId);
          if (strictOverlap(item.rect, rect, 0)) result.push(item);
        }
      }
    }
    return result;
  }

  protectedCandidates(rect: RoutingRect, sourceId: string, targetId: string): TopologyFallbackSafetyRect[] {
    const sourceLane = this.laneByNode.get(sourceId);
    const targetLane = this.laneByNode.get(targetId);
    return this.candidates(rect).filter((candidate) => {
      if (candidate.kind === "section-title" || candidate.kind === "frame-title") return true;
      if (candidate.kind === "section") return candidate.laneId !== sourceLane?.id && candidate.laneId !== targetLane?.id;
      if (candidate.kind === "frame") return !candidate.frameNodeIds?.includes(sourceId) && !candidate.frameNodeIds?.includes(targetId);
      if (candidate.kind === "card") return candidate.nodeId !== sourceId && candidate.nodeId !== targetId;
      return true;
    });
  }

  candidatesExceeded(): boolean {
    return this.candidateLimitExceeded;
  }

  overlapsProtectedEnvelope(rect: RoutingRect, sourceId: string, targetId: string, margin = 0): boolean {
    const candidates = this.protectedCandidates(inflateFallbackRect(rect, margin), sourceId, targetId);
    if (this.candidateLimitExceeded) return true;
    for (const candidate of candidates) {
      if (strictOverlap(candidate, rect, 0)) return true;
    }
    return false;
  }

  overlapsLabelEnvelope(rect: RoutingRect, sourceId: string, targetId: string, margin = 0, ignoredEdgeId?: string): boolean {
    const sourceLane = this.laneByNode.get(sourceId);
    const targetLane = this.laneByNode.get(targetId);
    const candidates = this.candidates(inflateFallbackRect(rect, margin));
    if (this.candidateLimitExceeded) return true;
    for (const label of this.labelCandidates(inflateFallbackRect(rect, margin))) {
      if (label.edgeId === ignoredEdgeId) continue;
      if (strictOverlap(label.rect, rect, 0)) return true;
    }
    for (const candidate of candidates) {
      if (!strictOverlap(candidate, rect, 0)) continue;
      if (candidate.kind === "section-title" || candidate.kind === "frame-title") return true;
      if (candidate.kind === "card") return true;
      if (candidate.kind === "section") {
        const belongsToEndpoint = candidate.laneId === sourceLane?.id || candidate.laneId === targetLane?.id;
        if (!belongsToEndpoint) return true;
        continue;
      }
      if (candidate.kind === "frame") {
        const belongsToEndpoint = candidate.frameNodeIds?.includes(sourceId) || candidate.frameNodeIds?.includes(targetId);
        if (!belongsToEndpoint) return true;
      }
    }
    return false;
  }
}

export function createTopologyFallbackRectIndex(
  layout: { lanes: TopologyLayoutLane[]; frames: TopologyLayoutFrame[]; positions: Record<string, TopologyLayoutPosition> },
  laneByNode: Map<string, TopologyLayoutLane>,
  margin = TOPOLOGY_FALLBACK_STROKE_MARGIN,
): TopologyFallbackRectIndex {
  const index = new TopologyFallbackRectIndex();
  index.setLaneByNode(laneByNode);
  const rects: TopologyFallbackSafetyRect[] = [];
  for (const lane of layout.lanes) {
    rects.push({ kind: "section-title", laneId: lane.id, x: lane.x, y: lane.y, width: lane.width, height: TOPOLOGY_SECTION_HEADER });
    rects.push({ kind: "section", laneId: lane.id, x: lane.x, y: lane.y, width: lane.width, height: lane.height });
  }
  for (const frame of layout.frames) {
    rects.push({ kind: "frame-title", frameId: frame.id, frameNodeIds: frame.nodeIds, x: frame.x, y: frame.y, width: frame.width, height: TOPOLOGY_FRAME_HEADER });
    rects.push({ kind: "frame", frameId: frame.id, frameNodeIds: frame.nodeIds, x: frame.x, y: frame.y, width: frame.width, height: frame.height });
  }
  for (const [nodeId, rect] of Object.entries(layout.positions)) {
    rects.push({ kind: "card", nodeId, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
  for (const rect of rects) {
    index.add({
      ...rect,
      ...inflateFallbackRect(rect, margin),
    });
  }
  return index;
}

function clipSegmentToRect(a: RoutingPoint, b: RoutingPoint, rect: RoutingRect): [number, number] | null {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || !strictFiniteRect(rect)) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - rect.x, rect.x + rect.width - a.x, a.y - rect.y, rect.y + rect.height - a.y];
  for (let index = 0; index < 4; index++) {
    const pValue = p[index];
    const qValue = q[index];
    if (pValue === undefined || qValue === undefined) continue;
    if (pValue === 0) {
      if (qValue < 0) return null;
      continue;
    }
    const ratio = qValue / pValue;
    if (pValue < 0) {
      if (ratio > t1) return null;
      if (ratio > t0) t0 = ratio;
    } else {
      if (ratio < t0) return null;
      if (ratio < t1) t1 = ratio;
    }
  }
  if (t0 > t1) return null;
  return [Math.max(0, t0), Math.min(1, t1)];
}

function subtractIntervals(length: number, forbidden: Array<[number, number]>): Array<[number, number]> {
  const sorted = forbidden
    .filter((interval) => interval[1] >= 0 && interval[0] <= length)
    .map(([start, end]) => [Math.max(0, start), Math.min(length, end)] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!sorted.length) return [[0, length]];
  const merged: Array<[number, number]> = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (!last || interval[0] > last[1] + EPSILON) merged.push([interval[0], interval[1]]);
    else if (interval[1] > last[1]) last[1] = interval[1];
  }
  const visible: Array<[number, number]> = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor + EPSILON) visible.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < length - EPSILON) visible.push([cursor, length]);
  return visible;
}

export function splitTopologyFallbackSegmentIndexed(
  index: TopologyFallbackRectIndex,
  a: RoutingPoint,
  b: RoutingPoint,
  sourceId: string,
  targetId: string,
  options: TopologyFallbackSplitOptions = {},
): TopologyFallbackSplitResult {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return { segments: [], timeout: false, geometryUnavailable: true, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
  if (index.rectCount() === 0) return { segments: [], timeout: false, geometryUnavailable: true, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
  const clock = options.clock;
  const deadline = options.deadline;
  if (clock && deadline !== undefined && clock() >= deadline) return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { segments: [{ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }], timeout: false, geometryUnavailable: false, checkedRectCount: 0, visibleSegmentCount: 1, hiddenSegmentCount: 0 };
  const strokeMargin = Number.isFinite(options.strokeMargin) ? Math.max(0, options.strokeMargin ?? 0) : TOPOLOGY_FALLBACK_STROKE_MARGIN;
  const segmentBounds: RoutingRect = {
    x: Math.min(a.x, b.x) - strokeMargin,
    y: Math.min(a.y, b.y) - strokeMargin,
    width: Math.abs(dx) + strokeMargin * 2,
    height: Math.abs(dy) + strokeMargin * 2,
  };
  const candidates = index.protectedCandidates(segmentBounds, sourceId, targetId);
  if (index.candidatesExceeded() || candidates.length > FALLBACK_MAX_CANDIDATES) return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };

  const maxCheckedRectCount = Number.isFinite(options.maxCheckedRectCount)
    ? Math.max(0, Math.floor(options.maxCheckedRectCount ?? FALLBACK_MAX_EDGE_CHECKED_RECT_COUNT))
    : FALLBACK_MAX_EDGE_CHECKED_RECT_COUNT;

  const forbiddenIntervals: Array<[number, number]> = [];
  let checkedRectCount = 0;
  for (const rect of candidates) {
    if (checkedRectCount >= maxCheckedRectCount) {
      return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
    }
    if (checkedRectCount % 64 === 0 && clock && deadline !== undefined && clock() >= deadline) {
      return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
    }
    checkedRectCount++;
    const clipped = clipSegmentToRect(a, b, rect);
    if (!clipped) continue;
    forbiddenIntervals.push(clipped);
  }

  const visible: Array<{ a: RoutingPoint; b: RoutingPoint }> = [];
  for (const [start, end] of subtractIntervals(1, forbiddenIntervals)) {
    if (end - start <= EPSILON) continue;
    visible.push({
      a: { x: a.x + dx * start, y: a.y + dy * start },
      b: { x: a.x + dx * end, y: a.y + dy * end },
    });
  }
  return { segments: visible, timeout: false, geometryUnavailable: false, checkedRectCount, visibleSegmentCount: visible.length, hiddenSegmentCount: forbiddenIntervals.length };
}

export function splitTopologyFallbackPolylinePreview(
  index: TopologyFallbackRectIndex,
  points: readonly RoutingPoint[],
  sourceId: string,
  targetId: string,
  options: number | TopologyFallbackPreviewOptions = {},
): TopologyFallbackSplitResult {
  if (index.rectCount() === 0) return { segments: [], timeout: false, geometryUnavailable: true, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
  if (points.length < 2) return { segments: [], timeout: false, geometryUnavailable: true, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
  if (points.length > FALLBACK_MAX_SEGMENT_COUNT + 1) return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };

  const previewOptions: TopologyFallbackPreviewOptions = typeof options === "number" ? { strokeMargin: options } : options;
  const margin = Number.isFinite(previewOptions.strokeMargin)
    ? Math.max(0, previewOptions.strokeMargin ?? 0)
    : TOPOLOGY_FALLBACK_STROKE_MARGIN;
  const maxCheckedRectCount = Number.isFinite(previewOptions.maxCheckedRectCount)
    ? Math.max(0, Math.floor(previewOptions.maxCheckedRectCount ?? FALLBACK_MAX_EDGE_CHECKED_RECT_COUNT))
    : FALLBACK_MAX_EDGE_CHECKED_RECT_COUNT;
  const maxCandidatesPerSegment = Number.isFinite(previewOptions.maxCandidatesPerSegment)
    ? Math.max(0, Math.floor(previewOptions.maxCandidatesPerSegment ?? FALLBACK_MAX_CANDIDATES))
    : FALLBACK_MAX_CANDIDATES;
  if (previewOptions.clock && previewOptions.deadline !== undefined && previewOptions.clock() >= previewOptions.deadline) {
    return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
  }

  const clean: RoutingPoint[] = [];
  for (const point of points) {
    if (!point || ![point.x, point.y].every(Number.isFinite)) return { segments: [], timeout: false, geometryUnavailable: true, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
    const last = clean.at(-1);
    if (!last || last.x !== point.x || last.y !== point.y) clean.push({ x: point.x, y: point.y });
  }

  if (clean.length < 2) return { segments: [], timeout: false, geometryUnavailable: true, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
  const visible: Array<{ a: RoutingPoint; b: RoutingPoint }> = [];
  let checkedRectCount = 0;
  let hiddenSegmentCount = 0;
  for (let segmentIndex = 0; segmentIndex + 1 < clean.length; segmentIndex++) {
    if (previewOptions.clock && previewOptions.deadline !== undefined && previewOptions.clock() >= previewOptions.deadline) {
      return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount, visibleSegmentCount: 0, hiddenSegmentCount };
    }
    const a = clean[segmentIndex];
    const b = clean[segmentIndex + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const bounds: RoutingRect = {
      x: Math.min(a.x, b.x) - margin,
      y: Math.min(a.y, b.y) - margin,
      width: Math.abs(dx) + margin * 2,
      height: Math.abs(dy) + margin * 2,
    };
    const candidates = index.protectedCandidates(bounds, sourceId, targetId);
    if (index.candidatesExceeded() || candidates.length > maxCandidatesPerSegment || checkedRectCount + candidates.length > maxCheckedRectCount) {
      return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount, visibleSegmentCount: 0, hiddenSegmentCount };
    }

    const forbiddenIntervals: Array<[number, number]> = [];
    for (const rect of candidates) {
      if (checkedRectCount >= maxCheckedRectCount) {
        return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount, visibleSegmentCount: 0, hiddenSegmentCount };
      }
      if (previewOptions.clock && previewOptions.deadline !== undefined && previewOptions.clock() >= previewOptions.deadline) {
        return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount, visibleSegmentCount: 0, hiddenSegmentCount };
      }
      checkedRectCount++;
      const clipped = clipSegmentToRect(a, b, rect);
      if (clipped) forbiddenIntervals.push(clipped);
    }
    for (const [start, end] of subtractIntervals(1, forbiddenIntervals)) {
      if (end - start <= EPSILON) continue;
      visible.push({
        a: { x: a.x + dx * start, y: a.y + dy * start },
        b: { x: a.x + dx * end, y: a.y + dy * end },
      });
    }
    if (forbiddenIntervals.length > 0) hiddenSegmentCount += forbiddenIntervals.length;
  }
  return { segments: visible, timeout: false, geometryUnavailable: false, checkedRectCount, visibleSegmentCount: visible.length, hiddenSegmentCount };
}

export function splitTopologyFallbackPolylineIndexed(
  index: TopologyFallbackRectIndex,
  points: readonly RoutingPoint[],
  sourceId: string,
  targetId: string,
  options: TopologyFallbackSplitOptions = {},
): TopologyFallbackSplitResult {
  if (index.rectCount() === 0) return { segments: [], timeout: false, geometryUnavailable: true, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
  if (points.length < 2) return { segments: [], timeout: false, geometryUnavailable: true, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
  if (points.length > FALLBACK_MAX_SEGMENT_COUNT + 1) return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
  const clean: RoutingPoint[] = [];
  for (const point of points) {
    if (!point || ![point.x, point.y].every(Number.isFinite)) return { segments: [], timeout: false, geometryUnavailable: true, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
    const last = clean.at(-1);
    if (!last || last.x !== point.x || last.y !== point.y) clean.push({ x: point.x, y: point.y });
  }
  if (clean.length < 2) return { segments: [], timeout: false, geometryUnavailable: true, checkedRectCount: 0, visibleSegmentCount: 0, hiddenSegmentCount: 0 };
  const result: Array<{ a: RoutingPoint; b: RoutingPoint }> = [];
  let checkedRectCount = 0;
  let hiddenSegmentCount = 0;
  for (let indexValue = 0; indexValue + 1 < clean.length; indexValue++) {
    const a = clean[indexValue];
    const b = clean[indexValue + 1];
    if (!a || !b) continue;
    if (options.clock && options.deadline !== undefined && options.clock() >= options.deadline) {
      return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount, visibleSegmentCount: 0, hiddenSegmentCount };
    }
    if (checkedRectCount >= FALLBACK_MAX_EDGE_CHECKED_RECT_COUNT) {
      return { segments: [], timeout: true, geometryUnavailable: false, checkedRectCount, visibleSegmentCount: 0, hiddenSegmentCount };
    }
    const remainingCheckedRectCount = FALLBACK_MAX_EDGE_CHECKED_RECT_COUNT - checkedRectCount;
    const split = splitTopologyFallbackSegmentIndexed(index, a, b, sourceId, targetId, {
      ...options,
      maxCheckedRectCount: remainingCheckedRectCount,
    });
    if (split.timeout || split.geometryUnavailable) return { segments: [], timeout: split.timeout, geometryUnavailable: split.geometryUnavailable, checkedRectCount: checkedRectCount + split.checkedRectCount, visibleSegmentCount: 0, hiddenSegmentCount: hiddenSegmentCount + split.hiddenSegmentCount };
    checkedRectCount += split.checkedRectCount;
    hiddenSegmentCount += split.hiddenSegmentCount;
    for (const segment of split.segments) result.push(segment);
  }
  return { segments: result, timeout: false, geometryUnavailable: false, checkedRectCount, visibleSegmentCount: result.length, hiddenSegmentCount };
}

export function topologyFallbackMarkerVisibility(
  segments: Array<{ a: RoutingPoint; b: RoutingPoint }>,
  source: RoutingPoint,
  target: RoutingPoint,
  options: TopologyFallbackMarkerOptions = {},
): TopologyFallbackMarkerVisibility {
  if (!segments.length) return { markerStart: false, markerEnd: false };
  const first = segments[0];
  const last = segments.at(-1);
  if (!first || !last) return { markerStart: false, markerEnd: false };

  const endpointStart = Math.abs(first.a.x - source.x) <= EPSILON && Math.abs(first.a.y - source.y) <= EPSILON;
  const endpointEnd = Math.abs(last.b.x - target.x) <= EPSILON && Math.abs(last.b.y - target.y) <= EPSILON;
  if (!options.index) return { markerStart: endpointStart, markerEnd: endpointEnd };

  const strokeWidth = Number.isFinite(options.strokeWidth) ? Math.max(1, options.strokeWidth ?? 1) : 2;
  const markerWidth = Number.isFinite(options.markerWidth) ? Math.max(1, options.markerWidth ?? 14) : 14;
  const scale = markerWidth / 20 * strokeWidth;
  const sourceId = options.sourceId ?? "";
  const targetId = options.targetId ?? "";

  const markerEnvelope = (
    tip: RoutingPoint,
    segment: { a: RoutingPoint; b: RoutingPoint },
    tailDirection: 1 | -1,
  ): RoutingRect => {
    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return { x: tip.x - scale * 5, y: tip.y - scale * 4, width: scale * 10, height: scale * 8 };
    const ux = dx / length * tailDirection;
    const uy = dy / length * tailDirection;
    const px = -uy;
    const py = ux;
    const points = [
      { x: tip.x + ux * scale * 5, y: tip.y + uy * scale * 5 },
      { x: tip.x, y: tip.y },
      { x: tip.x + ux * scale * 5 + px * scale * 4, y: tip.y + uy * scale * 5 + py * scale * 4 },
      { x: tip.x + ux * scale * 5 - px * scale * 4, y: tip.y + uy * scale * 5 - py * scale * 4 },
    ];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };

  const startEnvelope = endpointStart
    ? markerEnvelope(source, first, 1)
    : null;
  const endEnvelope = endpointEnd
    ? markerEnvelope(target, last, -1)
    : null;
  const markerStart = endpointStart && startEnvelope
    ? !options.index.overlapsProtectedEnvelope(startEnvelope, sourceId, targetId, 0)
    : false;
  const markerEnd = endpointEnd && endEnvelope
    ? !options.index.overlapsProtectedEnvelope(endEnvelope, sourceId, targetId, 0)
    : false;
  return { markerStart, markerEnd };
}
