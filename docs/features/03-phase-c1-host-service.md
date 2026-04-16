# Phase C1: Host Service

> Host Service — resident process for heartbeat snapshot reporting.

## Overview

Host Service is a resident process running on each agent host. It periodically scans local resources and reports snapshots to the Worker API. This is the foundation for maintaining real-time visibility of distributed agents and data sources.

## Platform Support

**Supported platforms:** macOS, Linux only.

Host Service relies on Unix-specific tools and conventions:
- Process detection: `pgrep -f`
- PATH probe: `which`
- Service management: systemd (Linux), launchd (macOS)
- File permissions: POSIX chmod

Windows is not supported in v1.

## Core Responsibilities

1. **Heartbeat Reporting**: POST `/api/v1/snapshot` every 10 minutes with full resource snapshot
2. **Agent Scanning**: Detect registered agents, collect runtime info (app, version, status)
3. **Data Source Scanning**: Detect CLI tools and MCP services, collect version and auth status
4. **Configuration Management**: Store and load host configuration (API key, Worker URL)

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Host Service                    │
├─────────────────────────────────────────────────┤
│  Scheduler (10min interval)                      │
│       │                                          │
│       ├──> Scanner                               │
│       │      ├── AgentScanner                    │
│       │      └── DataSourceScanner               │
│       │             ├── PathProbe                │
│       │             └── ConfigFileProbe          │
│       │                                          │
│       └──> Reporter                              │
│              └── POST /api/v1/snapshot           │
├─────────────────────────────────────────────────┤
│  ConfigManager                                   │
│       └── ~/.steed/config.json                   │
└─────────────────────────────────────────────────┘
```

## Configuration

### Config File Location

```
~/.steed/config.json
```

### File Permissions

Config file contains the Host API key in plaintext. **Mandatory permissions:**

- `~/.steed/` directory: `0700` (owner read/write/execute only)
- `~/.steed/config.json`: `0600` (owner read/write only)
- `~/.steed/state.json`: `0600` (owner read/write only)

CLI and Host Service must:
1. **On write**: Create files with correct permissions (`chmod 0600`)
2. **On read**: Verify permissions are not more permissive than required; warn if world/group readable

### Config Schema

```typescript
interface HostConfig {
  // Worker API endpoint
  worker_url: string;
  
  // Host API Key (obtained from Dashboard registration)
  api_key: string;
  
  // Registered agents for matching
  agents: RegisteredAgent[];
  
  // Data source scan settings
  data_sources: DataSourceConfig;
}

interface RegisteredAgent {
  // Stable identifier for matching (e.g., "openclaw:/home/agent/workspace")
  match_key: string;
  
  // How to detect this agent
  detection: AgentDetection;
}

interface AgentDetection {
  // Detection method: process, config_file, or custom
  method: "process" | "config_file" | "custom";
  
  // For process: process name pattern
  // For config_file: path to config file
  // For custom: command to run (exit 0 = running, exit 1 = stopped)
  pattern: string;
  
  // Optional: command to get version
  version_command?: string;
}

interface DataSourceConfig {
  // Known CLI tools to scan
  cli_scanners: CliScannerConfig[];
  
  // MCP services to check (future)
  mcp_scanners: McpScannerConfig[];
}

interface CliScannerConfig {
  // CLI name (e.g., "nmem", "wrangler")
  name: string;
  
  // Type: personal_cli or third_party_cli
  type: "personal_cli" | "third_party_cli";
  
  // Binary name to check in PATH
  binary: string;
  
  // Optional: config file path to check for auth status
  config_path?: string;
  
  // Optional: command to get version (default: "{binary} --version")
  version_command?: string;
  
  // Optional: how to determine auth status
  auth_check?: AuthCheck;
}

interface AuthCheck {
  // Method: config_exists, config_field, or command
  method: "config_exists" | "config_field" | "command";
  
  // For config_field: JSON path to check
  // For command: command to run (exit 0 = authenticated)
  pattern?: string;
}

interface McpScannerConfig {
  // MCP service name
  name: string;
  
