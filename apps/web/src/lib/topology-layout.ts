import type { Topology, TopologyPoint, TopologyView } from "@steed/api/shared";

export const TOPOLOGY_HOST_WIDTH = 240;
export const TOPOLOGY_HOST_HEIGHT = 152;
export const TOPOLOGY_SATELLITE_WIDTH = 220;
export const TOPOLOGY_SATELLITE_HEIGHT = 152;
export const TOPOLOGY_SUB_SATELLITE_INDENT = 32;
export const TOPOLOGY_LAYOUT_GAP_X = 24;
export const TOPOLOGY_LAYOUT_GAP_Y = 16;
export const TOPOLOGY_LANE_PADDING_X = 32;
export const TOPOLOGY_LANE_PADDING_Y = 32;
export const TOPOLOGY_DEFAULT_COLUMNS = 4;

export interface TopologyLayoutPosition extends TopologyPoint {
  width: number;
  height: number;
}

export interface TopologyLayoutBlock {
  id: string;
  hostId: string | null;
  kind: "host" | "satellite" | "sub-satellite";
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIds: string[];
}

export interface TopologyLayoutLane {
  id: string;
  layerId: string;
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
  blockIds: string[];
}

export interface TopologyLayoutResult {
  positions: Record<string, TopologyLayoutPosition>;
  nodePositions: Record<string, TopologyLayoutPosition>;
  blocks: TopologyLayoutBlock[];
  lanes: TopologyLayoutLane[];
  width: number;
  height: number;
}

export interface TopologyLayoutOptions {
  viewId?: string;
  view?: TopologyView;
  pins?: Record<string, TopologyPoint>;
  columns?: number;
  origin?: TopologyPoint;
}

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ReservedRectangle extends Rectangle {
  ownerHostId?: string;
  fixed?: boolean;
}

interface SatelliteLayout {
  satelliteId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: Array<{ id: string; x: number; y: number }>;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function overlaps(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function firstBoundaryId(topology: Topology, nodeId: string): string {
  const node = topology.nodes.find((candidate) => candidate.id === nodeId);
  if (!node?.boundaryIds.length) return "\uffff";
  return [...node.boundaryIds].sort(compareIds)[0] ?? "\uffff";
}

function satelliteChildren(topology: Topology, parentId: string): string[] {
  return topology.nodes.filter((node) => node.parentId === parentId).map((node) => node.id).sort(compareIds);
}

function rootHosts(topology: Topology, layerId: string): string[] {
  return topology.nodes
    .filter((node) => node.layerId === layerId && node.parentId === undefined)
    .map((node) => node.id)
    .sort((a, b) => {
      const boundary = compareIds(firstBoundaryId(topology, a), firstBoundaryId(topology, b));
      return boundary || compareIds(a, b);
    });
}

function satelliteBlockHeight(childCount: number): number {
  return childCount
    ? TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y + childCount * TOPOLOGY_SATELLITE_HEIGHT + Math.max(0, childCount - 1) * TOPOLOGY_LAYOUT_GAP_Y
    : TOPOLOGY_SATELLITE_HEIGHT;
}

function satelliteBlockWidth(childCount: number): number {
  return childCount ? TOPOLOGY_SATELLITE_WIDTH + TOPOLOGY_SUB_SATELLITE_INDENT : TOPOLOGY_SATELLITE_WIDTH;
}

function unionRectangle(rectangles: Rectangle[]): Rectangle | null {
  if (!rectangles.length) return null;
  const x = Math.min(...rectangles.map((rectangle) => rectangle.x));
  const y = Math.min(...rectangles.map((rectangle) => rectangle.y));
  const right = Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width));
  const bottom = Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height));
  return { x, y, width: right - x, height: bottom - y };
}

function childPositions(satelliteX: number, satelliteY: number, childIds: string[]): Array<{ id: string; x: number; y: number }> {
  return childIds.map((id, index) => ({
    id,
    x: satelliteX + TOPOLOGY_SUB_SATELLITE_INDENT,
    y: satelliteY + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y + index * (TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y),
  }));
}

