# Pilot Validation Checklist

> Real environment validation for Steed v1

## Environment

| Item | Value |
|------|-------|
| Host | nocoo-macbook (本机) |
| Worker | https://steed.nocoo.workers.dev |
| Dashboard | https://steed.hexly.ai |
| Start Time | 2026-04-18 15:30 |

## Validation Items

### 1. Manual Command Verification

| Command | Expected | Result | Timestamp |
|---------|----------|--------|-----------|
| `steed status` | Shows config, last report time | ✅ Pass | 2026-04-18 15:19 |
| `steed scan` | Detects agents + data sources | ✅ Pass (1 agent, 5 DS) | 2026-04-18 15:19 |
| `steed report` | Successfully reports to Worker | ✅ Pass | 2026-04-18 15:19 |
| `steed login` | OAuth flow completes, config updated | ⏳ Pending (Dashboard deploy) | |
| `steed register` | Adds agent to config | ✅ Pass (test:pilot-validation) | 2026-04-18 15:25 |

### 2. Host Service Continuous Run

| Item | Target | Actual | Status |
|------|--------|--------|--------|
| Continuous runtime | 24 hours | Started 2026-04-18 15:28 | 🔄 Running |
| Auto heartbeat count | ≥3 (every 10min = 144/day) | 1 (initial) | 🔄 Counting |
| No crash/restart | 0 unexpected stops | 0 | 🔄 Monitoring |

**Service PID:** 9994
**Log file:** /tmp/steed-service.log

### 3. Data Consistency

| Check | Method | Result |
|-------|--------|--------|
| Host appears in Dashboard | GET /hosts | ✅ host_1a58202b1d4b (MBP16M426LZ) |
| Agent count matches | Compare local scan vs Dashboard | ✅ 2 agents (hermes:main + test:pilot-validation) |
| Data source count matches | Compare local scan vs Dashboard | ✅ 5 data sources, all active |
| Overview aggregates correct | Check /overview endpoint | ⏳ Pending (needs Dashboard token) |

### 4. Missing Semantic Verification

| Test | Action | Expected | Actual |
|------|--------|----------|--------|
| Stop agent process | Kill hermes process | status → stopped | ⏳ Pending |
| Next heartbeat | Wait 10 min | Worker shows stopped | ⏳ Pending |
| Remove data source | Uninstall a CLI | status → missing | ⏳ Pending |
| Remove agent from config | Remove test:pilot-validation | status → missing | ✅ Pass |
| Restart agent | Start hermes | status → running | ⏳ Pending |

## Execution Log

### 2026-04-18 15:19 - Initial State Check

```
$ steed status
ℹ Host Service: not running
ℹ Last report: 1 day ago
Agents: 1 registered, 1 running, 0 stopped
Data Sources: 5 detected, 1 authenticated
Config: /Users/nocoo/.steed/config.json
Worker: https://steed.nocoo.workers.dev
```

### 2026-04-18 15:19 - Scan + Report Test

```
$ steed scan
Agents: hermes:main (✓ running)
Data Sources: claude (2.1.114), codex (0.121.0), gh (2.89.0, ✓ auth), wrangler (4.59.2), bun (1.3.11)

$ steed report
✓ Report sent successfully
  - Agents updated: 1
  - Data sources updated: 5
```

### 2026-04-18 15:20 - Remote D1 Verification

```sql
-- Hosts
SELECT id, name, last_seen_at FROM hosts;
host_1a58202b1d4b | MBP16M426LZ | 2026-04-18T07:19:58.998Z

-- Agents
SELECT match_key, status FROM agents;
hermes:main | running

-- Data Sources
SELECT name, status, version FROM data_sources;
claude | active | 2.1.114
codex | active | 0.121.0
gh | active | 2.89.0
wrangler | active | 4.59.2
bun | active | 1.3.11
```

### 2026-04-18 15:25 - Register Test

```
$ steed register --match-key "test:pilot-validation" --method process --pattern "nonexistent-test-process"
✓ Agent registered with Worker (id: agent_ad67ef3ca2b0)

-- Verified in D1: status = stopped (process not found)
```

### 2026-04-18 15:26 - Login Test

⏳ Waiting for Dashboard deployment (hostname fix not yet deployed)

### 2026-04-18 15:27 - Missing Semantic Test

```
# Removed test:pilot-validation from config
$ steed report
✓ Report sent successfully
  - Agents updated: 1
  - Agents missing: 1  ← Correctly detected!

# Verified in D1:
test:pilot-validation | missing  ← Status changed from stopped to missing
hermes:main | running
```

### 2026-04-18 15:28 - Host Service Started

```
$ nohup bun run src/bin/steed.ts service start > /tmp/steed-service.log 2>&1 &
$ steed status
✓ Host Service: running (PID 9994)
Last report: 7 seconds ago

Service will run for 24 hours to verify:
- Automatic heartbeat every 10 minutes
- No crashes or memory leaks
- Consistent data sync with Worker
```

## Conclusion

| Criterion | Pass/Fail |
|-----------|-----------|
| All manual commands work | |
| Service runs 24h without crash | |
| Data consistency maintained | |
| Missing semantic correct | |

**Overall Status:** [ ] Ready for production
