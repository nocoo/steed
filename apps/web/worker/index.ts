import { createApiRouter } from "@steed/api/server";
import { verifyAccessJwt, type VerifyResult } from "./access-jwt";

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  CF_ACCESS_TEAM: string;
  CF_ACCESS_AUD: string;
  CF_ACCESS_DEV_BYPASS?: string;
  WORKER_API_URL: string;
  DASHBOARD_SERVICE_TOKEN: string;
}

const router = createApiRouter();

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }

    const verifyResult: VerifyResult = await verifyAccessJwt(req, {
      team: env.CF_ACCESS_TEAM,
      aud: env.CF_ACCESS_AUD,
      devBypass: env.CF_ACCESS_DEV_BYPASS === "true",
    });
    if (!verifyResult.ok) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (url.pathname.startsWith("/api/")) {
      return router.fetch(
        req,
        {
          WORKER_API_URL: env.WORKER_API_URL,
          DASHBOARD_SERVICE_TOKEN: env.DASHBOARD_SERVICE_TOKEN,
        },
        verifyResult.user
      );
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