  // Health check endpoint
  endpoint: string;
}
```

### Example Config

```json
{
  "worker_url": "https://steed-worker.example.workers.dev",
  "api_key": "sk_host_xxxxxxxxxxxxxxxx",
  "agents": [
    {
      "match_key": "openclaw:/home/nocoo/agents/coder",
      "detection": {
        "method": "process",
        "pattern": "openclaw.*coder",
        "version_command": "openclaw --version"
      }
    },
    {
      "match_key": "hermes:/home/nocoo/agents/hermes",
      "detection": {
        "method": "config_file",
        "pattern": "/home/nocoo/agents/hermes/.hermes/config.json"
      }
    }
  ],
  "data_sources": {
    "cli_scanners": [
      {
        "name": "nmem",
        "type": "personal_cli",
        "binary": "nmem",
        "version_command": "nmem --version",
        "auth_check": {
          "method": "command",
          "pattern": "nmem auth status"
        }
      },
      {
        "name": "wrangler",
        "type": "third_party_cli",
        "binary": "wrangler",
        "config_path": "~/.wrangler",
        "auth_check": {
          "method": "config_exists"
        }
      },
      {
        "name": "railway",
        "type": "third_party_cli",
        "binary": "railway",
        "config_path": "~/.railway",
        "auth_check": {
          "method": "config_exists"
        }
      }
    ],
    "mcp_scanners": []
  }
}
```

## Scanning Logic

### Agent Scanning

For each registered agent in config:

1. **Run detection based on configured method** — each method has its own status mapping:

   | Method | Detection Logic | Status Mapping |
   |--------|-----------------|----------------|
   | `process` | `pgrep -f {pattern}` | Found → `running`; Not found → `stopped` |
   | `config_file` | File exists at `{pattern}` | Exists → `stopped` (installed but not running); Not exists → not included (Worker marks `missing`) |
   | `custom` | Run `{pattern}` as command | Exit 0 → `running`; Exit 1 → `stopped`; Exit 2+ or error → not included (Worker marks `missing`) |

   > **Rationale**: `process` directly reflects runtime state. `config_file` only confirms installation — presence means "installed but we can't tell if running" → report as `stopped`; absence means "not installed" → don't report. `custom` gives full control via exit codes.

2. **Collect runtime info** (only if detection produced a status):
   - `runtime_app`: Extract from match_key prefix (e.g., "openclaw" from "openclaw:/path")
   - `runtime_version`: Run version_command if configured; on failure, report `null`

### Data Source Scanning

For each CLI scanner in config:

1. **PATH Probe**: Check if binary exists in PATH (`which {binary}`)
   - Not found → Skip this data source

2. **Version Collection**: Run version command
   - Default: `{binary} --version`
   - Parse first line for version string

3. **Auth Status Check**: Based on configured method
   - `config_exists`: Check if config_path exists → `authenticated` / `unauthenticated`
   - `config_field`: Parse config JSON, check field value
   - `command`: Run command, exit 0 → `authenticated`
   - No auth_check configured → `unknown`

4. Build snapshot entry:
   ```typescript
   {
     type: scanner.type,
     name: scanner.name,
     version: extractedVersion,
     auth_status: determinedStatus
   }
   ```

## Heartbeat Cycle

```
Every 10 minutes:
  1. Load config from ~/.steed/config.json
  2. Run AgentScanner → AgentSnapshot[]
  3. Run DataSourceScanner → DataSourceSnapshot[]
  4. Build SnapshotRequest payload
  5. POST to {worker_url}/api/v1/snapshot
     - Header: Authorization: Bearer {api_key}
  6. Write scan result to state file (see State File below)
  7. Log result (agents_updated, data_sources_updated, etc.)
  8. Handle errors with exponential backoff retry
```

## State File

Host Service maintains a state file for CLI status queries and debugging.

### Location

```
~/.steed/state.json
```

### Schema

```typescript
interface HostState {
  // Last successful scan timestamp (ISO 8601)
  last_scan_at: string | null;
  
