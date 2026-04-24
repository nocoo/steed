export * from "@steed/api/shared";
export type { MapPayload } from "@steed/api/client";

import type { LaneKey } from "@steed/api/shared";

/** Lane Tailwind color map — matches LaneChips palette. */
export const LANE_COLORS: Record<
  LaneKey,
  { bg: string; border: string; stroke: string; text: string }
> = {
  work: {
    bg: "bg-blue-100",
    border: "border-blue-500",
    stroke: "#3b82f6",
    text: "text-blue-700",
  },
  life: {
    bg: "bg-green-100",
    border: "border-green-500",
    stroke: "#22c55e",
    text: "text-green-700",
  },
  learning: {
    bg: "bg-amber-100",
    border: "border-amber-500",
    stroke: "#f59e0b",
    text: "text-amber-700",
  },
  unassigned: {
    bg: "bg-slate-100",
    border: "border-slate-400",
    stroke: "#94a3b8",
    text: "text-slate-700",
  },
};
