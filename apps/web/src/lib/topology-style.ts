import type { Topology, TopologyBoundary, TopologyNode } from "@steed/api/shared";

export type TopologyNodeShape = "rect" | "rounded" | "pill" | "hexagon" | "cylinder" | "diamond" | "circle" | "cloud";
export type TopologyNodeSize = "s" | "m" | "l";
export type TopologyBorderStyle = "solid" | "dashed" | "dotted" | "double";
export type TopologyLifecycle = "active" | "planned" | "deprecated" | "retired";

export interface TopologyResolvedSize {
  width: number;
  height: number;
}

export interface TopologyResolvedBorder {
  style: TopologyBorderStyle;
  width: number;
  color: string;
}

export interface TopologyResolvedNodeStyle {
  shape: TopologyNodeShape;
  size: TopologyNodeSize;
  width: number;
  height: number;
  color: string;
  accent: string;
  fill: string;
  border: TopologyResolvedBorder;
  icon: string;
  lifecycle: TopologyLifecycle;
}

export interface TopologyResolvedBoundaryStyle {
  color: string;
  tint: string;
  border: TopologyResolvedBorder;
  icon: string;
}

export const TOPOLOGY_HOST_SIZE_TABLE = {
  s: { width: 176, height: 88 },
  m: { width: 240, height: 112 },
  l: { width: 320, height: 144 },
} as const satisfies Record<TopologyNodeSize, TopologyResolvedSize>;

export const TOPOLOGY_SIZE_TABLE = TOPOLOGY_HOST_SIZE_TABLE;
export const TOPOLOGY_SIZES = TOPOLOGY_HOST_SIZE_TABLE;
export const TOPOLOGY_HOST_SIZES = TOPOLOGY_HOST_SIZE_TABLE;

export const TOPOLOGY_SATELLITE_HEIGHT = 64;
export const TOPOLOGY_SATELLITE_INDENT = 24;
export const TOPOLOGY_SUB_SATELLITE_INDENT = 48;

export const TOPOLOGY_THEME_DEFAULT_COLOR = "var(--color-basalt-primary, #6366f1)";
export const TOPOLOGY_THEME_DEFAULT_BORDER = "var(--color-basalt-border)";

export const TOPOLOGY_FIXED_ICON_TABLE = {
  server: true,
  database: true,
  globe: true,
  cloud: true,
  network: true,
  laptop: true,
  monitor: true,
  "hard-drive": true,
  bot: true,
  "git-branch": true,
  shield: true,
  key: true,
  box: true,
  cpu: true,
  "circle-dot": true,
} as const satisfies Record<string, true>;

export const TOPOLOGY_ICON_KEYS = TOPOLOGY_FIXED_ICON_TABLE;

export const TOPOLOGY_PALETTE_VARIABLES: Readonly<Record<string, string>> = {
  primary: "var(--topology-palette-primary)",
  secondary: "var(--topology-palette-secondary)",
  accent: "var(--topology-palette-accent)",
  muted: "var(--topology-palette-muted)",
  "muted-foreground": "var(--topology-palette-muted-foreground)",
  border: "var(--topology-palette-border)",
  background: "var(--topology-palette-background)",
  foreground: "var(--topology-palette-foreground)",
  card: "var(--topology-palette-card)",
  success: "var(--topology-palette-green)",
  green: "var(--topology-palette-green)",
  emerald: "var(--topology-palette-emerald)",
  lime: "var(--topology-palette-lime)",
  warning: "var(--topology-palette-amber)",
  amber: "var(--topology-palette-amber)",
  yellow: "var(--topology-palette-yellow)",
  orange: "var(--topology-palette-orange)",
  danger: "var(--topology-palette-red)",
  destructive: "var(--topology-palette-red)",
  red: "var(--topology-palette-red)",
  rose: "var(--topology-palette-rose)",
  info: "var(--topology-palette-blue)",
  blue: "var(--topology-palette-blue)",
  cyan: "var(--topology-palette-cyan)",
  sky: "var(--topology-palette-sky)",
  indigo: "var(--topology-palette-indigo)",
  violet: "var(--topology-palette-violet)",
  purple: "var(--topology-palette-purple)",
  fuchsia: "var(--topology-palette-fuchsia)",
  pink: "var(--topology-palette-pink)",
  teal: "var(--topology-palette-teal)",
  slate: "var(--topology-palette-slate)",
  gray: "var(--topology-palette-gray)",
  grey: "var(--topology-palette-gray)",
  zinc: "var(--topology-palette-zinc)",
  neutral: "var(--topology-palette-neutral)",
  stone: "var(--topology-palette-stone)",
  white: "var(--topology-palette-white)",
  black: "var(--topology-palette-black)",
};

function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function resolveTopologyPaletteColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (/^#[0-9A-Fa-f]{6}$/.test(color)) return color;
  return hasOwn(TOPOLOGY_PALETTE_VARIABLES, color) ? TOPOLOGY_PALETTE_VARIABLES[color] : undefined;
}

