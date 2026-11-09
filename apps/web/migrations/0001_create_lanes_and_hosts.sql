-- Migration 0001: Create lanes and hosts tables
-- Lanes: preset data table, v1 fixed three lanes
-- Hosts: machine registry with API key hash

PRAGMA foreign_keys = ON;

-- Lanes table (preset data)
CREATE TABLE lanes (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE  -- 'work' | 'life' | 'learning'
);

-- Preset lane data
INSERT INTO lanes (id, name) VALUES
  ('lane_work', 'work'),
  ('lane_life', 'life'),
  ('lane_learning', 'learning');

-- Hosts table
CREATE TABLE hosts (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,  -- bcrypt/sha256 hash, never store plaintext
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_seen_at TEXT  -- last heartbeat time, updated by snapshot upload
);
