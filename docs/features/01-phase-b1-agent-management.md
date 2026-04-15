# Phase B1: Agent Management

> Agent CRUD endpoints for dashboard and host management.

## Overview

Phase A delivered the snapshot heartbeat pipeline. Phase B1 completes the Agent management loop:

1. **POST /agents** — Register a new Agent (dashboard or host role)
2. **GET /agents** — List all Agents with filtering (dashboard role)
3. **GET /agents/:id** — Get single Agent details (dashboard role)
4. **PATCH /agents/:id** — Update Agent metadata (dashboard role)

## API Design

### POST /api/v1/agents

Register a new Agent. Both `dashboard` and `host` roles allowed.

**Authorization rules:**
- `host` role: Ignores `host_id` in body, uses authenticated host's ID (prevents cross-host registration)
- `dashboard` role: Uses `host_id` from body (required)

**Request:**

```json
{
  "host_id": "host_xxxxx",
  "match_key": "openclaw:/home/agent/workspace",
  "nickname": "Coder Bot",
  "role": "Code review and auto-fix"
}
```

**Validation:**
- `host_id`: Required for dashboard role (ignored for host role)
- `match_key`: Required, non-empty string
- `nickname`: Optional string
- `role`: Optional string

**Response 201:**

```json
{
  "id": "agent_xxxxx",
  "host_id": "host_xxxxx",
  "match_key": "openclaw:/home/agent/workspace",
  "nickname": "Coder Bot",
  "role": "Code review and auto-fix",
  "lane_id": null,
  "metadata": {},
  "extra": {},
  "runtime_app": null,
  "runtime_version": null,
  "status": "stopped",
  "created_at": "2026-04-15T12:00:00Z",
  "last_seen_at": null
}
```

**Error cases:**
- 400: Missing/invalid `match_key`
- 400: Missing `host_id` (dashboard role only)
- 401: Unauthenticated
- 404: Host not found (dashboard role registering to non-existent host)
- 409: Duplicate `(host_id, match_key)`

---

### GET /api/v1/agents

List Agents with filtering. Dashboard role only.

**Query parameters:**

| Param | Description | Example |
|-------|-------------|---------|
| `host_id` | Filter by host | `?host_id=host_xxxxx` |
| `lane_id` | Filter by lane | `?lane_id=lane_work` |
| `status` | Filter by status | `?status=running` |
| `limit` | Page size (default 50, max 200) | `?limit=20` |
| `cursor` | Pagination cursor | `?cursor=xxxxx` |

**Response 200:**

```json
{
  "data": [
    {
      "id": "agent_xxxxx",
      "host_id": "host_xxxxx",
      "match_key": "openclaw:/workspace",
      "nickname": "Coder Bot",
      "role": "Code review",
      "lane_id": "lane_work",
      "status": "running",
      "runtime_app": "openclaw",
      "runtime_version": "0.3.2",
      "created_at": "2026-04-15T12:00:00Z",
      "last_seen_at": "2026-04-15T14:30:00Z"
    }
  ],
  "next_cursor": "xxxxx"
}
```

---

### GET /api/v1/agents/:id

Get single Agent details. Dashboard role only.

**Response 200:**

Full Agent object including `metadata` and `extra` JSON fields.

```json
{
  "id": "agent_xxxxx",
  "host_id": "host_xxxxx",
  "match_key": "openclaw:/workspace",
  "nickname": "Coder Bot",
  "role": "Code review and auto-fix",
  "lane_id": "lane_work",
  "metadata": {
    "notes": "Primary dev agent",
    "tags": ["dev", "primary"]
  },
  "extra": {},
  "runtime_app": "openclaw",
  "runtime_version": "0.3.2",
  "status": "running",
  "created_at": "2026-04-15T12:00:00Z",
  "last_seen_at": "2026-04-15T14:30:00Z"
}
```

**Error cases:**
- 401: Unauthenticated
- 404: Agent not found

---

### PATCH /api/v1/agents/:id

Update Agent human-managed metadata. Dashboard role only.

**Request (partial update):**

