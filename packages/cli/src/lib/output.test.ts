import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  success,
  error,
  warn,
  info,
  table,
  json,
  spinner,
  formatDuration,
  formatTimestamp,
} from "./output.js";

describe("output", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("success", () => {
    it("prints green checkmark with message", () => {
      success("Operation completed");
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("✓");
      expect(output).toContain("Operation completed");
    });
  });

  describe("error", () => {
    it("prints red X with message", () => {
      error("Something failed");
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const output = consoleErrorSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("✗");
      expect(output).toContain("Something failed");
    });
  });

  describe("warn", () => {
    it("prints yellow warning with message", () => {
      warn("Be careful");
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const output = consoleWarnSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("⚠");
      expect(output).toContain("Be careful");
    });
  });

  describe("info", () => {
    it("prints blue info with message", () => {
      info("FYI");
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("ℹ");
      expect(output).toContain("FYI");
    });
  });

  describe("table", () => {
    it("prints table with headers and rows", () => {
      table(["Name", "Value"], [["foo", "bar"]]);
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("Name");
      expect(output).toContain("Value");
      expect(output).toContain("foo");
      expect(output).toContain("bar");
    });

    it("handles empty rows", () => {
      table(["A", "B"], []);
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });

    it("handles null and undefined cells", () => {
      table(["A", "B"], [[null, undefined]]);
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      // Null/undefined should be converted to empty string
      expect(output).not.toContain("null");
      expect(output).not.toContain("undefined");
    });

    it("handles number cells", () => {
      table(["Count"], [[42]]);
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("42");
    });
  });

  describe("json", () => {
    it("prints formatted JSON", () => {
      json({ foo: "bar", num: 42 });
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('"foo"');
      expect(output).toContain('"bar"');
      expect(output).toContain("42");
      // Should be formatted with indentation
      expect(output).toContain("\n");
    });
  });

  describe("spinner", () => {
    it("returns ora spinner instance", () => {
      const s = spinner("Loading...");
      expect(s).toBeDefined();
      expect(typeof s.start).toBe("function");
      expect(typeof s.stop).toBe("function");
      expect(typeof s.succeed).toBe("function");
      expect(typeof s.fail).toBe("function");
    });
  });

  describe("formatDuration", () => {
    it("returns 'just now' for < 5 seconds", () => {
      expect(formatDuration(0)).toBe("just now");
      expect(formatDuration(1000)).toBe("just now");
      expect(formatDuration(4999)).toBe("just now");
    });

    it("returns seconds for < 60 seconds", () => {
      expect(formatDuration(5000)).toBe("5 seconds ago");
      expect(formatDuration(30000)).toBe("30 seconds ago");
      expect(formatDuration(59000)).toBe("59 seconds ago");
    });

    it("returns minutes for < 60 minutes", () => {
      expect(formatDuration(60000)).toBe("1 minute ago");
      expect(formatDuration(120000)).toBe("2 minutes ago");
      expect(formatDuration(3540000)).toBe("59 minutes ago");
    });

    it("returns hours for < 24 hours", () => {
      expect(formatDuration(3600000)).toBe("1 hour ago");
      expect(formatDuration(7200000)).toBe("2 hours ago");
      expect(formatDuration(82800000)).toBe("23 hours ago");
    });

    it("returns days for >= 24 hours", () => {
      expect(formatDuration(86400000)).toBe("1 day ago");
      expect(formatDuration(172800000)).toBe("2 days ago");
      expect(formatDuration(604800000)).toBe("7 days ago");
    });
  });

  describe("formatTimestamp", () => {
    it("returns 'never' for null", () => {
      expect(formatTimestamp(null)).toBe("never");
    });

    it("returns relative duration for valid timestamp", () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      expect(formatTimestamp(fiveMinutesAgo.toISOString())).toBe(
        "5 minutes ago"
      );
    });
  });
});
