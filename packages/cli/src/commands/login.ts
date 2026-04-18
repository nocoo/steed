import { Command } from "commander";
import { hostname } from "node:os";
import { performLogin, openBrowser } from "@nocoo/cli-base";
import { ConfigManager } from "../config/index.js";
import { DEFAULT_CLI_SCANNERS } from "../config/defaults.js";
import { HttpClient, verifyApiKey, AuthError, NetworkError } from "../lib/http.js";
import { success, error, info, warn } from "../lib/output.js";
import type { HostConfig } from "../config/schema.js";

/** Default Dashboard URL */
const DEFAULT_DASHBOARD_URL = "https://steed.hexly.ai";

/** Login timeout in milliseconds */
const LOGIN_TIMEOUT_MS = 120_000;

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
 * Create the login command
 */
export function createLoginCommand(configManager?: ConfigManager): Command {
  const cmd = new Command("login")
    .description("Login via browser OAuth and configure CLI")
    .option("--url <url>", "Dashboard URL", DEFAULT_DASHBOARD_URL)
    .action(async (options: { url: string }) => {
      const manager = configManager ?? new ConfigManager();
      process.exitCode = await runLogin(manager, options.url);
    });

  return cmd;
}

/**
 * Run the login command
 * Returns 0 on success, 1 on failure
 */
export async function runLogin(
  configManager: ConfigManager,
  dashboardUrl: string
): Promise<number> {
  // Validate URL format
  if (!isValidUrl(dashboardUrl)) {
    error("Invalid Dashboard URL format. Must be a valid HTTP(S) URL.");
    return 1;
  }

  // Check if config already exists
  if (await configManager.exists()) {
    warn(`Config already exists at ${configManager.getPath()}`);
    info("Existing config will be overwritten with new credentials.");
  }

  info("Opening browser for authentication...");
  info(`Dashboard: ${dashboardUrl}`);

  // Get local machine hostname to send to Dashboard
  const localHostname = hostname();
  info(`Host name: ${localHostname}`);

  let apiKey: string | undefined;

  const result = await performLogin({
    openBrowser,
    onSaveToken: (token: string) => {
      apiKey = token;
    },
    apiUrl: dashboardUrl,
    loginPath: "/api/auth/cli",
    tokenParam: "api_key",
    timeoutMs: LOGIN_TIMEOUT_MS,
    accentColor: "#16a34a", // Steed green
    extraParams: { hostname: localHostname },
  });

  if (!result.success || !apiKey) {
    error(`Login failed: ${result.error ?? "No API key received"}`);
    return 1;
  }

  // Get worker_url from callback params (provided by Dashboard)
  const workerUrl = result.params?.worker_url;
  if (!workerUrl) {
    error("Login failed: No worker_url received from Dashboard");
    return 1;
  }

  success("Authentication successful!");
  if (result.email) {
    info(`Logged in as: ${result.email}`);
  }

  // Test connectivity with health check
  info(`Connecting to Worker at ${workerUrl}...`);
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
      error("Invalid API key. Authentication may have failed.");
    } else if (err instanceof NetworkError) {
      error(`Network error during verification: ${err.message}`);
    } else {
      error("Failed to verify API key");
    }
    return 1;
  }

  // Create or update config
  let config: HostConfig;
  if (await configManager.exists()) {
    // Update existing config with new credentials
    const existing = await configManager.load();
    config = {
      ...existing,
      worker_url: workerUrl,
      api_key: apiKey,
    };
  } else {
    // Create new config
    config = {
      worker_url: workerUrl,
      api_key: apiKey,
      agents: [],
      data_sources: {
        cli_scanners: [...DEFAULT_CLI_SCANNERS],
        mcp_scanners: [],
      },
    };
  }

  try {
    await configManager.save(config);
    success(`Config saved to ${configManager.getPath()}`);
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
