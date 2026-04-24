import { useCallback, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "reactflow";
import "reactflow/dist/style.css";

import { HostNode } from "./nodes/host-node";
import { AgentNode } from "./nodes/agent-node";
import { DataSourceNode } from "./nodes/data-source-node";
import { layoutThreeColumn } from "./layout";
import {
  LANE_COLORS,
  type MapEdge,
  type MapGraph,
  type MapNode,
  type MapNodeData,
} from "@/lib/map-data";

const nodeTypes = {
  host: HostNode,
  agent: AgentNode,
  data_source: DataSourceNode,
};

interface LaneMapProps {
  graph: MapGraph;
  onNodeClick?: (node: MapNode) => void;
}

function toFlowNodes(graph: MapGraph): Node<MapNodeData>[] {
  return layoutThreeColumn(graph.nodes).map((p) => ({
    id: p.id,
    type: p.type,
    position: p.position,
    data: p.data,
  }));
}

function toFlowEdges(edges: MapEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    style: { stroke: LANE_COLORS[e.laneKey].stroke, strokeWidth: 2 },
    animated: false,
  }));
}

function LaneMapInner({ graph, onNodeClick }: LaneMapProps) {
  const nodes = useMemo(() => toFlowNodes(graph), [graph]);
  const edges = useMemo(() => toFlowEdges(graph.edges), [graph.edges]);

  const handleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (!onNodeClick) return;
      const orig = graph.nodes.find((n) => n.id === node.id);
      if (orig) onNodeClick(orig);
    },
    [graph, onNodeClick]
  );

  return (
    <div
      role="region"
      aria-label="Lane map"
      className="h-[640px] w-full rounded-lg border bg-background"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        fitView
        onNodeClick={handleClick}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

export function LaneMap(props: LaneMapProps) {
  return (
    <ReactFlowProvider>
      <LaneMapInner {...props} />
    </ReactFlowProvider>
  );
}
