/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  // D1 database binding
  DB: D1Database;

  // Service token for Dashboard Server authentication
  DASHBOARD_SERVICE_TOKEN: string;
}
