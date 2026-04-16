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

### Dependencies

Before starting Phase C1, ensure these are complete:

- Worker `/api/v1/snapshot` endpoint (Phase A) ✅
- Worker `/api/v1/auth/verify` endpoint (for CLI init)
- Worker `/api/v1/agents` POST endpoint (Phase B1) ✅
- `@steed/shared` types: `SnapshotRequest`, `SnapshotResponse`, `AgentSnapshot`, `DataSourceSnapshot` ✅

### Module Structure

```
packages/cli/src/
├── service/
│   ├── index.ts           # Service entry point
│   ├── state.ts           # State file manager
│   ├── scheduler.ts       # Heartbeat scheduler (10min interval)
│   ├── reporter.ts        # POST /snapshot to Worker
│   └── scanner/
│       ├── index.ts       # Scanner orchestrator
│       ├── agent.ts       # Agent scanner
│       └── data-source.ts # Data source scanner
├── config/
│   ├── index.ts           # Config manager
│   ├── schema.ts          # Config type definitions + zod validation
│   ├── permissions.ts     # File permission utilities
│   └── defaults.ts        # Default CLI scanners
└── lib/
    ├── http.ts            # HTTP client + auth verify
    ├── process.ts         # Process detection utilities
    ├── path.ts            # PATH probe utilities
    └── version.ts         # Version parsing utilities
```

> **Note:** CLI package scaffold (package.json, tsconfig, bin/) is created in Phase C2-1. C1 commits only add modules under `src/`.

### Commit Plan

#### Commit C1-1: Config schema

**Files:**

```
packages/cli/src/config/schema.ts
  - HostConfig interface
  - RegisteredAgent interface  
  - AgentDetection interface
  - DataSourceConfig interface
  - CliScannerConfig interface
  - AuthCheck interface
  - HostState interface (state file)
  - Zod schemas for all types
  - Export: hostConfigSchema, hostStateSchema

packages/cli/src/config/schema.test.ts
  - Valid config passes validation
  - Missing required fields rejected
  - Invalid api_key format rejected
  - Invalid detection method rejected
  - Invalid auth_check method rejected
```

**Verification:**
- `bun test` passes
- Types compile without errors

---

#### Commit C1-2: Config manager with file permissions

**Files:**

```
packages/cli/src/config/permissions.ts
  - ensureDir(path, mode): Create directory with permissions
  - ensureFilePermissions(path, mode): Set file permissions
  - checkPermissions(path): Verify not world/group readable
  - STEED_DIR = ~/.steed
  - CONFIG_FILE = ~/.steed/config.json
  - STATE_FILE = ~/.steed/state.json

packages/cli/src/config/index.ts
  - ConfigManager class:
    - constructor(configPath?: string)
    - load(): Promise<HostConfig> — read, parse, validate
    - save(config: HostConfig): Promise<void> — validate, write with 0600
    - exists(): Promise<boolean>
    - getPath(): string
  - On load: warn if permissions too permissive
  - On save: ensure ~/.steed/ exists with 0700

packages/cli/src/config/defaults.ts
  - DEFAULT_CLI_SCANNERS: CliScannerConfig[]
    - wrangler (third_party_cli, config_exists: ~/.wrangler)
    - railway (third_party_cli, config_exists: ~/.railway)  
    - gh (third_party_cli, command: gh auth status)
    - vercel (third_party_cli, config_exists: ~/.vercel)

packages/cli/src/config/index.test.ts
  - Load valid config file
  - Load returns error for missing file
  - Load returns error for invalid JSON
  - Load returns error for schema validation failure
  - Save creates file with correct permissions
  - Save creates directory if not exists
  - Round-trip: save then load returns same data
```

**Verification:**
- Config load/save works
- File permissions are enforced

---

#### Commit C1-3: HTTP client and auth verify

**Files:**

