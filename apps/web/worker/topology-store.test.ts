import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testDatabase } from "./__tests__/db";
import { loadTopology } from "./topology-store";

let database: ReturnType<typeof testDatabase>;
beforeEach(() => { database = testDatabase(); });
afterEach(() => database.close());

describe("topology store snapshot", () => {
  it("loads the seeded empty topology", async () => {
    const snapshot = await loadTopology(database.db);
    expect(snapshot).toEqual({
      updatedAt: "1970-01-01T00:00:00.000Z",
      topology: { schemaVersion: 2, title: "Steed topology", description: "", revision: 0, layers: [], types: [], boundaries: [], nodes: [], edges: [], views: [] },
    });
  });

  it("loads all collections, memberships, nested JSON and optional provenance", async () => {
    database.sqlite.exec(`
      UPDATE topology_meta SET revision = 2, updated_at = '2026-01-01T00:00:00.000Z', provenance = 'manual';
      INSERT INTO topo_layers (id, label, provider, sort_order, description, updated_rev, provenance) VALUES ('cloud', 'Cloud', 'Fixture', 0, '', 2, 'manual');
      INSERT INTO topo_types (id, label, shape, description, attrs_schema, updated_rev, provenance) VALUES ('host', 'Host', 'rect', '', '[{"key":"region","label":"Region","valueType":"string","badge":true,"order":0,"required":false,"provenance":"manual"}]', 2, 'manual');
      INSERT INTO topo_boundaries (id, label, kind, style, description, updated_rev, provenance) VALUES ('trust', 'Trust', 'trust', '{"color":"blue"}', '', 2, 'manual');
      INSERT INTO topo_nodes (id, type_id, label, layer_id, lifecycle, description, tags, attrs, style, updated_rev, provenance) VALUES ('root', 'host', 'Root', 'cloud', 'active', '', '["fixture"]', '{"region":"west"}', '{"shape":"rect"}', 2, 'manual');
      INSERT INTO topo_nodes (id, type_id, label, layer_id, lifecycle, description, tags, attrs, updated_rev) VALUES ('peer', 'host', 'Peer', 'cloud', 'active', '', '[]', '{}', 2);
      INSERT INTO topo_node_boundaries (node_id, boundary_id) VALUES ('root', 'trust');
      INSERT INTO topo_edges (id, source_id, target_id, kind, label, direction, evidence, description, tags, style, updated_rev, provenance) VALUES ('edge', 'root', 'peer', 'uses', '', 'uni', 'documented', '', '[]', '{"dash":"dotted"}', 2, 'manual');
      INSERT INTO topo_views (id, label, description, filter, focus_layer_id, pins, updated_rev, provenance) VALUES ('view', 'View', '', '{"layerIds":["cloud"],"typeIds":[],"boundaryIds":[],"tags":[]}', 'cloud', '{"root":{"x":1,"y":2}}', 2, 'manual');
    `);
    const snapshot = await loadTopology(database.db);
    expect(snapshot.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(snapshot.topology).toMatchObject({
      revision: 2, provenance: "manual",
      layers: [{ id: "cloud", provenance: "manual" }],
      types: [{ id: "host", attrs: [{ key: "region", provenance: "manual" }] }],
      boundaries: [{ id: "trust", style: { color: "blue" } }],
      nodes: [{ id: "peer", boundaryIds: [] }, { id: "root", boundaryIds: ["trust"], attrs: { region: "west" }, style: { shape: "rect" } }],
      edges: [{ id: "edge", source: "root", target: "peer", style: { dash: "dotted" }, provenance: "manual" }],
      views: [{ id: "view", pins: { root: { x: 1, y: 2 } }, focusLayerId: "cloud" }],
    });
  });

  it("fails closed if the metadata or stored graph is invalid", async () => {
    database.sqlite.exec("DELETE FROM topology_meta");
    await expect(loadTopology(database.db)).rejects.toThrow("Topology metadata is missing.");
    database.sqlite.exec("INSERT INTO topology_meta (id, title, description, revision, updated_at) VALUES ('main', '', '', 0, 't')");
    await expect(loadTopology(database.db)).rejects.toThrow();
  });

  it.each([
    ["topo_types", "attrs_schema", "host"],
    ["topo_nodes", "tags", "root"],
    ["topo_nodes", "attrs", "root"],
    ["topo_edges", "tags", "edge"],
    ["topo_views", "filter", "view"],
    ["topo_views", "pins", "view"],
    ["topo_boundaries", "style", "trust"],
    ["topo_nodes", "style", "root"],
    ["topo_edges", "style", "edge"],
  ])("rejects JSON null in %s.%s", async (table, column, id) => {
    database.sqlite.exec(`
      INSERT INTO topo_layers (id, label, provider, sort_order, description, updated_rev) VALUES ('cloud', 'Cloud', 'Fixture', 0, '', 0);
      INSERT INTO topo_types (id, label, shape, description, attrs_schema, updated_rev) VALUES ('host', 'Host', 'rect', '', '[]', 0);
      INSERT INTO topo_boundaries (id, label, kind, description, updated_rev) VALUES ('trust', 'Trust', 'trust', '', 0);
      INSERT INTO topo_nodes (id, type_id, label, layer_id, lifecycle, description, tags, attrs, updated_rev) VALUES ('root', 'host', 'Root', 'cloud', 'active', '', '[]', '{}', 0), ('peer', 'host', 'Peer', 'cloud', 'active', '', '[]', '{}', 0);
      INSERT INTO topo_edges (id, source_id, target_id, kind, label, direction, evidence, description, tags, updated_rev) VALUES ('edge', 'root', 'peer', 'uses', '', 'uni', 'documented', '', '[]', 0);
      INSERT INTO topo_views (id, label, description, filter, pins, updated_rev) VALUES ('view', 'View', '', '{"layerIds":[],"typeIds":[],"boundaryIds":[],"tags":[]}', '{}', 0);
    `);
    database.sqlite.prepare(`UPDATE ${table} SET ${column} = 'null' WHERE id = ?`).run(id);
    await expect(loadTopology(database.db)).rejects.toThrow();
  });
});
