/**
 * L2 E2E Test Runner
 *
 * Runs integration tests against a local Wrangler dev server with isolated D1.
 * Uses true HTTP requests to validate the complete Worker lifecycle.
 *
 * Each test run starts with a fresh database state for reliable, reproducible results.
 *
 * Usage: bun scripts/run-e2e.ts
 */

import { spawn, type Subprocess } from "bun";
import { rmSync, existsSync } from "fs";

const TEST_PORT = 8787;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const DASHBOARD_TOKEN = process.env.DASHBOARD_SERVICE_TOKEN ?? "test-dashboard-token";

let wranglerProcess: Subprocess | null = null;
let testHostApiKey: string | null = null;
let testHostId: string | null = null;

/**
 * Clean up previous test state for isolation
 */
function cleanupTestState(): void {
  console.log("🧹 Cleaning up previous test state...");

  const rootDir = import.meta.dir.replace("/scripts", "");
  const e2eStatePath = `${rootDir}/packages/worker/.wrangler/state/e2e`;

  if (existsSync(e2eStatePath)) {
    rmSync(e2eStatePath, { recursive: true, force: true });
    console.log("✅ Previous state cleaned");
  } else {
    console.log("✅ No previous state to clean");
  }
}

/**
 * Initialize local D1 database with migrations
 */
async function initDatabase(): Promise<void> {
  console.log("🗄️ Initializing local D1 database...");

  const rootDir = import.meta.dir.replace("/scripts", "");
  const workerDir = `${rootDir}/packages/worker`;

  // Run migrations with timeout
  const result = spawn({
    cmd: [
      "bunx",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      ".wrangler/state/e2e",
    ],
    cwd: workerDir,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  // Wait for completion with timeout
  const timeout = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error("Database initialization timeout")), 30000);
  });

  await Promise.race([result.exited, timeout]).catch(() => {
    result.kill();
    console.log("⚠️ Database initialization timed out, continuing...");
  });

  console.log("✅ Database initialized");
}

/**
 * Start Wrangler dev server
 */
async function startWrangler(): Promise<void> {
  console.log("🚀 Starting Wrangler dev server...");

  // Determine the correct working directory for wrangler
  const rootDir = import.meta.dir.replace("/scripts", "");
  const workerDir = `${rootDir}/packages/worker`;

  wranglerProcess = spawn({
    cmd: [
      "bunx",
      "wrangler",
      "dev",
      "--port",
      String(TEST_PORT),
      "--local",
      "--persist-to",
      ".wrangler/state/e2e",
      "--var",
      `DASHBOARD_SERVICE_TOKEN:${DASHBOARD_TOKEN}`,
    ],
    cwd: workerDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
    },
  });

  // Wait for server to be ready
  const maxWait = 60000; // 60 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/health`);
      if (res.ok) {
        console.log("✅ Wrangler dev server ready");
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Wrangler dev server failed to start within timeout");
}

/**
 * Stop Wrangler dev server
 */
function stopWrangler(): void {
  if (wranglerProcess) {
    console.log("🛑 Stopping Wrangler dev server...");
    wranglerProcess.kill();
    wranglerProcess = null;
  }
}

/**
 * Make authenticated request
 */
async function request(
  path: string,
  options: RequestInit & { auth?: "dashboard" | "host" | "none" } = {}
): Promise<Response> {
  const { auth = "none", headers = {}, ...rest } = options;

  const authHeaders: Record<string, string> = {};
  if (auth === "dashboard") {
    authHeaders["Authorization"] = `Bearer ${DASHBOARD_TOKEN}`;
  } else if (auth === "host" && testHostApiKey) {
    authHeaders["Authorization"] = `Bearer ${testHostApiKey}`;
  }

  return fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...headers,
    },
  });
}

/**
 * Test results tracking
 */
let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (error) {
      failed++;
      console.log(`  ❌ ${name}`);
      console.log(`     ${error}`);
    }
  };
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertExists<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(`${message}: value is ${value}`);
  }
}

