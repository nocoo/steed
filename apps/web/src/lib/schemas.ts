import { z } from "zod";
import { LANE_IDS, type LaneId } from "@steed/shared";

const LANE_ID_VALUES = Object.values(LANE_IDS) as [LaneId, ...LaneId[]];

export const laneIdSchema = z.enum(LANE_ID_VALUES);

export const laneIdNullableSchema = laneIdSchema.nullable();

const plainObjectSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => v !== null && !Array.isArray(v), {
    message: "metadata must be a plain object",
  });

const optionalNullableString = z
  .union([z.string(), z.null()])
  .optional();

export const agentUpdateSchema = z
  .object({
    nickname: optionalNullableString,
    role: optionalNullableString,
    lane_id: laneIdNullableSchema.optional(),
    metadata: plainObjectSchema.optional(),
  })
  .refine(
    (v) =>
      v.nickname !== undefined ||
      v.role !== undefined ||
      v.lane_id !== undefined ||
      v.metadata !== undefined,
    { message: "At least one field must be provided" }
  );

export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;

export const dataSourceUpdateSchema = z
  .object({
    metadata: plainObjectSchema.optional(),
  })
  .refine((v) => v.metadata !== undefined, {
    message: "metadata is required",
  });

export type DataSourceUpdateInput = z.infer<typeof dataSourceUpdateSchema>;

export const setLanesSchema = z.object({
  lane_ids: z.array(laneIdSchema),
});

export type SetLanesInput = z.infer<typeof setLanesSchema>;

export const createBindingSchema = z.object({
  agent_id: z.string().min(1),
  data_source_id: z.string().min(1),
});

export type CreateBindingInput = z.infer<typeof createBindingSchema>;

export function emptyToNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseTagsInput(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
