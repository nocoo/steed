import { Command } from "commander";
import { ConfigManager } from "../config/index.js";
import { DEFAULT_CLI_SCANNERS } from "../config/defaults.js";
import { HttpClient, verifyApiKey, AuthError, NetworkError } from "../lib/http.js";
import { success, error, info } from "../lib/output.js";
import type { HostConfig } from "../config/schema.js";

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Validate API key format
 */
function isValidApiKey(key: string): boolean {
  return key.startsWith("sk_host_") && key.length > 10;
}

/**
 * Create the init command
 */
export function createInitCommand(configManager?: ConfigManager): Command {
  const cmd = new Command("init")
    .description("Initialize host configuration")
    .requiredOption("--url <url>", "Worker API URL")
    .option("--key <key>", "Host API key (if not provided, use 'steed login' instead)")
    .action(async (options: { url: string; key?: string }) => {
      const manager = configManager ?? new ConfigManager();

      // If no key provided, suggest using login command
      if (!options.key) {
        info("No API key provided.");
        info("For browser-based login, run: steed login --url <dashboard-url>");
        info("Or provide key manually: steed init --url <url> --key <key>");
        process.exitCode = 1;
        return;
      }

      process.exitCode = await runInit(manager, options.url, options.key);
    });

  return cmd;
}

/**
 * Run the init command
 * Returns 0 on success, 1 on failure
 */
export async function runInit(
  configManager: ConfigManager,
  workerUrl: string,
  apiKey: string
): Promise<number> {
  // Validate URL format
  if (!isValidUrl(workerUrl)) {
    error("Invalid URL format. Must be a valid HTTP(S) URL.");
    return 1;
  }

  // Validate API key format
  if (!isValidApiKey(apiKey)) {
    error("Invalid API key format. Must start with 'sk_host_'.");
    return 1;
  }

  // Check if config already exists
  if (await configManager.exists()) {
    error(`Config already exists at ${configManager.getPath()}`);
    info("To reinitialize, delete the existing config first.");
    return 1;
  }

  // Test connectivity with health check
  info(`Connecting to ${workerUrl}...`);
  const client = new HttpClient(workerUrl);
  try {
    await client.get<{ status: string }>("/api/v1/health");
  } catch (err) {
    if (err instanceof NetworkError) {
      error(`Cannot connect to Worker: ${err.message}`);
    } else {
      error("Worker health check failed");
    }
    return 1;
  }

  // Verify API key
  info("Verifying API key...");
  try {
    const authResult = await verifyApiKey(workerUrl, apiKey);
    success(`API key valid for host: ${authResult.host_name}`);
  } catch (err) {
    if (err instanceof AuthError) {
      error("Invalid API key. Please check your key and try again.");
    } else if (err instanceof NetworkError) {
      error(`Network error during verification: ${err.message}`);
    } else {
      error("Failed to verify API key");
    }
    return 1;
  }

  // Create config
  const config: HostConfig = {
    worker_url: workerUrl,
    api_key: apiKey,
    agents: [],
    data_sources: {
      cli_scanners: [...DEFAULT_CLI_SCANNERS],
      mcp_scanners: [],
    },
  };

  try {
    await configManager.save(config);
    success(`Config created at ${configManager.getPath()}`);
  } catch (err) {
    error(`Failed to save config: ${err instanceof Error ? err.message : "Unknown error"}`);
    return 1;
  }

  // Print next steps
  console.log("");
  console.log("Next steps:");
  console.log("  1. Register agents:     steed register --match-key \"openclaw:/path\"");
  console.log("  2. Test scan:           steed scan");
  console.log("  3. Start service:       steed service start");

  return 0;
}
