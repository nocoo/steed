import app from "@steed/worker";
import { createApiRouter } from "@steed/api/server";
import { verifyAccessJwt, type VerifyResult } from "./access-jwt";
import pkg from "../../../package.json" with { type: "json" };
import { getUserProfile } from "./author-profile";
import { diagramBrowserApi } from "./diagram-api";
import { connectMachineApi, isDiagramApiPath } from "./connect-api";
import { connectManagementApi } from "./connect-management";

type Env = Pick<Cloudflare.ProductionEnv, "DB" | "CF_ACCESS_TEAM" | "CF_ACCESS_AUD" | "DASHBOARD_SERVICE_TOKEN">
  & Pick<WorkerBindings, "CF_ACCESS_DEV_BYPASS" | "CONNECT_DEPLOYMENT_ID" | "CONNECT_MANAGERS" | "CONNECT_TOKEN_KEYS">
  & { ASSETS: Pick<WorkerBindings["ASSETS"], "fetch"> };

const dashboardRouter = createApiRouter();

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/live") {
      return Response.json(
        { status: "ok", version: pkg.version },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (isDiagramApiPath(url.pathname)) return connectMachineApi(req, env);

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
      if (url.pathname === "/api/connect" || url.pathname.startsWith("/api/connect/")) {
        return connectManagementApi(req, env, verifyResult.ok ? verifyResult.user : undefined);
      }
      if (!verifyResult.ok) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (url.pathname === "/api/diagrams" || url.pathname.startsWith("/api/diagrams/")) {
        return diagramBrowserApi(req, env.DB);
      }

      if (url.pathname === "/api/me") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
        }
        const profile = await getUserProfile(verifyResult.user.email);
        const headers = { "Cache-Control": "no-store" };
        return req.method === "HEAD"
          ? new Response(null, { headers })
          : Response.json(profile, { headers });
      }

      return dashboardRouter.fetch(
        req,
        {
          // In-process: dashboard router calls /api/v1/* via app.fetch directly,
          // not via outbound HTTP — a same-host fetch to ourselves loops through
          // the edge and 522s. WORKER_API_URL is still required for URL building
          // inside worker-fetch but never actually dialed.
          WORKER_API_URL: url.origin,
          DASHBOARD_SERVICE_TOKEN: env.DASHBOARD_SERVICE_TOKEN,
          fetcher: async (r: Request) => app.fetch(r, env, ctx),
        },
        verifyResult.user
      );
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
