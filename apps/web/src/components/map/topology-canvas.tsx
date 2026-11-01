import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, ControlButton, Controls, Handle, MarkerType, Position, ReactFlowProvider, getNodesBounds, getViewportForBounds, useReactFlow, useStore, type Edge, type Node, type NodeMouseHandler, type NodeProps, type ReactFlowInstance, type Rect } from "@xyflow/react";
import { Badge } from "@nocoo/basalt";
import { Layers, Maximize, Network, Server, Shield } from "lucide-react";
import type { Topology, TopologyEdge, TopologyNode, TopologyView } from "@steed/api/shared";
import { layoutTopology, TOPOLOGY_FRAME_VISUAL_DEPTH_LIMIT } from "@/lib/topology-layout";
import "@xyflow/react/dist/style.css";

export type TopologyCardKind = "host" | "satellite" | "sub-satellite";

export interface TopologyCanvasNode extends Record<string, unknown> {
  label: string;
  kind: "lane" | "frame" | TopologyCardKind;
  node?: TopologyNode;
  laneLabel?: string;
  provider?: string;
  color?: string;
  counts?: { hosts: number; nodes: number };
  boundaryKind?: string;
  depth?: number;
  visualDepth?: number;
  fragmentIndex?: number;
  fragmentCount?: number;
  tint?: string;
  borderStyle?: "solid" | "dashed" | "dotted" | "double";
  borderWidth?: number;
  borderColor?: string;
  satelliteCount?: number;
  typeLabel?: string;
  badges?: { label: string; value: string }[];
  boundaryLabels?: string[];
  boundaryId?: string;
  highlighted?: boolean;
  onFrameHover?: (boundaryId: string) => void;
  onFrameClearHover?: () => void;
  onFrameFocus?: (boundaryId: string) => void;
  onFrameClearFocus?: () => void;
  lifecycle?: TopologyNode["lifecycle"];
  width?: number;
  height?: number;
  onSelect?: (id: string) => void;
  onFocusLayer?: (id: string) => void;
}

/** A one-shot request to move the viewport, e.g. from search or a toolbar. */
export interface TopologyFocusRequest {
  kind: "node" | "layer";
  id: string;
  seq: number;
}

export type TopologyZoomTier = "far" | "mid" | "near";
export const TOPOLOGY_ZOOM_FAR = 0.4;
export const TOPOLOGY_ZOOM_NEAR = 0.75;

export function topologyZoomTier(zoom: number): TopologyZoomTier {
  if (zoom < TOPOLOGY_ZOOM_FAR) return "far";
  if (zoom < TOPOLOGY_ZOOM_NEAR) return "mid";
  return "near";
}

/** Translucent fill for a layer or boundary colour; named colours fall back to the theme. */
export function topologyTint(color: string | undefined, alpha: number): string {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
  return `color-mix(in oklab, ${color ?? "var(--color-basalt-primary, #6366f1)"} ${Math.round(alpha * 100)}%, transparent)`;
}

type Side = "top" | "right" | "bottom" | "left";

