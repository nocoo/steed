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
});
