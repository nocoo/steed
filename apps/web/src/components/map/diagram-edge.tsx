import { BaseEdge, EdgeText, getSmoothStepPath, Position, useStore, type EdgeProps } from "reactflow";
import type { DiagramPoint } from "@steed/api/shared";
import type { DiagramCanvasEdge } from "@/lib/diagram-graph";

export function waypointPath(points: [DiagramPoint, ...DiagramPoint[]]): [string, number, number] {
  let previous = points[0];
  const segments = points.slice(1).map((point) => {
    const segment = { from: previous, to: point, length: Math.hypot(point.x - previous.x, point.y - previous.y) };
    previous = point;
    return segment;
  });
  let remaining = segments.reduce((sum, segment) => sum + segment.length, 0) / 2;
  let middle = points[0];
  for (const { length, from, to } of segments) {
    if (remaining <= length && length > 0) {
      middle = { x: from.x + (to.x - from.x) * remaining / length, y: from.y + (to.y - from.y) * remaining / length };
      break;
    }
    remaining -= length;
  }
  return [points.map((point, i) => `${i ? "L" : "M"}${point.x},${point.y}`).join(" "), middle.x, middle.y];
}

export function DiagramEdgeView(props: EdgeProps<DiagramCanvasEdge>) {
  const zoom = useStore((state) => state.transform[2]);
  const route = props.data?.route;
  const waypoints = route?.waypoints ?? (props.source === props.target ? [
    { x: props.sourceX + 48, y: props.sourceY }, { x: props.sourceX + 48, y: props.targetY - 48 }, { x: props.targetX, y: props.targetY - 48 },
  ] : undefined);
  const [path, x, y] = waypoints ? waypointPath([{ x: props.sourceX, y: props.sourceY }, ...waypoints, { x: props.targetX, y: props.targetY }]) : getSmoothStepPath(props);
  const vertical = props.sourcePosition === Position.Top || props.sourcePosition === Position.Bottom;
  return <>
    <BaseEdge path={path} markerEnd={props.markerEnd} style={props.style} />
    <EdgeText x={route?.labelPosition?.x ?? x} y={route?.labelPosition?.y ?? y - (vertical ? 0 : 14 / zoom)} label={props.label}
      labelStyle={{ fill: "var(--diagram-ink)", fontSize: Math.min(20, 10 / zoom) }}
      labelBgStyle={{ fill: "var(--diagram-paper)" }} labelBgPadding={[5, 4]} labelBgBorderRadius={4} />
  </>;
}
