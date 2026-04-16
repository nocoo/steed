import { describe, it, expect } from "vitest";
import { DEFAULT_CLI_SCANNERS } from "./defaults.js";

describe("defaults", () => {
  describe("DEFAULT_CLI_SCANNERS", () => {
    it("contains wrangler scanner", () => {
      const wrangler = DEFAULT_CLI_SCANNERS.find((s) => s.name === "wrangler");
      expect(wrangler).toBeDefined();
      expect(wrangler?.type).toBe("third_party_cli");
      expect(wrangler?.binary).toBe("wrangler");
      expect(wrangler?.auth_check?.method).toBe("config_exists");
    });

    it("contains railway scanner", () => {
      const railway = DEFAULT_CLI_SCANNERS.find((s) => s.name === "railway");
      expect(railway).toBeDefined();
      expect(railway?.type).toBe("third_party_cli");
      expect(railway?.binary).toBe("railway");
    });

    it("contains gh scanner with command auth check", () => {
      const gh = DEFAULT_CLI_SCANNERS.find((s) => s.name === "gh");
      expect(gh).toBeDefined();
      expect(gh?.auth_check?.method).toBe("command");
      expect(gh?.auth_check?.pattern).toBe("gh auth status");
    });

    it("contains vercel scanner", () => {
      const vercel = DEFAULT_CLI_SCANNERS.find((s) => s.name === "vercel");
      expect(vercel).toBeDefined();
      expect(vercel?.type).toBe("third_party_cli");
    });

    it("has 4 default scanners", () => {
      expect(DEFAULT_CLI_SCANNERS).toHaveLength(4);
    });
  });
});
