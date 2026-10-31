import { testDatabase } from "./db";

export function topologyConnectTestDatabase() {
  const database = testDatabase();
  database.sqlite.exec(`DROP TABLE connect_confirmations; DROP TABLE connect_requests; DROP TABLE connect_tokens;
    CREATE TABLE connect_tokens (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('topology:read', 'topology:write')),
      prefix TEXT NOT NULL, token_hash TEXT UNIQUE, ciphertext TEXT, owner TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, expires_at INTEGER, last_used_at INTEGER, revoked_at INTEGER
    );
    CREATE TABLE connect_confirmations (
      challenge_hash TEXT PRIMARY KEY, token_id TEXT NOT NULL REFERENCES connect_tokens(id), token_version INTEGER NOT NULL,
      principal TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('reveal', 'rotate', 'revoke')), expires_at INTEGER NOT NULL
    );
    CREATE TABLE connect_requests (
      token_id TEXT NOT NULL REFERENCES connect_tokens(id), key_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
      request_id TEXT NOT NULL UNIQUE, operation TEXT NOT NULL, http_status INTEGER NOT NULL DEFAULT 0,
      response_json TEXT, etag TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (token_id, key_hash)
    );
    ALTER TABLE connect_audit RENAME COLUMN diagram_id TO target;`);
  return database;
}
