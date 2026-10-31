import { topologySchema, type Topology } from "@steed/api/shared";

interface JsonRow { value: string }
interface MembershipRow { node_id: string; boundary_id: string }

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

export async function loadTopology(db: D1Database): Promise<TopologySnapshot> {
  const statements = [
    `SELECT json_object('title', title, 'description', description, 'revision', revision, 'provenance', provenance, 'updatedAt', updated_at) AS value FROM topology_meta WHERE id = 'main'`,
    `SELECT json_object('id', id, 'label', label, 'provider', provider, 'order', sort_order, 'color', color, 'icon', icon, 'url', url, 'description', description, 'provenance', provenance) AS value FROM topo_layers ORDER BY id`,
    `SELECT json_object('id', id, 'label', label, 'defaultLayerId', default_layer_id, 'shape', shape, 'icon', icon, 'color', color, 'description', description, 'attrs', json(attrs_schema), 'provenance', provenance) AS value FROM topo_types ORDER BY id`,
    `SELECT json_object('id', id, 'label', label, 'kind', kind, 'parentId', parent_id, 'style', json(style), 'styleStorageNull', style IS NULL, 'description', description, 'provenance', provenance) AS value FROM topo_boundaries ORDER BY id`,
    `SELECT json_object('id', id, 'type', type_id, 'label', label, 'layerId', layer_id, 'parentId', parent_id, 'role', role, 'lifecycle', lifecycle, 'url', url, 'description', description, 'tags', json(tags), 'attrs', json(attrs), 'style', json(style), 'styleStorageNull', style IS NULL, 'provenance', provenance) AS value FROM topo_nodes ORDER BY id`,
    `SELECT json_object('id', id, 'source', source_id, 'target', target_id, 'kind', kind, 'label', label, 'protocol', protocol, 'port', port, 'direction', direction, 'evidence', evidence, 'description', description, 'tags', json(tags), 'style', json(style), 'styleStorageNull', style IS NULL, 'provenance', provenance) AS value FROM topo_edges ORDER BY id`,
    `SELECT json_object('id', id, 'label', label, 'description', description, 'filter', json(filter), 'focusLayerId', focus_layer_id, 'pins', json(pins), 'provenance', provenance) AS value FROM topo_views ORDER BY id`,
    `SELECT node_id, boundary_id FROM topo_node_boundaries ORDER BY node_id, boundary_id`,
  ];
  const results = await db.batch<JsonRow | MembershipRow>(statements.map((sql) => db.prepare(sql)));
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
  return { topology, updatedAt: String(updatedAt) };
}
