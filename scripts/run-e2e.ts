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