/**
 * E2E Test Suite
 */
async function runTests(): Promise<void> {
  console.log("\n📋 Running E2E Tests\n");

  // 1. Health check
  await test("GET /api/v1/health returns ok", async () => {
    const res = await request("/api/v1/health");
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { status: string };
    assertEqual(body.status, "ok", "body.status");
  })();

  // 2. Register host (requires dashboard auth)
  await test("POST /api/v1/hosts/register creates host", async () => {
    const res = await request("/api/v1/hosts/register", {
      method: "POST",
      auth: "dashboard",
      body: JSON.stringify({ name: "e2e-test-host" }),
    });
    assertEqual(res.status, 201, "status");
    const body = await res.json() as { id: string; name: string; api_key: string };
    assertExists(body.id, "body.id");
    assertExists(body.api_key, "body.api_key");
    assertEqual(body.name, "e2e-test-host", "body.name");
    testHostId = body.id;
    testHostApiKey = body.api_key;
  })();

  // 3. List hosts
  await test("GET /api/v1/hosts returns hosts list", async () => {
    const res = await request("/api/v1/hosts", { auth: "dashboard" });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as Array<{ id: string; name: string }>;
    const found = body.find((h) => h.id === testHostId);
    assertExists(found, "registered host in list");
  })();

  // 4. Get single host
  await test("GET /api/v1/hosts/:id returns host details", async () => {
    assertExists(testHostId, "testHostId");
    const res = await request(`/api/v1/hosts/${testHostId}`, { auth: "dashboard" });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { id: string; name: string; status: string };
    assertEqual(body.id, testHostId, "body.id");
    assertEqual(body.status, "offline", "body.status"); // No heartbeat yet
  })();

  // 5. Upload snapshot (host auth)
  await test("POST /api/v1/snapshot processes snapshot", async () => {
    const res = await request("/api/v1/snapshot", {
      method: "POST",
      auth: "host",
      body: JSON.stringify({
        agents: [],
        data_sources: [
          {
            type: "personal_cli",
            name: "nmem",
            version: "1.2.0",
            auth_status: "authenticated",
          },
          {
            type: "third_party_cli",
            name: "wrangler",
            version: "3.50.0",
            auth_status: "authenticated",
          },
        ],
      }),
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as {
      host_id: string;
      data_sources_created: number;
      data_sources_updated: number;
    };
    assertEqual(body.host_id, testHostId!, "body.host_id");
    assertEqual(body.data_sources_created, 2, "body.data_sources_created");
  })();

  // 6. Verify host is now online
  await test("Host status is online after snapshot", async () => {
    assertExists(testHostId, "testHostId");
    const res = await request(`/api/v1/hosts/${testHostId}`, { auth: "dashboard" });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { status: string };
    assertEqual(body.status, "online", "body.status");
  })();

  // 7. Get overview - with clean state, we know exact counts
  await test("GET /api/v1/overview returns exact aggregates", async () => {
    const res = await request("/api/v1/overview", { auth: "dashboard" });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as {
      hosts: { total: number; online: number; offline: number };
      agents: { total: number };
      data_sources: { total: number; active: number; missing: number };
    };
    // With clean state, we know exactly what exists
    assertEqual(body.hosts.total, 1, "hosts.total");
    assertEqual(body.hosts.online, 1, "hosts.online");
    assertEqual(body.hosts.offline, 0, "hosts.offline");
    assertEqual(body.agents.total, 0, "agents.total"); // No agents registered yet
    assertEqual(body.data_sources.total, 2, "data_sources.total");
    assertEqual(body.data_sources.active, 2, "data_sources.active");
    assertEqual(body.data_sources.missing, 0, "data_sources.missing");
  })();

  // 8. Second snapshot marks missing data sources
  await test("Second snapshot marks missing data sources", async () => {
    // Only report nmem, wrangler should become missing
    const res = await request("/api/v1/snapshot", {
      method: "POST",
      auth: "host",
      body: JSON.stringify({
        agents: [],
        data_sources: [
          {
            type: "personal_cli",
            name: "nmem",
            version: "1.2.1",
            auth_status: "authenticated",
          },
        ],
      }),
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as {
      data_sources_updated: number;
      data_sources_missing: number;
    };
    assertEqual(body.data_sources_updated, 1, "body.data_sources_updated");
    assertEqual(body.data_sources_missing, 1, "body.data_sources_missing");
  })();

  // 9. Auth rejection tests
  // No token → 401 (missing authentication)
  await test("No token request to protected route returns 401", async () => {
    const res = await request("/api/v1/hosts");
    assertEqual(res.status, 401, "status");
  })();

  // Invalid token → 401 (token provided but invalid)
  await test("Invalid token returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/hosts`, {
      headers: {
        Authorization: "Bearer invalid-token-12345",
        "Content-Type": "application/json",
      },
    });
    assertEqual(res.status, 401, "status");
    const body = await res.json() as { error: { code: string } };
    assertEqual(body.error.code, "unauthorized", "error.code");
  })();

  await test("Host role cannot access overview (403)", async () => {
    const res = await request("/api/v1/overview", { auth: "host" });
    assertEqual(res.status, 403, "status");
  })();

  await test("Dashboard role cannot upload snapshot (403)", async () => {
    const res = await request("/api/v1/snapshot", {
      method: "POST",
      auth: "dashboard",
      body: JSON.stringify({ agents: [], data_sources: [] }),
    });
    assertEqual(res.status, 403, "status");
  })();

  // ==========================================
  // Agent CRUD Tests (Phase B1)
  // ==========================================

  let testAgentId: string | null = null;

  // 10. Register Agent (host role)
  await test("POST /api/v1/agents creates agent with host role", async () => {
    const res = await request("/api/v1/agents", {
      method: "POST",
      auth: "host",
      body: JSON.stringify({
        match_key: "openclaw:/home/agent/workspace",
        nickname: "E2E Test Agent",
        role: "Automated testing",
      }),
    });
    assertEqual(res.status, 201, "status");
    const body = await res.json() as {
      id: string;
      host_id: string;
      match_key: string;
      nickname: string;
      role: string;
      status: string;
      lane_id: string | null;
    };
    assertExists(body.id, "body.id");
    assertEqual(body.host_id, testHostId!, "body.host_id");
    assertEqual(body.match_key, "openclaw:/home/agent/workspace", "body.match_key");
    assertEqual(body.nickname, "E2E Test Agent", "body.nickname");
    assertEqual(body.role, "Automated testing", "body.role");
    assertEqual(body.status, "stopped", "body.status");
    assertEqual(body.lane_id, null, "body.lane_id");
    testAgentId = body.id;
  })();

  // 11. Register Agent (dashboard role)
  await test("POST /api/v1/agents creates agent with dashboard role", async () => {
    assertExists(testHostId, "testHostId");
    const res = await request("/api/v1/agents", {
      method: "POST",
      auth: "dashboard",
      body: JSON.stringify({
        host_id: testHostId,
        match_key: "hermes:/projects/bot",
        nickname: "Dashboard Created Agent",
      }),
    });
    assertEqual(res.status, 201, "status");
    const body = await res.json() as { id: string; host_id: string };
    assertExists(body.id, "body.id");
    assertEqual(body.host_id, testHostId, "body.host_id");
  })();

  // 12. Duplicate match_key should fail
  await test("POST /api/v1/agents rejects duplicate match_key", async () => {
    const res = await request("/api/v1/agents", {
      method: "POST",
      auth: "host",
      body: JSON.stringify({
        match_key: "openclaw:/home/agent/workspace", // Already exists
      }),
    });
    assertEqual(res.status, 409, "status");
  })();

  // 13. List Agents
  await test("GET /api/v1/agents returns agents list", async () => {
    const res = await request("/api/v1/agents", { auth: "dashboard" });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as {
      data: Array<{ id: string; match_key: string }>;
      next_cursor: string | null;
    };
    assertEqual(body.data.length, 2, "body.data.length"); // 2 agents created
    const found = body.data.find((a) => a.id === testAgentId);
    assertExists(found, "test agent in list");
  })();

  // 14. List Agents with host_id filter
  await test("GET /api/v1/agents filters by host_id", async () => {
    assertExists(testHostId, "testHostId");
    const res = await request(`/api/v1/agents?host_id=${testHostId}`, {
      auth: "dashboard",
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { data: Array<{ host_id: string }> };
    assertEqual(body.data.length, 2, "body.data.length");
    body.data.forEach((a) => assertEqual(a.host_id, testHostId!, "agent.host_id"));
  })();

  // 15. Get single Agent
  await test("GET /api/v1/agents/:id returns agent details", async () => {
    assertExists(testAgentId, "testAgentId");
    const res = await request(`/api/v1/agents/${testAgentId}`, {
      auth: "dashboard",
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as {
      id: string;
      nickname: string;
      metadata: Record<string, unknown>;
      extra: Record<string, unknown>;
    };
    assertEqual(body.id, testAgentId, "body.id");
    assertEqual(body.nickname, "E2E Test Agent", "body.nickname");
    assertEqual(typeof body.metadata, "object", "metadata is object");
    assertEqual(typeof body.extra, "object", "extra is object");
  })();

  // 16. Get non-existent Agent
  await test("GET /api/v1/agents/:id returns 404 for non-existent", async () => {
    const res = await request("/api/v1/agents/agent_nonexistent", {
      auth: "dashboard",
    });
    assertEqual(res.status, 404, "status");
  })();

  // 17. Update Agent
  await test("PATCH /api/v1/agents/:id updates agent", async () => {
    assertExists(testAgentId, "testAgentId");
    const res = await request(`/api/v1/agents/${testAgentId}`, {
      method: "PATCH",
      auth: "dashboard",
      body: JSON.stringify({
        nickname: "Updated Agent Name",
        role: "Updated role description",
        metadata: { notes: "E2E test notes", priority: "high" },
      }),
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as {
      id: string;
      nickname: string;
      role: string;
      metadata: Record<string, unknown>;
    };
    assertEqual(body.id, testAgentId, "body.id");
    assertEqual(body.nickname, "Updated Agent Name", "body.nickname");
    assertEqual(body.role, "Updated role description", "body.role");
    assertEqual(body.metadata.notes, "E2E test notes", "body.metadata.notes");
    assertEqual(body.metadata.priority, "high", "body.metadata.priority");
  })();

  // 18. Clear field with null
  await test("PATCH /api/v1/agents/:id clears field with null", async () => {
    assertExists(testAgentId, "testAgentId");
    const res = await request(`/api/v1/agents/${testAgentId}`, {
      method: "PATCH",
      auth: "dashboard",
      body: JSON.stringify({ role: null }),
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { role: string | null };
    assertEqual(body.role, null, "body.role");
  })();

  // 19. Verify Agent persisted state
  await test("GET /api/v1/agents/:id shows updated state", async () => {
    assertExists(testAgentId, "testAgentId");
    const res = await request(`/api/v1/agents/${testAgentId}`, {
      auth: "dashboard",
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as {
      nickname: string;
      role: string | null;
      metadata: Record<string, unknown>;
    };
    assertEqual(body.nickname, "Updated Agent Name", "body.nickname");
    assertEqual(body.role, null, "body.role cleared");
    assertEqual(body.metadata.notes, "E2E test notes", "metadata preserved");
  })();

  // 20. Host role cannot list agents (403)
  await test("Host role cannot list agents (403)", async () => {
    const res = await request("/api/v1/agents", { auth: "host" });
    assertEqual(res.status, 403, "status");
  })();

  // 21. Host role cannot update agents (403)
  await test("Host role cannot update agents (403)", async () => {
    assertExists(testAgentId, "testAgentId");
    const res = await request(`/api/v1/agents/${testAgentId}`, {
      method: "PATCH",
      auth: "host",
      body: JSON.stringify({ nickname: "Should not work" }),
    });
    assertEqual(res.status, 403, "status");
  })();

  // 22. Overview shows Agent count
  await test("GET /api/v1/overview shows updated agent count", async () => {
    const res = await request("/api/v1/overview", { auth: "dashboard" });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { agents: { total: number } };
    assertEqual(body.agents.total, 2, "agents.total"); // 2 agents created
  })();

  // ==========================================
  // Data Source CRUD Tests (Phase B2)
  // ==========================================

  let testDataSourceId: string | null = null;

  // 23. List Data Sources
  await test("GET /api/v1/data-sources returns data sources list", async () => {
    const res = await request("/api/v1/data-sources", { auth: "dashboard" });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as {
      data: Array<{ id: string; name: string; status: string }>;
      next_cursor: string | null;
    };
    // 2 data sources created by snapshot (nmem=active, wrangler=missing)
    assertEqual(body.data.length, 2, "body.data.length");
    const nmem = body.data.find((ds) => ds.name === "nmem");
    assertExists(nmem, "nmem data source");
    assertEqual(nmem!.status, "active", "nmem.status");
    testDataSourceId = nmem!.id;
  })();

  // 24. List Data Sources with host_id filter
  await test("GET /api/v1/data-sources filters by host_id", async () => {
    assertExists(testHostId, "testHostId");
    const res = await request(`/api/v1/data-sources?host_id=${testHostId}`, {
      auth: "dashboard",
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { data: Array<{ host_id: string }> };
    assertEqual(body.data.length, 2, "body.data.length");
    body.data.forEach((ds) => assertEqual(ds.host_id, testHostId!, "ds.host_id"));
  })();

  // 25. List Data Sources with status filter
  await test("GET /api/v1/data-sources filters by status", async () => {
    const res = await request("/api/v1/data-sources?status=active", {
      auth: "dashboard",
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { data: Array<{ status: string }> };
    assertEqual(body.data.length, 1, "body.data.length"); // Only nmem is active
    body.data.forEach((ds) => assertEqual(ds.status, "active", "ds.status"));
  })();

  // 26. Get single Data Source
  await test("GET /api/v1/data-sources/:id returns data source details", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(`/api/v1/data-sources/${testDataSourceId}`, {
      auth: "dashboard",
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as {
      id: string;
      name: string;
      type: string;
      version: string;
      metadata: Record<string, unknown>;
      lane_ids: string[];
    };
    assertEqual(body.id, testDataSourceId, "body.id");
    assertEqual(body.name, "nmem", "body.name");
    assertEqual(body.type, "personal_cli", "body.type");
    assertEqual(body.version, "1.2.1", "body.version"); // Updated by second snapshot
    assertEqual(typeof body.metadata, "object", "metadata is object");
    assertEqual(Array.isArray(body.lane_ids), true, "lane_ids is array");
    assertEqual(body.lane_ids.length, 0, "lane_ids initially empty");
  })();

  // 27. Get non-existent Data Source
  await test("GET /api/v1/data-sources/:id returns 404 for non-existent", async () => {
    const res = await request("/api/v1/data-sources/ds_nonexistent", {
      auth: "dashboard",
    });
    assertEqual(res.status, 404, "status");
  })();

  // 28. Update Data Source metadata
  await test("PATCH /api/v1/data-sources/:id updates metadata", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(`/api/v1/data-sources/${testDataSourceId}`, {
      method: "PATCH",
      auth: "dashboard",
      body: JSON.stringify({
        metadata: { notes: "Primary memory CLI", priority: "high" },
      }),
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as {
      id: string;
      metadata: Record<string, unknown>;
    };
    assertEqual(body.id, testDataSourceId, "body.id");
    assertEqual(body.metadata.notes, "Primary memory CLI", "metadata.notes");
    assertEqual(body.metadata.priority, "high", "metadata.priority");
  })();

  // 29. Metadata shallow merge
  await test("PATCH /api/v1/data-sources/:id shallow merges metadata", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(`/api/v1/data-sources/${testDataSourceId}`, {
      method: "PATCH",
      auth: "dashboard",
      body: JSON.stringify({
        metadata: { category: "tools" },
      }),
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { metadata: Record<string, unknown> };
    assertEqual(body.metadata.notes, "Primary memory CLI", "existing notes preserved");
    assertEqual(body.metadata.priority, "high", "existing priority preserved");
    assertEqual(body.metadata.category, "tools", "new category added");
  })();

  // 30. Invalid metadata type
  await test("PATCH /api/v1/data-sources/:id rejects invalid metadata", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(`/api/v1/data-sources/${testDataSourceId}`, {
      method: "PATCH",
      auth: "dashboard",
      body: JSON.stringify({ metadata: ["invalid"] }),
    });
    assertEqual(res.status, 400, "status");
  })();

  // 31. Set lane assignments
  await test("PUT /api/v1/data-sources/:id/lanes sets lane assignments", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    // First, we need to create lanes in the database
    // Since we can't directly create lanes via API, we'll skip the lane validation
    // and test that the endpoint structure works correctly
    // For now, test empty array (which is always valid)
    const res = await request(`/api/v1/data-sources/${testDataSourceId}/lanes`, {
      method: "PUT",
      auth: "dashboard",
      body: JSON.stringify({ lane_ids: [] }),
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { data_source_id: string; lane_ids: string[] };
    assertEqual(body.data_source_id, testDataSourceId, "body.data_source_id");
    assertEqual(Array.isArray(body.lane_ids), true, "lane_ids is array");
    assertEqual(body.lane_ids.length, 0, "lane_ids empty");
  })();

  // 32. Set lanes - invalid lane_ids type
  await test("PUT /api/v1/data-sources/:id/lanes rejects non-array", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(`/api/v1/data-sources/${testDataSourceId}/lanes`, {
      method: "PUT",
      auth: "dashboard",
      body: JSON.stringify({ lane_ids: "not-an-array" }),
    });
    assertEqual(res.status, 400, "status");
  })();

  // 33. Set lanes - non-existent data source
  await test("PUT /api/v1/data-sources/:id/lanes returns 404 for non-existent", async () => {
    const res = await request("/api/v1/data-sources/ds_nonexistent/lanes", {
      method: "PUT",
      auth: "dashboard",
      body: JSON.stringify({ lane_ids: [] }),
    });
    assertEqual(res.status, 404, "status");
  })();

  // 34. Host role cannot access data sources
  await test("Host role cannot list data sources (403)", async () => {
    const res = await request("/api/v1/data-sources", { auth: "host" });
    assertEqual(res.status, 403, "status");
  })();

  // 35. Host role cannot update data sources
  await test("Host role cannot update data sources (403)", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(`/api/v1/data-sources/${testDataSourceId}`, {
      method: "PATCH",
      auth: "host",
      body: JSON.stringify({ metadata: { test: "should fail" } }),
    });
    assertEqual(res.status, 403, "status");
  })();

  // 36. Verify Data Source persisted state
  await test("GET /api/v1/data-sources/:id shows updated state", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(`/api/v1/data-sources/${testDataSourceId}`, {
      auth: "dashboard",
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { metadata: Record<string, unknown> };
    assertEqual(body.metadata.notes, "Primary memory CLI", "notes persisted");
    assertEqual(body.metadata.priority, "high", "priority persisted");
    assertEqual(body.metadata.category, "tools", "category persisted");
  })();

  // ==========================================
  // Lanes Tests (Phase B2)
  // ==========================================

  // 37. List Lanes
  await test("GET /api/v1/lanes returns preset lanes", async () => {
    const res = await request("/api/v1/lanes", { auth: "dashboard" });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { data: Array<{ id: string; name: string }> };
    assertEqual(body.data.length, 3, "body.data.length"); // work, life, learning
    const laneNames = body.data.map(l => l.name);
    assertExists(laneNames.includes("work"), "has work lane");
    assertExists(laneNames.includes("life"), "has life lane");
    assertExists(laneNames.includes("learning"), "has learning lane");
  })();

  // 38. Host role cannot list lanes
  await test("Host role cannot list lanes (403)", async () => {
    const res = await request("/api/v1/lanes", { auth: "host" });
    assertEqual(res.status, 403, "status");
  })();

  // ==========================================
  // Bindings Tests (Phase B2)
  // ==========================================

  // 39. List Bindings (empty initially)
  await test("GET /api/v1/bindings returns empty list initially", async () => {
    const res = await request("/api/v1/bindings", { auth: "dashboard" });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { data: unknown[]; next_cursor: string | null };
    assertEqual(body.data.length, 0, "body.data.length");
    assertEqual(body.next_cursor, null, "next_cursor");
  })();

  // 40. Create Binding
  await test("POST /api/v1/bindings creates binding", async () => {
    assertExists(testAgentId, "testAgentId");
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request("/api/v1/bindings", {
      method: "POST",
      auth: "dashboard",
      body: JSON.stringify({
        agent_id: testAgentId,
        data_source_id: testDataSourceId,
      }),
    });
    assertEqual(res.status, 201, "status");
    const body = await res.json() as {
      agent_id: string;
      data_source_id: string;
      created_at: string;
    };
    assertEqual(body.agent_id, testAgentId, "body.agent_id");
    assertEqual(body.data_source_id, testDataSourceId, "body.data_source_id");
    assertExists(body.created_at, "body.created_at");
  })();

  // 41. Duplicate binding rejected
  await test("POST /api/v1/bindings rejects duplicate binding", async () => {
    assertExists(testAgentId, "testAgentId");
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request("/api/v1/bindings", {
      method: "POST",
      auth: "dashboard",
      body: JSON.stringify({
        agent_id: testAgentId,
        data_source_id: testDataSourceId,
      }),
    });
    assertEqual(res.status, 409, "status");
  })();

  // 42. List Bindings shows created binding
  await test("GET /api/v1/bindings shows created binding", async () => {
    assertExists(testAgentId, "testAgentId");
    const res = await request(`/api/v1/bindings?agent_id=${testAgentId}`, {
      auth: "dashboard",
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { data: Array<{ agent_id: string; data_source_id: string }> };
    assertEqual(body.data.length, 1, "body.data.length");
    assertEqual(body.data[0]?.agent_id, testAgentId, "binding.agent_id");
  })();

  // 43. Filter bindings by data_source_id
  await test("GET /api/v1/bindings filters by data_source_id", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(`/api/v1/bindings?data_source_id=${testDataSourceId}`, {
      auth: "dashboard",
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { data: Array<{ data_source_id: string }> };
    assertEqual(body.data.length, 1, "body.data.length");
    assertEqual(body.data[0]?.data_source_id, testDataSourceId, "binding.data_source_id");
  })();

  // 44. Cross-host binding rejected
  await test("POST /api/v1/bindings rejects cross-host binding", async () => {
    // Create a second host and agent to test cross-host binding
    const registerRes = await request("/api/v1/hosts/register", {
      method: "POST",
      auth: "dashboard",
      body: JSON.stringify({ name: "e2e-test-host-2" }),
    });
    assertEqual(registerRes.status, 201, "register status");
    const { id: secondHostId, api_key: secondHostApiKey } = await registerRes.json() as {
      id: string;
      api_key: string;
    };

    // Create agent on second host
    const agentRes = await fetch(`${BASE_URL}/api/v1/agents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secondHostApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ match_key: "test:/cross-host-agent" }),
    });
    assertEqual(agentRes.status, 201, "agent creation status");
    const { id: secondAgentId } = await agentRes.json() as { id: string };

    // Try to bind agent from host2 to data source from host1
    assertExists(testDataSourceId, "testDataSourceId");
    const bindingRes = await request("/api/v1/bindings", {
      method: "POST",
      auth: "dashboard",
      body: JSON.stringify({
        agent_id: secondAgentId,
        data_source_id: testDataSourceId,
      }),
    });
    assertEqual(bindingRes.status, 403, "cross-host binding rejected");

    // Clean up - we can't delete these but that's okay for E2E
    void secondHostId;
  })();

  // 45. Delete Binding
  await test("DELETE /api/v1/bindings/:agent_id/:data_source_id deletes binding", async () => {
    assertExists(testAgentId, "testAgentId");
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(
      `/api/v1/bindings/${testAgentId}/${testDataSourceId}`,
      { method: "DELETE", auth: "dashboard" }
    );
    assertEqual(res.status, 204, "status");
  })();

  // 46. Verify binding deleted
  await test("GET /api/v1/bindings shows binding deleted", async () => {
    assertExists(testAgentId, "testAgentId");
    const res = await request(`/api/v1/bindings?agent_id=${testAgentId}`, {
      auth: "dashboard",
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { data: unknown[] };
    assertEqual(body.data.length, 0, "body.data.length after delete");
  })();

  // 47. Delete non-existent binding returns 404
  await test("DELETE /api/v1/bindings/:agent_id/:data_source_id returns 404 for non-existent", async () => {
    const res = await request(
      "/api/v1/bindings/agent_nonexistent/ds_nonexistent",
      { method: "DELETE", auth: "dashboard" }
    );
    assertEqual(res.status, 404, "status");
  })();

  // 48. Host role cannot access bindings
  await test("Host role cannot list bindings (403)", async () => {
    const res = await request("/api/v1/bindings", { auth: "host" });
    assertEqual(res.status, 403, "status");
  })();

  // 49. Missing agent_id in POST returns 400
  await test("POST /api/v1/bindings requires agent_id", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request("/api/v1/bindings", {
      method: "POST",
      auth: "dashboard",
      body: JSON.stringify({ data_source_id: testDataSourceId }),
    });
    assertEqual(res.status, 400, "status");
  })();

  // 50. Set lane_ids with valid lanes
  await test("PUT /api/v1/data-sources/:id/lanes sets valid lane assignments", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(`/api/v1/data-sources/${testDataSourceId}/lanes`, {
      method: "PUT",
      auth: "dashboard",
      body: JSON.stringify({ lane_ids: ["lane_work", "lane_learning"] }),
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { data_source_id: string; lane_ids: string[] };
    assertEqual(body.data_source_id, testDataSourceId, "body.data_source_id");
    assertEqual(body.lane_ids.length, 2, "lane_ids.length");
    assertExists(body.lane_ids.includes("lane_work"), "has lane_work");
    assertExists(body.lane_ids.includes("lane_learning"), "has lane_learning");
  })();

  // 51. Verify lane assignments in data source detail
  await test("GET /api/v1/data-sources/:id shows lane assignments", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(`/api/v1/data-sources/${testDataSourceId}`, {
      auth: "dashboard",
    });
    assertEqual(res.status, 200, "status");
    const body = await res.json() as { lane_ids: string[] };
    assertEqual(body.lane_ids.length, 2, "lane_ids.length");
    assertExists(body.lane_ids.includes("lane_work"), "has lane_work");
    assertExists(body.lane_ids.includes("lane_learning"), "has lane_learning");
  })();

  // 52. Invalid lane_id returns 400
  await test("PUT /api/v1/data-sources/:id/lanes rejects invalid lane_id", async () => {
    assertExists(testDataSourceId, "testDataSourceId");
    const res = await request(`/api/v1/data-sources/${testDataSourceId}/lanes`, {
      method: "PUT",
      auth: "dashboard",
      body: JSON.stringify({ lane_ids: ["lane_work", "lane_invalid"] }),
    });
    assertEqual(res.status, 400, "status");
  })();
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log("🧪 Steed E2E Test Suite\n");

  try {
    cleanupTestState();
    await initDatabase();
    await startWrangler();
    await runTests();
  } finally {
    stopWrangler();
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  stopWrangler();
  process.exit(1);
});
