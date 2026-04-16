import { homedir } from "node:os";
import { join } from "node:path";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, stat } from "node:fs/promises";

/**
 * Steed directory path (~/.steed)
 */
export const STEED_DIR = join(homedir(), ".steed");

/**
 * Config file path (~/.steed/config.json)
 */
export const CONFIG_FILE = join(STEED_DIR, "config.json");

/**
 * State file path (~/.steed/state.json)
 */
export const STATE_FILE = join(STEED_DIR, "state.json");

/**
 * Directory permission mode (0700 - owner read/write/execute only)
 */
export const DIR_MODE = 0o700;

/**
 * File permission mode (0600 - owner read/write only)
 */
export const FILE_MODE = 0o600;

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  ok: boolean;
  warning?: string;
}

/**
 * Ensure directory exists with correct permissions.
 * Creates the directory if it doesn't exist.
 */
export async function ensureDir(
  dirPath: string,
  mode: number = DIR_MODE
): Promise<void> {
  await mkdir(dirPath, { recursive: true, mode });
  // Explicitly set mode (mkdir may not honor mode on all systems)
  await chmod(dirPath, mode);
}

/**
 * Ensure file has correct permissions.
 */
export async function ensureFilePermissions(
  filePath: string,
  mode: number = FILE_MODE
): Promise<void> {
  await chmod(filePath, mode);
}

/**
 * Check if file permissions are not more permissive than required.
 * Returns warning if world or group readable.
 */
export async function checkPermissions(
  filePath: string
): Promise<PermissionCheckResult> {
  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    // File doesn't exist yet, that's fine
    return { ok: true };
  }

  const mode = stats.mode & 0o777;

  // Check if group or others have any permissions
  const groupPerms = (mode >> 3) & 0o7;
  const othersPerms = mode & 0o7;

  if (groupPerms > 0 || othersPerms > 0) {
    return {
      ok: false,
      warning: `File ${filePath} has permissions ${mode.toString(8).padStart(4, "0")} - group or others can access. Run: chmod 600 ${filePath}`,
    };
  }

  return { ok: true };
}

/**
 * Check if file exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
