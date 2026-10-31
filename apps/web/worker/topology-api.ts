import { topologyChangesEtag, topologyEtag } from "@steed/api/shared";
import { apiResponse, HttpError, requireSameOrigin } from "./http";
import { InvalidTopologySince, listTopologyChanges, parseTopologySince, TopologyResyncRequired } from "./topology-history";
import { loadTopology, loadTopologyDelta } from "./topology-store";

export function topologyReadError(error: unknown, requestId: string): Response | null {
  if (error instanceof InvalidTopologySince) {
    return Response.json({ error: { code: "invalid_since", message: "Since must be a non-negative integer.", requestId } }, { status: 400 });
  }
  if (error instanceof TopologyResyncRequired) {
    return Response.json({ error: { code: "resync_required", message: "Read a full topology snapshot before continuing.", requestId },
      current_revision: error.currentRevision, oldest_retained_revision: error.oldestRetainedRevision }, { status: 410 });
  }
  return null;
}

function query(url: URL, allowed: string[]) {
  const values = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || values.has(key)) {
      if (key === "since") throw new InvalidTopologySince();
      throw new HttpError(400, "invalid_query", "The topology query is invalid.");
    }
    values.set(key, value);
  }
  return values;
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new HttpError(400, "invalid_query", "The topology query is invalid.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new HttpError(400, "invalid_query", "The topology query is invalid.");
  return parsed;
}

function notModified(request: Request, etag: string) {
  return (request.headers.get("If-None-Match") ?? "").split(",")
    .map((value) => value.trim()).some((value) => value === "*" || value === etag || value === `W/${etag}`);
}

function readResponse(request: Request, data: unknown, requestId: string, etag: string, updatedAt?: string) {
  const headers = { ETag: etag };
  if (notModified(request, etag)) return new Response(null, { status: 304, headers });
  if (request.method === "HEAD") return new Response(null, { headers });
  return Response.json({ data, ...(updatedAt === undefined ? {} : { updatedAt }), requestId }, { headers });
}

export async function topologyBrowserApi(request: Request, db: D1Database): Promise<Response> {
  const response = await apiResponse(async (requestId) => {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ error: { code: "method_not_allowed", message: "Topology is read-only.", requestId } },
        { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    requireSameOrigin(request);
    try {
      if (url.pathname === "/api/topology") {
        const params = query(url, ["since"]);
        const since = parseTopologySince(params.get("since") ?? null);
        if (since !== undefined) {
          const delta = await loadTopologyDelta(db, since);
          return readResponse(request, delta, requestId, topologyEtag(delta.revision));
        }
        if (request.headers.has("If-None-Match")) {
          const row = await db.prepare("SELECT revision FROM topology_meta WHERE id = 'main'").first<{ revision: number }>();
          if (!row) throw new Error("Topology metadata is missing.");
          const etag = topologyEtag(row.revision);
          if (notModified(request, etag)) return new Response(null, { status: 304, headers: { ETag: etag } });
        }
        const snapshot = await loadTopology(db);
        if (snapshot.topology.revision === undefined) throw new Error("Topology revision is missing.");
        return readResponse(request, snapshot.topology, requestId, topologyEtag(snapshot.topology.revision), snapshot.updatedAt);
      }
      if (url.pathname === "/api/topology/changes") {
        const params = query(url, ["since", "cursor", "limit"]);
        const since = parseTopologySince(params.get("since") ?? null);
        const cursor = params.has("cursor") ? positiveInteger(params.get("cursor"), 1, Number.MAX_SAFE_INTEGER) : undefined;
        const limit = positiveInteger(params.get("limit"), 50, 500);
        const result = await listTopologyChanges(db, { since, cursor, limit });
        return readResponse(request, { changes: result.data, nextCursor: result.nextCursor }, requestId,
          topologyChangesEtag(result.currentRevision, result.oldestRetainedRevision));
      }
      throw new HttpError(404, "not_found", "Topology route not found.");
    } catch (error) {
      const response = topologyReadError(error, requestId);
      if (response) return response;
      throw error;
    }
  });
  return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
}
