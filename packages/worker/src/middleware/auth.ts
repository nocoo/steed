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
 * Auth middleware - validates Bearer token and sets auth context
 * Full implementation in Commit 11
 */
export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    // Placeholder - will be fully implemented in Commit 11
    c.set("auth", { role: "public", hostId: null });
    await next();
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
