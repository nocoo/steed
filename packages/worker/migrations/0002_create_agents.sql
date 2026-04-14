-- Migration 0002: Create agents table
-- Agents: autonomous agent entities managed on hosts

CREATE TABLE agents (
  id              TEXT PRIMARY KEY,
  host_id         TEXT NOT NULL REFERENCES hosts(id),
  match_key       TEXT NOT NULL,      -- stable identifier for scan matching, set at registration
  nickname        TEXT,               -- human: display name
  role            TEXT,               -- human: role/responsibility description
  lane_id         TEXT REFERENCES lanes(id),  -- human: business lane assignment
  metadata        TEXT DEFAULT '{}',  -- human: JSON, extended metadata (notes, tags, etc.)
  extra           TEXT DEFAULT '{}',  -- Agent CLI supplementary info (JSON)
  runtime_app     TEXT,               -- scanned: host program
  runtime_version TEXT,               -- scanned: version
  status          TEXT NOT NULL DEFAULT 'stopped'
                  CHECK (status IN ('running', 'stopped', 'missing')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_seen_at    TEXT,               -- scanned: last discovery time

  UNIQUE (host_id, match_key)         -- same host, match_key must be unique
);

CREATE INDEX idx_agents_host_id ON agents(host_id);
CREATE INDEX idx_agents_lane_id ON agents(lane_id);
