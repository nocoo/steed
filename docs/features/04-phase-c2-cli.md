# Phase C2: CLI

> CLI — command-line interface for manual operations and Host Service management.

## Overview

The CLI provides manual control over Host Service operations and agent registration. It complements the automated heartbeat cycle with on-demand commands for debugging, registration, and service management.

## Platform Support

**Supported platforms:** macOS, Linux only.

CLI relies on Unix-specific tools and conventions:
- Process detection: `pgrep -f`
- PATH probe: `which`
- Service management: systemd (Linux), launchd (macOS)
- File permissions: POSIX chmod

Windows is not supported in v1.

## Commands

### Command Structure

```
steed <command> [subcommand] [options]
```

### Command Overview

| Command | Description |
|---------|-------------|
| `steed init` | Initialize host configuration |
| `steed scan` | Manually trigger resource scan |
| `steed report` | Manually trigger snapshot report |
| `steed register` | Register a new agent |
| `steed status` | Show current scan status |
| `steed config` | Manage configuration |
| `steed service` | Manage Host Service daemon |

---

## Command Details

### steed init

Initialize host configuration with Worker URL and API key.

```bash
steed init --url <worker-url> --key <api-key>
```

**Options:**

| Option | Required | Description |
|--------|----------|-------------|
| `--url` | Yes | Worker API endpoint URL |
| `--key` | Yes | Host API key from Dashboard registration |

**Behavior:**

1. Validate URL format and API key format (`sk_host_*`)
2. Test Worker connectivity (GET `/api/v1/health`)
3. **Validate API key** by calling POST `/api/v1/auth/verify`
   - Worker returns 200 with `{ "valid": true, "host_id": "host_xxx" }` → key is valid
   - Worker returns 401 → key is invalid, abort with error
4. Create `~/.steed/` directory with `0700` permissions
5. Create `~/.steed/config.json` with `0600` permissions
6. Add default CLI scanners from built-in list
7. Print success message with next steps

> **Why a dedicated endpoint?** Using POST `/snapshot` with empty payload would trigger `missing` status on all existing agents/data sources — a real side effect. The `/auth/verify` endpoint is read-only and safe for init validation.

**Example:**

```bash
$ steed init --url https://steed.example.workers.dev --key sk_host_abc123

✓ Connected to Worker
✓ Config created at ~/.steed/config.json

Next steps:
  1. Register agents:     steed register --match-key "openclaw:/path"
  2. Test scan:           steed scan
  3. Start service:       steed service start
```

---

### steed scan

Manually trigger a resource scan without reporting to Worker.

```bash
steed scan [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--agents` | Scan only agents |
| `--data-sources` | Scan only data sources |
| `--json` | Output as JSON |

**Behavior:**

1. Load config from `~/.steed/config.json`
2. Run scanners (all or filtered)
3. Display results in table format (or JSON if `--json`)

**Example:**

```bash
$ steed scan

Agents:
┌─────────────────────────────────────┬─────────┬─────────┬─────────┐
│ match_key                           │ status  │ app     │ version │
├─────────────────────────────────────┼─────────┼─────────┼─────────┤
│ openclaw:/home/nocoo/agents/coder   │ running │ openclaw│ 0.3.2   │
│ hermes:/home/nocoo/agents/hermes    │ stopped │ hermes  │ 1.0.0   │
└─────────────────────────────────────┴─────────┴─────────┴─────────┘

Data Sources:
┌──────────────────┬─────────────────┬─────────┬───────────────┐
│ name             │ type            │ version │ auth_status   │
├──────────────────┼─────────────────┼─────────┼───────────────┤
│ nmem             │ personal_cli    │ 1.2.0   │ authenticated │
│ wrangler         │ third_party_cli │ 3.50.0  │ authenticated │
│ railway          │ third_party_cli │ 3.5.0   │ unauthenticated│
└──────────────────┴─────────────────┴─────────┴───────────────┘
```

