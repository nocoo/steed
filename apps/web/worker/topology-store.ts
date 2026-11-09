import { TOPOLOGY_COLLECTIONS, topologySchema, type Topology, type TopologyCollection } from "@steed/api/shared";
import { requireRetainedTopologySince } from "./topology-history";

interface JsonRow { value: string; updatedRev?: number }
interface MembershipRow { node_id: string; boundary_id: string }
interface OldestRow { oldest: number | null }
interface DeletedRow { collection: TopologyCollection; id: string }

export interface TopologySnapshot {
  topology: Topology;
  updatedAt: string;
}

function parseRows(rows: JsonRow[], optional: string[]): Record<string, unknown>[] {
  return rows.map(({ value }) => {
    const { styleStorageNull, ...row } = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(row).filter(([key, item]) => item !== null || !optional.includes(key) || (key === "style" && styleStorageNull === 0)));
  });
}

async function readTopology(db: D1Database, extra: D1PreparedStatement[] = []) {
  const statements = [
    `SELECT json_object('title', title, 'description', description, 'revision', revision, 'provenance', provenance, 'updatedAt', updated_at) AS value FROM topology_meta WHERE id = 'main'`,
    `SELECT json_object('id', id, 'label', label, 'provider', provider, 'order', sort_order, 'color', color, 'icon', icon, 'url', url, 'description', description, 'provenance', provenance) AS value, updated_rev AS updatedRev FROM topo_layers ORDER BY id`,
    `SELECT json_object('id', id, 'label', label, 'defaultLayerId', default_layer_id, 'shape', shape, 'icon', icon, 'color', color, 'description', description, 'attrs', json(attrs_schema), 'provenance', provenance) AS value, updated_rev AS updatedRev FROM topo_types ORDER BY id`,
    `SELECT json_object('id', id, 'label', label, 'kind', kind, 'parentId', parent_id, 'style', json(style), 'styleStorageNull', style IS NULL, 'description', description, 'provenance', provenance) AS value, updated_rev AS updatedRev FROM topo_boundaries ORDER BY id`,
    `SELECT json_object('id', id, 'type', type_id, 'label', label, 'layerId', layer_id, 'parentId', parent_id, 'role', role, 'lifecycle', lifecycle, 'url', url, 'description', description, 'tags', json(tags), 'attrs', json(attrs), 'style', json(style), 'styleStorageNull', style IS NULL, 'provenance', provenance) AS value, updated_rev AS updatedRev FROM topo_nodes ORDER BY id`,
    `SELECT json_object('id', id, 'source', source_id, 'target', target_id, 'kind', kind, 'label', label, 'protocol', protocol, 'port', port, 'direction', direction, 'evidence', evidence, 'description', description, 'tags', json(tags), 'style', json(style), 'styleStorageNull', style IS NULL, 'provenance', provenance) AS value, updated_rev AS updatedRev FROM topo_edges ORDER BY id`,
    `SELECT json_object('id', id, 'label', label, 'description', description, 'filter', json(filter), 'focusLayerId', focus_layer_id, 'pins', json(pins), 'provenance', provenance) AS value, updated_rev AS updatedRev FROM topo_views ORDER BY id`,
    `SELECT node_id, boundary_id FROM topo_node_boundaries ORDER BY node_id, boundary_id`,
  ];
  const results = await db.batch<JsonRow | MembershipRow | OldestRow | DeletedRow>([...statements.map((sql) => db.prepare(sql)), ...extra]);
  const resultRows = (index: number) => {
    const result = results[index];
    if (!result?.success) throw new Error("Topology read failed.");
    return result.results;
  };
  const optional = [
    ["provenance"],
    ["color", "icon", "url", "provenance"],
    ["defaultLayerId", "icon", "color", "provenance"],
    ["parentId", "style", "provenance"],
    ["parentId", "role", "url", "style", "provenance"],
    ["protocol", "port", "style", "provenance"],
    ["focusLayerId", "provenance"],
  ];
  const rows = (index: number) => parseRows(resultRows(index) as JsonRow[], optional[index] ?? []);
  const meta = rows(0)[0];
  if (!meta || typeof meta.updatedAt !== "string") throw new Error("Topology metadata is missing.");
  const nodes = rows(4);
  const memberships = new Map<string, string[]>();
  for (const membership of resultRows(7) as MembershipRow[]) {
    const ids = memberships.get(membership.node_id) ?? [];
    ids.push(membership.boundary_id);
    memberships.set(membership.node_id, ids);
  }
  for (const node of nodes) node.boundaryIds = memberships.get(String(node.id)) ?? [];
  const { updatedAt, ...metadata } = meta;
  const topology = topologySchema.parse({
    schemaVersion: 2, ...metadata,
    layers: rows(1), types: rows(2), boundaries: rows(3), nodes, edges: rows(5), views: rows(6),
  });
  return { snapshot: { topology, updatedAt: String(updatedAt) }, resultRows, batch: results };
}

