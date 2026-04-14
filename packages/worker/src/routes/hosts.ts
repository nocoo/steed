import { Hono } from "hono";
import { generateId } from "@steed/shared";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
import { jsonResponse, errors } from "../lib/response";
import type {
  RegisterHostRequest,
  RegisterHostResponse,
  HostWithStatus,
} from "@steed/shared";

// Online threshold: 15 minutes (heartbeat every 10min + 5min buffer)
const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Generate a random API key
 */
function generateApiKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "sk_host_";
  for (let i = 0; i < 32; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

/**
 * Hash an API key using SHA-256
 */
async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Calculate host online/offline status based on last_seen_at
 */
function calculateStatus(lastSeenAt: string | null): "online" | "offline" {
  if (!lastSeenAt) return "offline";
  const lastSeen = new Date(lastSeenAt).getTime();
  const now = Date.now();
  return now - lastSeen <= ONLINE_THRESHOLD_MS ? "online" : "offline";
}

const hosts = new Hono<{ Bindings: Env }>();

/**
 * POST /hosts/register - Register a new host
 * Requires: dashboard role
 */
hosts.post("/register", requireRole("dashboard"), async (c) => {
  const body = await c.req.json<RegisterHostRequest>().catch(() => null);

  if (!body?.name) {
    return errors.invalidRequest(c, "Missing required field: name");
  }

  const id = generateId("host");
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);
  const now = new Date().toISOString();

  try {
    await c.env.DB.prepare(
      `INSERT INTO hosts (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)`
    )
      .bind(id, body.name, apiKeyHash, now)
      .run();

    const response: RegisterHostResponse = {
      id,
      name: body.name,
      api_key: apiKey,
    };

    return jsonResponse(c, response, 201);
  } catch (error) {
    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return errors.conflict(c, "Host with this name already exists");
    }
    return errors.internalError(c);
  }
});

/**
 * GET /hosts - List all hosts with online/offline status
 * Requires: dashboard role
 */
hosts.get("/", requireRole("dashboard"), async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT id, name, created_at, last_seen_at FROM hosts ORDER BY created_at DESC`
  ).all<{
    id: string;
    name: string;
    created_at: string;
    last_seen_at: string | null;
  }>();

  const hostsWithStatus: HostWithStatus[] = (result.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    api_key_hash: "", // Never expose hash
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    status: calculateStatus(row.last_seen_at),
  }));

  return jsonResponse(c, hostsWithStatus);
});

export { hosts, calculateStatus, hashApiKey };
