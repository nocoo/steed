import { spawn } from "node:child_process";

/**
 * Execute a command and return stdout
 */
async function execCommand(
  command: string,
  args: string[],
  timeout: number = 5000
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      shell: true, // Use shell for version commands which may have pipes
      timeout,
    });

    let stdout = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on("error", () => {
      resolve({ stdout, exitCode: 127 });
    });

    proc.on("close", (code) => {
      resolve({ stdout, exitCode: code ?? 1 });
    });
  });
}

/**
 * Get version by running a command
 * Default command format: {binary} --version
 */
export async function getVersion(
  command: string,
  timeout: number = 5000
): Promise<string | null> {
  const { stdout, exitCode } = await execCommand(command, [], timeout);

  if (exitCode !== 0) {
    return null;
  }

  const version = parseVersionString(stdout);
  return version || null;
}

/**
 * Parse version string from command output
 * Handles common formats:
 * - "v1.2.3" → "1.2.3"
 * - "version 1.2.3" → "1.2.3"
 * - "tool 1.2.3-beta" → "1.2.3-beta"
 * - "1.2.3" → "1.2.3"
 */
export function parseVersionString(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "";
  }

  // Get first line
  const firstLine = trimmed.split("\n")[0] ?? "";

  // Try to extract version with common patterns
  const patterns = [
    // v1.2.3 or v1.2.3-beta
    /v(\d+\.\d+\.\d+(?:-[\w.]+)?)/i,
    // version 1.2.3 or Version: 1.2.3
    /version[:\s]+(\d+\.\d+\.\d+(?:-[\w.]+)?)/i,
    // Just a version number at the end: "tool 1.2.3"
    /\s(\d+\.\d+\.\d+(?:-[\w.]+)?)\s*$/,
    // Version at the start: "1.2.3 - description"
    /^(\d+\.\d+\.\d+(?:-[\w.]+)?)/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(firstLine);
    if (match?.[1]) {
      return match[1];
    }
  }

  // Fallback: return first line trimmed
  return firstLine.trim();
}
