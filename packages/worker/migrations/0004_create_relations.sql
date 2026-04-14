-- Migration 0004: Create relation tables
-- data_source_lanes: M2M between data_sources and lanes
-- agent_data_source_bindings: M2M between agents and data_sources

-- Data Source Lane assignments (many-to-many)
CREATE TABLE data_source_lanes (
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  lane_id        TEXT NOT NULL REFERENCES lanes(id),

  PRIMARY KEY (data_source_id, lane_id)
);

-- Agent to Data Source bindings (many-to-many)
-- Note: Cross-host binding is forbidden, enforced at Worker API layer
CREATE TABLE agent_data_source_bindings (
  agent_id       TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  PRIMARY KEY (agent_id, data_source_id)
);
