import { spawn } from "node:child_process";

/**
 * Execute a command and return stdout, stderr, and exit code
 */
async function execCommand(
  command: string,
  args: string[],
  timeout: number = 5000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      shell: false,
      timeout,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", () => {
      resolve({ stdout, stderr, exitCode: 127 });
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

/**
 * Check if a binary exists in PATH using `which`
 */
export async function binaryExistsInPath(binary: string): Promise<boolean> {
  const { exitCode } = await execCommand("which", [binary]);
  return exitCode === 0;
}

/**
 * Check if a process matching the pattern is running
 * Uses: pgrep -f "{pattern}"
 */
export async function isProcessRunning(pattern: string): Promise<boolean> {
  const { exitCode } = await execCommand("pgrep", ["-f", pattern]);
  return exitCode === 0;
}

/**
 * Get the PID of a process matching the pattern
 * Returns the first PID found, or null if no match
 */
export async function getProcessPid(pattern: string): Promise<number | null> {
  const { stdout, exitCode } = await execCommand("pgrep", ["-f", pattern]);

  if (exitCode !== 0) {
    return null;
  }

  const lines = stdout.trim().split("\n");
  const firstPid = lines[0];

  if (!firstPid) {
    return null;
  }

  const pid = parseInt(firstPid, 10);
  return isNaN(pid) ? null : pid;
}

/**
 * Send a signal to a process
 * Default signal: SIGTERM
 */
export async function killProcess(
  pid: number,
  signal: string = "SIGTERM"
): Promise<boolean> {
  const { exitCode } = await execCommand("kill", [`-${signal}`, String(pid)]);
  return exitCode === 0;
}

/**
 * Run a command and return the exit code
 * For custom detection scripts
 */
export async function runCommand(
  command: string,
  timeout: number = 5000
): Promise<{ exitCode: number; stdout: string }> {
  // Split command into parts for spawn
  const parts = command.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  if (!cmd) {
    return { exitCode: 127, stdout: "" };
  }

  const { stdout, exitCode } = await execCommand(cmd, args, timeout);
  return { exitCode, stdout };
}
