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
  /** True if a token was provided but invalid */
  invalidToken: boolean;
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
 * Result of parsing Authorization header
 */
type AuthHeaderResult =
  | { status: "absent" }
  | { status: "valid"; token: string }
  | { status: "malformed" };

/**
 * Parse Authorization header for Bearer token
 */
function parseAuthHeader(header: string | undefined): AuthHeaderResult {
  if (!header) return { status: "absent" };
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return { status: "malformed" };
  return { status: "valid", token: match[1] };
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
 * 1. No Authorization header → role: public, invalidToken: false
 * 2. Malformed header (not "Bearer xxx") → role: public, invalidToken: true (triggers 401)
 * 3. Check if token matches DASHBOARD_SERVICE_TOKEN → role: dashboard
 * 4. Check if token hash matches hosts.api_key_hash → role: host, set hostId
 * 5. Invalid token → role: public, invalidToken: true (will trigger 401)
 */
export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    const parsed = parseAuthHeader(authHeader);

    // No header → public role (not an error, just unauthenticated)
    if (parsed.status === "absent") {
      c.set("auth", { role: "public", hostId: null, invalidToken: false });
      return next();
    }

    // Malformed header (e.g., "Basic xxx" or "Bearer" without token)
    if (parsed.status === "malformed") {
      c.set("auth", { role: "public", hostId: null, invalidToken: true });
      return next();
    }

    const token = parsed.token;

    // Check dashboard service token first
    if (token === c.env.DASHBOARD_SERVICE_TOKEN) {
      c.set("auth", { role: "dashboard", hostId: null, invalidToken: false });
      return next();
    }

    // Check host API key
    const hostId = await verifyHostApiKey(c.env.DB, token);
    if (hostId) {
      c.set("auth", { role: "host", hostId, invalidToken: false });
      return next();
    }

    // Token provided but invalid → still public, but mark as invalid for 401
    c.set("auth", { role: "public", hostId: null, invalidToken: true });
    return next();
  }
);

/**
 * Require specific role(s) for a route
 * Returns 401 if token was provided but invalid
 * Returns 403 if authenticated but wrong role
 */
export function requireRole(...roles: AuthRole[]) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const auth = c.get("auth");

    // Invalid token → 401 Unauthorized
    if (auth.invalidToken) {
      return c.json(
        { error: { code: "unauthorized", message: "Invalid or expired token" } },
        401
      );
    }

    // Valid auth but wrong role → 403 Forbidden
    if (!roles.includes(auth.role)) {
      return c.json(
        { error: { code: "forbidden", message: "Permission denied" } },
        403
      );
    }

    await next();
  });
}
