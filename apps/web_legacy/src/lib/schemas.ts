import { z } from "zod";
import { LANE_IDS, type LaneId } from "@steed/shared";

/**
 * Form-side validation schemas for the dashboard write surface.
 *
 * Alignment principle: these schemas mirror the Worker's runtime
 * validation so a form that passes here will not be 400'd by the
 * Worker. Notably:
 *
 * - lane_id / lane_ids[*] are restricted to the three preset LaneIds.
 *   The Worker rejects unknown lane ids; we surface that as a form
 *   error rather than a backend error.
 * - metadata must be a plain object (not null, not an array).
 * - tags inside metadata are emitted as a string[] with each entry
 *   trimmed; empty entries from "a,, b," style input are dropped.
 * - nickname / role accept the empty string as "clear" sugar; the
 *   form layer is expected to coerce that to null before submit
 *   (see emptyToNull below).
 */

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

/** PATCH /agents/:id payload */
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

/** PATCH /data-sources/:id payload */
export const dataSourceUpdateSchema = z
  .object({
    metadata: plainObjectSchema.optional(),
  })
  .refine((v) => v.metadata !== undefined, {
    message: "metadata is required",
  });

export type DataSourceUpdateInput = z.infer<typeof dataSourceUpdateSchema>;

/** PUT /data-sources/:id/lanes payload */
export const setLanesSchema = z.object({
  lane_ids: z.array(laneIdSchema),
});

export type SetLanesInput = z.infer<typeof setLanesSchema>;

/** POST /bindings payload */
export const createBindingSchema = z.object({
  agent_id: z.string().min(1),
  data_source_id: z.string().min(1),
});

export type CreateBindingInput = z.infer<typeof createBindingSchema>;

/**
 * Convert "" → null so blank text inputs clear the field on the
 * backend instead of becoming an empty string.
 */
export function emptyToNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Parse a comma-separated tag input into a clean string[].
 * Trims each entry and drops empty fragments produced by trailing
 * commas or accidental whitespace ("a, ,b," → ["a", "b"]).
 */
export function parseTagsInput(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