  // Last successful report timestamp (ISO 8601)
  last_report_at: string | null;
  
  // Last scan results (for steed status)
  last_scan: {
    agents: AgentSnapshot[];
    data_sources: DataSourceSnapshot[];
  } | null;
  
  // Last report response from Worker
  last_report_response: SnapshotResponse | null;
  
  // Service PID (written on startup, cleared on shutdown)
  service_pid: number | null;
  
  // Last error (if any)
  last_error: {
    timestamp: string;
    message: string;
    type: "scan" | "report" | "config";
  } | null;
}
```

### Write Timing

| Event | Fields Updated |
|-------|----------------|
| Service starts | `service_pid` |
| Service stops | `service_pid = null` |
| Scan completes | `last_scan_at`, `last_scan` |
| Report succeeds | `last_report_at`, `last_report_response` |
| Error occurs | `last_error` |

### CLI Fallback

When `steed status` runs and no state file exists:
- Show "No state file found. Run `steed scan` or start the service."
- Exit with code 0 (not an error)

## Error Handling

### Network Failures

- Retry with exponential backoff: 1s, 2s, 4s, 8s, max 60s
- After 3 retries, wait until next scheduled heartbeat
- Log all failures for debugging

### Scan Failures

- Individual scanner failure should not block others
- Log error and continue with remaining scanners
- Failed scanner's resource not included in snapshot → Worker marks as `missing`

### Config Errors

- Invalid config → Log error, skip heartbeat cycle
- Missing config → Service exits with error (requires initialization via CLI)

## Process Management

### Running as Daemon

Host Service runs as a long-lived process. Recommended deployment:

1. **systemd** (Linux):
   ```ini
   [Unit]
   Description=Steed Host Service
   After=network.target

   [Service]
   Type=simple
   ExecStart=/usr/local/bin/steed service start
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

2. **launchd** (macOS):
   ```xml
   <plist version="1.0">
   <dict>
     <key>Label</key>
     <string>com.steed.host-service</string>
     <key>ProgramArguments</key>
     <array>
       <string>/usr/local/bin/steed</string>
       <string>service</string>
       <string>start</string>
     </array>
     <key>RunAtLoad</key>
     <true/>
     <key>KeepAlive</key>
     <true/>
   </dict>
   </plist>
   ```

### Graceful Shutdown

- Handle SIGTERM/SIGINT
- Complete in-flight heartbeat before exit
- Log shutdown reason

## Implementation

### Module Structure

```
packages/cli/src/
├── service/
│   ├── index.ts           # Service entry point
│   ├── scheduler.ts       # Heartbeat scheduler (10min interval)
│   ├── reporter.ts        # POST /snapshot to Worker
│   └── scanner/
│       ├── index.ts       # Scanner orchestrator
│       ├── agent.ts       # Agent scanner
│       └── data-source.ts # Data source scanner
├── config/
│   ├── index.ts           # Config manager
│   ├── schema.ts          # Config type definitions
│   └── defaults.ts        # Default CLI scanners
└── lib/
    ├── process.ts         # Process detection utilities
    ├── path.ts            # PATH probe utilities
    └── version.ts         # Version parsing utilities
```

### Commit Plan

#### Commit C1-1: Config schema and manager

```
packages/cli/src/config/schema.ts
  - Define HostConfig, RegisteredAgent, DataSourceConfig types
  - Define validation schema (zod)

packages/cli/src/config/index.ts
  - ConfigManager class
  - load(): Read and validate ~/.steed/config.json
  - save(): Write config to file
  - getConfigPath(): Return config file path

packages/cli/src/config/defaults.ts
  - Default CLI scanners for common tools (wrangler, railway, gh, etc.)

packages/cli/src/config/index.test.ts
  - Test config load/save
  - Test validation errors
  - Test default values
```

**Tests:** Config load/save, validation, defaults

---

#### Commit C1-2: Process detection utilities