```
packages/cli/src/lib/http.ts
  - HttpClient class:
    - constructor(baseUrl: string, apiKey?: string)
    - get<T>(path): Promise<T>
    - post<T>(path, body): Promise<T>
  - Sets Authorization header if apiKey provided
  - Timeout: 30 seconds
  - Error types: NetworkError, ApiError, AuthError
  - verifyApiKey(baseUrl, apiKey): Promise<{ valid: boolean; host_id: string; host_name: string }>
    - Calls POST /api/v1/auth/verify
    - Returns parsed response or throws AuthError on 401

packages/cli/src/lib/http.test.ts
  - GET request works
  - POST request works
  - Auth header set correctly
  - 401 response throws AuthError
  - 500 response throws ApiError
  - Network error throws NetworkError
  - verifyApiKey returns host info on success
  - verifyApiKey throws on 401
```

**Verification:**
- HTTP client works
- `verifyApiKey()` validates Host API key

> **Note:** This is placed early (C1-3) so `steed init` (C2-3) can use `verifyApiKey()` without waiting for the full Reporter.

---

#### Commit C1-4: Process detection utilities

**Files:**

```
packages/cli/src/lib/process.ts
  - isProcessRunning(pattern: string): Promise<boolean>
    - Uses: pgrep -f "{pattern}"
    - Returns true if exit code 0
  - getProcessPid(pattern: string): Promise<number | null>
    - Uses: pgrep -f "{pattern}"
    - Returns first PID or null
  - killProcess(pid: number, signal?: string): Promise<boolean>
    - Uses: kill -{signal} {pid}
    - Default signal: SIGTERM

packages/cli/src/lib/process.test.ts
  - isProcessRunning returns true for current process
  - isProcessRunning returns false for non-existent pattern
  - getProcessPid returns number for running process
  - getProcessPid returns null for non-existent pattern
  - Pattern with special chars is properly escaped
```

**Verification:**
- Process detection works on macOS/Linux

---

#### Commit C1-5: PATH probe and version utilities

**Files:**

```
packages/cli/src/lib/path.ts
  - isInPath(binary: string): Promise<boolean>
    - Uses: which {binary}
    - Returns true if exit code 0
  - getBinaryPath(binary: string): Promise<string | null>
    - Uses: which {binary}
    - Returns path or null
  - expandPath(path: string): string
    - Expands ~ to home directory

packages/cli/src/lib/version.ts
  - getVersion(command: string): Promise<string | null>
    - Run command, capture stdout
    - Timeout: 5 seconds
    - Returns null on error
  - parseVersionString(output: string): string
    - Extract version from common formats:
      - "v1.2.3" → "1.2.3"
      - "version 1.2.3" → "1.2.3"  
      - "tool 1.2.3-beta" → "1.2.3-beta"
    - Returns first match or raw first line

packages/cli/src/lib/path.test.ts
  - isInPath returns true for "ls"
  - isInPath returns false for "nonexistent-binary-xyz"
  - getBinaryPath returns path for "ls"
  - expandPath expands ~ correctly

packages/cli/src/lib/version.test.ts
  - parseVersionString handles "v1.2.3"
  - parseVersionString handles "version 1.2.3"
  - parseVersionString handles "tool 1.2.3-beta"
  - parseVersionString returns first line as fallback
  - getVersion returns null on timeout
```

**Verification:**
- PATH detection works
- Version parsing handles common formats

---

#### Commit C1-6: Agent scanner

**Files:**

```
packages/cli/src/service/scanner/agent.ts
  - AgentScanner class:
    - scan(agents: RegisteredAgent[]): Promise<AgentSnapshot[]>
    - scanOne(agent: RegisteredAgent): Promise<AgentSnapshot | null>
  - Detection methods:
    - detectByProcess(pattern): running/stopped
    - detectByConfigFile(path): stopped/null
    - detectByCustom(command): running/stopped/null
  - Extract runtime_app from match_key prefix
  - Run version_command if configured

packages/cli/src/service/scanner/agent.test.ts
  - Process method: running process → status=running
  - Process method: no process → status=stopped
  - Config file method: file exists → status=stopped
  - Config file method: file not exists → returns null
  - Custom method: exit 0 → status=running
  - Custom method: exit 1 → status=stopped
  - Custom method: exit 2 → returns null
  - Version command extracts version
  - Version command failure → version=null
  - runtime_app extracted from match_key
  - Invalid match_key format handled gracefully
```

