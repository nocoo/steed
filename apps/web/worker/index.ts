import app from "@steed/worker";
import { createApiRouter } from "@steed/api/server";
import { verifyAccessJwt, type VerifyResult } from "./access-jwt";

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  DB: D1Database;
  CF_ACCESS_TEAM: string;
  CF_ACCESS_AUD: string;
  CF_ACCESS_DEV_BYPASS?: string;
  DASHBOARD_SERVICE_TOKEN: string;
}

const dashboardRouter = createApiRouter();

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }

    // /api/v1/* — Worker API. Auth handled by Hono Bearer middleware.
    // Used by Host Service / CLI directly, and by the dashboard router via
    // same-origin internal fetch (with the service token).
    if (url.pathname.startsWith("/api/v1/")) {
      return app.fetch(req, env, ctx);
    }

    // /api/* — Browser-facing dashboard API. Requires CF Access JWT.
    if (url.pathname.startsWith("/api/")) {
      const verifyResult: VerifyResult = await verifyAccessJwt(req, {
        team: env.CF_ACCESS_TEAM,
        aud: env.CF_ACCESS_AUD,
        devBypass: env.CF_ACCESS_DEV_BYPASS === "true",
      });
      if (!verifyResult.ok) {
        return new Response("Unauthorized", { status: 401 });
      }

      return dashboardRouter.fetch(
        req,
        {
          // Same-origin URL — internal fetch loops back into this Worker and
          // is matched by the /api/v1/ branch above.
          WORKER_API_URL: url.origin,
          DASHBOARD_SERVICE_TOKEN: env.DASHBOARD_SERVICE_TOKEN,
        },
        verifyResult.user
      );
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
