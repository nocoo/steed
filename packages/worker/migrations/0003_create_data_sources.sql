-- Migration 0003: Create data_sources table
-- Data Sources: discoverable external resources on hosts (CLI, MCP services, etc.)

CREATE TABLE data_sources (
  id          TEXT PRIMARY KEY,
  host_id     TEXT NOT NULL REFERENCES hosts(id),
  type        TEXT NOT NULL
              CHECK (type IN ('personal_cli', 'third_party_cli', 'mcp')),
  name        TEXT NOT NULL,           -- e.g., nmem, wrangler
  version     TEXT,                    -- scanned: version
  auth_status TEXT NOT NULL DEFAULT 'unknown'
              CHECK (auth_status IN ('authenticated', 'unauthenticated', 'unknown')),
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'missing')),
  metadata    TEXT DEFAULT '{}',       -- human: JSON, extended metadata (notes, tags, etc.)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_seen_at TEXT,                   -- scanned: last discovery time

  UNIQUE (host_id, type, name)         -- v1 constraint: (type, name) unique per host
);

CREATE INDEX idx_data_sources_host_id ON data_sources(host_id);