---

### steed report

Manually trigger a snapshot report to Worker.

```bash
steed report [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be reported without sending |

**Behavior:**

1. Run full scan (equivalent to `steed scan`)
2. Build snapshot payload
3. POST to Worker `/api/v1/snapshot`
4. Display response summary

**Example:**

```bash
$ steed report

Scanning...
Reporting to https://steed.example.workers.dev/api/v1/snapshot...

✓ Report sent successfully
  - Agents updated: 2
  - Agents missing: 0
  - Data sources updated: 3
  - Data sources created: 1
  - Data sources missing: 0
```

---

### steed register

Register a new agent for tracking.

```bash
steed register --match-key <key> [options]
```

**Options:**

| Option | Required | Description |
|--------|----------|-------------|
| `--match-key` | Yes | Unique identifier (e.g., "openclaw:/path/to/workspace") |
| `--method` | No | Detection method: `process`, `config_file`, `custom` (default: `process`) |
| `--pattern` | No | Detection pattern (auto-inferred from match-key if not provided) |
| `--version-cmd` | No | Command to get version |
| `--nickname` | No | Display name (sent to Worker) |
| `--role` | No | Role description (sent to Worker) |
| `--local-only` | No | Only add to local config, don't register with Worker |

**Behavior:**

1. Validate match-key format
2. Infer detection settings from match-key if not provided:
   - Extract runtime_app from prefix (e.g., "openclaw" from "openclaw:/path")
   - Set default pattern based on runtime_app
3. Add to local config `~/.steed/config.json`
4. Unless `--local-only`, POST to Worker `/api/v1/agents`
5. Display confirmation

**Match Key Format:**

```
{runtime_app}:{identifier}
```

Examples:
- `openclaw:/home/nocoo/agents/coder` — OpenClaw agent in specific directory
- `hermes:main` — Hermes agent named "main"
- `custom:my-agent` — Custom agent with manual detection

**Example:**

```bash
$ steed register \
    --match-key "openclaw:/home/nocoo/agents/coder" \
    --nickname "Coder Bot" \
    --role "Code review and fixes"

✓ Agent registered locally
✓ Agent registered with Worker (id: agent_abc123)

Detection configured:
  Method: process
  Pattern: openclaw.*/home/nocoo/agents/coder
  Version: openclaw --version

