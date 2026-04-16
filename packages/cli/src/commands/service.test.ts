import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// Import real modules — we spy on them instead of mocking
import * as configModule from "../config/index.js";
import * as processModule from "../lib/process.js";
import * as platformModule from "../lib/platform.js";
import * as outputModule from "../lib/output.js";
import * as fsModule from "../lib/fs.js";
import { HostService } from "../service/index.js";
import { StateManager } from "../service/state.js";
import { createServiceCommand } from "./service.js";

// Helper to cast spied methods for re-mocking in individual tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn<(...args: any[]) => any>>;

describe("service command", () => {
  let program: Command;

  beforeEach(() => {
    // Spy on class prototypes
    vi.spyOn(StateManager.prototype, "load").mockResolvedValue(null);
    vi.spyOn(StateManager.prototype, "updateServicePid").mockResolvedValue(undefined);
    vi.spyOn(HostService.prototype, "start").mockResolvedValue(undefined);
    vi.spyOn(HostService.prototype, "stop").mockResolvedValue(undefined);

    // Spy on config module
    vi.spyOn(configModule, "loadConfig").mockResolvedValue(null as unknown as Awaited<ReturnType<typeof configModule.loadConfig>>);

    // Spy on process module
    vi.spyOn(processModule, "isPidRunning").mockResolvedValue(false);
    vi.spyOn(processModule, "killProcess").mockResolvedValue(true);
    vi.spyOn(processModule, "spawnInteractive").mockResolvedValue({ exitCode: 0 });
    vi.spyOn(processModule, "spawnCapture").mockResolvedValue({ success: true });

    // Spy on platform module
    vi.spyOn(platformModule, "detectPlatform").mockResolvedValue("launchd" as Awaited<ReturnType<typeof platformModule.detectPlatform>>);
    vi.spyOn(platformModule, "generateSystemdUnit").mockReturnValue("[Unit]\nDescription=Test");
    vi.spyOn(platformModule, "generateLaunchdPlist").mockReturnValue('<?xml version="1.0"?>');
    vi.spyOn(platformModule, "getServicePath").mockReturnValue("/tmp/test.plist");
    vi.spyOn(platformModule, "getServiceCommands").mockReturnValue({
      install: [],
      uninstall: [],
      start: [],
      stop: [],
      status: [],
      logs: ["tail", "-f", "/tmp/test.log"],
    });

    // Spy on output module — suppress output
    vi.spyOn(outputModule, "success").mockImplementation(() => {});
    vi.spyOn(outputModule, "error").mockImplementation(() => {});
    vi.spyOn(outputModule, "info").mockImplementation(() => {});
    vi.spyOn(outputModule, "warn").mockImplementation(() => {});

    // Spy on fs module
    vi.spyOn(fsModule, "writeServiceFile").mockResolvedValue(undefined);
    vi.spyOn(fsModule, "removeFile").mockResolvedValue(undefined);

    // Set loadConfig to return valid config by default
    asMock(configModule.loadConfig).mockResolvedValue({ host_id: "test-host" });

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
      asMock(StateManager.prototype.load).mockResolvedValue(null);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(outputModule.info).toHaveBeenCalledWith("Host Service: stopped");
    });

    it("shows running with PID when process is running", async () => {
      asMock(StateManager.prototype.load).mockResolvedValue({
        service_pid: 12345,
        last_scan_at: new Date().toISOString(),
        last_report_at: new Date().toISOString(),
      });
      asMock(processModule.isPidRunning).mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(outputModule.success).toHaveBeenCalledWith("Host Service: running (PID: 12345)");
      expect(outputModule.info).toHaveBeenCalledWith(expect.stringContaining("Last scan:"));
      expect(outputModule.info).toHaveBeenCalledWith(expect.stringContaining("Last report:"));
    });

    it("shows stale PID warning when process not running", async () => {
      asMock(StateManager.prototype.load).mockResolvedValue({ service_pid: 99999 });
      asMock(processModule.isPidRunning).mockResolvedValue(false);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(outputModule.info).toHaveBeenCalledWith("Host Service: stopped (stale PID in state file)");
      expect(StateManager.prototype.updateServicePid).toHaveBeenCalledWith(null);
    });

    it("shows last error if present", async () => {
      asMock(StateManager.prototype.load).mockResolvedValue({
        service_pid: 12345,
        last_error: { message: "Test error", type: "scan" },
      });
      asMock(processModule.isPidRunning).mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(outputModule.warn).toHaveBeenCalledWith("Last error: Test error (scan)");
    });

    it("shows time ago for old scans (minutes)", async () => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      asMock(StateManager.prototype.load).mockResolvedValue({
        service_pid: 12345,
        last_scan_at: thirtyMinutesAgo,
      });
      asMock(processModule.isPidRunning).mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(outputModule.info).toHaveBeenCalledWith(expect.stringContaining("minutes ago"));
    });

    it("shows time ago for old scans (hours)", async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      asMock(StateManager.prototype.load).mockResolvedValue({
        service_pid: 12345,
        last_scan_at: twoHoursAgo,
      });
      asMock(processModule.isPidRunning).mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(outputModule.info).toHaveBeenCalledWith(expect.stringContaining("hours ago"));
    });

    it("shows time ago for old scans (days)", async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      asMock(StateManager.prototype.load).mockResolvedValue({
        service_pid: 12345,
        last_scan_at: twoDaysAgo,
      });
      asMock(processModule.isPidRunning).mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "status"]);

      expect(outputModule.info).toHaveBeenCalledWith(expect.stringContaining("days ago"));
    });
  });

  describe("service stop", () => {
    it("stops running service", async () => {
      asMock(StateManager.prototype.load).mockResolvedValue({ service_pid: 12345 });
      asMock(processModule.killProcess).mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "stop"]);

      expect(outputModule.info).toHaveBeenCalledWith("Stopping service (PID: 12345)...");
      expect(processModule.killProcess).toHaveBeenCalledWith(12345);
      expect(outputModule.success).toHaveBeenCalledWith("Service stopped.");
    });

    it("shows error when service not running", async () => {
      asMock(StateManager.prototype.load).mockResolvedValue(null);

      await program.parseAsync(["node", "test", "service", "stop"]);

      expect(outputModule.error).toHaveBeenCalledWith("Service not running.");
    });

    it("handles failed kill gracefully", async () => {
      asMock(StateManager.prototype.load).mockResolvedValue({ service_pid: 12345 });
      asMock(processModule.killProcess).mockResolvedValue(false);

      await program.parseAsync(["node", "test", "service", "stop"]);

      expect(outputModule.error).toHaveBeenCalledWith(
        "Failed to stop service. Process may have already exited."
      );
      expect(StateManager.prototype.updateServicePid).toHaveBeenCalledWith(null);
    });
  });

  describe("service install", () => {
    it("installs service on launchd platform", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("launchd");
      asMock(platformModule.generateLaunchdPlist).mockReturnValue('<?xml version="1.0"?>');
      asMock(platformModule.getServicePath).mockReturnValue("/tmp/test.plist");

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(fsModule.writeServiceFile).toHaveBeenCalledWith("/tmp/test.plist", '<?xml version="1.0"?>', 0o644);
      expect(outputModule.success).toHaveBeenCalledWith("Service installed successfully.");
      expect(outputModule.info).toHaveBeenCalledWith(expect.stringContaining("To start the service"));
    });

    it("installs service on systemd platform", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("systemd");
      asMock(platformModule.generateSystemdUnit).mockReturnValue("[Unit]\nDescription=Test");
      asMock(platformModule.getServicePath).mockReturnValue("/etc/systemd/system/steed.service");

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(fsModule.writeServiceFile).toHaveBeenCalledWith(
        "/etc/systemd/system/steed.service",
        "[Unit]\nDescription=Test",
        0o644
      );
    });

    it("shows error on unsupported platform", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("unknown");

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(outputModule.error).toHaveBeenCalledWith(
        "Unsupported platform. Service installation requires systemd (Linux) or launchd (macOS)."
      );
    });

    it("handles permission denied error", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("systemd");
      asMock(platformModule.getServicePath).mockReturnValue("/etc/systemd/system/steed.service");

      const permError = new Error("Permission denied") as NodeJS.ErrnoException;
      permError.code = "EACCES";
      asMock(fsModule.writeServiceFile).mockRejectedValue(permError);

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(outputModule.error).toHaveBeenCalledWith("Permission denied. On Linux, run with sudo:");
    });

    it("runs install command when provided", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("systemd");
      asMock(platformModule.getServiceCommands).mockReturnValue({
        install: ["sudo", "systemctl", "daemon-reload"],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      asMock(processModule.spawnCapture).mockResolvedValue({ success: true });

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(processModule.spawnCapture).toHaveBeenCalledWith("sudo", ["systemctl", "daemon-reload"]);
    });

    it("handles failed install command", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("systemd");
      asMock(platformModule.getServiceCommands).mockReturnValue({
        install: ["sudo", "systemctl", "daemon-reload"],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      asMock(processModule.spawnCapture).mockResolvedValue({ success: false, error: "daemon-reload failed" });

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(outputModule.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to enable service:")
      );
    });

    it("handles spawn error in install command", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("systemd");
      asMock(platformModule.getServiceCommands).mockReturnValue({
        install: ["sudo", "systemctl", "daemon-reload"],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      asMock(processModule.spawnCapture).mockResolvedValue({ success: false, error: "spawn error" });

      await program.parseAsync(["node", "test", "service", "install"]);

      expect(outputModule.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to enable service: spawn error")
      );
    });
  });

  describe("service uninstall", () => {
    it("uninstalls service", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("launchd");
      asMock(platformModule.getServicePath).mockReturnValue("/tmp/test.plist");
      asMock(platformModule.getServiceCommands).mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      await program.parseAsync(["node", "test", "service", "uninstall"]);

      expect(fsModule.removeFile).toHaveBeenCalledWith("/tmp/test.plist");
      expect(outputModule.success).toHaveBeenCalledWith("Service uninstalled.");
    });

    it("shows error on unsupported platform", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("unknown");

      await program.parseAsync(["node", "test", "service", "uninstall"]);

      expect(outputModule.error).toHaveBeenCalledWith("Unsupported platform.");
    });

    it("handles already removed service file", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("launchd");
      asMock(platformModule.getServicePath).mockReturnValue("/tmp/test.plist");
      asMock(platformModule.getServiceCommands).mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      const noentError = new Error("No such file") as NodeJS.ErrnoException;
      noentError.code = "ENOENT";
      asMock(fsModule.removeFile).mockRejectedValue(noentError);

      await program.parseAsync(["node", "test", "service", "uninstall"]);

      expect(outputModule.info).toHaveBeenCalledWith("Service file already removed.");
      expect(outputModule.success).toHaveBeenCalledWith("Service uninstalled.");
    });

    it("handles permission denied on uninstall", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("launchd");
      asMock(platformModule.getServicePath).mockReturnValue("/tmp/test.plist");
      asMock(platformModule.getServiceCommands).mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      const permError = new Error("Permission denied") as NodeJS.ErrnoException;
      permError.code = "EACCES";
      asMock(fsModule.removeFile).mockRejectedValue(permError);

      await program.parseAsync(["node", "test", "service", "uninstall"]);

      expect(outputModule.error).toHaveBeenCalledWith("Permission denied. On Linux, run with sudo.");
    });

    it("rethrows unknown errors on uninstall", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("launchd");
      asMock(platformModule.getServicePath).mockReturnValue("/tmp/test.plist");
      asMock(platformModule.getServiceCommands).mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      const unknownError = new Error("Unknown error") as NodeJS.ErrnoException;
      unknownError.code = "EUNKNOWN";
      asMock(fsModule.removeFile).mockRejectedValue(unknownError);

      await expect(
        program.parseAsync(["node", "test", "service", "uninstall"])
      ).rejects.toThrow("Unknown error");
    });

    it("stops service before uninstalling", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("launchd");
      asMock(platformModule.getServiceCommands).mockReturnValue({
        install: [],
        uninstall: ["launchctl", "unload", "/tmp/test.plist"],
        start: [],
        stop: ["launchctl", "stop", "com.steed.host-service"],
        status: [],
        logs: [],
      });

      asMock(processModule.spawnCapture).mockResolvedValue({ success: true });

      await program.parseAsync(["node", "test", "service", "uninstall"]);

      expect(outputModule.info).toHaveBeenCalledWith("Stopping service...");
      expect(processModule.spawnCapture).toHaveBeenCalledWith("launchctl", ["stop", "com.steed.host-service"]);
    });
  });

  describe("service logs", () => {
    it("streams logs on supported platform", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("launchd");
      asMock(platformModule.getServiceCommands).mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: ["tail", "-f", "/tmp/steed.log"],
      });

      asMock(processModule.spawnInteractive).mockResolvedValue({ exitCode: 0 });

      await program.parseAsync(["node", "test", "service", "logs"]);

      expect(outputModule.info).toHaveBeenCalledWith("Streaming logs (Ctrl+C to stop)...\n");
      expect(processModule.spawnInteractive).toHaveBeenCalledWith("tail", ["-f", "/tmp/steed.log"]);
    });

    it("shows error on unsupported platform", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("unknown");

      await program.parseAsync(["node", "test", "service", "logs"]);

      expect(outputModule.error).toHaveBeenCalledWith("Unsupported platform.");
    });

    it("shows error when logs not available", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("launchd");
      asMock(platformModule.getServiceCommands).mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      });

      await program.parseAsync(["node", "test", "service", "logs"]);

      expect(outputModule.error).toHaveBeenCalledWith("Log viewing not available for this platform.");
    });

    it("handles spawn error", async () => {
      asMock(platformModule.detectPlatform).mockResolvedValue("launchd");
      asMock(platformModule.getServiceCommands).mockReturnValue({
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: ["tail", "-f", "/tmp/steed.log"],
      });

      asMock(processModule.spawnInteractive).mockResolvedValue({ exitCode: 1, error: "spawn failed" });

      await program.parseAsync(["node", "test", "service", "logs"]);

      expect(outputModule.error).toHaveBeenCalledWith("Failed to stream logs: spawn failed");
    });
  });

  describe("service start", () => {
    it("shows error when no config", async () => {
      asMock(configModule.loadConfig).mockResolvedValue(null);

      await program.parseAsync(["node", "test", "service", "start"]);

      expect(outputModule.error).toHaveBeenCalledWith("No config found. Run 'steed init' first.");
    });

    it("shows error when service already running", async () => {
      asMock(StateManager.prototype.load).mockResolvedValue({ service_pid: 12345 });
      asMock(processModule.isPidRunning).mockResolvedValue(true);

      await program.parseAsync(["node", "test", "service", "start"]);

      expect(outputModule.error).toHaveBeenCalledWith("Service already running (PID: 12345)");
    });

    it("handles start failure", async () => {
      asMock(HostService.prototype.start).mockRejectedValue(new Error("Start failed"));

      await program.parseAsync(["node", "test", "service", "start"]);

      expect(outputModule.error).toHaveBeenCalledWith("Failed to start service: Start failed");
    });
  });
});
