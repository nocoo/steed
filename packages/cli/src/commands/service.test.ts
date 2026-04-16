import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// Use a mocks object to avoid hoisting issues
// vitest hoists vi.mock factories above variable declarations
// so we can't reference top-level vi.fn() directly in factories
const mocks = {
  stateLoad: vi.fn(),
  stateUpdatePid: vi.fn(),
  loadConfig: vi.fn(),
  isProcessRunning: vi.fn(),
  isPidRunning: vi.fn(),
  killProcess: vi.fn(),
  detectPlatform: vi.fn(),
  generateSystemdUnit: vi.fn(),
  generateLaunchdPlist: vi.fn(),
  getServicePath: vi.fn(),
  getServiceCommands: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  spawn: vi.fn(),
  hostServiceStart: vi.fn(),
  hostServiceStop: vi.fn(),
};

// Mock modules - use arrow functions that reference mocks object
vi.mock("../service/index.js", () => ({
  HostService: class {
    start = (...args: unknown[]) => mocks.hostServiceStart(...args);
    stop = (...args: unknown[]) => mocks.hostServiceStop(...args);
  },
  setupSignalHandlers: vi.fn(),
}));

vi.mock("../service/state.js", () => ({
  StateManager: class {
    load = (...args: unknown[]) => mocks.stateLoad(...args);
    updateServicePid = (...args: unknown[]) => mocks.stateUpdatePid(...args);
  },
}));

vi.mock("../config/index.js", () => ({
  loadConfig: (...args: unknown[]) => mocks.loadConfig(...args),
}));

vi.mock("../lib/process.js", () => ({
  isProcessRunning: (...args: unknown[]) => mocks.isPidRunning(...args),
  isPidRunning: (...args: unknown[]) => mocks.isPidRunning(...args),
  killProcess: (...args: unknown[]) => mocks.killProcess(...args),
}));

vi.mock("../lib/platform.js", () => ({
  detectPlatform: (...args: unknown[]) => mocks.detectPlatform(...args),
  generateSystemdUnit: (...args: unknown[]) => mocks.generateSystemdUnit(...args),
  generateLaunchdPlist: (...args: unknown[]) => mocks.generateLaunchdPlist(...args),
  getServicePath: (...args: unknown[]) => mocks.getServicePath(...args),
  getServiceCommands: (...args: unknown[]) => mocks.getServiceCommands(...args),
}));

vi.mock("../lib/output.js", () => ({
  success: (...args: unknown[]) => mocks.success(...args),
  error: (...args: unknown[]) => mocks.error(...args),
  info: (...args: unknown[]) => mocks.info(...args),
  warn: (...args: unknown[]) => mocks.warn(...args),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: (...args: unknown[]) => mocks.writeFile(...args),
  unlink: (...args: unknown[]) => mocks.unlink(...args),
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mocks.spawn(...args),
}));

// Import after mocks
import { createServiceCommand } from "./service.js";

