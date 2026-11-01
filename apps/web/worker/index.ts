import { verifyAccessJwt, type VerifyResult } from "./access-jwt";
import pkg from "../../../package.json" with { type: "json" };
import { getUserProfile } from "./author-profile";
import { topologyConnectMachineApi } from "./topology-connect-machine";
import { topologyConnectManagementApi } from "./topology-connect-management";
import { topologyBrowserApi } from "./topology-api";
import { coloLookup, TRACE_URL } from "./worker-colo";

type Env = Pick<Cloudflare.ProductionEnv, "DB" | "CF_ACCESS_TEAM" | "CF_ACCESS_AUD">
  & Pick<WorkerBindings, "CF_ACCESS_DEV_BYPASS" | "CONNECT_DEPLOYMENT_ID" | "CONNECT_MANAGERS" | "CONNECT_TOKEN_KEYS">
  & { ASSETS: Pick<WorkerBindings["ASSETS"], "fetch">; AUTHOR_PROFILE_ORIGIN?: string; COLO_TRACE_URL?: string };

const isLocalDev = (env: Env) => env.CF_ACCESS_DEV_BYPASS === "true" && env.CONNECT_DEPLOYMENT_ID === "steed-development";

/** The author profile upstream can only be redirected by the explicit local dev deployment (E2E stub). */
function profileOrigin(env: Env): string | undefined {
  return isLocalDev(env) ? env.AUTHOR_PROFILE_ORIGIN || undefined : undefined;
}

/** The trace lookup, redirected only by the local dev deployment's E2E stub and skipped there otherwise. */
function traceUrl(env: Env): string | undefined {
  return isLocalDev(env) ? env.COLO_TRACE_URL || undefined : TRACE_URL;
}

const workerColo = coloLookup();

/**
 * Where the request entered Cloudflare, from validated request metadata only: `request.cf.colo` is
 * the ingress colo, not where a placed Worker runs. `cf-placement` (`remote-NRT`, `local-IAD`) is
 * echoed when Cloudflare sends it.
 */
export function ingressLocation(req: Request): Record<string, string> {
  const location: Record<string, string> = {};
  const placement = req.headers.get("cf-placement");
  if (placement && /^(local|remote)-[A-Z]{3}$/.test(placement)) location["X-Steed-Placement"] = placement;
  const colo = (req as Request & { cf?: { colo?: unknown } }).cf?.colo;
  if (typeof colo === "string" && /^[A-Z]{3}$/.test(colo)) location["X-Steed-Ingress-Colo"] = colo;
  return location;
}

function withLocation(response: Response, location: Record<string, string>): Response {
  if (Object.keys(location).length === 0) return response;
  const located = new Response(response.body, response);
  for (const [name, value] of Object.entries(location)) located.headers.set(name, value);
  return located;
}

export default {
  async fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    const trace = traceUrl(env);
    const [response, colo] = await Promise.all([api(req, env, url, ctx), trace ? workerColo(trace) : null]);
    return withLocation(response, { ...ingressLocation(req), ...(colo ? { "X-Steed-Colo": colo } : {}) });
  },
} satisfies ExportedHandler<Env>;

async function api(req: Request, env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
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
