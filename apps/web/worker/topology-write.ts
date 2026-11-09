import { diffTopology, topologySchema, type Topology, type TopologyChangeItem, type TopologyCollection } from "@steed/api/shared";

const CHUNK_BYTES = 900_000;
const encoder = new TextEncoder();

export function chunkTopologyRows(items: unknown[]): string[] {
  const result: string[] = [];
  let encoded: string[] = [];
  let size = 2;
  for (const item of items) {
    const json = JSON.stringify(item);
    const bytes = encoder.encode(json).byteLength;
    if (bytes + 2 > CHUNK_BYTES) {
      if (encoded.length) result.push(`[${encoded.join(",")}]`);
      encoded = [];
      size = 2;
      result.push(`[${json}]`);
      continue;
    }
    if (size + bytes + (encoded.length ? 1 : 0) > CHUNK_BYTES) {
      result.push(`[${encoded.join(",")}]`);
      encoded = [];
      size = 2;
    }
    size += bytes + (encoded.length ? 1 : 0);
    encoded.push(json);
  }
  if (encoded.length) result.push(`[${encoded.join(",")}]`);
  return result;
}

export function splitTopologyJson(json: string): string[] {
  if (encoder.encode(json).byteLength <= CHUNK_BYTES) return [json];
  const parts: string[] = [];
  let start = 0;
  while (start < json.length) {
    let low = start + 1;
    let high = Math.min(json.length, start + CHUNK_BYTES);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (encoder.encode(json.slice(start, middle)).byteLength <= CHUNK_BYTES) low = middle;
      else high = middle - 1;
    }
    let end = low;
    const last = json.charCodeAt(end - 1);
    const next = json.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    parts.push(json.slice(start, end));
    start = end;
  }
  return parts;
}

function jsonParameters(json: string) {
  const values = splitTopologyJson(json);
  return { expression: values.map(() => "?").join(" || "), values };
}

const tables: Record<TopologyCollection, { table: string; fields: [string, string][] }> = {
  layers: { table: "topo_layers", fields: [["id", "id"], ["label", "label"], ["provider", "provider"], ["sort_order", "order"], ["color", "color"], ["icon", "icon"], ["url", "url"], ["description", "description"], ["provenance", "provenance"]] },
  types: { table: "topo_types", fields: [["id", "id"], ["label", "label"], ["default_layer_id", "defaultLayerId"], ["shape", "shape"], ["icon", "icon"], ["color", "color"], ["description", "description"], ["attrs_schema", "attrs"], ["provenance", "provenance"]] },
  boundaries: { table: "topo_boundaries", fields: [["id", "id"], ["label", "label"], ["kind", "kind"], ["parent_id", "parentId"], ["style", "style"], ["description", "description"], ["provenance", "provenance"]] },
  nodes: { table: "topo_nodes", fields: [["id", "id"], ["type_id", "type"], ["label", "label"], ["layer_id", "layerId"], ["parent_id", "parentId"], ["role", "role"], ["lifecycle", "lifecycle"], ["url", "url"], ["description", "description"], ["tags", "tags"], ["attrs", "attrs"], ["style", "style"], ["provenance", "provenance"]] },
  edges: { table: "topo_edges", fields: [["id", "id"], ["source_id", "source"], ["target_id", "target"], ["kind", "kind"], ["label", "label"], ["protocol", "protocol"], ["port", "port"], ["direction", "direction"], ["evidence", "evidence"], ["description", "description"], ["tags", "tags"], ["style", "style"], ["provenance", "provenance"]] },
  views: { table: "topo_views", fields: [["id", "id"], ["label", "label"], ["description", "description"], ["filter", "filter"], ["focus_layer_id", "focusLayerId"], ["pins", "pins"], ["provenance", "provenance"]] },
};

export interface TopologyWrite {
  before: Topology;
  after: Topology;
  revision: number;
  requestId: string;
  actor: string;
  tokenId: string | null;
  provenance: string | null;
  kind: "operations" | "replace" | "revert";
  revertsChangeId: number | null;
  updatedAt: string;
  createdAt: number;
  guard: { clause: string; values: (string | number | null)[] };
}