export function topologyColorTint(color: string, alpha = 0.08): string {
  if (/^#[0-9A-Fa-f]{6}$/i.test(color)) {
    const byte = Math.round(alpha * 255);
    return `${color}${byte.toString(16).padStart(2, "0")}`;
  }
  return `color-mix(in oklab, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

function resolvedLayerColor(topology: Topology, node: TopologyNode): string {
  const layer = topology.layers.find((candidate) => candidate.id === node.layerId);
  return resolveTopologyPaletteColor(layer?.color) ?? TOPOLOGY_THEME_DEFAULT_COLOR;
}

function resolvedNodeColor(topology: Topology, node: TopologyNode): string {
  const layerColor = resolvedLayerColor(topology, node);
  const nodeColor = node.style?.color;
  if (nodeColor !== undefined) return resolveTopologyPaletteColor(nodeColor) ?? layerColor;
  const type = topology.types.find((candidate) => candidate.id === node.type);
  const typeColor = type?.color;
  if (typeColor !== undefined) return resolveTopologyPaletteColor(typeColor) ?? layerColor;
  return layerColor;
}

export function resolveTopologyIconKey(topology: Topology, node: TopologyNode): string {
  const type = topology.types.find((candidate) => candidate.id === node.type);
  const requested = node.style?.icon;
  if (requested && hasOwn(TOPOLOGY_FIXED_ICON_TABLE, requested)) return requested;
  const typeIcon = type?.icon;
  if (typeIcon && hasOwn(TOPOLOGY_FIXED_ICON_TABLE, typeIcon)) return typeIcon;
  return "circle-dot";
}

export function resolveTopologyBorder(topology: Topology, node: TopologyNode): TopologyResolvedBorder {
  const border = node.style?.border;
  const style: TopologyBorderStyle = border?.style ?? "solid";
  const width = Math.max(0, Math.min(4, border?.width ?? 1));
  const color = resolveTopologyPaletteColor(border?.color) ?? TOPOLOGY_THEME_DEFAULT_BORDER;
  return { style, width, color };
}

function resolveRootHost(topology: Topology, node: TopologyNode): TopologyNode {
  const byId = new Map(topology.nodes.map((candidate) => [candidate.id, candidate]));
  let current = node;
  const seen = new Set<string>();
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

export function resolveTopologySatelliteDepth(topology: Topology, node: TopologyNode): 0 | 1 | 2 {
  if (!node.parentId) return 0;
  const byId = new Map(topology.nodes.map((candidate) => [candidate.id, candidate]));
  let current = node;
  let depth = 0;
  const seen = new Set<string>();
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    depth += 1;
    if (depth >= 2) return 2;
    current = parent;
  }
  return depth === 1 ? 1 : 0;
}

export function resolveTopologyNodeStyle(topology: Topology, node: TopologyNode): TopologyResolvedNodeStyle {
  const type = topology.types.find((candidate) => candidate.id === node.type);
  const satelliteDepth = resolveTopologySatelliteDepth(topology, node);
  const satellite = satelliteDepth > 0;
  const requestedSize = node.style?.size;
  const size: TopologyNodeSize = satellite
    ? (requestedSize === "s" ? "s" : "m")
    : (requestedSize ?? "m");
  const host = resolveRootHost(topology, node);
  const hostSize = host.style?.size ?? "m";
  const hostSizeKey = hostSize === "l" ? "l" : hostSize;
  const hostDimensions = TOPOLOGY_HOST_SIZE_TABLE[hostSizeKey];
  const width = satellite
    ? hostDimensions.width - (satelliteDepth === 2 ? TOPOLOGY_SUB_SATELLITE_INDENT : TOPOLOGY_SATELLITE_INDENT)
    : TOPOLOGY_HOST_SIZE_TABLE[size].width;
  const height = satellite ? TOPOLOGY_SATELLITE_HEIGHT : TOPOLOGY_HOST_SIZE_TABLE[size].height;
  const shape: TopologyNodeShape = node.style?.shape ?? type?.shape ?? "rounded";
  const color = resolvedNodeColor(topology, node);
  const icon = resolveTopologyIconKey(topology, node);

  return {
    shape,
    size,
    width,
    height,
    color,
    accent: color,
    fill: topologyColorTint(color, 0.08),
    border: resolveTopologyBorder(topology, node),
    icon,
    lifecycle: node.lifecycle,
  };
}

export function resolveTopologyStyles(topology: Topology): Record<string, TopologyResolvedNodeStyle> {
  return Object.fromEntries(topology.nodes.map((node) => [node.id, resolveTopologyNodeStyle(topology, node)]));
}

export const resolveStyles = resolveTopologyStyles;
export const resolveTopologyStyle = resolveTopologyNodeStyle;

export function resolveTopologyBoundaryStyle(topology: Topology, boundary: TopologyBoundary): TopologyResolvedBoundaryStyle {
  const color = resolveTopologyPaletteColor(boundary.style?.color) ?? TOPOLOGY_THEME_DEFAULT_COLOR;
  const style: TopologyBorderStyle = boundary.style?.border?.style ?? (boundary.kind === "trust" ? "dashed" : "solid");
  const width = Math.max(0, Math.min(4, boundary.style?.border?.width ?? 1));
  const borderColor = resolveTopologyPaletteColor(boundary.style?.border?.color) ?? TOPOLOGY_THEME_DEFAULT_BORDER;
  const icon = boundary.style?.icon && hasOwn(TOPOLOGY_FIXED_ICON_TABLE, boundary.style.icon)
    ? boundary.style.icon
    : "circle-dot";

  return {
    color,
    tint: topologyColorTint(color, 0.08),
    border: { style, width, color: borderColor },
    icon,
  };
}

export function resolveTopologyBoundaryStyles(topology: Topology): Record<string, TopologyResolvedBoundaryStyle> {
  return Object.fromEntries(topology.boundaries.map((boundary) => [boundary.id, resolveTopologyBoundaryStyle(topology, boundary)]));
}
