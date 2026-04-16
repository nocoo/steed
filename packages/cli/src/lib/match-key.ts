import type { AgentDetection, AgentDetectionMethod } from "../config/schema.js";

/**
 * Parsed match key
 */
export interface ParsedMatchKey {
  runtime_app: string;
  identifier: string;
}

/**
 * Parse a match key into its components
 * Format: {runtime_app}:{identifier}
 */
export function parseMatchKey(key: string): ParsedMatchKey {
  const colonIndex = key.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(
      `Invalid match key format: "${key}". Expected format: {runtime_app}:{identifier}`
    );
  }

  const runtime_app = key.slice(0, colonIndex);
  const identifier = key.slice(colonIndex + 1);

  if (!runtime_app) {
    throw new Error(
      `Invalid match key: missing runtime_app in "${key}"`
    );
  }

  if (!identifier) {
    throw new Error(
      `Invalid match key: missing identifier in "${key}"`
    );
  }

  return { runtime_app, identifier };
}

/**
 * Validate a match key format
 */
export function validateMatchKey(key: string): boolean {
  try {
    parseMatchKey(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Infer detection settings from a match key
 */
export function inferDetection(
  matchKey: string,
  method: AgentDetectionMethod = "process"
): AgentDetection {
  const { runtime_app, identifier } = parseMatchKey(matchKey);

  // Build pattern based on method
  let pattern: string;
  switch (method) {
    case "process":
      // Pattern for pgrep -f: matches runtime_app followed by identifier
      pattern = `${runtime_app}.*${escapeRegexForPattern(identifier)}`;
      break;
    case "config_file":
      // Assume identifier is a path, use it directly
      pattern = identifier;
      break;
    case "custom":
      // For custom, no default pattern makes sense - user must provide
      pattern = "";
      break;
  }

  const detection: AgentDetection = {
    method,
    pattern,
    version_command: `${runtime_app} --version`,
  };

  return detection;
}

/**
 * Escape special regex characters for use in pattern
 */
function escapeRegexForPattern(str: string): string {
  // Escape special regex characters except for basic wildcards
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