function movedSatelliteLayout(topology: Topology, satelliteId: string, pins: Map<string, TopologyPoint>): SatelliteLayout | null {
  const children = satelliteChildren(topology, satelliteId);
  const satellitePin = pins.get(satelliteId);
  if (satellitePin) {
    const layoutChildren = childPositions(satellitePin.x, satellitePin.y, children);
    return {
      satelliteId,
      x: satellitePin.x,
      y: satellitePin.y,
      width: satelliteBlockWidth(children.length),
      height: satelliteBlockHeight(children.length),
      children: layoutChildren,
    };
  }

  const pinnedChild = [...children].sort(compareIds).find((id) => pins.has(id));
  if (!pinnedChild) return null;
  const pinned = pins.get(pinnedChild);
  if (!pinned) return null;
  const childIndex = children.indexOf(pinnedChild);
  const satelliteX = pinned.x - TOPOLOGY_SUB_SATELLITE_INDENT;
  const satelliteY = pinned.y - TOPOLOGY_SATELLITE_HEIGHT - TOPOLOGY_LAYOUT_GAP_Y - childIndex * (TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y);
  const layoutChildren = childPositions(satelliteX, satelliteY, children);
  const selectedIndex = layoutChildren.findIndex((child) => child.id === pinnedChild);
  const selected = layoutChildren[selectedIndex];
  if (selected) {
    selected.x = pinned.x;
    selected.y = pinned.y;
  }
  return {
    satelliteId,
    x: satelliteX,
    y: satelliteY,
    width: satelliteBlockWidth(children.length),
    height: satelliteBlockHeight(children.length),
    children: layoutChildren,
  };
}

function defaultSatelliteLayout(topology: Topology, hostX: number, satelliteId: string, satelliteY: number): SatelliteLayout {
  const children = satelliteChildren(topology, satelliteId);
  const x = hostX + TOPOLOGY_HOST_WIDTH + TOPOLOGY_LAYOUT_GAP_X;
  return {
    satelliteId,
    x,
    y: satelliteY,
    width: satelliteBlockWidth(children.length),
    height: satelliteBlockHeight(children.length),
    children: childPositions(x, satelliteY, children),
  };
}

function satelliteLayouts(topology: Topology, hostId: string, hostX: number, hostY: number, moved: Map<string, SatelliteLayout>, ignoreMoved: boolean): SatelliteLayout[] {
  const satellites = satelliteChildren(topology, hostId);
  let satelliteY = hostY;
  const layouts: SatelliteLayout[] = [];
  for (const satelliteId of satellites) {
    const movedLayout = ignoreMoved ? undefined : moved.get(satelliteId);
    const layout = movedLayout ?? defaultSatelliteLayout(topology, hostX, satelliteId, satelliteY);
    layouts.push(layout);
    satelliteY += layout.height + TOPOLOGY_LAYOUT_GAP_Y;
  }
  return layouts;
}

function computeMovingCandidateRectangles(topology: Topology, hostId: string, hostX: number, hostY: number, moved: Map<string, SatelliteLayout>): Rectangle[] {
  const rectangles: Rectangle[] = [{ x: hostX, y: hostY, width: TOPOLOGY_HOST_WIDTH, height: TOPOLOGY_HOST_HEIGHT }];
  for (const satellite of satelliteLayouts(topology, hostId, hostX, hostY, moved, false)) {
    if (moved.has(satellite.satelliteId)) continue;
    rectangles.push({ x: satellite.x, y: satellite.y, width: satellite.width, height: satellite.height });
    for (const child of satellite.children) {
      rectangles.push({ x: child.x, y: child.y, width: TOPOLOGY_SATELLITE_WIDTH, height: TOPOLOGY_SATELLITE_HEIGHT });
    }
  }
  return rectangles;
}

function computeComposite(hostX: number, hostY: number, satellites: SatelliteLayout[]): Rectangle {
  const rectangles: Rectangle[] = [{ x: hostX, y: hostY, width: TOPOLOGY_HOST_WIDTH, height: TOPOLOGY_HOST_HEIGHT }];
  for (const satellite of satellites) {
    rectangles.push({ x: satellite.x, y: satellite.y, width: satellite.width, height: satellite.height });
    for (const child of satellite.children) {
      rectangles.push({ x: child.x, y: child.y, width: TOPOLOGY_SATELLITE_WIDTH, height: TOPOLOGY_SATELLITE_HEIGHT });
    }
  }
  return unionRectangle(rectangles) ?? { x: hostX, y: hostY, width: TOPOLOGY_HOST_WIDTH, height: TOPOLOGY_HOST_HEIGHT };
}

