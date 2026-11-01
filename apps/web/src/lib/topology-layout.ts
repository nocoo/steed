import type { Topology, TopologyBoundary, TopologyNode, TopologyPoint, TopologyView } from "@steed/api/shared";
import { resolveStyles, TOPOLOGY_HOST_SIZE_TABLE, TOPOLOGY_SATELLITE_HEIGHT, TOPOLOGY_SATELLITE_INDENT, TOPOLOGY_SUB_SATELLITE_INDENT } from "./topology-style";

// Card sizes. Satellites and sub-satellites stack under their host in one column.
export const TOPOLOGY_HOST_WIDTH = TOPOLOGY_HOST_SIZE_TABLE.m.width;
export const TOPOLOGY_HOST_HEIGHT = TOPOLOGY_HOST_SIZE_TABLE.m.height;
export { TOPOLOGY_SATELLITE_INDENT, TOPOLOGY_SATELLITE_HEIGHT, TOPOLOGY_SUB_SATELLITE_INDENT };
export const TOPOLOGY_SATELLITE_WIDTH = TOPOLOGY_HOST_WIDTH - TOPOLOGY_SATELLITE_INDENT;
export const TOPOLOGY_SUB_SATELLITE_WIDTH = TOPOLOGY_HOST_WIDTH - TOPOLOGY_SUB_SATELLITE_INDENT;
export const TOPOLOGY_STACK_GAP = 12;

// Spacing between composites, inside boundary frames and inside layer sections.
export const TOPOLOGY_ITEM_GAP = 64;
export const TOPOLOGY_FRAME_PADDING = 32;
export const TOPOLOGY_FRAME_HEADER = 36;
export const TOPOLOGY_SECTION_PADDING = 40;
export const TOPOLOGY_SECTION_HEADER = 96;
export const TOPOLOGY_SECTION_GAP = 160;
export const TOPOLOGY_TARGET_ASPECT = 1.6;

const BOUNDARY_KIND_PRIORITY: Record<TopologyBoundary["kind"], number> = { trust: 0, site: 1, network: 2, account: 3 };

export interface TopologyLayoutPosition extends TopologyPoint {
  width: number;
  height: number;
}

/** One host with its satellites and sub-satellites, stacked in a column. */
export interface TopologyLayoutBlock {
  id: string;
  hostId: string;
  kind: "host";
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIds: string[];
}

/** A titled region for one layer. */
export interface TopologyLayoutLane {
  id: string;
  layerId: string;
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
  blockIds: string[];
  nodeIds: string[];
}

/** A boundary frame inside a layer section. Frames nest and never overlap. */
export interface TopologyLayoutFrame {
  id: string;
  layerId: string;
  boundaryId: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIds: string[];
}

export interface TopologyLayoutResult {
  positions: Record<string, TopologyLayoutPosition>;
  nodePositions: Record<string, TopologyLayoutPosition>;
  blocks: TopologyLayoutBlock[];
  lanes: TopologyLayoutLane[];
  frames: TopologyLayoutFrame[];
  width: number;
  height: number;
}

export interface TopologyLayoutOptions {
  viewId?: string;
  view?: TopologyView;
  /** View pins order hosts (pinned first, by y then x); they are not coordinates. */
  pins?: Record<string, TopologyPoint>;
  origin?: TopologyPoint;
  /** Target width:height of the whole map, used to choose the section grid. */
  aspect?: number;
}

interface Size { width: number; height: number }

/** A placed item relative to its parent, with its own relative children. */
interface Packed extends Size {
  place(x: number, y: number, out: TopologyLayoutResult, layerId: string): void;
  nodeIds: string[];
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Row ("shelf") packing with a width budget. Items keep their order. */
function shelfPack<T extends Size>(items: T[], maxWidth: number, gap: number): { offsets: Array<TopologyPoint & { item: T }>; width: number; height: number } {
  const offsets: Array<TopologyPoint & { item: T }> = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const item of items) {
    if (x > 0 && x + item.width > maxWidth) {
      y += rowHeight + gap;
      x = 0;
      rowHeight = 0;
    }
    offsets.push({ item, x, y });
    x += item.width + gap;
    rowHeight = Math.max(rowHeight, item.height);
    width = Math.max(width, x - gap);
  }
  return { offsets, width, height: items.length ? y + rowHeight : 0 };
}

/** Width budget so a group of items packs to roughly the given aspect. */
function packWidth(items: Size[], gap: number, aspect: number): number {
  const area = items.reduce((sum, item) => sum + (item.width + gap) * (item.height + gap), 0);
  const widest = Math.max(0, ...items.map((item) => item.width));
  return Math.max(widest, Math.sqrt(area * aspect));
}

