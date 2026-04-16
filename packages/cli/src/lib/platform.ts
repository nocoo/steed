/**
 * Platform detection and service file generation utilities
 */

/**
 * Supported platforms for system service installation
 */
export type Platform = "systemd" | "launchd" | "unknown";

/**
 * Detect the current platform based on available tools
 */
export async function detectPlatform(): Promise<Platform> {
  // Check for macOS (launchd)
  if (process.platform === "darwin") {
    return "launchd";
  }

  // Check for Linux with systemd
  if (process.platform === "linux") {
    return "systemd";
  }

  return "unknown";
}

/**
 * Generate systemd unit file content
 */
export function generateSystemdUnit(binaryPath: string): string {
  return `[Unit]
Description=Steed Host Service
After=network.target

[Service]
Type=simple
ExecStart=${binaryPath} service start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Generate launchd plist file content
 */
export function generateLaunchdPlist(binaryPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.steed.host-service</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binaryPath}</string>
    <string>service</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/steed.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/steed.err.log</string>
</dict>
</plist>
`;
}

/**
 * Get the service file path for the platform
 */
export function getServicePath(platform: Platform): string {
  switch (platform) {
    case "systemd":
      return "/etc/systemd/system/steed.service";
    case "launchd":
      return `${process.env.HOME}/Library/LaunchAgents/com.steed.host-service.plist`;
    case "unknown":
      return "";
  }
}

/**
 * Get commands for service management
 */
export function getServiceCommands(platform: Platform): {
  install: string[];
  uninstall: string[];
  start: string[];
  stop: string[];
  status: string[];
  logs: string[];
} {
  switch (platform) {
    case "systemd":
      return {
        install: ["sudo", "systemctl", "daemon-reload"],
        uninstall: ["sudo", "systemctl", "disable", "steed"],
        start: ["sudo", "systemctl", "start", "steed"],
        stop: ["sudo", "systemctl", "stop", "steed"],
        status: ["systemctl", "status", "steed"],
        logs: ["journalctl", "-u", "steed", "-f"],
      };
    case "launchd":
      return {
        install: ["launchctl", "load", getServicePath("launchd")],
        uninstall: ["launchctl", "unload", getServicePath("launchd")],
        start: ["launchctl", "start", "com.steed.host-service"],
        stop: ["launchctl", "stop", "com.steed.host-service"],
        status: ["launchctl", "list", "com.steed.host-service"],
        logs: ["tail", "-f", "/tmp/steed.log"],
      };
    case "unknown":
      return {
        install: [],
        uninstall: [],
        start: [],
        stop: [],
        status: [],
        logs: [],
      };
  }
}