**Verification:**
- All three detection methods work correctly

---

#### Commit C1-7: Data source scanner

**Files:**

```
packages/cli/src/service/scanner/data-source.ts
  - DataSourceScanner class:
    - scan(config: DataSourceConfig): Promise<DataSourceSnapshot[]>
    - scanCli(scanner: CliScannerConfig): Promise<DataSourceSnapshot | null>
  - Auth status detection:
    - checkAuthByConfigExists(path): authenticated/unauthenticated
    - checkAuthByConfigField(path, jsonPath): authenticated/unauthenticated
    - checkAuthByCommand(command): authenticated/unauthenticated
  - PATH probe → skip if not found
  - Version collection

packages/cli/src/service/scanner/data-source.test.ts
  - Binary not in PATH → returns null
  - Binary in PATH → returns snapshot
  - Version extracted correctly
  - Auth config_exists: file exists → authenticated
  - Auth config_exists: file not exists → unauthenticated
  - Auth command: exit 0 → authenticated
  - Auth command: exit non-0 → unauthenticated
  - No auth_check → auth_status=unknown
  - Scanner failure doesn't affect other scanners
```

**Verification:**
- Data source scanning works with all auth methods

---

#### Commit C1-8: Scanner orchestrator

**Files:**

```
packages/cli/src/service/scanner/index.ts
  - Scanner class:
    - constructor(config: HostConfig)
    - scanAll(): Promise<SnapshotRequest>
    - scanAgents(): Promise<AgentSnapshot[]>
    - scanDataSources(): Promise<DataSourceSnapshot[]>
  - Handles partial failures gracefully
  - Logs individual scanner errors

packages/cli/src/service/scanner/index.test.ts
  - Empty config → empty results
  - Mixed success/failure → returns successful ones
  - Agent scanner error doesn't block data source scanner
  - Data source scanner error doesn't block agent scanner
  - Full scan returns SnapshotRequest structure
```

**Verification:**
- Orchestrator handles failures gracefully

---

#### Commit C1-9: State file manager

**Files:**

```
packages/cli/src/service/state.ts
  - StateManager class:
    - constructor(statePath?: string)
    - load(): Promise<HostState | null>
    - save(state: Partial<HostState>): Promise<void> — merge with existing
    - clear(): Promise<void>
    - updateScan(scan: SnapshotRequest): Promise<void>
    - updateReport(response: SnapshotResponse): Promise<void>
    - updateServicePid(pid: number | null): Promise<void>
    - updateError(error: { message, type }): Promise<void>
  - Atomic writes (write to temp, rename)
  - Permissions: 0600

packages/cli/src/service/state.test.ts
  - Load returns null for missing file
  - Save creates file with correct structure
  - Save merges with existing state
  - updateScan updates last_scan_at and last_scan
  - updateReport updates last_report_at and last_report_response
  - updateServicePid updates service_pid
  - updateError updates last_error with timestamp
  - clear removes file
```

**Verification:**
- State file operations are atomic and correct

---

#### Commit C1-10: Reporter with retry logic

**Files:**

```
packages/cli/src/service/reporter.ts
  - Reporter class:
    - constructor(httpClient: HttpClient, config: HostConfig)
    - report(snapshot: SnapshotRequest): Promise<SnapshotResponse>
  - Uses HttpClient from C1-3
  - POST to /api/v1/snapshot
  - Retry with exponential backoff: 1s, 2s, 4s (max 3 retries)

packages/cli/src/service/reporter.test.ts
  - Successful report returns SnapshotResponse
  - 401 response throws AuthError (no retry)
  - 500 response triggers retry
  - Max retries exceeded throws NetworkError
```

