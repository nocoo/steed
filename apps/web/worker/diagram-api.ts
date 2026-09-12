import { z } from "zod";
import { DIAGRAM_LIMITS, diagramEtag, diagramIdSchema, diagramSchema } from "@steed/api/shared";
import { apiResponse, HttpError, readJson, requireSameOrigin } from "./http";
import { deleteDiagram, getDiagram, listDiagrams, putDiagram, readRevision } from "./diagram-store";

export const diagramListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: diagramIdSchema.or(z.literal("")).default(""),
});

export function diagramBrowserApi(request: Request, db: D1Database): Promise<Response> {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 2 && (request.method === "GET" || request.method === "HEAD")) {
      const query = diagramListQuery.parse(Object.fromEntries(url.searchParams));
      const list = await listDiagrams(db, query.cursor, query.limit);
      return request.method === "HEAD" ? new Response() : Response.json(list);
    }
    if (parts.length !== 3) throw new HttpError(404, "not_found", "Diagram route not found.");
    const id = diagramIdSchema.parse(parts[2]);
    if (request.method === "GET" || request.method === "HEAD") {
      const data = await getDiagram(db, id);
      const headers = { ETag: diagramEtag(id, data.revision) };
      return request.method === "HEAD" ? new Response(null, { headers }) : Response.json(data, { headers });
    }
    if (request.method === "PUT") {
      const revision = readRevision(request, id);
      const document = diagramSchema.parse(await readJson(request, DIAGRAM_LIMITS.bytes));
      const data = await putDiagram(db, id, document, revision);
      return Response.json(data, { status: revision === null ? 201 : 200, headers: { ETag: diagramEtag(id, data.revision) } });
    }
    if (request.method === "DELETE") {
      await deleteDiagram(db, id, readRevision(request, id));
      return new Response(null, { status: 204 });
    }
    throw new HttpError(405, "method_not_allowed", "This method is not supported.");
  });
}
