import { describe, it, expect } from "vitest";
import {
  parseMatchKey,
  validateMatchKey,
  inferDetection,
} from "./match-key.js";

describe("match-key utilities", () => {
  describe("parseMatchKey", () => {
    it("parses valid match key", () => {
      const result = parseMatchKey("openclaw:/home/user/agent");
      expect(result.runtime_app).toBe("openclaw");
      expect(result.identifier).toBe("/home/user/agent");
    });

    it("handles identifiers with colons", () => {
      const result = parseMatchKey("custom:key:with:colons");
      expect(result.runtime_app).toBe("custom");
      expect(result.identifier).toBe("key:with:colons");
    });

    it("throws for missing colon", () => {
      expect(() => parseMatchKey("invalid")).toThrow("Invalid match key format");
    });

    it("throws for missing runtime_app", () => {
      expect(() => parseMatchKey(":identifier")).toThrow("missing runtime_app");
    });

    it("throws for missing identifier", () => {
      expect(() => parseMatchKey("runtime:")).toThrow("missing identifier");
    });
  });

  describe("validateMatchKey", () => {
    it("returns true for valid format", () => {
      expect(validateMatchKey("openclaw:/path")).toBe(true);
      expect(validateMatchKey("hermes:main")).toBe(true);
    });

    it("returns false for invalid format", () => {
      expect(validateMatchKey("invalid")).toBe(false);
      expect(validateMatchKey(":no-app")).toBe(false);
      expect(validateMatchKey("no-id:")).toBe(false);
    });
  });

  describe("inferDetection", () => {
    it("infers process detection correctly", () => {
      const detection = inferDetection("openclaw:/home/user/agent", "process");
      expect(detection.method).toBe("process");
      expect(detection.pattern).toContain("openclaw");
      expect(detection.pattern).toContain("agent");
      expect(detection.version_command).toBe("openclaw --version");
    });

    it("infers config_file detection correctly", () => {
      const detection = inferDetection(
        "hermes:/home/user/.hermes/config.json",
        "config_file"
      );
      expect(detection.method).toBe("config_file");
      expect(detection.pattern).toBe("/home/user/.hermes/config.json");
      expect(detection.version_command).toBe("hermes --version");
    });

    it("infers custom detection with empty pattern", () => {
      const detection = inferDetection("custom:my-agent", "custom");
      expect(detection.method).toBe("custom");
      expect(detection.pattern).toBe("");
      expect(detection.version_command).toBe("custom --version");
    });

    it("defaults to process method", () => {
      const detection = inferDetection("openclaw:/path");
      expect(detection.method).toBe("process");
    });

    it("escapes special regex characters in pattern", () => {
      const detection = inferDetection("app:/path/with.dots", "process");
      expect(detection.pattern).toContain("\\.");
    });
  });
});
