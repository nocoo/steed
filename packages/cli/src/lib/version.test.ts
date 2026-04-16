import { describe, it, expect } from "vitest";
import { parseVersionString, getVersion } from "./version.js";

describe("version utilities", () => {
  describe("parseVersionString", () => {
    it("handles 'v1.2.3' format", () => {
      expect(parseVersionString("v1.2.3")).toBe("1.2.3");
    });

    it("handles 'version 1.2.3' format", () => {
      expect(parseVersionString("version 1.2.3")).toBe("1.2.3");
    });

    it("handles 'Version: 1.2.3' format", () => {
      expect(parseVersionString("Version: 1.2.3")).toBe("1.2.3");
    });

    it("handles 'tool 1.2.3-beta' format", () => {
      expect(parseVersionString("tool 1.2.3-beta")).toBe("1.2.3-beta");
    });

    it("handles version at start '1.2.3 - description'", () => {
      expect(parseVersionString("1.2.3 - Some description")).toBe("1.2.3");
    });

    it("returns first line as fallback", () => {
      expect(parseVersionString("Some random text\nMore text")).toBe(
        "Some random text"
      );
    });

    it("returns empty string for empty input", () => {
      expect(parseVersionString("")).toBe("");
      expect(parseVersionString("  ")).toBe("");
    });

    it("handles multiline version output", () => {
      const output = `v3.50.0
(built with wrangler)`;
      expect(parseVersionString(output)).toBe("3.50.0");
    });
  });

  describe("getVersion", () => {
    it("returns version from echo command", async () => {
      // Use echo to simulate a version command
      const version = await getVersion("echo 'v1.2.3'");
      expect(version).toBe("1.2.3");
    });

    it("returns null on command failure", async () => {
      const version = await getVersion("false");
      expect(version).toBeNull();
    });

    it("returns null on timeout", async () => {
      // This test uses a very short timeout to force timeout
      // Give the test itself extra time since process cleanup can be slow in CI
      const version = await getVersion("sleep 10", 100);
      expect(version).toBeNull();
    }, 10000);
  });
});
