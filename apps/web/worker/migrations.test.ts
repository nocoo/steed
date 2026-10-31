import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";

const migrationsDir = join(import.meta.dirname, "..", "migrations");
const migrationFiles = () => readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

function applyMigrations(sqlite: DatabaseSync, from: number, to: number) {
  for (const file of migrationFiles()) {
    const number = parseInt(file.split("_")[0] ?? "0", 10);
    if (number < from || number > to) continue;
    sqlite.exec(readFileSync(join(migrationsDir, file), "utf-8"));
  }
}

function tableNames(sqlite: DatabaseSync) {
  return sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String(row.name));
}

const INVENTORY_TABLES = ["agent_data_source_bindings", "agents", "data_source_lanes", "data_sources", "hosts", "lanes"];

describe("D1 Migrations", () => {
  it("should have migration files in correct order", () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);

    // Check files are numbered correctly
    const numbers = files.map((f) => parseInt(f.split("_")[0] ?? "0", 10));
    for (let i = 0; i < numbers.length; i++) {
      expect(numbers[i]).toBe(i + 1);
    }
  });

  it("should have valid SQL syntax in migration files", () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

    for (const file of files) {
      const content = readFileSync(join(migrationsDir, file), "utf-8");

      // Basic syntax checks
      if (file.includes("_create_")) expect(content).toContain("CREATE TABLE");
      expect(content.trim().length).toBeGreaterThan(0);

      // Check for common SQL errors
      expect(content).not.toContain("CREATE TABLE IF NOT EXIST "); // missing S
      expect(content).not.toContain("REFERENCES  ("); // double space before paren
    }
  });

  it("0001 should create lanes and hosts tables", () => {
    const content = readFileSync(
      join(migrationsDir, "0001_create_lanes_and_hosts.sql"),
      "utf-8"
    );

    expect(content).toContain("CREATE TABLE lanes");
    expect(content).toContain("CREATE TABLE hosts");
    expect(content).toContain("INSERT INTO lanes");
    expect(content).toContain("lane_work");
    expect(content).toContain("lane_life");
    expect(content).toContain("lane_learning");
    expect(content).toContain("api_key_hash");
    expect(content).toContain("last_seen_at");
  });

  it("0002 should create agents table with constraints", () => {
    const content = readFileSync(
      join(migrationsDir, "0002_create_agents.sql"),
      "utf-8"
    );

    expect(content).toContain("CREATE TABLE agents");
    expect(content).toContain("REFERENCES hosts(id)");
    expect(content).toContain("REFERENCES lanes(id)");
    expect(content).toContain("match_key");
    expect(content).toContain("UNIQUE (host_id, match_key)");
    expect(content).toContain("CHECK (status IN ('running', 'stopped', 'missing'))");
    expect(content).toContain("metadata");
    expect(content).toContain("extra");
    expect(content).toContain("idx_agents_host_id");
    expect(content).toContain("idx_agents_lane_id");
  });

  it("0003 should create data_sources table with constraints", () => {
    const content = readFileSync(
      join(migrationsDir, "0003_create_data_sources.sql"),
      "utf-8"
    );

    expect(content).toContain("CREATE TABLE data_sources");
    expect(content).toContain("REFERENCES hosts(id)");
    expect(content).toContain("CHECK (type IN ('personal_cli', 'third_party_cli', 'mcp'))");
    expect(content).toContain("CHECK (auth_status IN ('authenticated', 'unauthenticated', 'unknown'))");
    expect(content).toContain("CHECK (status IN ('active', 'missing'))");
    expect(content).toContain("UNIQUE (host_id, type, name)");
    expect(content).toContain("metadata");
    expect(content).toContain("idx_data_sources_host_id");
  });

  it("0004 should create relation tables with cascade", () => {
    const content = readFileSync(
      join(migrationsDir, "0004_create_relations.sql"),
      "utf-8"
    );

    expect(content).toContain("CREATE TABLE data_source_lanes");
    expect(content).toContain("CREATE TABLE agent_data_source_bindings");
    expect(content).toContain("REFERENCES data_sources(id) ON DELETE CASCADE");
    expect(content).toContain("REFERENCES agents(id) ON DELETE CASCADE");
    expect(content).toContain("REFERENCES lanes(id)");
    expect(content).toContain("PRIMARY KEY (data_source_id, lane_id)");
    expect(content).toContain("PRIMARY KEY (agent_id, data_source_id)");
  });

  it("0007 drops the inventory tables and keeps diagram and Connect tables", () => {
    const sqlite = new DatabaseSync(":memory:");
    applyMigrations(sqlite, 1, 6);
    expect(tableNames(sqlite)).toEqual(expect.arrayContaining(INVENTORY_TABLES));
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      INSERT INTO hosts (id, name, api_key_hash) VALUES ('h1', 'host', 'hash');
      INSERT INTO agents (id, host_id, match_key, lane_id) VALUES ('a1', 'h1', 'agent', 'lane_work');
      INSERT INTO data_sources (id, host_id, type, name) VALUES ('d1', 'h1', 'mcp', 'source');
      INSERT INTO data_source_lanes (data_source_id, lane_id) VALUES ('d1', 'lane_work');
      INSERT INTO agent_data_source_bindings (agent_id, data_source_id) VALUES ('a1', 'd1');
    `);
    applyMigrations(sqlite, 7, 7);
    const tables = tableNames(sqlite);
    for (const table of INVENTORY_TABLES) expect(tables).not.toContain(table);
    expect(tables).toEqual(expect.arrayContaining([
      "connect_audit", "connect_confirmations", "connect_rate_limits", "connect_requests", "connect_tokens", "diagrams",
    ]));
    sqlite.close();
  });
});