/** Handle sides for an edge, chosen from the relative position of the two cards. */
export function topologyEdgeSides(source: Rect, target: Rect): [Side, Side] {
  const dx = (target.x + target.width / 2) - (source.x + source.width / 2);
  const dy = (target.y + target.height / 2) - (source.y + source.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

export interface TopologyCanvasEdge extends Record<string, unknown> {
  edge: TopologyEdge;
}

export const TOPOLOGY_NODE_VISIBLE_BADGES = 4;
export const TOPOLOGY_SATELLITE_VISIBLE_BADGES = 2;
export const TOPOLOGY_NODE_VISIBLE_BOUNDARY_CHIPS = 1;

export function topologyNodeBadgeValues(topology: Topology, node: TopologyNode): { label: string; value: string }[] {
  const type = topology.types.find((candidate) => candidate.id === node.type);
  if (!type) return [];
  return [...type.attrs]
    .filter((attr) => attr.badge && node.attrs[attr.key] !== undefined)
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
    .slice(0, 6)
    .map((attr) => {
      const raw = node.attrs[attr.key];
      const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
      return { label: attr.label, value: `${value}${attr.unit ? ` ${attr.unit}` : ""}` };
    });
}

export function inheritedBoundaryIds(topology: Topology, node: TopologyNode): string[] {
  if (!node.parentId) return [...node.boundaryIds];
  const byId = new Map(topology.nodes.map((candidate) => [candidate.id, candidate]));
  let current = node;
  const seen = new Set<string>();
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return [...current.boundaryIds];
}

export function topologyNodeBoundaryLabels(topology: Topology, node: TopologyNode): string[] {
  const boundaryById = new Map(topology.boundaries.map((boundary) => [boundary.id, boundary.label]));
  const ids = new Set(inheritedBoundaryIds(topology, node));
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop();
    if (!id) continue;
    const parentId = topology.boundaries.find((boundary) => boundary.id === id)?.parentId;
    if (parentId && !ids.has(parentId)) {
      ids.add(parentId);
      stack.push(parentId);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b)).map((id) => boundaryById.get(id) ?? id);
}

const SIDES: Array<[Side, Position]> = [["top", Position.Top], ["right", Position.Right], ["bottom", Position.Bottom], ["left", Position.Left]];
const handleClass = "!h-1.5 !w-1.5 !min-h-0 !min-w-0 !border-0 !bg-basalt-primary/60";

function CardHandles() {
  return <>{SIDES.map(([side, position]) => (
    <span key={side}>
      <Handle type="target" position={position} id={`t-${side}`} isConnectable={false} className={handleClass} />
      <Handle type="source" position={position} id={`s-${side}`} isConnectable={false} className={handleClass} />
    </span>
  ))}</>;
}

const NodeCard = memo(function NodeCard({ data, selected }: NodeProps<Node<TopologyCanvasNode>>) {
  const host = data.kind === "host";
  const visibleBadges = data.badges?.slice(0, host ? TOPOLOGY_NODE_VISIBLE_BADGES : TOPOLOGY_SATELLITE_VISIBLE_BADGES) ?? [];
  const visibleBoundaries = host ? data.boundaryLabels?.slice(0, TOPOLOGY_NODE_VISIBLE_BOUNDARY_CHIPS) ?? [] : [];
  const boundaryOverflow = host ? Math.max(0, (data.boundaryLabels?.length ?? 0) - visibleBoundaries.length) : 0;
  const completeBoundaryLabels = data.boundaryLabels?.join(", ") ?? "";
  return (
    <div
      className={`topology-card topology-card-${data.kind} relative flex flex-col overflow-hidden rounded-lg border bg-basalt-card text-basalt-card-foreground shadow-sm transition-colors${selected ? " border-basalt-primary ring-2 ring-basalt-primary/40" : " border-basalt-border"}`}
      style={{ width: data.width, height: data.height, borderLeftColor: data.color, borderLeftWidth: host ? 4 : 2 }}
      role={data.node ? "button" : undefined}
      tabIndex={data.node ? 0 : undefined}
      aria-label={data.node ? `Select ${data.label}` : data.kind}
      aria-pressed={data.node ? selected === true : undefined}
      data-testid={`topology-node-card-${data.node?.id ?? data.kind}`}
      data-boundary-labels={completeBoundaryLabels || undefined}
      // Mouse focus would make the browser scroll React Flow's overflow-hidden
      // renderer to reveal the card, shifting the whole map off its viewport.
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (data.node && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          data.onSelect?.(data.node.id);
        }
      }}
    >
      <CardHandles />
      {host && <div className="topology-card-far absolute inset-0 flex-col justify-center gap-1 bg-basalt-card px-4" aria-hidden="true">
        <div className="line-clamp-2 text-[26px] font-bold leading-tight" title={data.label}>{data.label}</div>
        {(data.satelliteCount ?? 0) > 0 && <div className="text-lg text-basalt-muted-foreground">+{data.satelliteCount} satellites</div>}
      </div>}
      <div className={`flex items-start gap-2 px-3 ${host ? "pt-2.5" : "pt-2"}`}>
        {host ? <Server className="mt-0.5 h-4 w-4 shrink-0" style={{ color: data.color }} /> : <Network className="mt-0.5 h-3.5 w-3.5 shrink-0 text-basalt-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className={`truncate font-semibold ${host ? "text-sm" : "text-xs"}`} title={data.label}>{data.label}</div>
          {host && <div className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-basalt-muted-foreground">{data.typeLabel ?? data.kind}{(data.satelliteCount ?? 0) > 0 ? ` · ${data.satelliteCount} satellites` : ""}</div>}
        </div>
        {data.lifecycle && data.lifecycle !== "active" && <Badge variant="outline" className="shrink-0 text-[10px]">{data.lifecycle}</Badge>}
      </div>
      <div className={`mt-auto flex flex-wrap gap-1 overflow-hidden px-3 pb-2 ${host ? "max-h-[46px]" : "max-h-[22px]"}`} aria-label="Topology node details">
        {visibleBadges.map((badge) => <Badge key={`${badge.label}:${badge.value}`} variant="secondary" className="h-5 max-w-[104px] text-[10px]" title={`${badge.label}: ${badge.value}`}>
          <span className="block truncate">{badge.label}: {badge.value}</span>
        </Badge>)}
        {visibleBoundaries.map((label) => <Badge key={label} variant="outline" className="h-5 max-w-[104px] text-[10px]" title={label} aria-label={`Boundary: ${label}`}>
          <span className="block truncate">{label}</span>
        </Badge>)}
        {boundaryOverflow > 0 && <Badge variant="outline" className="h-5 max-w-[104px] text-[10px]" title={completeBoundaryLabels} aria-label={`Boundaries: ${completeBoundaryLabels}`}>
          <span className="block truncate">+{boundaryOverflow} boundaries</span>
        </Badge>}
      </div>
    </div>
  );
});

const SectionNode = memo(function SectionNode({ data }: NodeProps<Node<TopologyCanvasNode>>) {
  return (
    <div
      className="topology-section h-full w-full rounded-3xl border-2"
      style={{ width: data.width, height: data.height, background: topologyTint(data.color, 0.07), borderColor: topologyTint(data.color, 0.35) }}
      data-testid={`topology-section-${data.label}`}
    >
      <button
        type="button"
        className="nopan flex w-full items-center gap-4 rounded-t-3xl px-10 py-6 text-left hover:bg-basalt-secondary/40"
        style={{ height: 96 }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => data.onFocusLayer?.(data.label)}
        aria-label={`Focus layer ${data.laneLabel ?? data.label}`}
      >
        <Layers className="h-10 w-10 shrink-0" style={{ color: data.color }} aria-hidden="true" />
        <span className="min-w-0 truncate text-[44px] font-bold leading-none">{data.laneLabel}</span>
        <span className="min-w-0 truncate text-2xl text-basalt-muted-foreground">{data.provider}</span>
        <span className="ml-auto shrink-0 text-2xl text-basalt-muted-foreground">{data.counts?.hosts} hosts · {data.counts?.nodes} nodes</span>
      </button>
    </div>
  );
});

const FrameNode = memo(function FrameNode({ data }: NodeProps<Node<TopologyCanvasNode>>) {
  const borderStyle = data.borderStyle === "dotted" ? "dotted" : data.borderStyle === "dashed" ? "dashed" : data.borderStyle === "double" ? "double" : "solid";
  const hover = () => data.boundaryId && data.onFrameHover?.(data.boundaryId);
  const clear = () => data.onFrameClearHover?.();
  const focus = () => data.boundaryId && data.onFrameFocus?.(data.boundaryId);
  const blur = () => data.onFrameClearFocus?.();
  return (
    <div
      className={`topology-frame h-full w-full rounded-2xl${data.highlighted ? " topology-frame-highlighted ring-2 ring-basalt-primary/60" : ""}`}
      style={{ width: data.width, height: data.height, borderStyle, borderWidth: data.borderWidth ?? 2, borderColor: data.highlighted ? data.color ?? topologyTint(data.color, 1) : data.borderColor ?? topologyTint(data.color, 0.7), background: data.tint ?? topologyTint(data.color, (data.visualDepth ?? data.depth ?? 0) > 0 ? 0.06 : 0.04) }}
      data-testid={`topology-frame-${data.label}`}
      data-highlighted={data.highlighted ? "true" : "false"}
    >
      <button
        type="button"
        className="nopan absolute inset-x-0 top-0 z-10 flex h-9 items-center gap-2 px-4 text-left text-base font-semibold"
        style={{ color: data.color }}
        data-testid={`topology-frame-header-${data.label}-${data.fragmentIndex}-${data.fragmentCount}`}
        aria-label={`Highlight frame ${data.laneLabel}`}
        onMouseEnter={hover}
        onMouseLeave={clear}
        onFocus={focus}
        onBlur={blur}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Shield className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{data.laneLabel}</span>
        <span className="shrink-0 text-xs font-normal uppercase tracking-wide text-basalt-muted-foreground">{data.boundaryKind}</span>
      </button>
    </div>
  );
});

const nodeTypes = { topologyNode: NodeCard, topologyLane: SectionNode, topologyFrame: FrameNode };

interface Props {
  topology: Topology;
  visibleNodes: TopologyNode[];
  visibleEdges: TopologyEdge[];
  view?: TopologyView;
  selectedNodeId: string;
  onSelect: (id: string) => void;
  focus?: TopologyFocusRequest;
  onInit?: (instance: ReactFlowInstance<Node<TopologyCanvasNode>, Edge<TopologyCanvasEdge>>) => void;
}

const BOUNDARY_FALLBACK_COLOR = "#64748b";

function Canvas({ topology, visibleNodes, visibleEdges, view, selectedNodeId, onSelect, focus, onInit }: Props) {
  const { setViewport, setCenter, getZoom } = useReactFlow();
  const canvas = useStore((state) => ({ width: state.width, height: state.height }));
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  const [hoveredBoundaryId, setHoveredBoundaryId] = useState("");
  const [focusedBoundaryId, setFocusedBoundaryId] = useState("");

  const layout = useMemo(() => layoutTopology(topology, view ? { view } : {}), [topology, view]);
  const fitRect = useCallback((rect: Rect, padding: number) => {
    const { width, height } = canvasRef.current;
    if (width <= 0 || height <= 0) return;
    setViewport(getViewportForBounds(rect, width, height, 0.05, 1, padding), { duration: 0 });
  }, [setViewport]);
  const focusLayer = useCallback((layerId: string) => {
    const lane = layout.lanes.find((candidate) => candidate.layerId === layerId);
    if (lane) fitRect(lane, 0.04);
  }, [layout, fitRect]);
  const selectRef = useRef({ onSelect, selectedNodeId });
  selectRef.current = { onSelect, selectedNodeId };
  const selectNode = useCallback((id: string) => selectRef.current.onSelect(id), []);
  const hoverFrame = useCallback((boundaryId: string) => setHoveredBoundaryId(boundaryId), []);
  const clearFrameHover = useCallback(() => setHoveredBoundaryId(""), []);
  const focusFrame = useCallback((boundaryId: string) => setFocusedBoundaryId(boundaryId), []);
  const clearFrameFocus = useCallback(() => setFocusedBoundaryId(""), []);

  const projected = useMemo(() => {
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const byId = new Map(topology.nodes.map((node) => [node.id, node]));
    const layerById = new Map(topology.layers.map((layer) => [layer.id, layer]));
    const boundaryById = new Map(topology.boundaries.map((boundary) => [boundary.id, boundary]));
    const typeById = new Map(topology.types.map((type) => [type.id, type]));
    // Hosts count every card in their column; satellites count their direct children.
    const satelliteCounts = new Map<string, number>();
    for (const node of topology.nodes) if (node.parentId) satelliteCounts.set(node.parentId, (satelliteCounts.get(node.parentId) ?? 0) + 1);
    for (const block of layout.blocks) satelliteCounts.set(block.hostId, block.nodeIds.length - 1);
    const hostLayer = new Map<string, string>();
    for (const lane of layout.lanes) for (const id of lane.nodeIds) hostLayer.set(id, lane.layerId);

    const laneNodes: Node<TopologyCanvasNode>[] = layout.lanes
      .filter((lane) => lane.nodeIds.some((id) => visibleNodeIds.has(id)))
      .map((lane) => {
        const layer = layerById.get(lane.layerId);
        return {
          id: `lane:${lane.id}`,
          type: "topologyLane",
          position: { x: lane.x, y: lane.y },
          width: lane.width,
          height: lane.height,
          selectable: false,
          draggable: false,
          focusable: false,
          zIndex: -3,
          data: {
            label: lane.layerId,
            kind: "lane",
            laneLabel: layer?.label ?? lane.layerId,
            provider: layer?.provider,
            color: layer?.color,
            counts: { hosts: lane.blockIds.length, nodes: lane.nodeIds.length },
            width: lane.width,
            height: lane.height,
            onFocusLayer: focusLayer,
          },
          style: { width: lane.width, height: lane.height },
        };
      });
    const frameNodes: Node<TopologyCanvasNode>[] = layout.frames
      .filter((frame) => frame.depth < TOPOLOGY_FRAME_VISUAL_DEPTH_LIMIT && frame.nodeIds.some((id) => visibleNodeIds.has(id)))
      .map((frame) => {
        const boundary = boundaryById.get(frame.boundaryId);
        return {
          id: frame.id,
          type: "topologyFrame",
          position: { x: frame.x, y: frame.y },
          width: frame.width,
          height: frame.height,
          selectable: false,
          draggable: false,
          focusable: false,
          zIndex: -2 + frame.visualDepth * 0.1,
          className: hoveredBoundaryId === frame.boundaryId || focusedBoundaryId === frame.boundaryId ? "topology-frame-highlighted" : undefined,
          data: {
            label: frame.boundaryId,
            kind: "frame",
            laneLabel: frame.title,
            boundaryId: frame.boundaryId,
            highlighted: hoveredBoundaryId === frame.boundaryId || focusedBoundaryId === frame.boundaryId,
            onFrameHover: hoverFrame,
            onFrameClearHover: clearFrameHover,
            onFrameFocus: focusFrame,
            onFrameClearFocus: clearFrameFocus,
            boundaryKind: boundary?.kind,
            color: frame.color || boundary?.style?.color || BOUNDARY_FALLBACK_COLOR,
            depth: frame.depth,
            visualDepth: frame.visualDepth,
            fragmentIndex: frame.fragmentIndex,
            fragmentCount: frame.fragmentCount,
            tint: frame.tint,
            borderStyle: frame.border.style,
            borderWidth: frame.border.width,
            borderColor: frame.border.color,
            width: frame.width,
            height: frame.height,
          },
          style: { width: frame.width, height: frame.height },
        };
      });

    const nodeLayer: Node<TopologyCanvasNode>[] = [];
    for (const node of visibleNodes) {
      const position = layout.positions[node.id];
      if (!position) continue;
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      const kind: TopologyCardKind = !parent ? "host" : parent.parentId ? "sub-satellite" : "satellite";
      nodeLayer.push({
        id: node.id,
        type: "topologyNode",
        className: kind === "host" ? "topology-rf-host" : "topology-rf-satellite",
        position: { x: position.x, y: position.y },
        width: position.width,
        height: position.height,
        selectable: true,
        ariaLabel: `Select ${node.label}`,
        draggable: false,
        zIndex: 2,
        data: {
          label: node.label,
          kind,
          node,
          typeLabel: typeById.get(node.type)?.label ?? node.type,
          color: layerById.get(hostLayer.get(node.id) ?? node.layerId)?.color,
          satelliteCount: satelliteCounts.get(node.id) ?? 0,
          badges: topologyNodeBadgeValues(topology, node),
          boundaryLabels: topologyNodeBoundaryLabels(topology, node),
          lifecycle: node.lifecycle,
          width: position.width,
          height: position.height,
          onSelect: selectNode,
        },
      });
    }

    const edges: Edge<TopologyCanvasEdge>[] = visibleEdges
      .flatMap((edge) => {
        const source = layout.positions[edge.source];
        const target = layout.positions[edge.target];
        if (!source || !target || !visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return [];
        const [sourceSide, targetSide] = topologyEdgeSides(source, target);
        const sourceLayer = hostLayer.get(edge.source);
        const crossLayer = sourceLayer !== hostLayer.get(edge.target);
        const satellite = byId.get(edge.source)?.parentId !== undefined || byId.get(edge.target)?.parentId !== undefined;
        const color = crossLayer ? "var(--topology-edge-cross, #94a3b8)" : layerById.get(sourceLayer ?? "")?.color ?? "var(--topology-edge-cross, #94a3b8)";
        return [{
          id: `topology-edge:${edge.id}`,
          source: edge.source,
          target: edge.target,
          label: edge.label || edge.kind,
          type: crossLayer ? "default" : "smoothstep",
          className: `${satellite ? "topology-edge-satellite" : "topology-edge-host"}${crossLayer ? " topology-edge-cross" : ""}`,
          sourceHandle: `s-${sourceSide}`,
          targetHandle: `t-${targetSide}`,
          animated: edge.style?.animated === true,
          markerStart: edge.direction === "bi" ? { type: MarkerType.ArrowClosed, width: 14, height: 14, color } : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          style: {
            stroke: color,
            strokeOpacity: crossLayer ? 0.55 : 0.8,
            strokeWidth: edge.style?.width ?? (crossLayer ? 1.5 : 2),
            strokeDasharray: edge.style?.dash === "solid" ? undefined
              : edge.style?.dash === "dotted" ? "2 5"
                : edge.style?.dash === "dashed" ? "6 5"
                  : edge.evidence === "inferred" ? "6 5" : undefined,
          },
          data: { edge },
        }];
      });
    return { nodes: [...laneNodes, ...frameNodes, ...nodeLayer], laneNodes, edges };
  }, [topology, visibleNodes, visibleEdges, layout, selectNode, focusLayer, hoveredBoundaryId, focusedBoundaryId, hoverFrame, clearFrameHover, focusFrame, clearFrameFocus]);

  useEffect(() => {
    if (!hoveredBoundaryId) return;
    const visibleBoundary = layout.frames.some((frame) =>
      frame.depth < TOPOLOGY_FRAME_VISUAL_DEPTH_LIMIT
      && frame.boundaryId === hoveredBoundaryId
      && frame.nodeIds.some((id) => visibleNodes.some((node) => node.id === id)),
    );
    if (!visibleBoundary) setHoveredBoundaryId("");
  }, [hoveredBoundaryId, layout, visibleNodes]);

  useEffect(() => {
    if (!focusedBoundaryId) return;
    const visibleBoundary = layout.frames.some((frame) =>
      frame.depth < TOPOLOGY_FRAME_VISUAL_DEPTH_LIMIT
      && frame.boundaryId === focusedBoundaryId
      && frame.nodeIds.some((id) => visibleNodes.some((node) => node.id === id)),
    );
    if (!visibleBoundary) setFocusedBoundaryId("");
  }, [focusedBoundaryId, layout, visibleNodes]);

  // Selection is fully controlled by `selectedNodeId`. Only the nodes whose
  // selected flag changes get new objects, and the edge array never depends on
  // selection, so a click cannot feed back into React Flow's store.
  const canvasNodes = useMemo(() => projected.nodes.map((node) => {
    const selected = node.id === selectedNodeId;
    return selected === (node.selected === true) ? node : { ...node, selected };
  }), [projected.nodes, selectedNodeId]);
  const handleNodeClick = useCallback<NodeMouseHandler<Node<TopologyCanvasNode>>>((_, node) => {
    const id = (node.data as TopologyCanvasNode).node?.id;
    if (id && id !== selectRef.current.selectedNodeId) selectRef.current.onSelect(id);
  }, []);
  const handlePaneClick = useCallback(() => {
    if (selectRef.current.selectedNodeId) selectRef.current.onSelect("");
  }, []);

  const canvasSize = `${canvas.width}:${canvas.height}`;
  const fitNodesRef = useRef(projected.laneNodes);
  fitNodesRef.current = projected.laneNodes;
  const fit = useCallback(() => {
    const nodes = fitNodesRef.current;
    if (nodes.length) fitRect(getNodesBounds(nodes), 0.06);
  }, [fitRect]);
  const geometryKey = JSON.stringify({
    revision: topology.revision,
    viewId: view?.id ?? "",
    pins: view?.pins ?? {},
    sections: projected.laneNodes.map((node) => [node.id, node.position.x, node.position.y, node.width, node.height]),
  });
  useEffect(() => { fit(); }, [geometryKey, canvasSize, fit]);

  const focusSeq = focus?.seq;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const request = focusRef.current;
    if (!request) return;
    if (request.kind === "layer") {
      focusLayer(request.id);
      return;
    }
    const position = layout.positions[request.id];
    if (position) void setCenter(position.x + position.width / 2, position.y + position.height / 2, { zoom: Math.max(getZoom(), 0.9), duration: 0 });
    // Only a new request (seq) moves the viewport; layout changes alone do not.
  }, [focusSeq]);

  const tier = useStore((state) => topologyZoomTier(state.transform[2]));

  return (
    <div
      role="region"
      aria-label="Topology graph"
      className={`topology-canvas topology-zoom-${tier} relative h-full w-full`}
      data-zoom-tier={tier}
      data-selected-node={selectedNodeId}
      data-visible-nodes={visibleNodes.length}
      data-visible-edges={visibleEdges.length}
      // Keyboard focus can still scroll React Flow's overflow-hidden panes; the
      // viewport transform is the only source of truth for where the map sits.
      onScrollCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target !== event.currentTarget && (target.scrollLeft || target.scrollTop)) target.scrollTo(0, 0);
      }}
    >
      <ReactFlow
        onInit={onInit}
        nodes={canvasNodes}
        edges={projected.edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable={true}
        deleteKeyCode={null}
        onlyRenderVisibleElements={true}
        fitView={false}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={32} size={1} color="hsl(var(--basalt-border))" />
        <Controls showInteractive={false} showFitView={false} position="bottom-left">
          <ControlButton onClick={fit} aria-label="Fit topology"><Maximize /></ControlButton>
        </Controls>
      </ReactFlow>
      {!visibleNodes.length && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-basalt-muted-foreground">
        <Network className="h-10 w-10 opacity-40" aria-hidden="true" />
        <p>No topology nodes match the current filters.</p>
      </div>}
    </div>
  );
}

export function TopologyCanvas(props: Props) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
