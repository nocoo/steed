export interface ApiEnv {
  WORKER_API_URL: string;
  DASHBOARD_SERVICE_TOKEN: string;
  /**
   * Optional in-process fetcher. When provided, dashboard router uses it
   * instead of the global `fetch` to call /api/v1/*. Required when the
   * dashboard router and the Worker API live in the same Worker, because
   * a same-host outbound fetch would loop back through the edge and 522.
   */
  fetcher?: (req: Request) => Promise<Response>;
}

export interface AuthedUser {
  email: string;
  sub: string;
}

export interface ApiContext {
  env: ApiEnv;
  user: AuthedUser | null;
}
