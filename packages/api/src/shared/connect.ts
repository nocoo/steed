import { z } from "zod";

export const CONNECT_LIMITS = { tokensPerTarget: 50, readPerMinute: 120, writePerMinute: 30, managerPerMinute: 60, challengeSeconds: 60, revealSeconds: 30, receiptDays: 7, auditDays: 90 } as const;
export const tokenNameSchema = z.string().trim().min(1).max(64).refine((name) => !/[\x00-\x1f\x7f]/.test(name) && !name.includes("steedc_"), "Use a printable name without credentials.");
export const sensitiveActionSchema = z.enum(["reveal", "rotate", "revoke"]);
export const idempotencyKeySchema = z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/);
export type ConnectSensitiveAction = z.infer<typeof sensitiveActionSchema>;