```json
{
  "nickname": "Coder Bot v2",
  "role": "Full-stack dev assistant",
  "lane_id": "lane_work",
  "metadata": {
    "notes": "Updated notes",
    "tags": ["dev", "primary"]
  }
}
```

**Field semantics:**
- `nickname`, `role`, `lane_id`: Direct field updates (null to clear)
- `metadata`: Shallow merge with existing JSON

**Response 200:** Full updated Agent object.

**Error cases:**
- 400: Invalid `lane_id` (non-existent lane)
- 401: Unauthenticated
- 404: Agent not found

---

## Implementation

### Commit Plan

#### Commit B1-1: Agent types and route scaffold

```
packages/shared/src/types/agent.ts
  - Add AgentResponse type (full agent object for responses)
  - Add CreateAgentRequest type
  - Add UpdateAgentRequest type
  - Add ListAgentsQuery type
  - Add ListAgentsResponse type (with pagination)

packages/worker/src/routes/agents.ts
  - Create route scaffold with all 4 endpoints (stub 501)
  - Wire up to main app

packages/worker/src/index.ts
  - Mount /api/v1/agents routes
```

**Tests:** Route mounting and 501 stubs work

---

#### Commit B1-2: POST /agents implementation

```
packages/worker/src/routes/agents.ts
  - Implement POST / handler
  - Host role: use auth.hostId, ignore body.host_id
  - Dashboard role: require body.host_id, verify host exists
  - Validate match_key required
  - INSERT with generateId("agent")
  - Handle unique constraint (409)

packages/worker/src/routes/agents.test.ts
  - Test host role registration (hostId from auth)
  - Test dashboard role registration (hostId from body)
  - Test missing match_key → 400
  - Test missing host_id for dashboard → 400
  - Test non-existent host_id → 404
  - Test duplicate match_key → 409
  - Test returned Agent object has correct defaults
```

**Tests:** 7+ test cases

---

#### Commit B1-3: GET /agents list implementation

```
packages/worker/src/routes/agents.ts
  - Implement GET / handler
  - Build query with optional filters (host_id, lane_id, status)
  - Implement cursor pagination
  - Return ListAgentsResponse

packages/worker/src/routes/agents.test.ts
  - Test empty list
  - Test list with agents
  - Test host_id filter
  - Test lane_id filter
  - Test status filter
  - Test combined filters
  - Test pagination (limit, cursor)
```

**Tests:** 7+ test cases

---

#### Commit B1-4: GET /agents/:id implementation

```
packages/worker/src/routes/agents.ts
  - Implement GET /:id handler
  - Parse JSON fields (metadata, extra)
  - Return full AgentResponse

packages/worker/src/routes/agents.test.ts
  - Test get existing agent
  - Test non-existent agent → 404
  - Test JSON fields parsed correctly
```

**Tests:** 3+ test cases

---

#### Commit B1-5: PATCH /agents/:id implementation

```
packages/worker/src/routes/agents.ts
  - Implement PATCH /:id handler
  - Validate lane_id if provided (must exist)
  - Handle metadata shallow merge
  - Return updated AgentResponse

packages/worker/src/routes/agents.test.ts
  - Test update nickname only
  - Test update multiple fields
  - Test clear field with null
  - Test invalid lane_id → 400
  - Test non-existent agent → 404
  - Test metadata shallow merge
```

**Tests:** 6+ test cases

---

#### Commit B1-6: E2E tests for Agent endpoints

```
scripts/run-e2e.ts
  - Add E2E tests for all 4 Agent endpoints
  - Test full lifecycle: register → list → get → update → verify
```

**Tests:** Full Agent lifecycle E2E

---

## Progress

| Commit | Status |
|--------|--------|
| B1-1: Types and scaffold | ✅ Done |
| B1-2: POST /agents | ✅ Done |
| B1-3: GET /agents | ✅ Done |
| B1-4: GET /agents/:id | ✅ Done |
| B1-5: PATCH /agents/:id | ✅ Done |
| B1-6: E2E tests | ✅ Done |