**Verification:**
- HTTP reporting works with retry logic

> **Note:** `verifyApiKey()` is in `lib/http.ts` (C1-3), not in Reporter. Reporter only handles snapshot reporting.

---

#### Commit C1-11: Scheduler

**Files:**

```
packages/cli/src/service/scheduler.ts
  - Scheduler class:
    - constructor(intervalMs: number = 600000)  // 10 minutes
    - start(callback: () => Promise<void>): void
    - stop(): void
    - runOnce(): Promise<void>
    - isRunning(): boolean
  - Uses setInterval for periodic execution
  - Prevents overlapping runs
  - Logs next scheduled time

packages/cli/src/service/scheduler.test.ts
  - start() begins interval
  - stop() clears interval
  - runOnce() executes immediately
  - Overlapping runs prevented
  - isRunning() returns correct state
```

**Verification:**
- Scheduler timing works correctly

---

#### Commit C1-12: Host Service entry point

**Files:**

```
packages/cli/src/service/index.ts
  - HostService class:
    - constructor(configPath?: string)
    - start(): Promise<void>
      - Load config
      - Write PID to state
      - Start scheduler
      - Run first heartbeat immediately
    - stop(): Promise<void>
      - Stop scheduler
      - Clear PID from state
    - runHeartbeat(): Promise<void>
      - Scan → Report → Update state
  - Signal handling: SIGTERM, SIGINT → graceful stop
  - Logs all operations

packages/cli/src/service/index.test.ts
  - start() loads config and begins scheduler
  - stop() clears PID and stops scheduler
  - Heartbeat cycle: scan → report → state update
  - Config error prevents start
  - Network error logged but doesn't crash
  - SIGTERM triggers graceful stop
```

**Verification:**
- Full service lifecycle works

---

## Recommended Implementation Order

Phase C1 commits should be implemented in order (1 → 12) as each depends on previous:

```
C1-1: Config schema
  ↓
C1-2: Config manager + permissions
  ↓
C1-3: HTTP client + auth verify ←── enables C2-3 (steed init)
  ↓
C1-4: Process detection ─────────────┐
  ↓                                  │
C1-5: PATH probe + version ──────────┤
  ↓                                  │
C1-6: Agent scanner ←────────────────┤
  ↓                                  │
C1-7: Data source scanner ←──────────┘
  ↓
C1-8: Scanner orchestrator ←── enables C2-4 (steed scan)
  ↓
C1-9: State file manager
  ↓
C1-10: Reporter + retry ←── enables C2-5 (steed report)
  ↓
C1-11: Scheduler
  ↓
C1-12: Host Service entry ←── enables C2-11 (steed service start)
```

**Milestone checkpoints:**

| After Commit | Capability |
|--------------|------------|
| C1-2 | Config files can be read/written securely |
| C1-3 | `verifyApiKey()` validates Host API key (enables `steed init`) |
| C1-8 | `Scanner.scanAll()` produces valid `SnapshotRequest` |
| C1-10 | Can report snapshot to Worker |
| C1-12 | Full Host Service runs with 10-min heartbeat |

---

## Progress

| Commit | Description | Status |
|--------|-------------|--------|
| C1-1 | Config schema | ✅ Done |
| C1-2 | Config manager + permissions | ✅ Done |
| C1-3 | HTTP client + auth verify | ✅ Done |
| C1-4 | Process detection | ✅ Done |
| C1-5 | PATH probe + version | ✅ Done |
| C1-6 | Agent scanner | ✅ Done |
| C1-7 | Data source scanner | ✅ Done |
| C1-8 | Scanner orchestrator | ✅ Done |
| C1-9 | State file manager | ✅ Done |
| C1-10 | Reporter + retry | ✅ Done |
| C1-11 | Scheduler | ✅ Done |
| C1-12 | Host Service entry | ✅ Done |
