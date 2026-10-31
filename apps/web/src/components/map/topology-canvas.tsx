import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import ReactFlow, { Background, ControlButton, Controls, Handle, MarkerType, Position, ReactFlowProvider, getNodesBounds, getViewportForBounds, useNodesState, useReactFlow, useStore, type Edge, type Node, type NodeProps, type ReactFlowInstance } from "reactflow";
import { Badge } from "@nocoo/basalt";
import { Layers, Maximize, Network, Server } from "lucide-react";
import type { Topology, TopologyEdge, TopologyNode, TopologyView } from "@steed/api/shared";
import {
  layoutTopology,
  TOPOLOGY_HOST_HEIGHT,
  TOPOLOGY_HOST_WIDTH,
  TOPOLOGY_SATELLITE_HEIGHT,
  TOPOLOGY_SATELLITE_WIDTH,
} from "@/lib/topology-layout";
import "reactflow/dist/style.css";

export interface TopologyCanvasNode {
  label: string;
  kind: "lane" | "host" | "satellite" | "sub-satellite";
  node?: TopologyNode;
  laneLabel?: string;
  badges?: { label: string; value: string }[];
  boundaryLabels?: string[];
  lifecycle?: TopologyNode["lifecycle"];
  onSelect?: (id: string) => void;
}

export interface TopologyCanvasEdge {
  edge: TopologyEdge;
}

export const TOPOLOGY_NODE_VISIBLE_BADGES = 6;
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

