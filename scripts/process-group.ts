/**
 * Owned local server lifecycle for the E2E runners.
 *
 * `bun x wrangler dev` starts a chain of processes (a shell wrapper on some
 * hosts, Bun, the wrangler CLI and workerd). Killing only the direct child
 * orphans the rest, which keep the port and the stdout/stderr pipes open and
 * hang the runner. The server is therefore spawned as its own process group
 * leader and stopped by signalling the whole group.
 */
import type { Subprocess } from "bun";

export const processGroup = { detached: true } as const;

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false; // The group no longer exists.
  }
}

async function groupGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!signalGroup(pid, 0)) return true;
    await Bun.sleep(100);
  }
  return !signalGroup(pid, 0);
}

/** Stop every process in the child's group: SIGTERM, then SIGKILL after the grace period. */
export async function stopProcessGroup(child: Subprocess, graceMs = 10_000): Promise<void> {
  signalGroup(child.pid, "SIGTERM");
  if (!(await groupGone(child.pid, graceMs))) {
    signalGroup(child.pid, "SIGKILL");
    await groupGone(child.pid, 5_000);
  }
  await child.exited;
}

/** Synchronous best-effort variant for exit paths that cannot await. */
export function killProcessGroup(child: Subprocess): void {
  if (!signalGroup(child.pid, "SIGTERM")) child.kill();
}
