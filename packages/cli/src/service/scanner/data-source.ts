import type {
  CliScannerConfig,
  DataSourceConfig,
  LocalDataSourceSnapshot,
  AuthCheck,
} from "../../config/schema.js";
import { binaryExistsInPath } from "../../lib/process.js";
import { getVersion } from "../../lib/version.js";
import { expandPath } from "../../lib/path.js";
import { fileExists } from "../../config/permissions.js";
import { runCommand } from "../../lib/process.js";

/**
 * Data source scanner - detects CLI tools and other data sources
 */
export class DataSourceScanner {
  /**
   * Scan all configured data sources
   */
  async scan(config: DataSourceConfig): Promise<LocalDataSourceSnapshot[]> {
    const results: LocalDataSourceSnapshot[] = [];

    // Scan CLI tools
    for (const scanner of config.cli_scanners) {
      const snapshot = await this.scanCliTool(scanner);
      if (snapshot) {
        results.push(snapshot);
      }
    }

    // MCP scanners are future work - skip for now

    return results;
  }

  /**
   * Scan a single CLI tool
   * Returns null if the binary is not found in PATH
   */
  async scanCliTool(
    scanner: CliScannerConfig
  ): Promise<LocalDataSourceSnapshot | null> {
    // Step 1: PATH probe - check if binary exists
    const exists = await binaryExistsInPath(scanner.binary);
    if (!exists) {
      return null;
    }

    // Step 2: Version collection
    const versionCommand =
      scanner.version_command ?? `${scanner.binary} --version`;
    const version = await getVersion(versionCommand);

    // Step 3: Auth status check
    const authStatus = await this.checkAuthStatus(scanner);

    return {
      type: scanner.type,
      name: scanner.name,
      version,
      auth_status: authStatus,
    };
  }

  /**
   * Check authentication status based on scanner config
   */
  private async checkAuthStatus(
    scanner: CliScannerConfig
  ): Promise<"authenticated" | "unauthenticated" | "unknown"> {
    if (!scanner.auth_check) {
      return "unknown";
    }

    return this.runAuthCheck(scanner.auth_check, scanner.config_path);
  }

  /**
   * Run auth check based on method
   */
  private async runAuthCheck(
    check: AuthCheck,
    configPath?: string
  ): Promise<"authenticated" | "unauthenticated" | "unknown"> {
    switch (check.method) {
      case "config_exists":
        return this.checkConfigExists(configPath);

      case "config_field":
        // Future: parse config JSON and check field
        // For now, fall back to checking if config exists
        return this.checkConfigExists(configPath);

      case "command":
        return this.checkByCommand(check.pattern);
    }
  }

  /**
   * Check if config file/directory exists
   */
  private async checkConfigExists(
    configPath?: string
  ): Promise<"authenticated" | "unauthenticated" | "unknown"> {
    if (!configPath) {
      return "unknown";
    }

    const expandedPath = expandPath(configPath);
    const exists = await fileExists(expandedPath);

    return exists ? "authenticated" : "unauthenticated";
  }

  /**
   * Check auth by running a command
   * Exit 0 = authenticated, any other = unauthenticated
   */
  private async checkByCommand(
    command?: string
  ): Promise<"authenticated" | "unauthenticated" | "unknown"> {
    if (!command) {
      return "unknown";
    }

    try {
      const { exitCode } = await runCommand(command);
      return exitCode === 0 ? "authenticated" : "unauthenticated";
    } catch {
      return "unknown";
    }
  }
}
