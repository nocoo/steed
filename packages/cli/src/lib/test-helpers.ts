/**
 * Test helpers for process-related tests.
 *
 * Tests must not assume the harness itself is discoverable via pgrep
 * (e.g. assuming "bun" matches). Different runners / CI environments
 * break that assumption. Instead, spawn a controlled subprocess with
 * a unique marker and match against it.
 *
 * NOTE: This file is test-only infrastructure. It is excluded from
 * production builds via its `.test-helpers` naming — imports come
 * from .test.ts files only.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface MarkedProcess {
  /** The running child process handle */
  proc: ChildProcess;
  /** Unique marker string guaranteed to appear in the process cmdline */
  marker: string;
  /** Kill the process and wait for exit */
  kill: () => Promise<void>;
}

/**
 * Spawn a long-running process whose cmdline contains a unique marker.
 *
 * Uses `sleep` with an argument that embeds the marker — the argument
 * is ignored by sleep but is visible to `pgrep -f`. This gives tests
 * a deterministic "known running process" they can detect.
 */
export async function spawnMarkedProcess(): Promise<MarkedProcess> {
  const marker = `steed-test-marker-${randomUUID()}`;
  // Spawn node with an inline sleeper. The marker is passed as an extra
  // argv after the script, which pgrep -f sees in the cmdline but node
  // ignores (it's available as process.argv[2] inside the child).
  // Using node (not sh/exec) keeps the marker in the child's cmdline.
  const proc = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 60000)", marker],
    {
      stdio: "ignore",
      detached: false,
    }
  );

  // Wait a beat for the process to actually register in the process table
  await new Promise<void>((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, 50);
    proc.once("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    proc.once("spawn", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        // Extra small delay so pgrep can see it
        setTimeout(resolve, 100);
      }
    });
  });

  const kill = async (): Promise<void> => {
    if (proc.killed || proc.exitCode !== null) {
      return;
    }
    await new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      proc.kill("SIGKILL");
    });
  };

  return { proc, marker, kill };
}