export async function loadTopology(db: D1Database): Promise<TopologySnapshot> {
  return (await readTopology(db)).snapshot;
}

/**
 * Reads the snapshot and the extra statements' rows in the same D1 round trip. `batch` is the raw
 * D1 result list, for its per-statement `meta` (Server-Timing).
 */
export async function loadTopologyWith<T>(db: D1Database, extra: D1PreparedStatement[]): Promise<TopologySnapshot & { extra: T[][]; batch: unknown[] }> {
  const { snapshot, resultRows, batch } = await readTopology(db, extra);
  return { ...snapshot, extra: extra.map((_, index) => resultRows(8 + index) as T[]), batch };
}

export async function loadTopologyDelta(db: D1Database, since: number) {
  const { snapshot, resultRows } = await readTopology(db, [
    db.prepare("SELECT MIN(revision) AS oldest FROM topo_changes"),
    db.prepare(`WITH latest AS (
      SELECT i.collection, i.entity_id, i.change_id, i.seq,
        ROW_NUMBER() OVER (PARTITION BY i.collection, i.entity_id ORDER BY c.revision DESC, i.seq DESC) AS position
      FROM topo_change_items i JOIN topo_changes c ON c.id = i.change_id
      WHERE c.revision > ? AND i.collection <> 'metadata'
    )
    SELECT collection, entity_id AS id FROM latest l WHERE position = 1
      AND NOT EXISTS (SELECT 1 FROM topo_change_images image WHERE image.change_id = l.change_id AND image.seq = l.seq AND image.side = 'after')
    ORDER BY collection, entity_id`).bind(since),
  ]);
  const revision = snapshot.topology.revision;
  const oldest = (resultRows(8) as OldestRow[])[0];
  if (revision === undefined || !oldest) throw new Error("Topology history metadata is missing.");
  requireRetainedTopologySince(since, revision, oldest.oldest);
  const deleted: Record<TopologyCollection, string[]> = { layers: [], types: [], boundaries: [], nodes: [], edges: [], views: [] };
  for (const row of resultRows(9) as DeletedRow[]) {
    if (!Object.hasOwn(deleted, row.collection)) throw new Error("Unknown topology change collection.");
    deleted[row.collection].push(row.id);
  }
  const changed = Object.fromEntries(TOPOLOGY_COLLECTIONS.map((collection, index) => {
    const records = resultRows(index + 1) as JsonRow[];
    const entities = snapshot.topology[collection];
    return [collection, entities.filter((_, position) => (records[position]?.updatedRev ?? 0) > since)];
  })) as { [K in TopologyCollection]: Topology[K] };
  const metadata = since === revision ? {} : { metadata: {
    schemaVersion: 2 as const, title: snapshot.topology.title, description: snapshot.topology.description,
    ...(snapshot.topology.provenance === undefined ? {} : { provenance: snapshot.topology.provenance }),
  } };
  return { since, revision, ...metadata, changed, deleted };
}
