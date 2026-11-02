import type { TopologyEdge } from "@steed/api/shared";
import type { RoutingPoint, RoutingRect } from "./topology-routing-grid";
import type { TopologyFallbackRectIndex } from "./topology-route-edge-safety";

export const TOPOLOGY_ROUTE_CORNER_RADIUS = 8;

export interface TopologyRouteEdgeData extends Record<string, unknown> {
  edge: TopologyEdge;
  points?: RoutingPoint[];
  crossLayer?: boolean;
  showLabel?: boolean;
  status?: "routed" | "fallback";
  renderMode?: "straight";
  fallbackStyle?: "dashed" | "faded";
  fallback?: "no_path" | "timeout";
  fallbackIndex?: TopologyFallbackRectIndex;
  workerLabel?: { rect: RoutingRect | null; hidden: boolean; text: string; segmentIndex: number | null };
  strokeMargin?: number;
  deadline?: number;
  clock?: () => number;
}

export const TOPOLOGY_EDGE_KIND_COLORS: Readonly<Record<TopologyEdge["kind"], string>> = {
  traffic: "var(--topology-edge-traffic, #2563eb)",
  dns: "var(--topology-edge-dns, #7c3aed)",
  binding: "var(--topology-edge-binding, #0891b2)",
  deploy: "var(--topology-edge-deploy, #ea580c)",
  auth: "var(--topology-edge-auth, #db2777)",
  monitor: "var(--topology-edge-monitor, #16a34a)",
  uses: "var(--topology-edge-uses, #64748b)",
  tunnel: "var(--topology-edge-tunnel, #9333ea)",
};

export function topologyRouteEdgeColor(edge: TopologyEdge, crossLayer = false): string {
  if (crossLayer) return "var(--topology-edge-cross, #94a3b8)";
  return TOPOLOGY_EDGE_KIND_COLORS[edge.kind] ?? "var(--topology-edge-uses, #64748b)";
}

export function topologyRoutePointsValid(points: readonly RoutingPoint[] | null | undefined): points is readonly RoutingPoint[] {
  return Array.isArray(points)
    && points.length >= 2
    && Array.from(points).every((point) => point !== null && point !== undefined
      && Number.isFinite(point.x)
      && Number.isFinite(point.y))
    && points.some((point) => point.x !== points[0]?.x || point.y !== points[0]?.y);
}

export function topologyRouteLabelDetail(edge: TopologyEdge): string {
  const protocol = edge.protocol?.trim();
  return protocol
    ? `${protocol}${edge.port !== undefined ? ` :${edge.port}` : ""}`
    : edge.port !== undefined
      ? `:${edge.port}`
      : "";
}

export function topologyRouteLabelText(edge: TopologyEdge): string {
  const base = edge.label.trim() || edge.kind;
  const protocolPort = topologyRouteLabelDetail(edge);
  return protocolPort ? `${base} · ${protocolPort}` : base;
}

export function topologyRouteLabelCapsuleWidth(text: string): number {
  let width = 16;
  for (const character of Array.from(text)) {
    const codePoint = character.codePointAt(0) ?? 0;
    width += codePoint <= 0x7f ? 12 : codePoint >= 0xac00 && codePoint <= 0xd7af ? 14 : 14;
  }
  return Math.max(48, Math.ceil(width));
}

export function topologyRouteSafeLabelPosition(
  segments: readonly { a: RoutingPoint; b: RoutingPoint }[],
  fallbackIndex: TopologyFallbackRectIndex | undefined,
  sourceId: string,
  targetId: string,
  text: string,
  capsuleHeight = 21,
  measuredCapsuleWidth?: number,
  edgeId?: string,
): RoutingPoint | null {
  if (!fallbackIndex || segments.length === 0) return null;
  const width = Number.isFinite(measuredCapsuleWidth)
    ? Math.max(48, measuredCapsuleWidth ?? 48)
    : topologyRouteLabelCapsuleWidth(text);
  const horizontal = segments.flatMap((segment) => {
    if (Math.abs(segment.b.y - segment.a.y) > EPSILON_LABEL) return [];
    const length = Math.abs(segment.b.x - segment.a.x);
    if (length < width) return [];
    return [{ ...segment, length }];
  }).sort((left, right) => right.length - left.length || left.a.x - right.a.x || left.a.y - right.a.y);

  for (const segment of horizontal) {
    const minX = Math.min(segment.a.x, segment.b.x);
    const maxX = Math.max(segment.a.x, segment.b.x);
    const availableStart = minX + width / 2;
    const availableEnd = maxX - width / 2;
    if (availableEnd < availableStart) continue;
    const steps = 17;
    for (let step = 0; step < steps; step++) {
      const ratio = step / (steps - 1);
      const centerX = availableStart + (availableEnd - availableStart) * ratio;
      const centerY = segment.a.y;
      const capsule = {
        x: centerX - width / 2,
        y: centerY - capsuleHeight / 2,
        width,
        height: capsuleHeight,
      };
      if (!fallbackIndex.overlapsLabelEnvelope(capsule, sourceId, targetId, 0, edgeId)) {
        return { x: centerX, y: centerY };
      }
    }
  }
  return null;
}

const EPSILON_LABEL = 1e-7;

