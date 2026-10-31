import { topologyChangesEtag, topologyEtag, topologyIdSchema, type TopologyConnectOperation } from "@steed/api/shared";
import { HttpError } from "./http";
import { topologyNotModified, topologyPositiveInteger, topologyQuery, topologyReadError } from "./topology-api";
import { topologyCollectionItem, topologyCollectionPage } from "./topology-collections";
import { topologyCollectionQuery } from "./topology-connect-request";
import { getTopologyChangeWithRevision, listTopologyChanges, parseTopologySince } from "./topology-history";
import { loadTopology, loadTopologyDelta } from "./topology-store";

function response(request: Request, data: unknown, requestId: string, etag: string, extra: Record<string, unknown> = {}) {
  const headers = { ETag: etag };
  if (topologyNotModified(request, etag)) return new Response(null, { status: 304, headers });
  if (request.method === "HEAD") return new Response(null, { headers });
  return Response.json({ data, ...extra, requestId }, { headers });
}

export async function topologyConnectRead(request: Request, db: D1Database, operation: TopologyConnectOperation, params: Record<string, string>, requestId: string): Promise<Response | null> {
  const url = new URL(request.url);
  try {
    if (operation.id === "topology.get") {
      const query = topologyQuery(url, ["since"]);
      const since = parseTopologySince(query.get("since") ?? null);
      if (since !== undefined) {
        const delta = await loadTopologyDelta(db, since);
        return response(request, delta, requestId, topologyEtag(delta.revision));
      }
      const snapshot = await loadTopology(db);
      if (snapshot.topology.revision === undefined) throw new Error("Topology revision is missing.");
      return response(request, snapshot.topology, requestId, topologyEtag(snapshot.topology.revision));
    }
    if (operation.id === "changes.list") {
      const query = topologyQuery(url, ["since", "cursor", "limit"]);
      const since = parseTopologySince(query.get("since") ?? null);
      const cursor = query.has("cursor") ? topologyPositiveInteger(query.get("cursor"), 1, Number.MAX_SAFE_INTEGER) : undefined;
      const limit = topologyPositiveInteger(query.get("limit"), 50, 500);
      const page = await listTopologyChanges(db, { since, cursor, limit });
      return response(request, page.data, requestId, topologyChangesEtag(page.currentRevision, page.oldestRetainedRevision), { nextCursor: page.nextCursor });
    }
    if (operation.id === "changes.get") {
      topologyQuery(url, []);
      const id = topologyPositiveInteger(params.changeId, 0, Number.MAX_SAFE_INTEGER);
      if (!id) throw new HttpError(400, "invalid_query", "The topology query is invalid.");
      const result = await getTopologyChangeWithRevision(db, id);
      if (!result) throw new HttpError(404, "not_found", "Topology change not found.");
      return response(request, result.change, requestId, topologyEtag(result.revision));
    }
    if (operation.collection && operation.id.endsWith(".list")) {
      const query = topologyCollectionQuery(url, operation.collection);
      const snapshot = await loadTopology(db);
      if (snapshot.topology.revision === undefined) throw new Error("Topology revision is missing.");
      const page = topologyCollectionPage(snapshot.topology, operation.collection, query);
      return response(request, page.data, requestId, topologyEtag(snapshot.topology.revision), { nextCursor: page.nextCursor });
    }
    if (operation.collection && operation.id.endsWith(".get")) {
      topologyQuery(url, []);
      const id = topologyIdSchema.safeParse(params.entityId);
      if (!id.success) throw new HttpError(400, "invalid_id", "The topology ID is invalid.");
      const snapshot = await loadTopology(db);
      if (snapshot.topology.revision === undefined) throw new Error("Topology revision is missing.");
      const item = topologyCollectionItem(snapshot.topology, operation.collection, id.data);
      if (!item) throw new HttpError(404, "not_found", "Topology entity not found.");
      return response(request, item, requestId, topologyEtag(snapshot.topology.revision));
    }
    return null;
  } catch (error) {
    const result = topologyReadError(error, requestId);
    if (result) return result;
    throw error;
  }
}
