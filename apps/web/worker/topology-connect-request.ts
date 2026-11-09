import { topologyEtag, topologyIdSchema, type TopologyCollection } from "@steed/api/shared";
import { HttpError } from "./http";
import type { TopologyCollectionQuery } from "./topology-collections";

export function topologyIfMatch(request: Request): number {
  const etag = request.headers.get("If-Match");
  if (!etag) throw new HttpError(428, "precondition_required", "Read the topology and send its ETag in If-Match.");
  // A weak validator is accepted: the ETag names a revision, not a byte representation, and
  // Cloudflare weakens it to W/"…" whenever it compresses the response for the client.
  const match = /^(?:W\/)?("topology:(0|[1-9]\d*)")$/.exec(etag);
  const revision = match ? Number(match[2]) : NaN;
  if (!Number.isSafeInteger(revision) || match?.[1] !== topologyEtag(revision) || request.headers.has("If-None-Match")) {
    throw new HttpError(412, "version_conflict", "The topology version does not match. Reload before editing.");
  }
  return revision;
}

export function topologyCollectionQuery(url: URL, collection: TopologyCollection): TopologyCollectionQuery {
  const allowed = collection === "nodes" ? ["cursor", "limit", "layer", "type", "tag", "boundary", "parent"]
    : collection === "edges" ? ["cursor", "limit", "node", "kind"] : ["cursor", "limit"];
  const values = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || values.has(key)) throw new HttpError(400, "invalid_query", "The topology query is invalid.");
    values.set(key, value);
  }
  const cursor = values.get("cursor") ?? "";
  if (cursor && !topologyIdSchema.safeParse(cursor).success) throw new HttpError(400, "invalid_query", "The topology query is invalid.");
  const rawLimit = values.get("limit");
  const limit = rawLimit === undefined ? 50 : /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new HttpError(400, "invalid_query", "The topology query is invalid.");
  const filters = Object.fromEntries([...values].filter(([key]) => key !== "cursor" && key !== "limit"));
  return { cursor, limit, ...filters };
}