export function topologyRouteWorkerLabelPosition(
  segments: readonly { a: RoutingPoint; b: RoutingPoint }[],
  fallbackIndex: TopologyFallbackRectIndex | undefined,
  sourceId: string,
  targetId: string,
  workerRect: RoutingRect | null | undefined,
  capsuleHeight = 22,
  measuredCapsuleWidth = 48,
  edgeId?: string,
): RoutingPoint | null {
  if (!fallbackIndex || !workerRect || ![workerRect.x, workerRect.y, workerRect.width, workerRect.height].every(Number.isFinite)) return null;
  const width = Number.isFinite(measuredCapsuleWidth) ? Math.max(48, measuredCapsuleWidth) : 48;
  const height = Number.isFinite(capsuleHeight) ? Math.max(1, capsuleHeight) : 22;
  const center = { x: workerRect.x + workerRect.width / 2, y: workerRect.y + workerRect.height / 2 };
  const onSegment = segments.some((segment) => {
    if (Math.abs(segment.b.y - segment.a.y) > EPSILON_LABEL) return false;
    const minX = Math.min(segment.a.x, segment.b.x);
    const maxX = Math.max(segment.a.x, segment.b.x);
    return Math.abs(center.y - segment.a.y) <= EPSILON_LABEL && center.x >= minX - 1e-6 && center.x <= maxX + 1e-6;
  });
  if (!onSegment) return null;
  const capsule = { x: center.x - width / 2, y: center.y - height / 2, width, height };
  return fallbackIndex.overlapsLabelEnvelope(capsule, sourceId, targetId, 2, edgeId) ? null : center;
}

export function topologyRouteDash(edge: TopologyEdge): string | undefined {
  if (edge.style?.dash === "solid") return undefined;
  if (edge.style?.dash === "dotted") return "2 5";
  if (edge.style?.dash === "dashed") return "6 5";
  return edge.evidence === "inferred" ? "6 5" : undefined;
}

export function topologyRouteStrokeWidth(edge: TopologyEdge, crossLayer = false): number {
  const width = edge.style?.width;
  if (width !== undefined) return Math.min(4, Math.max(1, width));
  return crossLayer ? 1.5 : 2;
}

function uniqueOrthogonalPoints(points: readonly RoutingPoint[]): RoutingPoint[] {
  const result: RoutingPoint[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && last.x === point.x && last.y === point.y) continue;
    result.push({ x: point.x, y: point.y });
  }
  return result;
}

export function topologyRoundedOrthogonalPath(points: readonly RoutingPoint[], radius = TOPOLOGY_ROUTE_CORNER_RADIUS): string {
  const clean = uniqueOrthogonalPoints(points);
  if (!clean.length) return "";
  const first = clean[0];
  if (!first) return "";
  if (clean.length === 1) return `M ${first.x} ${first.y}`;
  if (clean.length === 2) {
    const second = clean[1];
    return second ? `M ${first.x} ${first.y} L ${second.x} ${second.y}` : `M ${first.x} ${first.y}`;
  }

  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < clean.length - 1; index++) {
    const previous = clean[index - 1];
    const corner = clean[index];
    const next = clean[index + 1];
    if (!previous || !corner || !next) continue;

    const incomingLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoingLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    const incomingScale = incomingLength === 0 ? 0 : r / incomingLength;
    const outgoingScale = outgoingLength === 0 ? 0 : r / outgoingLength;
    const before = {
      x: corner.x + (previous.x - corner.x) * incomingScale,
      y: corner.y + (previous.y - corner.y) * incomingScale,
    };
    const after = {
      x: corner.x + (next.x - corner.x) * outgoingScale,
      y: corner.y + (next.y - corner.y) * outgoingScale,
    };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = clean.at(-1);
  if (last) path += ` L ${last.x} ${last.y}`;
  return path;
}

export function topologySharpOrthogonalPath(points: readonly RoutingPoint[]): string {
  const clean = uniqueOrthogonalPoints(points);
  if (!clean.length) return "";
  const first = clean[0];
  if (!first) return "";
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < clean.length; index++) {
    const point = clean[index];
    if (point) path += ` L ${point.x} ${point.y}`;
  }
  return path;
}

export function topologySafeRoundedOrthogonalPath(
  points: readonly RoutingPoint[],
  fallbackIndex: TopologyFallbackRectIndex | undefined,
  sourceId: string,
  targetId: string,
  radius = TOPOLOGY_ROUTE_CORNER_RADIUS,
): string {
  const clean = uniqueOrthogonalPoints(points);
  if (!fallbackIndex || clean.length < 3) return topologySharpOrthogonalPath(clean);

  for (let index = 1; index < clean.length - 1; index++) {
    const previous = clean[index - 1];
    const corner = clean[index];
    const next = clean[index + 1];
    if (!previous || !corner || !next) continue;
    const incomingLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoingLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    const incomingScale = incomingLength === 0 ? 0 : r / incomingLength;
    const outgoingScale = outgoingLength === 0 ? 0 : r / outgoingLength;
    const before = { x: corner.x + (previous.x - corner.x) * incomingScale, y: corner.y + (previous.y - corner.y) * incomingScale };
    const after = { x: corner.x + (next.x - corner.x) * outgoingScale, y: corner.y + (next.y - corner.y) * outgoingScale };
    const xs = [before.x, corner.x, after.x];
    const ys = [before.y, corner.y, after.y];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const envelope = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    if (fallbackIndex.overlapsProtectedEnvelope(envelope, sourceId, targetId, radius)) return topologySharpOrthogonalPath(clean);
  }
  return topologyRoundedOrthogonalPath(clean, radius);
}

export function topologyRouteHighlightedEndpoints(edges: readonly TopologyEdge[], hoveredEdgeId: string, selectedEdgeId: string): Set<string> {
  const activeIds = new Set([hoveredEdgeId, selectedEdgeId].filter((id) => id.length > 0));
  const endpointIds = new Set<string>();
  for (const edge of edges) {
    if (activeIds.has(edge.id) || activeIds.has(`topology-edge:${edge.id}`)) {
      endpointIds.add(edge.source);
      endpointIds.add(edge.target);
    }
  }
  return endpointIds;
}
