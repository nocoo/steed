import type { Command } from "commander";
import type { ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { HostService, setupSignalHandlers } from "../service/index.js";
import { StateManager } from "../service/state.js";
import { loadConfig } from "../config/index.js";
import { isPidRunning, killProcess } from "../lib/process.js";
import {
  detectPlatform,
  generateSystemdUnit,
  generateLaunchdPlist,
  getServicePath,
  getServiceCommands,
} from "../lib/platform.js";
import { success, error, info, warn } from "../lib/output.js";

/**
 * Run service start subcommand
 */
async function runServiceStart(): Promise<number> {
  // Check config exists
  const config = await loadConfig();
  if (!config) {
    error("No config found. Run 'steed init' first.");
    return 1;
  }

  // Check if already running
  const stateManager = new StateManager();
  const state = await stateManager.load();
  if (state?.service_pid) {
    const running = await isPidRunning(state.service_pid);
    if (running) {
      error(`Service already running (PID: ${state.service_pid})`);
      return 1;
    }
  }

  info("Starting Host Service...");
  info("Press Ctrl+C to stop.\n");

  // Create and start service
  const service = new HostService();
  setupSignalHandlers(service);

  try {
    await service.start();

    // Keep the process running
    await new Promise(() => {
      // This promise never resolves - service runs until signal
    });
  } catch (err) {
    error(`Failed to start service: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  return 0;
}

/**
 * Run service status subcommand
 */
async function runServiceStatus(): Promise<number> {
  const stateManager = new StateManager();
  const state = await stateManager.load();

  if (!state?.service_pid) {
    info("Host Service: stopped");
    return 0;
  }

  // Check if process is actually running
  const running = await isPidRunning(state.service_pid);

  if (running) {
    success(`Host Service: running (PID: ${state.service_pid})`);

    if (state.last_scan_at) {
      const lastScan = new Date(state.last_scan_at);
      const ago = formatTimeAgo(lastScan);
      info(`Last scan: ${ago}`);
    }

    if (state.last_report_at) {
      const lastReport = new Date(state.last_report_at);
      const ago = formatTimeAgo(lastReport);
      info(`Last report: ${ago}`);
    }

    if (state.last_error) {
      warn(`Last error: ${state.last_error.message} (${state.last_error.type})`);
    }
  } else {
    info("Host Service: stopped (stale PID in state file)");
    // Clear stale PID
    await stateManager.updateServicePid(null);
  }

  return 0;
}

/**
 * Run service stop subcommand
 */
async function runServiceStop(): Promise<number> {
  const stateManager = new StateManager();
  const state = await stateManager.load();

  if (!state?.service_pid) {
    error("Service not running.");
    return 1;
  }

  info(`Stopping service (PID: ${state.service_pid})...`);

  const killed = await killProcess(state.service_pid);

  if (killed) {
    success("Service stopped.");
    return 0;
  } else {
    error("Failed to stop service. Process may have already exited.");
    // Clear stale PID
    await stateManager.updateServicePid(null);
    return 1;
  }
}

/**
 * Run service install subcommand
 */
async function runServiceInstall(): Promise<number> {
  const platform = await detectPlatform();

  if (platform === "unknown") {
    error("Unsupported platform. Service installation requires systemd (Linux) or launchd (macOS).");
    return 1;
  }

  const servicePath = getServicePath(platform);
  const binaryPath = process.argv[1] ?? "steed"; // Path to steed binary

  // Generate service file
  let serviceContent: string;
  if (platform === "systemd") {
    serviceContent = generateSystemdUnit(binaryPath);
  } else {
    serviceContent = generateLaunchdPlist(binaryPath);
  }

  info(`Installing service to ${servicePath}...`);

  try {
    await writeFile(servicePath, serviceContent, { mode: 0o644 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EACCES") {
      error(`Permission denied. On Linux, run with sudo:`);
      error(`  sudo steed service install`);
      return 1;
    }
    throw err;
  }

  // Run platform-specific install command
  const commands = getServiceCommands(platform);
  if (commands.install.length > 0) {
    const result = await runExternalCommand(commands.install);
    if (!result.success) {
      error(`Failed to enable service: ${result.error}`);
      return 1;
    }
  }

  success(`Service installed successfully.`);
  info(`\nTo start the service:`);
  info(`  steed service start`);

  return 0;
}

/**
 * Run service uninstall subcommand
 */
async function runServiceUninstall(): Promise<number> {
  const platform = await detectPlatform();

  if (platform === "unknown") {
    error("Unsupported platform.");
    return 1;
  }

  const servicePath = getServicePath(platform);
  const commands = getServiceCommands(platform);

  // Stop service first
  if (commands.stop.length > 0) {
    info("Stopping service...");
    await runExternalCommand(commands.stop);
  }

  // Uninstall
  if (commands.uninstall.length > 0) {
    info("Disabling service...");
    const result = await runExternalCommand(commands.uninstall);
    if (!result.success) {
      warn(`Note: ${result.error}`);
    }
  }

  // Remove service file
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(servicePath);
    success(`Service file removed: ${servicePath}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      info("Service file already removed.");
    } else if ((err as NodeJS.ErrnoException).code === "EACCES") {
      error(`Permission denied. On Linux, run with sudo.`);
      return 1;
    } else {
      throw err;
    }
  }

  success("Service uninstalled.");
  return 0;
}

/**
 * Run service logs subcommand
 */
async function runServiceLogs(): Promise<number> {
  const platform = await detectPlatform();

  if (platform === "unknown") {
    error("Unsupported platform.");
    return 1;
  }

  const commands = getServiceCommands(platform);

  if (commands.logs.length === 0) {
    error("Log viewing not available for this platform.");
    return 1;
  }

  info(`Streaming logs (Ctrl+C to stop)...\n`);

  const [cmd, ...args] = commands.logs;
  if (!cmd) {
    error("No log command available.");
    return 1;
  }
  const child: ChildProcess = spawn(cmd, args, { stdio: "inherit" });

  return new Promise((resolve) => {
    child.on("exit", (code: number | null) => {
      resolve(code ?? 0);
    });
    child.on("error", (err: Error) => {
      error(`Failed to stream logs: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Format time ago string
 */
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

/**
 * Run external command and return result
 */
async function runExternalCommand(
  args: string[]
): Promise<{ success: boolean; error?: string }> {
  const [cmd, ...restArgs] = args;
  if (!cmd) {
    return { success: false, error: "No command provided" };
  }

  return new Promise((resolve) => {
    const child: ChildProcess = spawn(cmd, restArgs, { stdio: "pipe" });

    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("exit", (code: number | null) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr || `Exit code ${code}` });
      }
    });

    child.on("error", (err: Error) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Create and configure the service command
 */
export function createServiceCommand(program: Command): void {
  const serviceCmd = program
    .command("service")
    .description("Manage Host Service daemon");

  serviceCmd
    .command("start")
    .description("Start Host Service in foreground")
    .action(async () => {
      const exitCode = await runServiceStart();
      process.exitCode = exitCode;
    });

  serviceCmd
    .command("status")
    .description("Check if service is running")
    .action(async () => {
      const exitCode = await runServiceStatus();
      process.exitCode = exitCode;
    });

  serviceCmd
    .command("stop")
    .description("Stop running service")
    .action(async () => {
      const exitCode = await runServiceStop();
      process.exitCode = exitCode;
    });

  serviceCmd
    .command("install")
    .description("Install as system service")
    .action(async () => {
      const exitCode = await runServiceInstall();
      process.exitCode = exitCode;
    });

  serviceCmd
    .command("uninstall")
    .description("Remove system service")
    .action(async () => {
      const exitCode = await runServiceUninstall();
      process.exitCode = exitCode;
    });

  serviceCmd
    .command("logs")
    .description("Show service logs")
    .action(async () => {
      const exitCode = await runServiceLogs();
      process.exitCode = exitCode;
    });
}
