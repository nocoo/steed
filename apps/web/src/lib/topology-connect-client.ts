import { topologyTokenEtag, type TopologyConnectToken } from "@steed/api/shared";
import { browserRequest } from "./browser-request";

export function topologyConnectRequest<T>(path: string, options: { method?: string; body?: unknown; token?: TopologyConnectToken; signal?: AbortSignal } = {}) {
  return browserRequest<T>(path, { method: options.method, signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: options.token ? { "If-Match": topologyTokenEtag(options.token.id, options.token.version) } : undefined });
}

export function topologyConnectExamples(base: string) {
  return {
    curl: `# Load STEED_TOKEN from your secret store\nprintf 'Authorization: Bearer %s\\n' "$STEED_TOKEN" | \\\n  curl --fail-with-body --header @- --include '${base}/topology'\n\n# Persist the current ETag and one INTENT_ID per exact change\nprintf 'Authorization: Bearer %s\\n' "$STEED_TOKEN" | \\\n  curl --fail-with-body --header @- --request POST \\\n  --header 'Content-Type: application/json' \\\n  --header "If-Match: $ETAG" --header "Idempotency-Key: $INTENT_ID" \\\n  --data '{"operations":[{"op":"set_metadata","description":"Reviewed topology"}]}' \\\n  '${base}/topology/operations'`,
    agent: `Connect to ${base} using the Bearer token in your secret store.\nRead /capabilities and /openapi.json, then GET /topology and retain its ETag.\nUse stable IDs and validate changes with POST /topology/validate.\nUse /topology/operations for batches of at most 1000 edits.\nAll mutations require If-Match and a persisted Idempotency-Key.\nFor removals, send X-Steed-Confirm: topology.\nOn connection loss inspect /requests/{key}, then retry the exact intent.\nOn 412 reread the topology; on 410 resync with a full snapshot.\nNever place credentials in prompts, URLs, browser storage, logs or source code.`,
  };
}

export function topologyTokenStatus(token: TopologyConnectToken, now = Date.now()): "Active" | "Expired" | "Revoked" {
  return token.revokedAt ? "Revoked" : token.expiresAt && Date.parse(token.expiresAt) <= now ? "Expired" : "Active";
}

export const connectDate = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never used";