```
packages/cli/src/lib/process.ts
  - isProcessRunning(pattern: string): Promise<boolean>
  - getProcessInfo(pattern: string): Promise<ProcessInfo | null>
  - Uses: pgrep -f (Linux/macOS)

packages/cli/src/lib/process.test.ts
  - Test process detection
  - Test pattern matching
```

**Tests:** Process detection on current platform

---

#### Commit C1-3: PATH probe and version utilities

```
packages/cli/src/lib/path.ts
  - isInPath(binary: string): Promise<boolean>
  - getBinaryPath(binary: string): Promise<string | null>
  - Uses: which command

packages/cli/src/lib/version.ts
  - getVersion(command: string): Promise<string | null>
  - parseVersionString(output: string): string
  - Handles common version formats

packages/cli/src/lib/path.test.ts
packages/cli/src/lib/version.test.ts
```

**Tests:** PATH detection, version parsing

---

#### Commit C1-4: Agent scanner

```
packages/cli/src/service/scanner/agent.ts
  - AgentScanner class
  - scan(agents: RegisteredAgent[]): Promise<AgentSnapshot[]>
  - detectAgent(agent: RegisteredAgent): Promise<AgentSnapshot | null>
  - Handles process, config_file, custom detection methods

packages/cli/src/service/scanner/agent.test.ts
  - Test each detection method
  - Test version extraction
  - Test failure handling (agent not found)
```

**Tests:** Agent detection for each method

---

#### Commit C1-5: Data source scanner

```
packages/cli/src/service/scanner/data-source.ts
  - DataSourceScanner class
  - scan(config: DataSourceConfig): Promise<DataSourceSnapshot[]>
  - scanCli(scanner: CliScannerConfig): Promise<DataSourceSnapshot | null>
  - checkAuthStatus(scanner: CliScannerConfig): Promise<DataSourceAuthStatus>

packages/cli/src/service/scanner/data-source.test.ts
  - Test PATH probe
  - Test version extraction
  - Test auth status detection (each method)
  - Test failure handling (CLI not found)
```

**Tests:** Data source detection, auth status

---

#### Commit C1-6: Scanner orchestrator

```
packages/cli/src/service/scanner/index.ts
  - Scanner class
  - scanAll(config: HostConfig): Promise<SnapshotRequest>
  - Orchestrates AgentScanner and DataSourceScanner
  - Handles partial failures gracefully

packages/cli/src/service/scanner/index.test.ts
  - Test full scan with mixed success/failure
  - Test empty results
```

**Tests:** Orchestration, error isolation

---

#### Commit C1-7: Reporter

```
packages/cli/src/service/reporter.ts
  - Reporter class
  - report(config: HostConfig, snapshot: SnapshotRequest): Promise<SnapshotResponse>
  - HTTP POST to Worker with auth header
  - Retry logic with exponential backoff

packages/cli/src/service/reporter.test.ts
  - Test successful report
  - Test retry on failure
  - Test auth header
```

**Tests:** HTTP reporting, retry logic

---

#### Commit C1-8: Scheduler and service entry

```
packages/cli/src/service/scheduler.ts
  - Scheduler class
  - start(): Begin 10-minute heartbeat cycle
  - stop(): Graceful shutdown
  - runOnce(): Manual trigger (for CLI)

packages/cli/src/service/index.ts
  - HostService class
  - start(): Load config, start scheduler
  - stop(): Stop scheduler, cleanup
  - Signal handling (SIGTERM, SIGINT)

packages/cli/src/service/index.test.ts
packages/cli/src/service/scheduler.test.ts
  - Test scheduler timing
  - Test graceful shutdown
```

**Tests:** Scheduler, service lifecycle

---

## Progress

| Commit | Status |
|--------|--------|
| C1-1: Config schema and manager | Pending |
| C1-2: Process detection utilities | Pending |
| C1-3: PATH probe and version utilities | Pending |
| C1-4: Agent scanner | Pending |
| C1-5: Data source scanner | Pending |
| C1-6: Scanner orchestrator | Pending |
| C1-7: Reporter | Pending |
| C1-8: Scheduler and service entry | Pending |
