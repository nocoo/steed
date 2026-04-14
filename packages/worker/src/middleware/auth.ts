import { createMiddleware } from "hono/factory";
import type { Env } from "../env";

/**
 * Authentication role
 */
export type AuthRole = "dashboard" | "host" | "public";

/**
 * Authentication context injected by auth middleware
 */
export interface AuthContext {
  role: AuthRole;
  hostId: string | null;
}

/**
 * Extended Hono context with auth info
 */
declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * Verify Host API Key against stored hash
 * Uses timing-safe comparison to prevent timing attacks
 */
async function verifyHostApiKey(
  db: D1Database,
  token: string
): Promise<string | null> {
  // Hash the incoming token (we store sha256 hash of API keys)
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  // Look up host by api_key_hash
  const result = await db
    .prepare("SELECT id FROM hosts WHERE api_key_hash = ?")
    .bind(tokenHash)
    .first<{ id: string }>();

  return result?.id ?? null;
}

/**
 * Auth middleware - validates Bearer token and sets auth context
 *
 * Priority:
 * 1. Check if token matches DASHBOARD_SERVICE_TOKEN → role: dashboard
 * 2. Check if token hash matches hosts.api_key_hash → role: host, set hostId
 * 3. No valid token → role: public (only health check allowed)
 */
export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    const token = extractBearerToken(authHeader);

    // No token → public role
    if (!token) {
      c.set("auth", { role: "public", hostId: null });
      return next();
    }

    // Check dashboard service token first
    if (token === c.env.DASHBOARD_SERVICE_TOKEN) {
      c.set("auth", { role: "dashboard", hostId: null });
      return next();
    }

    // Check host API key
    const hostId = await verifyHostApiKey(c.env.DB, token);
    if (hostId) {
      c.set("auth", { role: "host", hostId });
      return next();
    }

    // Invalid token → still public, but endpoints will reject
    c.set("auth", { role: "public", hostId: null });
    return next();
  }
);

/**
 * Require specific role(s) for a route
 */
export function requireRole(...roles: AuthRole[]) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const auth = c.get("auth");
    if (!roles.includes(auth.role)) {
      return c.json(
        { error: { code: "forbidden", message: "Permission denied" } },
        403
      );
    }
    await next();
  });
}
