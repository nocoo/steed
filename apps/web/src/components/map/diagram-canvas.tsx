import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, { Background, ControlButton, Controls, Handle, MiniMap, Position, ReactFlowProvider, useNodesState, useReactFlow, useStore, type Connection, type NodeProps } from "reactflow";
import { Blocks, Box, Cloud, Container, Database, Globe, HardDrive, Layers, Map, Maximize, Monitor, Network, Radio, Server, Shield } from "lucide-react";
import type { Diagram, DiagramEdge, DiagramPoint } from "@steed/api/shared";
import { COMPONENT_HEIGHT, COMPONENT_WIDTH, graphBounds, projectDiagram, type DiagramCanvasNode, type DiagramFilter } from "@/lib/diagram-graph";
import "reactflow/dist/style.css";
import { DiagramEdgeView } from "./diagram-edge";

const icons = { client: Monitor, gateway: Shield, worker: Cloud, service: Box, database: Database, cache: Blocks, storage: HardDrive,
  host: Server, container: Container, monitor: Radio, external: Globe, group: Layers };
const ports = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom };

const ComponentNode = memo(function ComponentNode({ data, selected }: NodeProps<DiagramCanvasNode>) {
  const Icon = icons[data.kind];
  const zoom = useStore((state) => state.transform[2]);
  const compact = zoom < 0.8;
  return (
    <div className={`architecture-component${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}`} data-kind={data.kind} style={{ width: COMPONENT_WIDTH, height: COMPONENT_HEIGHT }}>
      {Object.entries(ports).map(([side, position]) => (
        <span key={side}>
          <Handle type="target" position={position} id={`t-${side}`} />
          <Handle type="source" position={position} id={`s-${side}`} />
        </span>
      ))}
      {!compact && <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-basalt-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{data.kind === "group" ? "Boundary" : data.kind}</span>
        {data.count !== undefined && <span className="ml-auto font-mono">{data.count} components</span>}
      </div>}
      <div className="line-clamp-2 font-semibold leading-tight [overflow-wrap:anywhere]" style={{ fontSize: Math.min(26, 14 / zoom) }} title={data.label}>{data.label}</div>
      {!compact && data.node?.tags.length ? <div className="mt-1 truncate font-mono text-[10px] text-basalt-muted-foreground">{data.node.tags.join(" · ")}</div> : null}
    </div>
  );
});

const BoundaryNode = memo(function BoundaryNode({ data }: NodeProps<DiagramCanvasNode>) {
  const zoom = useStore((state) => state.transform[2]);
  return <div className="architecture-boundary"><span style={{ fontSize: Math.min(22, 11 / zoom) }}><Layers className="h-3.5 w-3.5" aria-hidden="true" />{data.label}</span></div>;
});
const nodeTypes = { component: ComponentNode, boundary: BoundaryNode };
const edgeTypes = { architecture: DiagramEdgeView };

interface Props {
  document: Diagram;
  filter: DiagramFilter;
  onSelect: (id: string) => void;
  onEdgeSelect: (edges: DiagramEdge[]) => void;
  onExpand: (id: string) => void;
  onMove: (id: string, point: DiagramPoint) => void;
  onConnect: (source: string, target: string) => void;
  disabled?: boolean;
}

function Canvas({ document, filter, onSelect, onEdgeSelect, onExpand, onMove, onConnect, disabled }: Props) {
  const [minimap, setMinimap] = useState(false);
  const projected = useMemo(() => projectDiagram(document, filter), [document, filter]);
  const [nodes, setNodes, onNodesChange] = useNodesState(projected.nodes);
  const { fitBounds } = useReactFlow();
  const canvasSize = useStore((state) => `${state.width}:${state.height}`);
  const bounds = useRef(graphBounds(projected.nodes));
  bounds.current = graphBounds([...projected.nodes, ...projected.edges.flatMap((edge) => [
    ...(edge.data?.route?.waypoints ?? []), ...(edge.data?.route?.labelPosition ? [edge.data.route.labelPosition] : []),
  ].map((position) => ({ position, width: 0, height: 0 })))]);
  const fit = useCallback(() => { void fitBounds(bounds.current, { padding: 0.15 }); }, [fitBounds]);
  const signature = `${filter.viewId ?? ""}|${projected.nodes.map((node) => node.id).join("|")}`;
  useEffect(() => { setNodes(projected.nodes); }, [projected.nodes, setNodes]);
  useEffect(() => {
    const timer = window.setTimeout(fit, 80);
    return () => window.clearTimeout(timer);
  }, [signature, canvasSize, fit]);

  const connect = (connection: Connection) => {
    if (connection.source?.startsWith("n:") && connection.target?.startsWith("n:")) onConnect(connection.source.slice(2), connection.target.slice(2));
  };
  return (
    <div role="region" aria-label="Architecture diagram" className="diagram-canvas relative h-full w-full" data-visible-nodes={projected.visibleNodeIds.length} data-visible-edges={projected.edges.length}>
      <ReactFlow nodes={nodes} edges={projected.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
        onNodeClick={(_, node) => { if (node.data.node) onSelect(node.data.node.id); else if (node.data.group) onExpand(node.data.group.id); }}
        onEdgeClick={(_, edge) => { if (edge.data) onEdgeSelect(edge.data.relationships); }}
        onNodeDragStop={(_, node) => { if (node.data.node) onMove(node.data.node.id, node.position); }}
        onConnect={connect} nodesDraggable={!disabled} nodesConnectable={!disabled} deleteKeyCode={null}
        minZoom={0.05} maxZoom={2} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} proOptions={{ hideAttribution: true }}>
        <Background gap={24} size={1} color="var(--diagram-dot)" />
        <Controls showInteractive={false} showFitView={false}>
          <ControlButton onClick={fit} aria-label="Fit diagram"><Maximize /></ControlButton>
          <ControlButton onClick={() => setMinimap((value) => !value)} aria-label="Toggle minimap" aria-pressed={minimap}><Map /></ControlButton>
        </Controls>
        {minimap && <MiniMap pannable zoomable nodeColor={(node) => node.type === "boundary" ? "transparent" : "#94a3b8"} />}
      </ReactFlow>
      {!projected.visibleNodeIds.length && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-basalt-muted-foreground">
        <Network className="h-10 w-10 opacity-40" aria-hidden="true" /><p>Add a component or import a diagram to begin.</p>
      </div>}
    </div>
  );
}

export function DiagramCanvas(props: Props) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>; }
