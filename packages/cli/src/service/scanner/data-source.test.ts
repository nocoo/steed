import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DataSourceScanner } from "./data-source.js";
import type { CliScannerConfig, DataSourceConfig } from "../../config/schema.js";

describe("DataSourceScanner", () => {
  let scanner: DataSourceScanner;
  let tempDir: string;

  beforeEach(async () => {
    scanner = new DataSourceScanner();
    tempDir = await mkdtemp(join(tmpdir(), "steed-ds-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("scanCliTool", () => {
    it("returns null when binary not in PATH", async () => {
      const config: CliScannerConfig = {
        name: "nonexistent-tool",
        type: "third_party_cli",
        binary: "nonexistent_tool_xyz_12345",
      };

      const result = await scanner.scanCliTool(config);

      expect(result).toBeNull();
    });

    it("returns snapshot for existing binary", async () => {
      // echo is always available
      const config: CliScannerConfig = {
        name: "echo",
        type: "personal_cli",
        binary: "echo",
        version_command: "echo v1.0.0",
      };

      const result = await scanner.scanCliTool(config);

      expect(result).not.toBeNull();
      expect(result?.name).toBe("echo");
      expect(result?.type).toBe("personal_cli");
      expect(result?.version).toBe("1.0.0");
      expect(result?.auth_status).toBe("unknown");
    });

    it("defaults to --version for version command", async () => {
      // Test that version_command defaults to "{binary} --version"
      const config: CliScannerConfig = {
        name: "bun",
        type: "third_party_cli",
        binary: "bun",
        // No version_command specified, should default to "bun --version"
      };

      const result = await scanner.scanCliTool(config);

      expect(result).not.toBeNull();
      expect(result?.name).toBe("bun");
      // bun --version should return a version like "1.x.x"
      expect(result?.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe("auth status checks", () => {
    describe("config_exists method", () => {
      it("returns authenticated when config exists", async () => {
        const configPath = join(tempDir, "config.json");
        await writeFile(configPath, "{}");

        const config: CliScannerConfig = {
          name: "test-cli",
          type: "third_party_cli",
          binary: "echo",
          config_path: configPath,
          auth_check: {
            method: "config_exists",
          },
        };

        const result = await scanner.scanCliTool(config);

        expect(result?.auth_status).toBe("authenticated");
      });

      it("returns unauthenticated when config does not exist", async () => {
        const config: CliScannerConfig = {
          name: "test-cli",
          type: "third_party_cli",
          binary: "echo",
          config_path: join(tempDir, "nonexistent.json"),
          auth_check: {
            method: "config_exists",
          },
        };

        const result = await scanner.scanCliTool(config);

        expect(result?.auth_status).toBe("unauthenticated");
      });

      it("returns unknown when no config_path specified", async () => {
        const config: CliScannerConfig = {
          name: "test-cli",
          type: "third_party_cli",
          binary: "echo",
          auth_check: {
            method: "config_exists",
          },
        };

        const result = await scanner.scanCliTool(config);

        expect(result?.auth_status).toBe("unknown");
      });

      it("handles directory config paths", async () => {
        const configDir = join(tempDir, ".config");
        await mkdir(configDir);

        const config: CliScannerConfig = {
          name: "test-cli",
          type: "third_party_cli",
          binary: "echo",
          config_path: configDir,
          auth_check: {
            method: "config_exists",
          },
        };

        const result = await scanner.scanCliTool(config);

        expect(result?.auth_status).toBe("authenticated");
      });
    });

    describe("config_field method", () => {
      it("falls back to config_exists for now", async () => {
        const configPath = join(tempDir, "config.json");
        await writeFile(configPath, '{"token": "secret"}');

        const config: CliScannerConfig = {
          name: "test-cli",
          type: "third_party_cli",
          binary: "echo",
          config_path: configPath,
          auth_check: {
            method: "config_field",
            pattern: "token",
          },
        };

        const result = await scanner.scanCliTool(config);

        // Currently falls back to config_exists
        expect(result?.auth_status).toBe("authenticated");
      });
    });

    describe("command method", () => {
      it("returns authenticated when command exits 0", async () => {
        const config: CliScannerConfig = {
          name: "test-cli",
          type: "third_party_cli",
          binary: "echo",
          auth_check: {
            method: "command",
            pattern: "true", // exits 0
          },
        };

        const result = await scanner.scanCliTool(config);

        expect(result?.auth_status).toBe("authenticated");
      });

      it("returns unauthenticated when command exits non-zero", async () => {
        const config: CliScannerConfig = {
          name: "test-cli",
          type: "third_party_cli",
          binary: "echo",
          auth_check: {
            method: "command",
            pattern: "false", // exits 1
          },
        };

        const result = await scanner.scanCliTool(config);

        expect(result?.auth_status).toBe("unauthenticated");
      });

      it("returns unknown when no pattern specified", async () => {
        const config: CliScannerConfig = {
          name: "test-cli",
          type: "third_party_cli",
          binary: "echo",
          auth_check: {
            method: "command",
            // No pattern
          },
        };

        const result = await scanner.scanCliTool(config);

        expect(result?.auth_status).toBe("unknown");
      });
    });
  });

  describe("scan", () => {
    it("scans all configured CLI tools", async () => {
      const config: DataSourceConfig = {
        cli_scanners: [
          {
            name: "echo",
            type: "personal_cli",
            binary: "echo",
            version_command: "echo v1.0.0",
          },
          {
            name: "ls",
            type: "third_party_cli",
            binary: "ls",
            version_command: "echo v2.0.0",
          },
        ],
        mcp_scanners: [],
      };

      const results = await scanner.scan(config);

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.name)).toContain("echo");
      expect(results.map((r) => r.name)).toContain("ls");
    });

    it("excludes tools not in PATH", async () => {
      const config: DataSourceConfig = {
        cli_scanners: [
          {
            name: "echo",
            type: "personal_cli",
            binary: "echo",
          },
          {
            name: "nonexistent",
            type: "third_party_cli",
            binary: "nonexistent_tool_xyz_12345",
          },
        ],
        mcp_scanners: [],
      };

      const results = await scanner.scan(config);

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe("echo");
    });

    it("handles empty config", async () => {
      const config: DataSourceConfig = {
        cli_scanners: [],
        mcp_scanners: [],
      };

      const results = await scanner.scan(config);

      expect(results).toHaveLength(0);
    });
  });
});
