import { Hono } from "hono";
import type { Env } from "./env";
import { authMiddleware } from "./middleware/auth";
import { hosts } from "./routes/hosts";
import { snapshot } from "./routes/snapshot";

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("*", authMiddleware);

// Health check - no auth required
app.get("/api/v1/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
app.route("/api/v1/hosts", hosts);
app.route("/api/v1/snapshot", snapshot);

export default app;
