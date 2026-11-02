export type TopologyZoomTier = "far" | "mid" | "near";

export const TOPOLOGY_ZOOM_FAR = 0.4;
export const TOPOLOGY_ZOOM_NEAR = 0.75;

export function topologyZoomTier(zoom: number): TopologyZoomTier {
  if (zoom < TOPOLOGY_ZOOM_FAR) return "far";
  if (zoom < TOPOLOGY_ZOOM_NEAR) return "mid";
  return "near";
}
