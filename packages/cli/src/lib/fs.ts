/**
 * File system helpers
 *
 * Thin wrappers around node:fs/promises to enable testability
 * without mocking Node built-ins (which breaks bun test isolation).
 */

import { writeFile as fsWriteFile, unlink as fsUnlink } from "node:fs/promises";

/**
 * Write content to a file with optional mode
 */
export async function writeServiceFile(
  path: string,
  content: string,
  mode: number = 0o644
): Promise<void> {
  await fsWriteFile(path, content, { mode });
}

/**
 * Remove a file
 */
export async function removeFile(path: string): Promise<void> {
  await fsUnlink(path);
}