describe("service command", () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set default mock implementations
    mocks.stateLoad.mockResolvedValue(null);
    mocks.stateUpdatePid.mockResolvedValue(undefined);
    mocks.loadConfig.mockResolvedValue({ host_id: "test-host" });
    mocks.isPidRunning.mockResolvedValue(false);
    mocks.killProcess.mockResolvedValue(true);
    mocks.detectPlatform.mockResolvedValue("launchd");
    mocks.generateSystemdUnit.mockReturnValue("[Unit]\nDescription=Test");
    mocks.generateLaunchdPlist.mockReturnValue('<?xml version="1.0"?>');
    mocks.getServicePath.mockReturnValue("/tmp/test.plist");
    mocks.getServiceCommands.mockReturnValue({
      install: [],
      uninstall: [],
      start: [],
      stop: [],
      status: [],
      logs: ["tail", "-f", "/tmp/test.log"],
    });
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.unlink.mockResolvedValue(undefined);
    mocks.hostServiceStart.mockResolvedValue(undefined);
    mocks.hostServiceStop.mockResolvedValue(undefined);
    mocks.spawn.mockImplementation(() => {
      const mockChild = {
        on: vi.fn((event: string, handler: (code: number) => void) => {
          if (event === "exit") {
            setTimeout(() => handler(0), 10);
          }
          return mockChild;
        }),
        stderr: { on: vi.fn() },
      };
      return mockChild;
    });

    program = new Command();
    program.exitOverride();
    createServiceCommand(program);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createServiceCommand", () => {
    it("creates service command with subcommands", () => {
      const serviceCmd = program.commands.find((cmd) => cmd.name() === "service");
      expect(serviceCmd).toBeDefined();

      const subcommands = serviceCmd?.commands.map((cmd) => cmd.name());
      expect(subcommands).toContain("start");
      expect(subcommands).toContain("status");
      expect(subcommands).toContain("stop");
      expect(subcommands).toContain("install");
      expect(subcommands).toContain("uninstall");
      expect(subcommands).toContain("logs");
    });
  });

  describe("service status", () => {
    it("shows stopped when no state", async () => {
      mocks.stateLoad.mockResolvedValue(null);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(mocks.info).toHaveBeenCalledWith("Host Service: stopped");
    });

    it("shows running with PID when process is running", async () => {
      mocks.stateLoad.mockResolvedValue({
        service_pid: 12345,
        last_scan_at: new Date().toISOString(),
        last_report_at: new Date().toISOString(),
      });
      mocks.isPidRunning.mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(mocks.success).toHaveBeenCalledWith("Host Service: running (PID: 12345)");
      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining("Last scan:"));
      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining("Last report:"));
    });

    it("shows stale PID warning when process not running", async () => {
      mocks.stateLoad.mockResolvedValue({ service_pid: 99999 });
      mocks.isPidRunning.mockResolvedValue(false);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(mocks.info).toHaveBeenCalledWith("Host Service: stopped (stale PID in state file)");
      expect(mocks.stateUpdatePid).toHaveBeenCalledWith(null);
    });

    it("shows last error if present", async () => {
      mocks.stateLoad.mockResolvedValue({
        service_pid: 12345,
        last_error: { message: "Test error", type: "scan" },
      });
      mocks.isPidRunning.mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(mocks.warn).toHaveBeenCalledWith("Last error: Test error (scan)");
    });

    it("shows time ago for old scans (minutes)", async () => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      mocks.stateLoad.mockResolvedValue({
        service_pid: 12345,
        last_scan_at: thirtyMinutesAgo,
      });
      mocks.isPidRunning.mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining("minutes ago"));
    });

    it("shows time ago for old scans (hours)", async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      mocks.stateLoad.mockResolvedValue({
        service_pid: 12345,
        last_scan_at: twoHoursAgo,
      });
      mocks.isPidRunning.mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining("hours ago"));
    });

    it("shows time ago for old scans (days)", async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      mocks.stateLoad.mockResolvedValue({
        service_pid: 12345,
        last_scan_at: twoDaysAgo,
      });
      mocks.isPidRunning.mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining("days ago"));
    });
  });

  describe("service stop", () => {
    it("stops running service", async () => {
      mocks.stateLoad.mockResolvedValue({ service_pid: 12345 });
      mocks.killProcess.mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "stop"]);

      expect(mocks.info).toHaveBeenCalledWith("Stopping service (PID: 12345)...");
      expect(mocks.killProcess).toHaveBeenCalledWith(12345);
      expect(mocks.success).toHaveBeenCalledWith("Service stopped.");
    });

    it("shows error when service not running", async () => {
      mocks.stateLoad.mockResolvedValue(null);

      await program.parseAsync(["node", "test", "service", "stop"]);

      expect(mocks.error).toHaveBeenCalledWith("Service not running.");
    });

    it("handles failed kill gracefully", async () => {
      mocks.stateLoad.mockResolvedValue({ service_pid: 12345 });
      mocks.killProcess.mockResolvedValue(false);

      await program.parseAsync(["node", "test", "service", "stop"]);

      expect(mocks.error).toHaveBeenCalledWith(
        "Failed to stop service. Process may have already exited."
      );
      expect(mocks.stateUpdatePid).toHaveBeenCalledWith(null);
    });
  });

  describe("service install", () => {
    it("installs service on launchd platform", async () => {
      mocks.detectPlatform.mockResolvedValue("launchd");
      mocks.generateLaunchdPlist.mockReturnValue('<?xml version="1.0"?>');
      mocks.getServicePath.mockReturnValue("/tmp/test.plist");

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(mocks.writeFile).toHaveBeenCalledWith("/tmp/test.plist", '<?xml version="1.0"?>', {
        mode: 0o644,
      });
      expect(mocks.success).toHaveBeenCalledWith("Service installed successfully.");
      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining("To start the service"));
    });

    it("installs service on systemd platform", async () => {
      mocks.detectPlatform.mockResolvedValue("systemd");
      mocks.generateSystemdUnit.mockReturnValue("[Unit]\nDescription=Test");
      mocks.getServicePath.mockReturnValue("/etc/systemd/system/steed.service");

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(mocks.writeFile).toHaveBeenCalledWith(
        "/etc/systemd/system/steed.service",
        "[Unit]\nDescription=Test",
        { mode: 0o644 }
      );
    });

    it("shows error on unsupported platform", async () => {
      mocks.detectPlatform.mockResolvedValue("unknown");

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(mocks.error).toHaveBeenCalledWith(
        "Unsupported platform. Service installation requires systemd (Linux) or launchd (macOS)."
      );
    });

    it("handles permission denied error", async () => {
      mocks.detectPlatform.mockResolvedValue("systemd");
      mocks.getServicePath.mockReturnValue("/etc/systemd/system/steed.service");

      const permError = new Error("Permission denied") as NodeJS.ErrnoException;
      permError.code = "EACCES";
      mocks.writeFile.mockRejectedValue(permError);

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(mocks.error).toHaveBeenCalledWith("Permission denied. On Linux, run with sudo:");
    });

    it("runs install command when provided", async () => {
      mocks.detectPlatform.mockResolvedValue("systemd");
      mocks.getServiceCommands.mockReturnValue({
        install: ["sudo", "systemctl", "daemon-reload"],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      const mockChild = {
        on: vi.fn((event: string, handler: (code: number) => void) => {
          if (event === "exit") {
            setTimeout(() => handler(0), 10);
          }
          return mockChild;
        }),
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(mocks.spawn).toHaveBeenCalledWith("sudo", ["systemctl", "daemon-reload"], {
        stdio: "pipe",
      });
    });

    it("handles failed install command", async () => {
      mocks.detectPlatform.mockResolvedValue("systemd");
      mocks.getServiceCommands.mockReturnValue({
        install: ["sudo", "systemctl", "daemon-reload"],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      const mockChild = {
        on: vi.fn((event: string, handler: (code: number | null) => void) => {
          if (event === "exit") {
            setTimeout(() => handler(1), 10);
          }
          return mockChild;
        }),
        stderr: {
          on: vi.fn((_event: string, handler: (data: Buffer) => void) => {
            handler(Buffer.from("daemon-reload failed"));
          }),
        },
      };
      mocks.spawn.mockReturnValue(mockChild);

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(mocks.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to enable service:")
      );
    });

    it("handles spawn error in install command", async () => {
      mocks.detectPlatform.mockResolvedValue("systemd");
      mocks.getServiceCommands.mockReturnValue({
        install: ["sudo", "systemctl", "daemon-reload"],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      const mockChild = {
        on: vi.fn((event: string, handler: (err: Error) => void) => {
          if (event === "error") {
            setTimeout(() => handler(new Error("spawn error")), 10);
          }
          return mockChild;
        }),
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(mocks.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to enable service: spawn error")
      );
    });
  });

  describe("service uninstall", () => {
    it("uninstalls service", async () => {
      mocks.detectPlatform.mockResolvedValue("launchd");
      mocks.getServicePath.mockReturnValue("/tmp/test.plist");
      mocks.getServiceCommands.mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      await program.parseAsync(["node", "test", "service", "uninstall"]);

      expect(mocks.unlink).toHaveBeenCalledWith("/tmp/test.plist");
      expect(mocks.success).toHaveBeenCalledWith("Service uninstalled.");
    });

    it("shows error on unsupported platform", async () => {
      mocks.detectPlatform.mockResolvedValue("unknown");

      await program.parseAsync(["node", "test", "service", "uninstall"]);

      expect(mocks.error).toHaveBeenCalledWith("Unsupported platform.");
    });

    it("handles already removed service file", async () => {
      mocks.detectPlatform.mockResolvedValue("launchd");
      mocks.getServicePath.mockReturnValue("/tmp/test.plist");
      mocks.getServiceCommands.mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      const noentError = new Error("No such file") as NodeJS.ErrnoException;
      noentError.code = "ENOENT";
      mocks.unlink.mockRejectedValue(noentError);

      await program.parseAsync(["node", "test", "service", "uninstall"]);

      expect(mocks.info).toHaveBeenCalledWith("Service file already removed.");
      expect(mocks.success).toHaveBeenCalledWith("Service uninstalled.");
    });

    it("handles permission denied on uninstall", async () => {
      mocks.detectPlatform.mockResolvedValue("launchd");
      mocks.getServicePath.mockReturnValue("/tmp/test.plist");
      mocks.getServiceCommands.mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      const permError = new Error("Permission denied") as NodeJS.ErrnoException;
      permError.code = "EACCES";
      mocks.unlink.mockRejectedValue(permError);

      await program.parseAsync(["node", "test", "service", "uninstall"]);

      expect(mocks.error).toHaveBeenCalledWith("Permission denied. On Linux, run with sudo.");
    });

    it("rethrows unknown errors on uninstall", async () => {
      mocks.detectPlatform.mockResolvedValue("launchd");
      mocks.getServicePath.mockReturnValue("/tmp/test.plist");
      mocks.getServiceCommands.mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      const unknownError = new Error("Unknown error") as NodeJS.ErrnoException;
      unknownError.code = "EUNKNOWN";
      mocks.unlink.mockRejectedValue(unknownError);

      await expect(
        program.parseAsync(["node", "test", "service", "uninstall"])
      ).rejects.toThrow("Unknown error");
    });

    it("stops service before uninstalling", async () => {
      mocks.detectPlatform.mockResolvedValue("launchd");
      mocks.getServiceCommands.mockReturnValue({
        install: [],
        uninstall: ["launchctl", "unload", "/tmp/test.plist"],
        start: [],
        stop: ["launchctl", "stop", "com.steed.host-service"],
        status: [],
        logs: [],
      });

      const mockChild = {
        on: vi.fn((event: string, handler: (code: number) => void) => {
          if (event === "exit") {
            setTimeout(() => handler(0), 10);
          }
          return mockChild;
        }),
        stderr: { on: vi.fn() },
      };
      mocks.spawn.mockReturnValue(mockChild);

      await program.parseAsync(["node", "test", "service", "uninstall"]);

      expect(mocks.info).toHaveBeenCalledWith("Stopping service...");
      expect(mocks.spawn).toHaveBeenCalledWith("launchctl", ["stop", "com.steed.host-service"], {
        stdio: "pipe",
      });
    });
  });

  describe("service logs", () => {
    it("streams logs on supported platform", async () => {
      mocks.detectPlatform.mockResolvedValue("launchd");
      mocks.getServiceCommands.mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: ["tail", "-f", "/tmp/steed.log"],
      });

      const mockChild = {
        on: vi.fn((event: string, handler: (code: number) => void) => {
          if (event === "exit") {
            setTimeout(() => handler(0), 10);
          }
          return mockChild;
        }),
      };
      mocks.spawn.mockReturnValue(mockChild);

      await program.parseAsync(["node", "test", "service", "logs"]);

      expect(mocks.info).toHaveBeenCalledWith("Streaming logs (Ctrl+C to stop)...\n");
      expect(mocks.spawn).toHaveBeenCalledWith("tail", ["-f", "/tmp/steed.log"], { stdio: "inherit" });
    });

    it("shows error on unsupported platform", async () => {
      mocks.detectPlatform.mockResolvedValue("unknown");

      await program.parseAsync(["node", "test", "service", "logs"]);

      expect(mocks.error).toHaveBeenCalledWith("Unsupported platform.");
    });

    it("shows error when logs not available", async () => {
      mocks.detectPlatform.mockResolvedValue("launchd");
      mocks.getServiceCommands.mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      await program.parseAsync(["node", "test", "service", "logs"]);

      expect(mocks.error).toHaveBeenCalledWith("Log viewing not available for this platform.");
    });

    it("handles spawn error", async () => {
      mocks.detectPlatform.mockResolvedValue("launchd");
      mocks.getServiceCommands.mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: ["tail", "-f", "/tmp/steed.log"],
      });

      const mockChild = {
        on: vi.fn((event: string, handler: (err: Error) => void) => {
          if (event === "error") {
            setTimeout(() => handler(new Error("spawn failed")), 10);
          }
          return mockChild;
        }),
      };
      mocks.spawn.mockReturnValue(mockChild);

      await program.parseAsync(["node", "test", "service", "logs"]);

      expect(mocks.error).toHaveBeenCalledWith("Failed to stream logs: spawn failed");
    });
  });

  describe("service start", () => {
    it("shows error when no config", async () => {
      mocks.loadConfig.mockResolvedValue(null);

      await program.parseAsync(["node", "test", "service", "start"]);

      expect(mocks.error).toHaveBeenCalledWith("No config found. Run 'steed init' first.");
    });

    it("shows error when service already running", async () => {
      mocks.loadConfig.mockResolvedValue({ host_id: "test" });
      mocks.stateLoad.mockResolvedValue({ service_pid: 12345 });
      mocks.isPidRunning.mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "start"]);

      expect(mocks.error).toHaveBeenCalledWith("Service already running (PID: 12345)");
    });

    it("handles start failure", async () => {
      mocks.loadConfig.mockResolvedValue({ host_id: "test" });
      mocks.stateLoad.mockResolvedValue(null);
      mocks.hostServiceStart.mockRejectedValue(new Error("Start failed"));

      await program.parseAsync(["node", "test", "service", "start"]);

      expect(mocks.error).toHaveBeenCalledWith("Failed to start service: Start failed");
    });
  });
});
