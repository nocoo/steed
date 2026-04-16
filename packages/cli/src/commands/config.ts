import type { Command } from "commander";
import { spawn } from "node:child_process";
import { loadConfig, ConfigManager } from "../config/index.js";
import { CONFIG_FILE } from "../config/permissions.js";
import type { CliScannerConfig, AuthCheck } from "../config/schema.js";
import { success, error, info, json as outputJson } from "../lib/output.js";

/**
 * Mask sensitive values in config for display
 */
function maskSensitiveConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...config };
  if (typeof masked.api_key === "string" && masked.api_key.length > 12) {
    masked.api_key = masked.api_key.slice(0, 12) + "...";
  }
  return masked;
}

/**
 * Run config show subcommand
 */
async function runConfigShow(options: { json?: boolean }): Promise<number> {
  const config = await loadConfig();
  if (!config) {
    error("No config found. Run 'steed init' first.");
    return 1;
  }

  const masked = maskSensitiveConfig(config as unknown as Record<string, unknown>);

  if (options.json) {
    outputJson(masked);
  } else {
    info("Configuration:");
    console.log(JSON.stringify(masked, null, 2));
  }

  return 0;
}

/**
 * Run config path subcommand
 */
function runConfigPath(): number {
  console.log(CONFIG_FILE);
  return 0;
}

/**
 * Run config edit subcommand
 */
async function runConfigEdit(): Promise<number> {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";

  return new Promise((resolve) => {
    const child = spawn(editor, [CONFIG_FILE], {
      stdio: "inherit",
    });

    child.on("error", (err) => {
      error(`Failed to open editor: ${err.message}`);
      resolve(1);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        success("Config file saved.");
      }
      resolve(code ?? 0);
    });
  });
}

/**
 * Parse auth check string (format: "method:pattern")
 */
function parseAuthCheck(authCheckStr: string): AuthCheck | null {
  const colonIndex = authCheckStr.indexOf(":");
  if (colonIndex === -1) {
    return { method: authCheckStr as AuthCheck["method"] };
  }

  const method = authCheckStr.slice(0, colonIndex) as AuthCheck["method"];
  const pattern = authCheckStr.slice(colonIndex + 1);

  return { method, pattern };
}

/**
 * Run config add-scanner subcommand
 */
async function runConfigAddScanner(options: {
  name: string;
  type: string;
  binary: string;
  configPath?: string;
  versionCmd?: string;
  authCheck?: string;
}): Promise<number> {
  const configManager = new ConfigManager();
  const config = await configManager.load();
  if (!config) {
    error("No config found. Run 'steed init' first.");
    return 1;
  }

  // Validate type
  if (options.type !== "personal_cli" && options.type !== "third_party_cli") {
    error(`Invalid type: ${options.type}. Must be 'personal_cli' or 'third_party_cli'.`);
    return 1;
  }

  // Check if scanner already exists
  const existingIndex = config.data_sources.cli_scanners.findIndex(
    (s) => s.name === options.name
  );
  if (existingIndex !== -1) {
    error(`Scanner '${options.name}' already exists. Remove it first with 'steed config remove-scanner'.`);
    return 1;
  }

  // Build scanner config
  const scanner: CliScannerConfig = {
    name: options.name,
    type: options.type as "personal_cli" | "third_party_cli",
    binary: options.binary,
  };

  if (options.configPath) {
    scanner.config_path = options.configPath;
  }

  if (options.versionCmd) {
    scanner.version_command = options.versionCmd;
  }

  if (options.authCheck) {
    const authCheck = parseAuthCheck(options.authCheck);
    if (authCheck) {
      scanner.auth_check = authCheck;
    }
  }

  // Add scanner
  config.data_sources.cli_scanners.push(scanner);
  await configManager.save(config);

  success(`Scanner '${options.name}' added.`);
  return 0;
}

/**
 * Run config remove-scanner subcommand
 */
async function runConfigRemoveScanner(options: { name: string }): Promise<number> {
  const configManager = new ConfigManager();
  const config = await configManager.load();
  if (!config) {
    error("No config found. Run 'steed init' first.");
    return 1;
  }

  // Find scanner
  const index = config.data_sources.cli_scanners.findIndex(
    (s) => s.name === options.name
  );

  if (index === -1) {
    error(`Scanner '${options.name}' not found.`);
    return 1;
  }

  // Remove scanner
  config.data_sources.cli_scanners.splice(index, 1);
  await configManager.save(config);

  success(`Scanner '${options.name}' removed.`);
  return 0;
}

/**
 * Create and configure the config command
 */
export function createConfigCommand(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage configuration");

  configCmd
    .command("show")
    .description("Display current configuration")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      const exitCode = await runConfigShow(options);
      process.exitCode = exitCode;
    });

  configCmd
    .command("path")
    .description("Print config file path")
    .action(() => {
      const exitCode = runConfigPath();
      process.exitCode = exitCode;
    });

  configCmd
    .command("edit")
    .description("Open config in $EDITOR")
    .action(async () => {
      const exitCode = await runConfigEdit();
      process.exitCode = exitCode;
    });

  configCmd
    .command("add-scanner")
    .description("Add a CLI scanner")
    .requiredOption("--name <name>", "Scanner name")
    .requiredOption("--type <type>", "Scanner type (personal_cli or third_party_cli)")
    .requiredOption("--binary <binary>", "Binary name to check in PATH")
    .option("--config-path <path>", "Config file path for auth check")
    .option("--version-cmd <cmd>", "Command to get version")
    .option("--auth-check <check>", "Auth check (format: method:pattern)")
    .action(async (options) => {
      const exitCode = await runConfigAddScanner(options);
      process.exitCode = exitCode;
    });

  configCmd
    .command("remove-scanner")
    .description("Remove a CLI scanner")
    .requiredOption("--name <name>", "Scanner name to remove")
    .action(async (options: { name: string }) => {
      const exitCode = await runConfigRemoveScanner(options);
      process.exitCode = exitCode;
    });
}
