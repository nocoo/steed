import { describe, it, expect } from "vitest";
import app from "./index";

describe("Worker App", () => {
  describe("GET /api/v1/health", () => {
    it("should return ok status", async () => {
      const res = await app.request("/api/v1/health");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty("status", "ok");
      expect(body).toHaveProperty("timestamp");
    });

    it("should return ISO 8601 timestamp", async () => {
      const res = await app.request("/api/v1/health");
      const body = (await res.json()) as { timestamp: string };

      // Check ISO 8601 format
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
