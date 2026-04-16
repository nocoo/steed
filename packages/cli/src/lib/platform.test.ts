import { describe, it, expect, afterEach } from "vitest";
import {
  detectPlatform,
  generateSystemdUnit,
  generateLaunchdPlist,
  getServicePath,
  getServiceCommands,
} from "./platform.js";

describe("platform utilities", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  describe("detectPlatform", () => {
    it("returns a valid platform value", async () => {
      const platform = await detectPlatform();
      expect(["systemd", "launchd", "unknown"]).toContain(platform);
    });

    it("returns launchd on darwin", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      const platform = await detectPlatform();
      expect(platform).toBe("launchd");
    });

    it("returns systemd on linux", async () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      const platform = await detectPlatform();
      expect(platform).toBe("systemd");
    });

    it("returns unknown on unsupported platform", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const platform = await detectPlatform();
      expect(platform).toBe("unknown");
    });
  });

  describe("generateSystemdUnit", () => {
    it("generates valid systemd unit file", () => {
      const unit = generateSystemdUnit("/usr/local/bin/steed");

      expect(unit).toContain("[Unit]");
      expect(unit).toContain("Description=Steed Host Service");
      expect(unit).toContain("[Service]");
      expect(unit).toContain("ExecStart=/usr/local/bin/steed service start");
      expect(unit).toContain("[Install]");
      expect(unit).toContain("WantedBy=multi-user.target");
    });

    it("uses provided binary path", () => {
      const unit = generateSystemdUnit("/custom/path/steed");
      expect(unit).toContain("ExecStart=/custom/path/steed");
    });
  });

  describe("generateLaunchdPlist", () => {
    it("generates valid plist XML", () => {
      const plist = generateLaunchdPlist("/usr/local/bin/steed");

      expect(plist).toContain('<?xml version="1.0"');
      expect(plist).toContain("<!DOCTYPE plist");
      expect(plist).toContain("<plist version=\"1.0\">");
      expect(plist).toContain("<key>Label</key>");
      expect(plist).toContain("<string>com.steed.host-service</string>");
      expect(plist).toContain("<string>/usr/local/bin/steed</string>");
      expect(plist).toContain("<key>RunAtLoad</key>");
      expect(plist).toContain("<true/>");
    });

    it("uses provided binary path", () => {
      const plist = generateLaunchdPlist("/custom/path/steed");
      expect(plist).toContain("<string>/custom/path/steed</string>");
    });
  });

  describe("getServicePath", () => {
    it("returns systemd path for systemd platform", () => {
      const path = getServicePath("systemd");
      expect(path).toBe("/etc/systemd/system/steed.service");
    });

    it("returns launchd path for launchd platform", () => {
      const path = getServicePath("launchd");
      expect(path).toContain("Library/LaunchAgents/com.steed.host-service.plist");
    });

    it("returns empty string for unknown platform", () => {
      const path = getServicePath("unknown");
      expect(path).toBe("");
    });
  });

  describe("getServiceCommands", () => {
    it("returns systemd commands for systemd platform", () => {
      const commands = getServiceCommands("systemd");

      expect(commands.install).toContain("systemctl");
      expect(commands.start).toContain("systemctl");
      expect(commands.stop).toContain("systemctl");
      expect(commands.status).toContain("systemctl");
      expect(commands.logs).toContain("journalctl");
    });

    it("returns launchd commands for launchd platform", () => {
      const commands = getServiceCommands("launchd");

      expect(commands.install).toContain("launchctl");
      expect(commands.start).toContain("launchctl");
      expect(commands.stop).toContain("launchctl");
      expect(commands.status).toContain("launchctl");
      expect(commands.logs).toContain("tail");
    });

    it("returns empty arrays for unknown platform", () => {
      const commands = getServiceCommands("unknown");

      expect(commands.install).toHaveLength(0);
      expect(commands.start).toHaveLength(0);
      expect(commands.stop).toHaveLength(0);
      expect(commands.status).toHaveLength(0);
      expect(commands.logs).toHaveLength(0);
    });
  });
});