export function topologyWriteStatements(db: D1Database, input: TopologyWrite) {
  const after = topologySchema.parse(input.after);
  for (const node of after.nodes) node.boundaryIds.sort();
  const items = diffTopology(input.before, after);
  const nextRevision = input.revision + 1;
  const writeId = crypto.randomUUID();
  const guard = "EXISTS (SELECT 1 FROM topology_meta WHERE id = 'main' AND request_id = ? AND revision = ?)";
  const guarded = (sql: string, values: (string | number | null)[]) => db.prepare(sql).bind(...values, writeId, nextRevision);
  const statements: D1PreparedStatement[] = [
    db.prepare("PRAGMA defer_foreign_keys = ON"),
    db.prepare(`UPDATE topology_meta SET title = ?, description = ?, provenance = ?, revision = revision + 1, request_id = ?, updated_at = ?
      WHERE id = 'main' AND revision = ? AND (${input.guard.clause})`)
      .bind(after.title, after.description, after.provenance ?? null, writeId, input.updatedAt, input.revision, ...input.guard.values),
  ];
  const selected = (collection: TopologyCollection) => items.filter((item) => item.collection === collection);
  const changedNodes = selected("nodes");
  const deleteIds = (table: string, column: string, ids: string[]) => {
    for (const json of chunkTopologyRows(ids)) {
      const params = jsonParameters(json);
      statements.push(guarded(`DELETE FROM ${table} WHERE ${column} IN (SELECT value FROM json_each(${params.expression})) AND ${guard}`, params.values));
    }
  };
  deleteIds("topo_edges", "id", selected("edges").filter((item) => item.after === null).map((item) => item.id));
  deleteIds("topo_node_boundaries", "node_id", changedNodes.map((item) => item.id));
  for (const collection of ["nodes", "views", "boundaries", "types", "layers"] as const) {
    deleteIds(tables[collection].table, "id", selected(collection).filter((item) => item.after === null).map((item) => item.id));
  }
  for (const json of chunkTopologyRows(selected("layers").filter((item) => item.after !== null).map((item) => item.id))) {
    const params = jsonParameters(json);
    statements.push(guarded(`UPDATE topo_layers SET sort_order = -10001 - rowid WHERE id IN (SELECT value FROM json_each(${params.expression})) AND ${guard}`, params.values));
  }
  for (const collection of ["layers", "types", "boundaries", "nodes", "edges", "views"] as const) {
    const { table, fields } = tables[collection];
    const columns = fields.map(([column]) => column);
    const extracted = fields.map(([, key]) => `json_extract(value, '$.${key}')`);
    const updates = columns.filter((column) => column !== "id").map((column) => `${column} = excluded.${column}`);
    for (const json of chunkTopologyRows(selected(collection).flatMap((item) => item.after === null ? [] : [item.after]))) {
      const params = jsonParameters(json);
      statements.push(guarded(`INSERT INTO ${table} (${columns.join(", ")}, updated_rev)
        SELECT ${extracted.join(", ")}, ? FROM json_each(${params.expression}) WHERE ${guard}
        ON CONFLICT(id) DO UPDATE SET ${updates.join(", ")}, updated_rev = excluded.updated_rev`, [nextRevision, ...params.values]));
    }
  }
  const memberships = changedNodes.flatMap((item) => {
    if (item.collection !== "nodes" || item.after === null) return [];
    const node = item.after as Topology["nodes"][number];
    return node.boundaryIds.map((boundaryId) => ({ nodeId: node.id, boundaryId }));
  });
  for (const json of chunkTopologyRows(memberships)) {
    const params = jsonParameters(json);
    statements.push(guarded(`INSERT INTO topo_node_boundaries (node_id, boundary_id)
      SELECT json_extract(value, '$.nodeId'), json_extract(value, '$.boundaryId') FROM json_each(${params.expression}) WHERE ${guard}`, params.values));
  }
  const changed = Object.fromEntries((["metadata", "layers", "types", "boundaries", "nodes", "edges", "views"] as const)
    .map((collection) => [collection, items.filter((item) => item.collection === collection).length]));
  statements.push(guarded(`INSERT INTO topo_changes (revision, request_id, actor, token_id, provenance, kind, reverts_change_id, summary, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
  [nextRevision, input.requestId, input.actor, input.tokenId, input.provenance, input.kind, input.revertsChangeId, JSON.stringify({ changed }), input.createdAt]));
  const changeItems = items.map((item: TopologyChangeItem, seq) => ({ seq, collection: item.collection, id: item.id }));
  for (const json of chunkTopologyRows(changeItems)) {
    const params = jsonParameters(json);
    statements.push(guarded(`INSERT INTO topo_change_items (change_id, seq, collection, entity_id)
      SELECT c.id, json_extract(j.value, '$.seq'), json_extract(j.value, '$.collection'), json_extract(j.value, '$.id')
      FROM json_each(${params.expression}) AS j JOIN topo_changes AS c ON c.request_id = ? WHERE ${guard}`, [...params.values, input.requestId]));
  }
  const images = items.flatMap((item, seq) => ([
    ...(item.before === null ? [] : [{ seq, side: "before", image: item.before }]),
    ...(item.after === null ? [] : [{ seq, side: "after", image: item.after }]),
  ]));
  for (const json of chunkTopologyRows(images)) {
    const params = jsonParameters(json);
    statements.push(guarded(`INSERT INTO topo_change_images (change_id, seq, side, image_json)
      SELECT c.id, json_extract(j.value, '$.seq'), json_extract(j.value, '$.side'), json_extract(j.value, '$.image')
      FROM json_each(${params.expression}) AS j JOIN topo_changes AS c ON c.request_id = ? WHERE ${guard}`, [...params.values, input.requestId]));
  }
  return { statements, items, changed, nextRevision, writeId };
}