Test with: steed scan --agents
```

---

### steed status

Show current status of scanned resources and service health.

```bash
steed status [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

**Behavior:**

1. Read state file `~/.steed/state.json` (see Phase C1 State File spec)
2. Check `service_pid` — if set, verify process is running
3. Display summary from `last_scan` and `last_report_response`

**Fallback when no state file:**
- Show "No state file found. Run `steed scan` or start the service."
- Exit code 0 (not an error condition)

**Example:**

```bash
$ steed status

Host Service: running (PID 12345)
Last heartbeat: 3 minutes ago

Agents: 2 registered, 1 running, 1 stopped
Data Sources: 5 detected, 4 authenticated

Config: ~/.steed/config.json
Worker: https://steed.example.workers.dev
```

---

### steed config

Manage configuration.

```bash
steed config <subcommand> [options]
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `show` | Display current configuration |
| `edit` | Open config in $EDITOR |
| `path` | Print config file path |
| `add-scanner` | Add a CLI scanner |
| `remove-scanner` | Remove a CLI scanner |

**Examples:**

```bash
# Show config
$ steed config show

# Add a custom CLI scanner
$ steed config add-scanner \
    --name "zhe" \
    --type personal_cli \
    --binary "zhe" \
    --auth-check "command:zhe auth status"

# Remove a scanner
$ steed config remove-scanner --name "zhe"
```

---

### steed service

Manage the Host Service daemon.

```bash
steed service <subcommand>
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `start` | Start Host Service in foreground |
| `status` | Check if service is running |
| `stop` | Stop running service (sends SIGTERM) |
| `install` | Install as system service (systemd/launchd) |
| `uninstall` | Remove system service |
| `logs` | Show service logs |

**Examples:**

```bash
# Start in foreground (for testing)
$ steed service start
[2026-04-16 10:00:00] Host Service started
[2026-04-16 10:00:00] First heartbeat in 10 minutes...

# Install as system service
$ steed service install
✓ Created /etc/systemd/system/steed.service
✓ Enabled steed.service
✓ Started steed.service

Run "steed service status" to check status.

# Check status
$ steed service status
● steed.service - Steed Host Service
   Active: active (running) since Wed 2026-04-16 10:00:00 UTC
   Main PID: 12345 (steed)
```

---

## Implementation

### Dependencies

CLI commands depend on Host Service modules from Phase C1:

| CLI Command | Required C1 Modules |
|-------------|---------------------|
| `steed init` | ConfigManager (C1-2), verifyApiKey (C1-3) |
| `steed scan` | ConfigManager, Scanner (C1-6, C1-7, C1-8) |
| `steed report` | ConfigManager, Scanner, Reporter (C1-10), StateManager (C1-9) |
| `steed register` | ConfigManager, HttpClient (C1-3) |
| `steed status` | StateManager (C1-9), process utils (C1-4) |
| `steed config` | ConfigManager |
| `steed service` | HostService (C1-12), platform utils |

> **Note:** CLI package scaffold (package.json, tsconfig, bin/, vitest.config) is created in C2-1. C1 commits only add modules under `src/config/`, `src/lib/`, and `src/service/`.

### Module Structure

```
packages/cli/src/
├── index.ts              # CLI entry point (Commander setup)
├── bin/
│   └── steed.ts          # Executable entry (shebang)
├── commands/
│   ├── init.ts           # steed init
│   ├── scan.ts           # steed scan
│   ├── report.ts         # steed report
│   ├── register.ts       # steed register
│   ├── status.ts         # steed status
│   ├── config.ts         # steed config *
│   └── service.ts        # steed service *
├── lib/
│   ├── output.ts         # Table/JSON formatting, spinners
│   ├── match-key.ts      # Match key parsing and inference
│   ├── platform.ts       # Platform detection (systemd/launchd)
│   ├── http.ts           # HTTP client + auth verify (from C1-3)
│   ├── process.ts        # Process detection (from C1-4)
│   ├── path.ts           # PATH probe (from C1-5)
│   └── version.ts        # Version parsing (from C1-5)
├── config/               # (from C1-1, C1-2)
│   ├── schema.ts
│   ├── index.ts
│   ├── permissions.ts
│   └── defaults.ts
└── service/              # (from C1-6 to C1-12)
    ├── scanner/
    ├── state.ts
    ├── reporter.ts
    ├── scheduler.ts
    └── index.ts
```

### CLI Framework

Use **Commander.js** for command parsing:

```typescript
import { Command } from "commander";

const program = new Command();

program
  .name("steed")
  .description("Steed CLI — Agent asset visibility")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize host configuration")
  .requiredOption("--url <url>", "Worker API URL")
  .requiredOption("--key <key>", "Host API key")
  .action(initCommand);

// ... more commands

program.parse();
```

### Commit Plan

#### Commit C2-1: CLI package scaffold

**Files:**

```
packages/cli/package.json
  - Add dependencies: commander, chalk, ora, cli-table3, zod, undici
  - Add devDependencies: vitest, @types/node
  - Add bin field: { "steed": "./dist/bin/steed.js" }
  - Scripts: build, dev, test

packages/cli/tsconfig.json
  - Extend shared tsconfig
  - Target: ESNext, module: ESNext

packages/cli/vitest.config.ts
  - Setup vitest for CLI package

packages/cli/src/bin/steed.ts
  - #!/usr/bin/env node
  - Import and run main CLI

packages/cli/src/index.ts
  - Commander program setup
  - Version from package.json
  - Help text customization
  - Stub commands (all throw "not implemented")

packages/cli/src/index.test.ts
  - CLI --version works
  - CLI --help works
  - Unknown command shows error
```

**Verification:**
- `bun run build` produces executable
- `./dist/bin/steed.js --version` works

> **Note:** This commit creates the full CLI package infrastructure. C1 commits (C1-1 onwards) add modules into this structure.

---

#### Commit C2-2: Output utilities

**Files:**

```
packages/cli/src/lib/output.ts
  - success(message): Print green ✓ + message
  - error(message): Print red ✗ + message
  - warn(message): Print yellow ⚠ + message
  - info(message): Print blue ℹ + message
  - table(headers, rows, options?): Print ASCII table
  - json(data): Print formatted JSON
  - spinner(message): Return ora spinner instance
  - formatDuration(ms): "3 minutes ago", "just now"

packages/cli/src/lib/output.test.ts
  - Each output function produces expected format
  - Table handles empty rows
  - Table handles long content (truncation)
  - formatDuration handles various ranges
```

**Verification:**
- Output formatting works correctly

---

#### Commit C2-3: Init command

**Files:**

```
packages/cli/src/commands/init.ts
  - Parse --url and --key options
  - Validate URL format (https required)
  - Validate key format (sk_host_*)
  - Test connectivity: GET /health (via HttpClient from C1-3)
  - Validate key: verifyApiKey() (from C1-3)
  - Create config with ConfigManager (from C1-2)
  - Add default scanners
  - Print success with next steps

packages/cli/src/commands/init.test.ts
  - Invalid URL format rejected
  - Invalid key format rejected
  - Network error handled gracefully
  - 401 from /auth/verify shows clear error
  - Success creates config file
  - Default scanners added to config
```

**Verification:**
- `steed init` works end-to-end

> **Requires:** C1-2 (ConfigManager), C1-3 (HttpClient, verifyApiKey)

---

#### Commit C2-4: Scan command

**Files:**

```
packages/cli/src/commands/scan.ts
  - Load config (error if not exists)
  - Create Scanner, run scanAll() (from C1-8)
  - Format output:
    - Default: ASCII tables for agents and data sources
    - --json: JSON output
    - --agents: Only agents table
    - --data-sources: Only data sources table
  - Update state file with scan results (from C1-9)

packages/cli/src/commands/scan.test.ts
  - No config file → error message
  - Empty scan results → "No agents/data sources found"
  - Agents displayed in table
  - Data sources displayed in table
  - --json outputs valid JSON
  - --agents filters to agents only
  - --data-sources filters to data sources only
  - State file updated after scan
```

**Verification:**
- `steed scan` displays results correctly

> **Requires:** C1-2 (ConfigManager), C1-8 (Scanner), C1-9 (StateManager)

---

#### Commit C2-5: Report command

**Files:**

```
packages/cli/src/commands/report.ts
  - Load config
  - Run scan (via Scanner from C1-8)
  - --dry-run: Display payload, don't send
  - Normal: POST to Worker via Reporter (from C1-10)
  - Display response summary
  - Update state file (from C1-9)

packages/cli/src/commands/report.test.ts
  - No config file → error message
  - --dry-run shows payload without sending
  - Successful report shows summary
  - Network error shows retry info
  - Auth error shows clear message
  - State file updated after report
```

**Verification:**
- `steed report` sends snapshot to Worker

> **Requires:** C1-8 (Scanner), C1-9 (StateManager), C1-10 (Reporter)

---

#### Commit C2-6: Match key utilities

**Files:**

```
packages/cli/src/lib/match-key.ts
  - parseMatchKey(key): { runtime_app, identifier }
    - Format: "{runtime_app}:{identifier}"
    - Throws on invalid format
  - inferDetection(matchKey): AgentDetection
    - Default method: "process"
    - Default pattern: "{runtime_app}.*{identifier}"
    - Default version_command: "{runtime_app} --version"
  - validateMatchKey(key): boolean

packages/cli/src/lib/match-key.test.ts
  - parseMatchKey valid format
  - parseMatchKey invalid format throws
  - inferDetection produces expected defaults
  - validateMatchKey returns correct boolean
```

**Verification:**
- Match key parsing and inference work

---

#### Commit C2-7: Register command

**Files:**

```
packages/cli/src/commands/register.ts
  - Parse --match-key (required)
  - Optional: --method, --pattern, --version-cmd
  - Optional: --nickname, --role
  - Optional: --local-only
  - Infer detection if not provided (using match-key utils from C2-6)
  - Add to local config (via ConfigManager from C1-2)
  - Unless --local-only: POST to Worker /api/v1/agents (via HttpClient from C1-3)
  - Display confirmation with detection details

packages/cli/src/commands/register.test.ts
  - Missing --match-key → error
  - Invalid match-key format → error
  - Local config updated
  - Worker registration called (unless --local-only)
  - --local-only skips Worker registration
  - Detection inference works
  - Explicit --method overrides inference
```

**Verification:**
- `steed register` adds agent locally and remotely

> **Requires:** C1-2 (ConfigManager), C1-3 (HttpClient), C2-6 (match-key utils)

---

#### Commit C2-8: Status command

**Files:**

```
packages/cli/src/commands/status.ts
  - Load state file (via StateManager from C1-9, handle missing)
  - Check service_pid: is process running? (via process utils from C1-4)
  - Format output:
    - Service status (running/stopped)
    - Last heartbeat time (relative)
    - Agent summary (count by status)
    - Data source summary (count by auth)
    - Config/Worker info
  - --json: JSON output

packages/cli/src/commands/status.test.ts
  - No state file → "No state file found" message
  - Service running shows PID
  - Service stopped (stale PID) shows stopped
  - Last heartbeat shows relative time
  - Agent/data source counts correct
  - --json outputs valid JSON
```

**Verification:**
- `steed status` shows correct information

> **Requires:** C1-4 (process utils), C1-9 (StateManager)

---

#### Commit C2-9: Config command

**Files:**

```
packages/cli/src/commands/config.ts
  - Subcommand: show
    - Display config (mask api_key)
  - Subcommand: edit
    - Open $EDITOR with config path
  - Subcommand: path
    - Print config file path
  - Subcommand: add-scanner
    - --name, --type, --binary required
    - --auth-check optional (format: "method:pattern")
    - Add to config, save
  - Subcommand: remove-scanner
    - --name required
    - Remove from config, save

packages/cli/src/commands/config.test.ts
  - show displays config with masked key
  - path prints correct path
  - add-scanner adds to config
  - add-scanner validates required fields
  - remove-scanner removes from config
  - remove-scanner handles non-existent scanner
```

**Verification:**
- `steed config` subcommands work

> **Requires:** C1-2 (ConfigManager)

---

#### Commit C2-10: Platform utilities

**Files:**

```
packages/cli/src/lib/platform.ts
  - detectPlatform(): "systemd" | "launchd" | "unknown"
    - Check for systemctl (Linux)
    - Check for launchctl (macOS)
  - generateSystemdUnit(): string
    - [Unit], [Service], [Install] sections
    - ExecStart points to steed binary
  - generateLaunchdPlist(): string
    - plist XML for com.steed.host-service
  - getServicePath(platform): string
    - systemd: /etc/systemd/system/steed.service
    - launchd: ~/Library/LaunchAgents/com.steed.host-service.plist

packages/cli/src/lib/platform.test.ts
  - detectPlatform returns valid value
  - generateSystemdUnit produces valid ini
  - generateLaunchdPlist produces valid XML
  - getServicePath returns correct paths
```

**Verification:**
- Platform detection and file generation work

---

#### Commit C2-11: Service command

**Files:**

```
packages/cli/src/commands/service.ts
  - Subcommand: start
    - Check not already running
    - Run HostService.start() in foreground (from C1-12)
  - Subcommand: status
    - Check if service is running
    - Show PID and uptime
  - Subcommand: stop
    - Find PID from state file
    - Send SIGTERM (via process utils from C1-4)
  - Subcommand: install
    - Detect platform (from C2-10)
    - Generate service file
    - Write to system path (may need sudo)
    - Enable and start service
  - Subcommand: uninstall
    - Stop service
    - Disable service
    - Remove service file
  - Subcommand: logs
    - systemd: journalctl -u steed
    - launchd: tail ~/Library/Logs/steed.log

packages/cli/src/commands/service.test.ts
  - start prevents double start
  - stop sends SIGTERM to correct PID
  - status shows running/stopped correctly
  - install generates correct file for platform
  - uninstall removes file
```

**Verification:**
- `steed service` subcommands work

> **Requires:** C1-4 (process utils), C1-12 (HostService), C2-10 (platform utils)

---

#### Commit C2-12: E2E tests

**Files:**

```
packages/cli/test/e2e/cli.test.ts
  - Full workflow test:
    1. steed init → config created
    2. steed register → agent added
    3. steed scan → shows agent
    4. steed report → reports to Worker
    5. steed status → shows status
  - Test against test Worker environment
  - Cleanup: remove test config after

packages/cli/test/e2e/setup.ts
  - Test Worker URL from env
  - Test Host API key from env
  - Temp config directory
```

**Verification:**
- Full CLI workflow works end-to-end

---

## Recommended Implementation Order (C1 + C2 Combined)

Since C2 depends on C1 modules, implement in interleaved order:

```
Phase 1: Foundation
├── C2-1: CLI package scaffold (creates packages/cli infrastructure)
├── C1-1: Config schema
├── C1-2: Config manager + permissions
└── C2-2: Output utilities

Phase 2: Core Utilities + Init
├── C1-3: HTTP client + auth verify
├── C1-4: Process detection
├── C1-5: PATH probe + version
├── C2-3: Init command
└── C2-6: Match key utilities

Phase 3: Scanning + Register
├── C1-6: Agent scanner
├── C1-7: Data source scanner
├── C1-8: Scanner orchestrator
├── C2-4: Scan command
└── C2-7: Register command

Phase 4: Reporting + Status
├── C1-9: State file manager
├── C1-10: Reporter + retry
├── C2-5: Report command
└── C2-8: Status command

Phase 5: Service Management
├── C1-11: Scheduler
├── C1-12: Host Service entry
├── C2-9: Config command
├── C2-10: Platform utilities
└── C2-11: Service command

Phase 6: Integration
└── C2-12: E2E tests
```

**Milestone checkpoints:**

| After Phase | Capability |
|-------------|------------|
| Phase 1 | `steed --help` works, config can be saved/loaded |
| Phase 2 | `steed init` works, validates API key with Worker |
| Phase 3 | `steed scan` and `steed register` work |
| Phase 4 | `steed report` and `steed status` work |
| Phase 5 | `steed service start` runs Host Service |
| Phase 6 | Full E2E validation |

---

## Progress

| Commit | Description | Status |
|--------|-------------|--------|
| C2-1 | CLI package scaffold | ✅ Done |
| C2-2 | Output utilities | ✅ Done |
| C2-3 | Init command | ✅ Done |
| C2-4 | Scan command | ✅ Done |
| C2-5 | Report command | ✅ Done |
| C2-6 | Match key utilities | ✅ Done |
| C2-7 | Register command | ✅ Done |
| C2-8 | Status command | ✅ Done |
| C2-9 | Config command | ✅ Done |
| C2-10 | Platform utilities | ✅ Done |
| C2-11 | Service command | ✅ Done |
| C2-12 | E2E tests | Pending |
