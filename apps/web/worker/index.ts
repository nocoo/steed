import { verifyAccessJwt, type VerifyResult } from "./access-jwt";
import pkg from "../../../package.json" with { type: "json" };
import { getUserProfile } from "./author-profile";
import { topologyConnectMachineApi } from "./topology-connect-machine";
import { topologyConnectManagementApi } from "./topology-connect-management";
import { topologyBrowserApi } from "./topology-api";

type Env = Pick<Cloudflare.ProductionEnv, "DB" | "CF_ACCESS_TEAM" | "CF_ACCESS_AUD">
  & Pick<WorkerBindings, "CF_ACCESS_DEV_BYPASS" | "CONNECT_DEPLOYMENT_ID" | "CONNECT_MANAGERS" | "CONNECT_TOKEN_KEYS">
  & { ASSETS: Pick<WorkerBindings["ASSETS"], "fetch">; AUTHOR_PROFILE_ORIGIN?: string };

/** The author profile upstream can only be redirected by the explicit local dev deployment (E2E stub). */
function profileOrigin(env: Env): string | undefined {
  const local = env.CF_ACCESS_DEV_BYPASS === "true" && env.CONNECT_DEPLOYMENT_ID === "steed-development";
  return local ? env.AUTHOR_PROFILE_ORIGIN || undefined : undefined;
}

export default {
  async fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/live") {
      return Response.json(
        { status: "ok", version: pkg.version },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // /api/v1/* — Connect machine API only. The handler authenticates the
    // Bearer token first (401 without one) and answers unknown routes with 404.
    if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) return topologyConnectMachineApi(req, env, ctx);

    // /api/* — Browser-facing API. Requires CF Access JWT.
    if (url.pathname.startsWith("/api/")) {
      const verifyResult: VerifyResult = await verifyAccessJwt(req, {
        team: env.CF_ACCESS_TEAM,
        aud: env.CF_ACCESS_AUD,
        devBypass: env.CF_ACCESS_DEV_BYPASS === "true",
      });
      if (url.pathname === "/api/connect" || url.pathname.startsWith("/api/connect/")) {
        return topologyConnectManagementApi(req, env, verifyResult.ok ? verifyResult.user : undefined);
      }
      if (!verifyResult.ok) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (url.pathname === "/api/topology" || url.pathname.startsWith("/api/topology/")) {
        return topologyBrowserApi(req, env.DB);
      }

      if (url.pathname === "/api/me") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
        }
        const profile = await getUserProfile(verifyResult.user.email, { host: url.host, origin: profileOrigin(env) });
        const headers = { "Cache-Control": "no-store" };
        return req.method === "HEAD"
          ? new Response(null, { headers })
          : Response.json(profile, { headers });
      }

      return Response.json(
        { error: { code: "not_found", message: "API route not found." } },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
