import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { auth } from "./auth";
import type { Env } from "../env";
import type { VerifyAuthResponse } from "@steed/shared";

// Mock auth middleware that sets host role
const mockHostAuth = (hostId: string) => {
  return async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>
  ) => {
    c.set("auth", { role: "host", hostId, invalidToken: false });
    await next();
  };
};

// Mock auth middleware that sets public role (invalid token)
const mockPublicAuth = async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "public", hostId: null, invalidToken: true });
  await next();
};

// Create mock D1 database
function createMockDb(hostData: { id: string; name: string } | null) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => (hostData ? { name: hostData.name } : null)),
      })),
    })),
  };
}

describe("auth routes", () => {
  describe("POST /verify", () => {
    it("returns host info for valid host token", async () => {
      const hostId = "host_abc123";
      const hostName = "Test Host";

      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth(hostId));
      app.route("/", auth);

      const mockDb = createMockDb({ id: hostId, name: hostName });
      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }, { DB: mockDb } as unknown as Env);

      expect(res.status).toBe(200);
      const body = (await res.json()) as VerifyAuthResponse;
      expect(body.valid).toBe(true);
      expect(body.host_id).toBe(hostId);
      expect(body.host_name).toBe(hostName);
    });

    it("returns 401 for invalid token", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockPublicAuth);
      app.route("/", auth);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }, {} as Env);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("returns 404 if host record not found", async () => {
      const hostId = "host_deleted";

      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth(hostId));
      app.route("/", auth);

      const mockDb = createMockDb(null); // Host not found
      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }, { DB: mockDb } as unknown as Env);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "not_found");
    });
  });
});