export function layoutTopology(topology: Topology, options: TopologyLayoutOptions = {}): TopologyLayoutResult {
  const selectedView = options.view ?? (options.viewId ? topology.views.find((view) => view.id === options.viewId) : undefined);
  const pins = new Map(Object.entries(options.pins ?? selectedView?.pins ?? {}));
  const columns = Math.max(1, options.columns ?? TOPOLOGY_DEFAULT_COLUMNS);
  const origin = options.origin ?? { x: 0, y: 0 };
  const positions: Record<string, TopologyLayoutPosition> = {};
  const blocks: TopologyLayoutBlock[] = [];
  const lanes: TopologyLayoutLane[] = [];
  const occupied: ReservedRectangle[] = [];
  let laneY = origin.y;

  const hostIds = new Set(topology.nodes.filter((node) => node.parentId === undefined).map((node) => node.id));
  const pinnedHostIds = new Set([...hostIds].filter((hostId) => pins.has(hostId)));

  // Pre-reserve every pinned host composite before any unpinned host is packed.
  for (const hostId of pinnedHostIds) {
    const pin = pins.get(hostId);
    if (!pin) continue;
    const satellites = satelliteLayouts(topology, hostId, pin.x, pin.y, new Map(), true);
    occupied.push({ ...computeComposite(pin.x, pin.y, satellites), ownerHostId: hostId, fixed: true });
  }

  // Pre-reserve every moved satellite/sub-satellite block before unpinned peers are packed.
  const movedSatellites = new Map<string, SatelliteLayout>();
  for (const hostId of hostIds) {
    if (pinnedHostIds.has(hostId)) continue;
    for (const satelliteId of satelliteChildren(topology, hostId)) {
      const moved = movedSatelliteLayout(topology, satelliteId, pins);
      if (!moved) continue;
      movedSatellites.set(satelliteId, moved);
      const composite = unionRectangle([
        { x: moved.x, y: moved.y, width: moved.width, height: moved.height },
        ...moved.children.map((child) => ({ x: child.x, y: child.y, width: TOPOLOGY_SATELLITE_WIDTH, height: TOPOLOGY_SATELLITE_HEIGHT })),
      ]);
      if (composite) occupied.push({ ...composite, ownerHostId: hostId, fixed: true });
    }
  }

  const layers = [...topology.layers].sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
  for (const layer of layers) {
    const hostIdsInLane = rootHosts(topology, layer.id);
    const laneX = origin.x;
    const laneTop = laneY;
    const laneBlockIds: string[] = [];
    let laneMaxX = laneX;
    let laneMaxY = laneTop;

    for (let index = 0; index < hostIdsInLane.length; index++) {
      const hostId = hostIdsInLane[index];
      if (!hostId) continue;
      const hostPin = pins.get(hostId);
      let hostX: number;
      let hostY: number;

      if (hostPin) {
        hostX = hostPin.x;
        hostY = hostPin.y;
      } else {
        const gridColumn = index % columns;
        const gridRow = Math.floor(index / columns);
        const startsAt = gridRow * columns + gridColumn;
        let candidateX = laneX + TOPOLOGY_LANE_PADDING_X + gridColumn * (TOPOLOGY_HOST_WIDTH + TOPOLOGY_LAYOUT_GAP_X);
        let candidateY = laneTop + TOPOLOGY_LANE_PADDING_Y + gridRow * (TOPOLOGY_HOST_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y);
        let found = false;
        const maxCandidateCount = 2000;
        for (let attempt = 0; attempt < maxCandidateCount; attempt++) {
          const scan = startsAt + attempt;
          const scanColumn = scan % columns;
          const scanRow = Math.floor(scan / columns);
          candidateX = laneX + TOPOLOGY_LANE_PADDING_X + scanColumn * (TOPOLOGY_HOST_WIDTH + TOPOLOGY_LAYOUT_GAP_X);
          candidateY = laneTop + TOPOLOGY_LANE_PADDING_Y + scanRow * (TOPOLOGY_HOST_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y);
          const moving = computeMovingCandidateRectangles(topology, hostId, candidateX, candidateY, movedSatellites);
          const collides = occupied.some((rectangle) => {
            if (rectangle.fixed) return moving.some((movingRectangle) => overlaps(movingRectangle, rectangle));
            return rectangle.ownerHostId !== hostId && moving.some((movingRectangle) => overlaps(movingRectangle, rectangle));
          });
          if (!collides) {
            found = true;
            break;
          }
        }
        if (!found) {
          const occupiedBottom = occupied.length
            ? Math.max(...occupied.map((rectangle) => rectangle.y + rectangle.height))
            : laneTop;
          candidateX = laneX + TOPOLOGY_LANE_PADDING_X;
          candidateY = occupiedBottom + TOPOLOGY_LAYOUT_GAP_Y;
        }
        hostX = candidateX;
        hostY = candidateY;
      }

      const satellites = satelliteLayouts(topology, hostId, hostX, hostY, movedSatellites, hostPin !== undefined);
      positions[hostId] = { x: hostX, y: hostY, width: TOPOLOGY_HOST_WIDTH, height: TOPOLOGY_HOST_HEIGHT };
      const composite = computeComposite(hostX, hostY, satellites);
      blocks.push({
        id: hostId,
        hostId,
        kind: "host",
        x: composite.x,
        y: composite.y,
        width: composite.width,
        height: composite.height,
        nodeIds: [hostId, ...satellites.flatMap((layout) => [layout.satelliteId, ...layout.children.map((child) => child.id)])],
      });
      laneBlockIds.push(hostId);
      occupied.push({ ...composite, ownerHostId: hostId, fixed: false });
      laneMaxX = Math.max(laneMaxX, composite.x + composite.width);
      laneMaxY = Math.max(laneMaxY, composite.y + composite.height);

      for (const satellite of satellites) {
        blocks.push({
          id: satellite.satelliteId,
          hostId,
          kind: "satellite",
          x: satellite.x,
          y: satellite.y,
          width: satellite.width,
          height: satellite.height,
          nodeIds: [satellite.satelliteId, ...satellite.children.map((child) => child.id)],
        });
        laneBlockIds.push(satellite.satelliteId);
        positions[satellite.satelliteId] = { x: satellite.x, y: satellite.y, width: TOPOLOGY_SATELLITE_WIDTH, height: TOPOLOGY_SATELLITE_HEIGHT };
        laneMaxX = Math.max(laneMaxX, satellite.x + satellite.width);
        laneMaxY = Math.max(laneMaxY, satellite.y + satellite.height);
        for (const child of satellite.children) {
          blocks.push({ id: child.id, hostId, kind: "sub-satellite", x: child.x, y: child.y, width: TOPOLOGY_SATELLITE_WIDTH, height: TOPOLOGY_SATELLITE_HEIGHT, nodeIds: [child.id] });
          laneBlockIds.push(child.id);
          positions[child.id] = { x: child.x, y: child.y, width: TOPOLOGY_SATELLITE_WIDTH, height: TOPOLOGY_SATELLITE_HEIGHT };
          laneMaxX = Math.max(laneMaxX, child.x + TOPOLOGY_SATELLITE_WIDTH);
          laneMaxY = Math.max(laneMaxY, child.y + TOPOLOGY_SATELLITE_HEIGHT);
        }
      }
    }

    const laneWidth = Math.max(TOPOLOGY_HOST_WIDTH + TOPOLOGY_LANE_PADDING_X * 2, laneMaxX - laneX);
    const laneHeight = Math.max(TOPOLOGY_HOST_HEIGHT + TOPOLOGY_LANE_PADDING_Y * 2, laneMaxY - laneTop);
    lanes.push({ id: layer.id, layerId: layer.id, order: layer.order, x: laneX, y: laneTop, width: laneWidth, height: laneHeight, blockIds: laneBlockIds });
    laneY = laneTop + laneHeight + TOPOLOGY_LAYOUT_GAP_Y;
  }

  return {
    positions,
    nodePositions: positions,
    blocks,
    lanes,
    width: lanes.length ? Math.max(...lanes.map((lane) => lane.x + lane.width)) : 0,
    height: lanes.length ? laneY - TOPOLOGY_LAYOUT_GAP_Y : 0,
  };
}

export const projectTopologyLayout = layoutTopology;
