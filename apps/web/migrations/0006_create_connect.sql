CREATE TABLE connect_tokens (
  id TEXT PRIMARY KEY,
  diagram_id TEXT REFERENCES diagrams(id),
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  prefix TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  ciphertext TEXT,
  owner TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX idx_connect_tokens_target ON connect_tokens(diagram_id, id);
CREATE TABLE connect_confirmations (
  challenge_hash TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES connect_tokens(id),
  token_version INTEGER NOT NULL,
  principal TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('reveal', 'rotate', 'revoke')),
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_connect_confirmations_expiry ON connect_confirmations(expires_at);
CREATE TABLE connect_requests (
  token_id TEXT NOT NULL REFERENCES connect_tokens(id),
  key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  diagram_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  http_status INTEGER NOT NULL DEFAULT 0,
  response_json TEXT,
  etag TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(token_id, key_hash)
);
CREATE INDEX idx_connect_requests_expiry ON connect_requests(expires_at);
CREATE TABLE connect_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  token_id TEXT,
  diagram_id TEXT,
  actor TEXT NOT NULL,
  operation TEXT NOT NULL,
  status INTEGER NOT NULL,
  code TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_connect_audit_target ON connect_audit(diagram_id, id);
CREATE INDEX idx_connect_audit_expiry ON connect_audit(created_at);
CREATE TABLE connect_rate_limits (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(key, window)
);
