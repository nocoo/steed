CREATE TABLE topology_meta (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  title TEXT NOT NULL, description TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  request_id TEXT, updated_at TEXT NOT NULL, provenance TEXT
);
INSERT INTO topology_meta (id, title, description, revision, request_id, updated_at, provenance) VALUES ('main', 'Steed topology', '', 0, NULL, '1970-01-01T00:00:00.000Z', NULL);

CREATE TABLE topo_layers (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, provider TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE, color TEXT, icon TEXT, url TEXT,
  description TEXT NOT NULL, updated_rev INTEGER NOT NULL, provenance TEXT
);
CREATE TABLE topo_types (
  id TEXT PRIMARY KEY, label TEXT NOT NULL,
  default_layer_id TEXT REFERENCES topo_layers(id),
  shape TEXT NOT NULL, icon TEXT, color TEXT, description TEXT NOT NULL,
  attrs_schema TEXT NOT NULL CHECK (json_valid(attrs_schema)),
  updated_rev INTEGER NOT NULL, provenance TEXT
);
CREATE TABLE topo_boundaries (
  id TEXT PRIMARY KEY, label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('trust','site','network','account')),
  parent_id TEXT REFERENCES topo_boundaries(id),
  style TEXT CHECK (style IS NULL OR json_valid(style)),
  description TEXT NOT NULL, updated_rev INTEGER NOT NULL, provenance TEXT
);
CREATE TABLE topo_nodes (
  id TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES topo_types(id),
  label TEXT NOT NULL, layer_id TEXT NOT NULL REFERENCES topo_layers(id),
  parent_id TEXT REFERENCES topo_nodes(id),
  role TEXT CHECK (role IN ('service','subresource')),
  lifecycle TEXT NOT NULL, url TEXT, description TEXT NOT NULL,
  tags TEXT NOT NULL CHECK (json_valid(tags)),
  attrs TEXT NOT NULL CHECK (json_valid(attrs)),
  style TEXT CHECK (style IS NULL OR json_valid(style)), provenance TEXT,
  updated_rev INTEGER NOT NULL,
  CHECK ((parent_id IS NULL) = (role IS NULL))
);
CREATE TABLE topo_node_boundaries (
  node_id TEXT NOT NULL REFERENCES topo_nodes(id) ON DELETE CASCADE,
  boundary_id TEXT NOT NULL REFERENCES topo_boundaries(id),
  PRIMARY KEY (node_id, boundary_id)
) WITHOUT ROWID;
CREATE TABLE topo_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES topo_nodes(id),
  target_id TEXT NOT NULL REFERENCES topo_nodes(id),
  kind TEXT NOT NULL, label TEXT NOT NULL, protocol TEXT,
  port INTEGER CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
  direction TEXT NOT NULL CHECK (direction IN ('uni','bi')),
  evidence TEXT NOT NULL CHECK (evidence IN ('documented','inferred')),
  description TEXT NOT NULL, tags TEXT NOT NULL CHECK (json_valid(tags)),
  style TEXT CHECK (style IS NULL OR json_valid(style)), provenance TEXT,
  updated_rev INTEGER NOT NULL, CHECK (source_id <> target_id)
);
CREATE TABLE topo_views (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT NOT NULL,
  filter TEXT NOT NULL CHECK (json_valid(filter)),
  focus_layer_id TEXT REFERENCES topo_layers(id),
  pins TEXT NOT NULL CHECK (json_valid(pins)), updated_rev INTEGER NOT NULL, provenance TEXT
);
CREATE TABLE topo_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision INTEGER NOT NULL UNIQUE, request_id TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL, token_id TEXT, provenance TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('operations','replace','revert')),
  reverts_change_id INTEGER REFERENCES topo_changes(id),
  summary TEXT NOT NULL CHECK (json_valid(summary)), created_at INTEGER NOT NULL
);
CREATE TABLE topo_change_items (
  change_id INTEGER NOT NULL REFERENCES topo_changes(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, collection TEXT NOT NULL, entity_id TEXT NOT NULL,
  before_json TEXT, after_json TEXT,
  PRIMARY KEY (change_id, seq)
);

CREATE INDEX idx_topo_nodes_layer ON topo_nodes(layer_id, id);
CREATE INDEX idx_topo_nodes_type ON topo_nodes(type_id, id);
CREATE INDEX idx_topo_nodes_parent ON topo_nodes(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_topo_node_boundaries_boundary ON topo_node_boundaries(boundary_id, node_id);
CREATE INDEX idx_topo_boundaries_parent ON topo_boundaries(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_topo_types_layer ON topo_types(default_layer_id) WHERE default_layer_id IS NOT NULL;
CREATE INDEX idx_topo_views_focus ON topo_views(focus_layer_id) WHERE focus_layer_id IS NOT NULL;
CREATE INDEX idx_topo_edges_source ON topo_edges(source_id, id);
CREATE INDEX idx_topo_edges_target ON topo_edges(target_id, id);
CREATE INDEX idx_topo_edges_kind ON topo_edges(kind, id);
CREATE INDEX idx_topo_change_items_entity ON topo_change_items(collection, entity_id, change_id);
CREATE INDEX idx_topo_changes_created ON topo_changes(created_at);
CREATE INDEX idx_topo_changes_reverts ON topo_changes(reverts_change_id) WHERE reverts_change_id IS NOT NULL;
