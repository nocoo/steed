import { Hono } from "hono";
import type { Env } from "./env";
import { authMiddleware } from "./middleware/auth";

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

export default app;
