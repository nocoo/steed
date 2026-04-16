import { spawn } from "node:child_process";
import { homedir } from "node:os";

/**
 * Execute a command and return stdout and exit code
 */
async function execCommand(
  command: string,
  args: string[],
  timeout: number = 5000
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      shell: false,
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
 * Check if a binary exists in PATH
 * Uses: which {binary}
 */
export async function isInPath(binary: string): Promise<boolean> {
  const { exitCode } = await execCommand("which", [binary]);
  return exitCode === 0;
}

/**
 * Get the full path to a binary
 * Returns null if not found
 */
export async function getBinaryPath(binary: string): Promise<string | null> {
  const { stdout, exitCode } = await execCommand("which", [binary]);

  if (exitCode !== 0) {
    return null;
  }

  return stdout.trim() || null;
}

/**
 * Expand ~ to home directory
 */
export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return path.replace("~", homedir());
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}
