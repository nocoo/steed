import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const migrationsDir = join(import.meta.dirname, "..", "migrations");

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
      expect(content).toContain("CREATE TABLE");

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
});