const NodeCard = memo(function NodeCard({ data, selected }: NodeProps<TopologyCanvasNode>) {
  const width = data.kind === "host" ? TOPOLOGY_HOST_WIDTH : TOPOLOGY_SATELLITE_WIDTH;
  const height = data.kind === "host" ? TOPOLOGY_HOST_HEIGHT : TOPOLOGY_SATELLITE_HEIGHT;
  const visibleBadges = data.badges?.slice(0, TOPOLOGY_NODE_VISIBLE_BADGES) ?? [];
  const visibleBoundaries = data.boundaryLabels?.slice(0, TOPOLOGY_NODE_VISIBLE_BOUNDARY_CHIPS) ?? [];
  const boundaryOverflow = Math.max(0, (data.boundaryLabels?.length ?? 0) - visibleBoundaries.length);
  const completeBoundaryLabels = data.boundaryLabels?.join(", ") ?? "";
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-lg border bg-basalt-card text-basalt-card-foreground shadow-sm transition-colors${selected ? " border-basalt-primary ring-2 ring-basalt-primary/30" : " border-basalt-border"}`}
      style={{ width, height }}
      role={data.node ? "button" : undefined}
      tabIndex={data.node ? 0 : undefined}
      aria-label={data.node ? `Select ${data.label}` : data.kind}
      data-testid={`topology-node-card-${data.node?.id ?? data.kind}`}
      onKeyDown={(event) => {
        if (data.node && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          data.onSelect?.(data.node.id);
        }
      }}
    >
      <Handle type="target" position={Position.Left} id="t-left" isConnectable={false} className="!h-2 !w-2 !border-0 !bg-basalt-primary" />
      <Handle type="source" position={Position.Right} id="s-right" isConnectable={false} className="!h-2 !w-2 !border-0 !bg-basalt-primary" />
      <div className="flex items-start gap-2 px-3 py-2">
        {data.kind === "host" ? <Server className="mt-0.5 h-4 w-4 shrink-0 text-basalt-primary" /> : <Network className="mt-0.5 h-4 w-4 shrink-0 text-basalt-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" title={data.label}>{data.label}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-basalt-muted-foreground">{data.kind}</div>
        </div>
        {data.lifecycle && <Badge variant="outline" className="shrink-0 text-[10px]">{data.lifecycle}</Badge>}
      </div>
      <div className="mt-auto grid grid-cols-2 gap-1 px-3 pb-2" aria-label="Topology node details">
        {visibleBadges.map((badge) => <Badge key={`${badge.label}:${badge.value}`} variant="secondary" className="h-5 max-w-full text-[10px]" title={`${badge.label}: ${badge.value}`}>
          <span className="block truncate">{badge.label}: {badge.value}</span>
        </Badge>)}
        {visibleBoundaries.map((label) => <Badge key={label} variant="outline" className="h-5 max-w-full text-[10px]" title={label} aria-label={`Boundary: ${label}`}>
          <span className="block truncate">{label}</span>
        </Badge>)}
        {boundaryOverflow > 0 && <Badge variant="outline" className="h-5 max-w-full text-[10px]" title={completeBoundaryLabels} aria-label={`Boundaries: ${completeBoundaryLabels}`}>
          <span className="block truncate">+{boundaryOverflow} boundaries</span>
        </Badge>}
      </div>
    </div>
  );
});

const LaneNode = memo(function LaneNode({ data }: NodeProps<TopologyCanvasNode>) {
  return (
    <div className="h-full w-full rounded-xl border border-basalt-border/70 bg-basalt-secondary/20 px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-basalt-muted-foreground"><Layers className="h-4 w-4" />{data.laneLabel}</div>
    </div>
  );
});

const nodeTypes = { topologyNode: NodeCard, topologyLane: LaneNode };

interface Props {
  topology: Topology;
  visibleNodes: TopologyNode[];
  visibleEdges: TopologyEdge[];
  view?: TopologyView;
  selectedNodeId: string;
  onSelect: (id: string) => void;
  onInit?: (instance: ReactFlowInstance<TopologyCanvasNode, TopologyCanvasEdge>) => void;
}

function Canvas({ topology, visibleNodes, visibleEdges, view, selectedNodeId, onSelect, onInit }: Props) {
  const projected = useMemo(() => {
    const layout = layoutTopology(topology, view ? { view } : {});
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const laneNodes: Node<TopologyCanvasNode>[] = layout.lanes.map((lane) => ({
      id: `lane:${lane.id}`,
      type: "topologyLane",
      position: { x: lane.x, y: lane.y },
      width: lane.width,
      height: lane.height,
      selectable: false,
      draggable: false,
      zIndex: -2,
      data: { label: lane.layerId, kind: "lane", laneLabel: topology.layers.find((layer) => layer.id === lane.layerId)?.label ?? lane.layerId },
      style: { width: lane.width, height: lane.height },
    }));
    const nodeLayer: Node<TopologyCanvasNode>[] = [];
    for (const node of visibleNodes) {
      const position = layout.positions[node.id];
      if (!position) continue;
      const parent = node.parentId ? topology.nodes.find((candidate) => candidate.id === node.parentId) : undefined;
      const kind = !parent ? "host" : parent.parentId ? "sub-satellite" : "satellite";
      const boundaries = topologyNodeBoundaryLabels(topology, node);
      nodeLayer.push({
        id: node.id,
        type: "topologyNode",
        position: { x: position.x, y: position.y },
        width: kind === "host" ? TOPOLOGY_HOST_WIDTH : TOPOLOGY_SATELLITE_WIDTH,
        height: kind === "host" ? TOPOLOGY_HOST_HEIGHT : TOPOLOGY_SATELLITE_HEIGHT,
        selectable: true,
        ariaLabel: `Select ${node.label}`,
        selected: node.id === selectedNodeId,
        draggable: false,
        zIndex: 2,
        data: {
          label: node.label,
          kind,
          node,
          badges: topologyNodeBadgeValues(topology, node),
          boundaryLabels: boundaries,
          lifecycle: node.lifecycle,
          onSelect,
        },
      });
    }

    const edges: Edge<TopologyCanvasEdge>[] = visibleEdges
      .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
      .map((edge) => ({
        id: `topology-edge:${edge.id}`,
        source: edge.source,
        target: edge.target,
        label: edge.label || edge.kind,
        type: "smoothstep",
        sourceHandle: "s-right",
        targetHandle: "t-left",
        animated: edge.style?.animated === true,
        markerStart: edge.direction === "bi" ? { type: MarkerType.ArrowClosed, width: 16, height: 16 } : undefined,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: {
          strokeWidth: edge.style?.width ?? 1.5,
          strokeDasharray: edge.style?.dash === "solid" ? undefined
            : edge.style?.dash === "dotted" ? "2 5"
              : edge.style?.dash === "dashed" ? "6 5"
                : edge.evidence === "inferred" ? "6 5" : undefined,
        },
        data: { edge },
      }));
    return { nodes: [...laneNodes, ...nodeLayer], edges, layout };
  }, [topology, visibleNodes, visibleEdges, view, selectedNodeId]);

  const [canvasNodes, setCanvasNodes, onNodesChange] = useNodesState(projected.nodes);
  useEffect(() => { setCanvasNodes(projected.nodes); }, [projected.nodes, setCanvasNodes]);
  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes.filter((change) => change.type === "select" || change.type === "dimensions"));
  }, [onNodesChange]);

  const { setViewport } = useReactFlow();
  const canvas = useStore((state) => ({ width: state.width, height: state.height }));
  const canvasSize = `${canvas.width}:${canvas.height}`;
  const fitNodes = useMemo(() => projected.nodes.filter((node) => node.type === "topologyNode" && !node.hidden), [projected.nodes]);
  const fitNodesRef = useRef(fitNodes);
  const canvasRef = useRef(canvas);
  fitNodesRef.current = fitNodes;
  canvasRef.current = canvas;
  const fit = useCallback(() => {
    const nodes = fitNodesRef.current;
    const { width, height } = canvasRef.current;
    if (!nodes.length || width <= 0 || height <= 0) return;
    const bounds = getNodesBounds(nodes);
    const viewport = getViewportForBounds(bounds, width, height, 0.05, 1, 0.15);
    setViewport(viewport, { duration: 0 });
  }, [setViewport]);
  const geometryKey = JSON.stringify({
    revision: topology.revision,
    viewId: view?.id ?? "",
    pins: view?.pins ?? {},
    nodes: fitNodes.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y, width: node.width, height: node.height })),
  });
  useEffect(() => { fit(); }, [geometryKey, canvasSize, fit]);

  return (
    <div role="region" aria-label="Topology graph" className="relative h-full w-full" data-visible-nodes={visibleNodes.length} data-visible-edges={visibleEdges.length}>
      <ReactFlow
        onInit={onInit}
        nodes={canvasNodes}
        edges={projected.edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => { if (node.data.node) onSelect(node.data.node.id); }}
        onSelectionChange={({ nodes }) => { const node = nodes.find((candidate) => candidate.data.node); if (node?.data.node) onSelect(node.data.node.id); }}
        onNodesChange={handleNodesChange}
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
        <Background gap={24} size={1} color="var(--diagram-dot)" />
        <Controls showInteractive={false} showFitView={false}>
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
