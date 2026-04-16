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

### Module Structure

```
packages/cli/src/
├── index.ts              # CLI entry point
├── commands/
│   ├── init.ts           # steed init
│   ├── scan.ts           # steed scan
│   ├── report.ts         # steed report
│   ├── register.ts       # steed register
│   ├── status.ts         # steed status
│   ├── config.ts         # steed config *
│   └── service.ts        # steed service *
├── service/              # (from Phase C1)
├── config/               # (from Phase C1)
├── lib/
│   ├── output.ts         # Table/JSON formatting
│   ├── prompts.ts        # Interactive prompts
│   └── platform.ts       # Platform detection (systemd/launchd)
└── bin/
    └── steed.ts          # Executable entry
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

#### Commit C2-1: CLI scaffold and init command

```
packages/cli/package.json
  - Add dependencies: commander, chalk, ora

packages/cli/src/bin/steed.ts
  - Shebang entry point
  - Import and run main program

packages/cli/src/index.ts
  - Commander program setup
  - Wire up commands

packages/cli/src/commands/init.ts
  - Parse --url and --key
  - Validate inputs
  - Test Worker connection
  - Create config file

packages/cli/src/commands/init.test.ts
  - Test validation
  - Test config creation
```

**Tests:** Init command validation and config creation

---

#### Commit C2-2: Output utilities

```
packages/cli/src/lib/output.ts
  - table(headers, rows): Print ASCII table
  - json(data): Print formatted JSON
  - success(message): Green checkmark
  - error(message): Red X
  - spinner(message): Loading spinner (ora)

packages/cli/src/lib/output.test.ts
```

**Tests:** Output formatting

---

#### Commit C2-3: Scan command

```
packages/cli/src/commands/scan.ts
  - Load config
  - Run Scanner (from C1)
  - Format and display results
  - Support --agents, --data-sources, --json flags

packages/cli/src/commands/scan.test.ts
  - Test output formatting
  - Test filtering flags
```

**Tests:** Scan command with filters

---

#### Commit C2-4: Report command

```
packages/cli/src/commands/report.ts
  - Run scan
  - Build snapshot
  - Call Reporter (from C1)
  - Display results
  - Support --dry-run flag

packages/cli/src/commands/report.test.ts
  - Test dry-run
  - Test error handling
```

**Tests:** Report command

---

#### Commit C2-5: Register command

```
packages/cli/src/commands/register.ts
  - Parse --match-key and options
  - Infer detection settings
  - Update local config
  - POST to Worker /api/v1/agents
  - Display confirmation

packages/cli/src/lib/match-key.ts
  - parseMatchKey(key): Extract runtime_app and identifier
  - inferDetection(matchKey): Auto-generate detection config

packages/cli/src/commands/register.test.ts
  - Test match-key parsing
  - Test detection inference
  - Test Worker registration
```

**Tests:** Register with inference

---

#### Commit C2-6: Status command

```
packages/cli/src/commands/status.ts
  - Check service PID
  - Load last scan cache
  - Display summary

packages/cli/src/commands/status.test.ts
```

**Tests:** Status display

---

#### Commit C2-7: Config command

```
packages/cli/src/commands/config.ts
  - Subcommands: show, edit, path, add-scanner, remove-scanner
  - Config manipulation

packages/cli/src/commands/config.test.ts
```

**Tests:** Config management

---

#### Commit C2-8: Service command

```
packages/cli/src/commands/service.ts
  - Subcommands: start, status, stop, install, uninstall, logs
  - Platform detection (systemd vs launchd)
  - Service file generation

packages/cli/src/lib/platform.ts
  - detectPlatform(): "systemd" | "launchd" | "unknown"
  - generateServiceFile(platform): string
  - installService(platform): void
  - uninstallService(platform): void

packages/cli/src/commands/service.test.ts
```

**Tests:** Service management

---

#### Commit C2-9: E2E tests for CLI

```
packages/cli/test/e2e/
  - Test full workflow: init → register → scan → report
  - Test against real Worker (test environment)
```

**Tests:** CLI E2E

---

## Dependencies on Phase C1

CLI commands depend on Host Service modules:

| CLI Command | C1 Dependency |
|-------------|---------------|
| `steed scan` | Scanner (C1-4, C1-5, C1-6) |
| `steed report` | Scanner + Reporter (C1-7) |
| `steed register` | ConfigManager (C1-1) |
| `steed service start` | HostService (C1-8) |
| `steed status` | HostService status |

**Recommended implementation order:**

1. Phase C1 commits 1-3 (config, utilities)
2. Phase C2 commit 1-2 (CLI scaffold, output)
3. Phase C1 commits 4-6 (scanners)
4. Phase C2 commits 3-5 (scan, report, register)
5. Phase C1 commits 7-8 (reporter, service)
6. Phase C2 commits 6-8 (status, config, service commands)
7. Phase C2 commit 9 (E2E)

---

## Progress

| Commit | Status |
|--------|--------|
| C2-1: CLI scaffold and init | Pending |
| C2-2: Output utilities | Pending |
| C2-3: Scan command | Pending |
| C2-4: Report command | Pending |
| C2-5: Register command | Pending |
| C2-6: Status command | Pending |
| C2-7: Config command | Pending |
| C2-8: Service command | Pending |
| C2-9: E2E tests | Pending |
