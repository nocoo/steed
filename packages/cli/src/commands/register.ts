import type { Command } from "commander";
import { ConfigManager } from "../config/index.js";
import type { AgentDetectionMethod, RegisteredAgent } from "../config/schema.js";
import { parseMatchKey, inferDetection } from "../lib/match-key.js";
import { success, error, info } from "../lib/output.js";

/**
 * Options for register command
 */
interface RegisterOptions {
  matchKey: string;
  method?: AgentDetectionMethod;
  pattern?: string;
  versionCmd?: string;
  nickname?: string;
  role?: string;
  localOnly?: boolean;
}

/**
 * Run the register command
 */
export async function runRegister(options: RegisterOptions): Promise<number> {
  // Validate match-key format
  try {
    parseMatchKey(options.matchKey);
  } catch {
    error(
      `Invalid match-key format: "${options.matchKey}". Expected: {runtime_app}:{identifier}`
    );
    return 1;
  }

  // Load existing config
  const configManager = new ConfigManager();
  let config;
  try {
    config = await configManager.load();
  } catch {
    error("Config not found. Run 'steed init' first.");
    return 1;
  }

  // Check if already registered
  const existing = config.agents.find((a) => a.match_key === options.matchKey);
  if (existing) {
    error(`Agent with match-key "${options.matchKey}" is already registered.`);
    return 1;
  }

  // Build detection config
  const method = options.method ?? "process";
  const inferred = inferDetection(options.matchKey, method);

  const agent: RegisteredAgent = {
    match_key: options.matchKey,
    detection: {
      method,
      pattern: options.pattern ?? inferred.pattern,
      version_command: options.versionCmd ?? inferred.version_command,
    },
  };

  // Add to config
  config.agents.push(agent);

  // Save config
  try {
    await configManager.save(config);
  } catch (err) {
    error(`Failed to save config: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  success("Agent registered locally");

  // Display detection config
  info("\nDetection configured:");
  info(`  Method: ${agent.detection.method}`);
  info(`  Pattern: ${agent.detection.pattern}`);
  if (agent.detection.version_command) {
    info(`  Version: ${agent.detection.version_command}`);
  }

  // TODO: If not --local-only, register with Worker API
  if (!options.localOnly) {
    info("\nNote: Worker registration not yet implemented. Use --local-only for now.");
  }

  info("\nTest with: steed scan --agents");

  return 0;
}

/**
 * Create and configure the register command
 */
export function createRegisterCommand(program: Command): void {
  program
    .command("register")
    .description("Register a new agent for tracking")
    .requiredOption("--match-key <key>", "Unique identifier (e.g., openclaw:/path)")
    .option(
      "--method <method>",
      "Detection method: process, config_file, custom",
      "process"
    )
    .option("--pattern <pattern>", "Detection pattern")
    .option("--version-cmd <cmd>", "Command to get version")
    .option("--nickname <name>", "Display name")
    .option("--role <role>", "Role description")
    .option("--local-only", "Only add to local config, don't register with Worker")
    .action(async (options: RegisterOptions) => {
      const exitCode = await runRegister(options);
      process.exitCode = exitCode;
    });
}
