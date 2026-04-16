import type { CliScannerConfig } from "./schema.js";

/**
 * Default CLI scanners for common tools
 */
export const DEFAULT_CLI_SCANNERS: CliScannerConfig[] = [
  {
    name: "wrangler",
    type: "third_party_cli",
    binary: "wrangler",
    config_path: "~/.wrangler",
    auth_check: {
      method: "config_exists",
    },
  },
  {
    name: "railway",
    type: "third_party_cli",
    binary: "railway",
    config_path: "~/.railway",
    auth_check: {
      method: "config_exists",
    },
  },
  {
    name: "gh",
    type: "third_party_cli",
    binary: "gh",
    auth_check: {
      method: "command",
      pattern: "gh auth status",
    },
  },
  {
    name: "vercel",
    type: "third_party_cli",
    binary: "vercel",
    config_path: "~/.vercel",
    auth_check: {
      method: "config_exists",
    },
  },
];
