# Phase B2: Data Source Management

> Data Source CRUD endpoints for dashboard management.

## Overview

Phase B1 delivered Agent CRUD. Phase B2 completes the Data Source management loop:

1. **GET /data-sources** — List all Data Sources with filtering (dashboard role)
2. **GET /data-sources/:id** — Get single Data Source details (dashboard role)
3. **PATCH /data-sources/:id** — Update Data Source metadata (dashboard role)
4. **PUT /data-sources/:id/lanes** — Set Data Source Lane assignments (dashboard role)

## API Design

### GET /api/v1/data-sources

List Data Sources with filtering. Dashboard role only.

**Query parameters:**

| Param | Description | Example |
|-------|-------------|---------|
| `host_id` | Filter by host | `?host_id=host_xxxxx` |
| `lane_id` | Filter by lane | `?lane_id=lane_work` |
| `status` | Filter by status | `?status=active` |
| `limit` | Page size (default 50, max 200) | `?limit=20` |
| `cursor` | Pagination cursor | `?cursor=xxxxx` |

**Response 200:**

```json
{
  "data": [
    {
      "id": "ds_xxxxx",
      "host_id": "host_xxxxx",
      "type": "personal_cli",
      "name": "nmem",
      "version": "1.2.0",
      "auth_status": "authenticated",
      "status": "active",
      "created_at": "2026-04-15T12:00:00Z",
      "last_seen_at": "2026-04-15T14:30:00Z"
    }
  ],
  "next_cursor": "xxxxx"
}
```

Note: `metadata` is omitted from list view. Use GET /data-sources/:id for full details.

---

### GET /api/v1/data-sources/:id

Get single Data Source details. Dashboard role only.

**Response 200:**

Full DataSource object including `metadata` JSON field.

```json
{
  "id": "ds_xxxxx",
  "host_id": "host_xxxxx",
  "type": "personal_cli",
  "name": "nmem",
  "version": "1.2.0",
  "auth_status": "authenticated",
  "status": "active",
  "metadata": {
    "notes": "Primary memory system",
    "tags": ["core", "memory"]
  },
  "lane_ids": ["lane_work", "lane_learning"],
  "created_at": "2026-04-15T12:00:00Z",
  "last_seen_at": "2026-04-15T14:30:00Z"
}
```

**Error cases:**
- 401: Unauthenticated
- 404: Data Source not found

---

### PATCH /api/v1/data-sources/:id

Update Data Source human-managed metadata. Dashboard role only.

**Request (partial update):**

```json
{
  "metadata": {
    "notes": "Updated notes",
    "tags": ["core", "updated"]
  }
}
```

**Field semantics:**
- `metadata`: Shallow merge with existing JSON (must be plain object, not null/array)

**Response 200:** Full updated DataSource object.

**Error cases:**
- 400: Invalid `metadata` type (not an object)
- 401: Unauthenticated
- 404: Data Source not found

---

### PUT /api/v1/data-sources/:id/lanes

Set Data Source Lane assignments. Full replacement. Dashboard role only.

Data Sources can belong to multiple Lanes (unlike Agents which have a single lane_id).

**Request:**

```json
{
  "lane_ids": ["lane_work", "lane_learning"]
}
```

**Validation:**
- All `lane_ids` must exist in the lanes table
- Empty array is valid (removes all lane assignments)

**Response 200:**

```json
{
  "data_source_id": "ds_xxxxx",
  "lane_ids": ["lane_work", "lane_learning"]
}
```

**Error cases:**
- 400: `lane_ids` not an array
- 400: Invalid lane_id in array (non-existent lane)
- 401: Unauthenticated
- 404: Data Source not found

---

## Implementation

### Commit Plan

#### Commit B2-1: Data Source types and route scaffold

```
packages/shared/src/types/data-source.ts
  - Add DataSourceListItem type (omits metadata)
  - Add UpdateDataSourceRequest type
  - Add SetLanesRequest type
  - Add SetLanesResponse type
  - Add ListDataSourcesQuery type
  - Add ListDataSourcesResponse type

packages/worker/src/routes/data-sources.ts
  - Create route scaffold with all 4 endpoints (stub 501)
  - Wire up to main app

packages/worker/src/index.ts
  - Mount /api/v1/data-sources routes
```

**Tests:** Route mounting and 501 stubs work

---

#### Commit B2-2: GET /data-sources list implementation

```
packages/worker/src/routes/data-sources.ts
  - Implement GET / handler
  - Build query with optional filters (host_id, lane_id, status)
  - For lane_id filter: JOIN with data_source_lanes
  - Implement cursor pagination
  - Return ListDataSourcesResponse (omit metadata)

packages/worker/src/routes/data-sources.test.ts
  - Test empty list
  - Test list with data sources
  - Test host_id filter
  - Test lane_id filter (requires JOIN)
  - Test status filter
  - Test pagination (limit, cursor)
  - Test auth rejection
```

**Tests:** 7+ test cases

---

#### Commit B2-3: GET /data-sources/:id implementation

```
packages/worker/src/routes/data-sources.ts
  - Implement GET /:id handler
  - Parse metadata JSON field
  - Fetch lane_ids from data_source_lanes
  - Return full DataSource with lane_ids

packages/worker/src/routes/data-sources.test.ts
  - Test get existing data source
  - Test non-existent data source → 404
  - Test metadata JSON parsing
  - Test lane_ids included
```

**Tests:** 4+ test cases

---

#### Commit B2-4: PATCH /data-sources/:id implementation

```
packages/worker/src/routes/data-sources.ts
  - Implement PATCH /:id handler
  - Validate metadata is plain object (not null/array)
  - Handle metadata shallow merge
  - Return updated DataSource

packages/worker/src/routes/data-sources.test.ts
  - Test metadata update
  - Test metadata shallow merge
  - Test invalid metadata type → 400
  - Test non-existent data source → 404
```

**Tests:** 4+ test cases

---

#### Commit B2-5: PUT /data-sources/:id/lanes implementation

```
packages/worker/src/routes/data-sources.ts
  - Implement PUT /:id/lanes handler
  - Validate lane_ids is array
  - Validate all lane_ids exist
  - DELETE existing + INSERT new (full replacement)
  - Return SetLanesResponse

packages/worker/src/routes/data-sources.test.ts
  - Test set new lanes
  - Test replace existing lanes
  - Test clear all lanes (empty array)
  - Test invalid lane_id → 400
  - Test non-existent data source → 404
  - Test lane_ids not array → 400
```

**Tests:** 6+ test cases

---

#### Commit B2-6: E2E tests for Data Source endpoints

```
scripts/run-e2e.ts
  - Add E2E tests for all 4 Data Source endpoints
  - Test full lifecycle: list → get → update metadata → set lanes → verify
```

**Tests:** Full Data Source lifecycle E2E

---

## Progress

| Commit | Status |
|--------|--------|
| B2-1: Types and scaffold | ✅ Done |
| B2-2: GET /data-sources | ✅ Done |
| B2-3: GET /data-sources/:id | ✅ Done |
| B2-4: PATCH /data-sources/:id | ✅ Done |
| B2-5: PUT /data-sources/:id/lanes | ✅ Done |
| B2-6: E2E tests (data sources) | ✅ Done |
| B2-7: Bindings CRUD | ⏳ Pending |
| B2-8: GET /lanes | ⏳ Pending |
| B2-9: L2 E2E extension | ⏳ Pending |