export function primaryBoundaryId(topology: Topology, node: TopologyNode): string | undefined {
  const priority = new Map(topology.boundaries.map((boundary) => [boundary.id, BOUNDARY_KIND_PRIORITY[boundary.kind]]));
  return node.boundaryIds
    .flatMap((id) => { const rank = priority.get(id); return rank === undefined ? [] : [{ id, rank }]; })
    .sort((a, b) => a.rank - b.rank || compareIds(a.id, b.id))[0]?.id;
}

function boundaryPath(topology: Topology, boundaryId: string | undefined): string[] {
  const byId = new Map(topology.boundaries.map((boundary) => [boundary.id, boundary]));
  const path: string[] = [];
  const seen = new Set<string>();
  let current = boundaryId ? byId.get(boundaryId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function hostComposite(host: TopologyNode, children: Map<string, TopologyNode[]>, styles: Record<string, { width: number; height: number }>): Packed {
  const hostStyle = styles[host.id] ?? { width: TOPOLOGY_HOST_WIDTH, height: TOPOLOGY_HOST_HEIGHT };
  const rows: Array<{ id: string; dx: number; width: number; height: number }> = [{ id: host.id, dx: 0, width: hostStyle.width, height: hostStyle.height }];
  const visit = (parentId: string, seen: Set<string>) => {
    for (const child of children.get(parentId) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      const childStyle = styles[child.id] ?? { width: hostStyle.width - TOPOLOGY_SATELLITE_INDENT, height: TOPOLOGY_SATELLITE_HEIGHT };
      rows.push({ id: child.id, dx: hostStyle.width - childStyle.width, width: childStyle.width, height: childStyle.height });
      visit(child.id, seen);
    }
  };
  visit(host.id, new Set([host.id]));
  const height = rows.reduce((sum, row) => sum + row.height, 0) + (rows.length - 1) * TOPOLOGY_STACK_GAP;
  return {
    width: hostStyle.width,
    height,
    nodeIds: rows.map((row) => row.id),
    place(x, y, out) {
      let rowY = y;
      for (const row of rows) {
        out.positions[row.id] = { x: x + row.dx, y: rowY, width: row.width, height: row.height };
        rowY += row.height + TOPOLOGY_STACK_GAP;
      }
      out.blocks.push({ id: host.id, hostId: host.id, kind: "host", x, y, width: hostStyle.width, height, nodeIds: rows.map((row) => row.id) });
    },
  };
}

interface FrameTree {
  boundaryId: string;
  hosts: Packed[];
  children: Map<string, FrameTree>;
}

function packFrame(tree: FrameTree, depth: number): Packed {
  const items: Packed[] = [
    ...[...tree.children.values()].sort((a, b) => compareIds(a.boundaryId, b.boundaryId)).map((child) => packFrame(child, depth + 1)),
    ...tree.hosts,
  ];
  const packed = shelfPack(items, packWidth(items, TOPOLOGY_ITEM_GAP, TOPOLOGY_TARGET_ASPECT), TOPOLOGY_ITEM_GAP);
  const nodeIds = items.flatMap((item) => item.nodeIds);
  return {
    width: packed.width + 2 * TOPOLOGY_FRAME_PADDING,
    height: packed.height + TOPOLOGY_FRAME_HEADER + 2 * TOPOLOGY_FRAME_PADDING,
    nodeIds,
    place(x, y, out, layerId) {
      out.frames.push({
        id: `frame:${layerId}:${tree.boundaryId}`,
        layerId,
        boundaryId: tree.boundaryId,
        depth,
        x,
        y,
        width: packed.width + 2 * TOPOLOGY_FRAME_PADDING,
        height: packed.height + TOPOLOGY_FRAME_HEADER + 2 * TOPOLOGY_FRAME_PADDING,
        nodeIds,
      });
      for (const offset of packed.offsets) {
        offset.item.place(x + TOPOLOGY_FRAME_PADDING + offset.x, y + TOPOLOGY_FRAME_HEADER + TOPOLOGY_FRAME_PADDING + offset.y, out, layerId);
      }
    },
  };
}

function pinOrder(pins: Map<string, TopologyPoint>, a: string, b: string): number {
  const pa = pins.get(a);
  const pb = pins.get(b);
  if (pa && pb) return pa.y - pb.y || pa.x - pb.x || compareIds(a, b);
  if (pa) return -1;
  if (pb) return 1;
  return compareIds(a, b);
}

export function layoutTopology(topology: Topology, options: TopologyLayoutOptions = {}): TopologyLayoutResult {
  const selectedView = options.view ?? (options.viewId ? topology.views.find((view) => view.id === options.viewId) : undefined);
  const pins = new Map(Object.entries(options.pins ?? selectedView?.pins ?? {}));
  const origin = options.origin ?? { x: 0, y: 0 };
  const aspect = options.aspect ?? TOPOLOGY_TARGET_ASPECT;
  const styles = resolveStyles(topology);
  const result: TopologyLayoutResult = { positions: {}, nodePositions: {}, blocks: [], lanes: [], frames: [], width: 0, height: 0 };
  result.nodePositions = result.positions;

  const children = new Map<string, TopologyNode[]>();
  for (const node of topology.nodes) {
    if (node.parentId === undefined) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => compareIds(a.id, b.id));

  const layers = [...topology.layers].sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
  const sections = layers.map((layer) => {
    const hosts = topology.nodes
      .filter((node) => node.layerId === layer.id && node.parentId === undefined)
      .sort((a, b) => pinOrder(pins, a.id, b.id));
    const root: FrameTree = { boundaryId: "", hosts: [], children: new Map() };
    for (const host of hosts) {
      let tree = root;
      for (const boundaryId of boundaryPath(topology, primaryBoundaryId(topology, host))) {
        let next = tree.children.get(boundaryId);
        if (!next) {
          next = { boundaryId, hosts: [], children: new Map() };
          tree.children.set(boundaryId, next);
        }
        tree = next;
      }
      tree.hosts.push(hostComposite(host, children, styles));
    }
    const items: Packed[] = [
      ...[...root.children.values()].sort((a, b) => compareIds(a.boundaryId, b.boundaryId)).map((tree) => packFrame(tree, 0)),
      ...root.hosts,
    ];
    const packed = shelfPack(items, packWidth(items, TOPOLOGY_ITEM_GAP, aspect), TOPOLOGY_ITEM_GAP);
    return {
      layer,
      items,
      packed,
      width: Math.max(TOPOLOGY_HOST_WIDTH, packed.width) + 2 * TOPOLOGY_SECTION_PADDING,
      height: packed.height + TOPOLOGY_SECTION_HEADER + 2 * TOPOLOGY_SECTION_PADDING,
    };
  });

  // Section grid: uniform column widths and row heights, column count closest to the target aspect.
  let best = { columns: 1, widths: [] as number[], heights: [] as number[], score: Number.POSITIVE_INFINITY };
  for (let columns = 1; columns <= Math.max(1, sections.length); columns++) {
    const widths = Array.from({ length: columns }, (_, column) => Math.max(0, ...sections.filter((_, index) => index % columns === column).map((section) => section.width)));
    const rows = Math.ceil(sections.length / columns);
    const heights = Array.from({ length: rows }, (_, row) => Math.max(0, ...sections.slice(row * columns, row * columns + columns).map((section) => section.height)));
    const width = widths.reduce((sum, value) => sum + value, 0) + (columns - 1) * TOPOLOGY_SECTION_GAP;
    const height = heights.reduce((sum, value) => sum + value, 0) + (rows - 1) * TOPOLOGY_SECTION_GAP;
    const score = height > 0 ? Math.abs(Math.log(width / height / aspect)) : 0;
    if (score < best.score) best = { columns, widths, heights, score };
  }

  let rowY = origin.y;
  best.heights.forEach((height, row) => {
    let columnX = origin.x;
    best.widths.forEach((width, column) => {
      const section = sections[row * best.columns + column];
      if (section) {
        const firstBlock = result.blocks.length;
        for (const offset of section.packed.offsets) {
          offset.item.place(columnX + TOPOLOGY_SECTION_PADDING + offset.x, rowY + TOPOLOGY_SECTION_HEADER + TOPOLOGY_SECTION_PADDING + offset.y, result, section.layer.id);
        }
        result.lanes.push({
          id: section.layer.id,
          layerId: section.layer.id,
          order: section.layer.order,
          x: columnX,
          y: rowY,
          width,
          height,
          blockIds: result.blocks.slice(firstBlock).map((block) => block.id),
          nodeIds: section.items.flatMap((item) => item.nodeIds),
        });
        result.width = Math.max(result.width, columnX + width - origin.x);
        result.height = Math.max(result.height, rowY + height - origin.y);
      }
      columnX += width + TOPOLOGY_SECTION_GAP;
    });
    rowY += height + TOPOLOGY_SECTION_GAP;
  });

  return result;
}

export const projectTopologyLayout = layoutTopology;
