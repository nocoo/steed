import { diagramSchema, diagramEtag, type Diagram, type DiagramRecord, type DiagramList } from "@steed/api/shared";
import { HttpError } from "./http";

interface DiagramRow {
  id: string;
  document: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function fromRow(row: DiagramRow): DiagramRecord {
  const document = diagramSchema.parse(JSON.parse(row.document));
  return { id: row.id, document, revision: row.revision, title: document.title, description: document.description,
    nodeCount: document.nodes.length, edgeCount: document.edges.length, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function getDiagram(db: D1Database, id: string): Promise<DiagramRecord> {
  const row = await db.prepare("SELECT id, document, revision, created_at, updated_at FROM diagrams WHERE id = ? AND deleted_at IS NULL").bind(id).first<DiagramRow>();
  if (!row) throw new HttpError(404, "not_found", "Diagram not found.");
  return fromRow(row);
}

export async function listDiagrams(db: D1Database, cursor: string, limit: number, diagramId?: string): Promise<DiagramList> {
  const result = await db.prepare(`SELECT id, title, description, revision, created_at AS createdAt, updated_at AS updatedAt,
    json_array_length(document, '$.nodes') AS nodeCount, json_array_length(document, '$.edges') AS edgeCount
    FROM diagrams WHERE deleted_at IS NULL AND id > ? AND (? IS NULL OR id = ?) ORDER BY id LIMIT ?`)
    .bind(cursor, diagramId ?? null, diagramId ?? null, limit + 1).all<DiagramList["data"][number]>();
  const data = result.results.slice(0, limit);
  return { data, nextCursor: result.results.length > limit ? data.at(-1)?.id ?? null : null };
}

export function readRevision(request: Request, id: string): number | null {
  if (request.headers.get("If-None-Match") === "*" && !request.headers.has("If-Match")) return null;
  const etag = request.headers.get("If-Match");
  if (!etag) throw new HttpError(428, "precondition_required", "Read the diagram and send its ETag in If-Match; use If-None-Match: * to create.");
  const prefix = `"${id}:`;
  const revision = etag.startsWith(prefix) && etag.endsWith('"') ? Number(etag.slice(prefix.length, -1)) : NaN;
  if (!Number.isSafeInteger(revision) || revision < 1 || etag !== diagramEtag(id, revision) || request.headers.has("If-None-Match")) {
    throw new HttpError(412, "version_conflict", "The diagram version does not match. Reload before editing.");
  }
  return revision;
}

interface WriteGuard { clause: string; values: (string | number | null)[] }
const noGuard: WriteGuard = { clause: "1", values: [] };

export function diagramPutStatement(db: D1Database, id: string, document: Diagram, revision: number | null, now: string, guard = noGuard) {
  const json = JSON.stringify(document);
  const columns = " RETURNING id, document, revision, created_at, updated_at";
  return revision === null
    ? db.prepare(`INSERT INTO diagrams (id, title, description, document, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${guard.clause} ON CONFLICT(id) DO NOTHING` + columns)
      .bind(id, document.title, document.description, json, now, now, ...guard.values)
    : db.prepare(`UPDATE diagrams SET title = ?, description = ?, document = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND deleted_at IS NULL AND (${guard.clause})` + columns)
      .bind(document.title, document.description, json, now, id, revision, ...guard.values);
}

export async function putDiagram(db: D1Database, id: string, document: Diagram, revision: number | null): Promise<DiagramRecord> {
  const row = await diagramPutStatement(db, id, document, revision, new Date().toISOString()).first<DiagramRow>();
  if (!row) throw new HttpError(412, "version_conflict", "The diagram changed. Reload before editing.");
  return fromRow(row);
}

export function diagramDeleteStatement(db: D1Database, id: string, revision: number, now: string, guard = noGuard) {
  return db.prepare(`UPDATE diagrams SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL AND (${guard.clause})`)
    .bind(now, now, id, revision, ...guard.values);
}

export async function deleteDiagram(db: D1Database, id: string, revision: number | null): Promise<void> {
  if (revision === null) throw new HttpError(428, "precondition_required", "Deleting requires If-Match.");
  const now = new Date().toISOString();
  const result = await diagramDeleteStatement(db, id, revision, now).run();
  if (result.meta.changes !== 1) throw new HttpError(412, "version_conflict", "The diagram changed. Reload before deleting.");
}
