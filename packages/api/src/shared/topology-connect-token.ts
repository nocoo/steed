import { z } from "zod";
import { tokenNameSchema } from "./connect";

export const topologyConnectScopeSchema = z.enum(["topology:read", "topology:write"]);
export const topologyTokenInputSchema = z.strictObject({
  name: tokenNameSchema,
  scope: topologyConnectScopeSchema,
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export const topologyTokenIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/);
export const topologyTokenEtag = (id: string, version: number) => `"${id}:${version}"`;
export type TopologyConnectScope = z.infer<typeof topologyConnectScopeSchema>;
export type TopologyTokenInput = z.infer<typeof topologyTokenInputSchema>;
export interface TopologyConnectToken {
  id: string;
  name: string;
  scope: TopologyConnectScope;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  version: number;
}
export interface TopologyConnectAudit {
  id: number;
  requestId: string;
  target: string | null;
  tokenId: string | null;
  actor: string;
  operation: string;
  status: number;
  code: string | null;
  createdAt: string;
}
