import { diagramEtag, type ConnectToken } from "@steed/api/shared";
import { diagramRequest } from "./diagram-client";

export function connectRequest<T>(path: string, options: { method?: string; body?: unknown; token?: ConnectToken; signal?: AbortSignal } = {}) {
  return diagramRequest<T>(path, { method: options.method, signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: options.token ? { "If-Match": diagramEtag(options.token.id, options.token.version) } : undefined });
}
export function tokenStatus(token: ConnectToken, now = Date.now()): "Active" | "Expired" | "Revoked" {
  return token.revokedAt ? "Revoked" : token.expiresAt && Date.parse(token.expiresAt) <= now ? "Expired" : "Active";
}
export const connectDate = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never used";
export function connectExamples(base: string, diagramId: string) {
  const id = diagramId || "DIAGRAM_ID";
  return {
    curl: `# Load STEED_TOKEN from your secret store\nprintf 'Authorization: Bearer %s\\n' "$STEED_TOKEN" | \\\n  curl --fail-with-body --header @- '${base}/capabilities'\n\nprintf 'Authorization: Bearer %s\\n' "$STEED_TOKEN" | \\\n  curl --fail-with-body --header @- --include \\\n  '${base}/diagrams/${id}'\n\n# Save the ETag and one INTENT_ID before sending a change\nprintf 'Authorization: Bearer %s\\n' "$STEED_TOKEN" | \\\n  curl --fail-with-body --header @- --request POST \\\n  --header 'Content-Type: application/json' \\\n  --header "If-Match: $ETAG" --header "Idempotency-Key: $INTENT_ID" \\\n  --data '{"operations":[{"op":"set_metadata","description":"Reviewed architecture"}]}' \\\n  '${base}/diagrams/${id}/operations'`,
    agent: `Connect to ${base} using the Bearer token in your secret store.\nRead GET /capabilities and GET /openapi.json first.\n${diagramId ? `Operate only on diagram ${diagramId}.` : "List /diagrams and use canonical IDs from the response."}\nFollow nextCursor until it is null. Read the complete document and ETag before editing.\nUse stable node/edge/group/view IDs. Mark uncertain connections as inferred.\nUse named views, positions and explicit edge routes to keep complex paths readable.\nValidate complete source with POST /diagrams/{id}/validate before replacing it.\nPUT /diagrams/{id} creates with If-None-Match: *; updates require If-Match.\nUse /operations for atomic batches of at most 100 edits. All writes require a persisted Idempotency-Key.\nFor deletes or batches with removals, send X-Steed-Confirm: ${id}.\nOn connection loss, inspect /requests/{key}, then retry the same exact intent and key.\nOn 412, reread and reconsider the change. Never silently overwrite another revision.\nToken management and inventory/host operations are outside this API.\nNever place credentials in prompts, URLs, browser storage, logs or source code.`,
  };
}
