/**
 * Lane — business line tag
 * Preset values: work, life, learning
 */
export interface Lane {
  id: string;
  name: "work" | "life" | "learning";
}

export const LANE_IDS = {
  work: "lane_work",
  life: "lane_life",
  learning: "lane_learning",
} as const;

export type LaneId = (typeof LANE_IDS)[keyof typeof LANE_IDS];
