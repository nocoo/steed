export interface ApiEnv {
  WORKER_API_URL: string;
  DASHBOARD_SERVICE_TOKEN: string;
}

export interface AuthedUser {
  email: string;
  sub: string;
}

export interface ApiContext {
  env: ApiEnv;
  user: AuthedUser | null;
}
