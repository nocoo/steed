import { Hono } from "hono";
import type { Env } from "./env";
import { authMiddleware } from "./middleware/auth";
import { hosts } from "./routes/hosts";
import { snapshot } from "./routes/snapshot";
import { overview } from "./routes/overview";
import { agents } from "./routes/agents";
import { dataSources } from "./routes/data-sources";
import { bindings } from "./routes/bindings";
import { lanes } from "./routes/lanes";

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
app.route("/api/v1/overview", overview);
app.route("/api/v1/agents", agents);
app.route("/api/v1/data-sources", dataSources);
app.route("/api/v1/bindings", bindings);
app.route("/api/v1/lanes", lanes);

export default app;
