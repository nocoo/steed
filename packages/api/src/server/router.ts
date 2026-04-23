import type { ApiEnv, AuthedUser } from "./context";
import { createWorkerClient, type WorkerClient } from "./worker-fetch";
import { WorkerApiError } from "./errors";

export interface HandlerContext {
  env: ApiEnv;
  user: AuthedUser | null;
  workerClient: WorkerClient;
  params: Record<string, string>;
}

export type Handler = (
  req: Request,
  ctx: HandlerContext
) => Promise<Response>;

interface Route {
  method: string;
  pattern: URLPattern;
  handler: Handler;
}

export interface ApiRouter {
  fetch(req: Request, env: ApiEnv, user: AuthedUser | null): Promise<Response>;
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
  patch(path: string, handler: Handler): void;
  put(path: string, handler: Handler): void;
  delete(path: string, handler: Handler): void;
}

export function createRouter(): ApiRouter {
  const routes: Route[] = [];

  function addRoute(method: string, path: string, handler: Handler) {
    routes.push({
      method,
      pattern: new URLPattern({ pathname: path }),
      handler,
    });
  }

  return {
    get: (path, handler) => addRoute("GET", path, handler),
    post: (path, handler) => addRoute("POST", path, handler),
    patch: (path, handler) => addRoute("PATCH", path, handler),
    put: (path, handler) => addRoute("PUT", path, handler),
    delete: (path, handler) => addRoute("DELETE", path, handler),

    async fetch(req, env, user) {
      const url = new URL(req.url);
      const method = req.method;

      const workerClient = createWorkerClient(env);

      for (const route of routes) {
        if (route.method !== method) continue;
        const match = route.pattern.exec(url);
        if (!match) continue;

        const params: Record<string, string> = {};
        for (const [key, value] of Object.entries(
          match.pathname.groups as Record<string, string>
        )) {
          params[key] = value;
        }

        try {
          return await route.handler(req, {
            env,
            user,
            workerClient,
            params,
          });
        } catch (error) {
          if (error instanceof WorkerApiError) {
            return new Response(
              JSON.stringify({
                error: { code: "upstream_error", message: error.message },
              }),
              {
                status: error.status,
                headers: { "Content-Type": "application/json" },
              }
            );
          }
          throw error;
        }
      }

      return new Response(
        JSON.stringify({ error: { code: "not_found", message: "Not found" } }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    },
  };
}

export function jsonOk<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonError(
  code: string,
  message: string,
  status: number
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
