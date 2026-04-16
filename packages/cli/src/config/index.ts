import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CONFIG_FILE,
  FILE_MODE,
  ensureDir,
  ensureFilePermissions,
  checkPermissions,
  fileExists,
} from "./permissions.js";
import { type HostConfig, hostConfigSchema } from "./schema.js";

/**
 * Error thrown when config file is not found
 */
export class ConfigNotFoundError extends Error {
  constructor(path: string) {
    super(`Config file not found: ${path}`);
    this.name = "ConfigNotFoundError";
  }
}

/**
 * Error thrown when config file is invalid
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * Config manager for Host configuration
 */
export class ConfigManager {
  private configPath: string;

  constructor(configPath: string = CONFIG_FILE) {
    this.configPath = configPath;
  }

  /**
   * Get the config file path
   */
  getPath(): string {
    return this.configPath;
  }

  /**
   * Check if config file exists
   */
  async exists(): Promise<boolean> {
    return fileExists(this.configPath);
  }

  /**
   * Load config from file
   */
  async load(): Promise<HostConfig> {
    // Check if file exists
    if (!(await this.exists())) {
      throw new ConfigNotFoundError(this.configPath);
    }

    // Check permissions
    const permCheck = await checkPermissions(this.configPath);
    if (!permCheck.ok && permCheck.warning) {
      console.warn(`Warning: ${permCheck.warning}`);
    }

    // Read and parse
    const content = await readFile(this.configPath, "utf-8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ConfigValidationError("Invalid JSON in config file");
    }

    // Validate
    const result = hostConfigSchema.safeParse(parsed);
    if (!result.success) {
      const errors = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      throw new ConfigValidationError(`Config validation failed: ${errors}`);
    }

    return result.data;
  }

  /**
   * Save config to file
   */
  async save(config: HostConfig): Promise<void> {
    // Validate before saving
    const result = hostConfigSchema.safeParse(config);
    if (!result.success) {
      const errors = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      throw new ConfigValidationError(`Config validation failed: ${errors}`);
    }

    // Ensure directory exists with correct permissions
    const dir = dirname(this.configPath);
    await ensureDir(dir);

    // Write atomically (write to temp, then rename)
    const tempPath = join(dir, `.config-${randomUUID()}.tmp`);
    const content = JSON.stringify(config, null, 2) + "\n";

    try {
      await writeFile(tempPath, content, { mode: FILE_MODE });
      await rename(tempPath, this.configPath);
    } catch (err) {
      // Clean up temp file on error
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }

    // Ensure correct permissions on final file
    await ensureFilePermissions(this.configPath, FILE_MODE);
  }
}

export {
  STEED_DIR,
  CONFIG_FILE,
  ensureDir,
  checkPermissions,
  fileExists,
} from "./permissions.js";
