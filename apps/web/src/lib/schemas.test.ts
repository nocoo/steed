import { describe, it, expect } from "vitest";
import {
  agentUpdateSchema,
  dataSourceUpdateSchema,
  setLanesSchema,
  createBindingSchema,
  emptyToNull,
  parseTagsInput,
} from "./schemas";

describe("schemas", () => {
  describe("agentUpdateSchema", () => {
    it("accepts valid agent update", () => {
      const result = agentUpdateSchema.safeParse({
        nickname: "Test",
        role: "Main agent",
        lane_id: "lane_work",
      });
      expect(result.success).toBe(true);
    });

    it("accepts null values", () => {
      const result = agentUpdateSchema.safeParse({
        nickname: null,
        role: null,
        lane_id: null,
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty object", () => {
      const result = agentUpdateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects invalid lane_id", () => {
      const result = agentUpdateSchema.safeParse({
        lane_id: "invalid_lane",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("dataSourceUpdateSchema", () => {
    it("accepts valid metadata", () => {
      const result = dataSourceUpdateSchema.safeParse({
        metadata: { notes: "test" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing metadata", () => {
      const result = dataSourceUpdateSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("setLanesSchema", () => {
    it("accepts valid lane_ids array", () => {
      const result = setLanesSchema.safeParse({
        lane_ids: ["lane_work", "lane_life"],
      });
      expect(result.success).toBe(true);
    });

    it("accepts empty array", () => {
      const result = setLanesSchema.safeParse({
        lane_ids: [],
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid lane id", () => {
      const result = setLanesSchema.safeParse({
        lane_ids: ["invalid"],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createBindingSchema", () => {
    it("accepts valid binding", () => {
      const result = createBindingSchema.safeParse({
        agent_id: "agent-123",
        data_source_id: "ds-456",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty agent_id", () => {
      const result = createBindingSchema.safeParse({
        agent_id: "",
        data_source_id: "ds-456",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("emptyToNull", () => {
    it("returns null for empty string", () => {
      expect(emptyToNull("")).toBe(null);
    });

    it("returns null for whitespace only", () => {
      expect(emptyToNull("   ")).toBe(null);
    });

    it("returns trimmed value for non-empty string", () => {
      expect(emptyToNull("  hello  ")).toBe("hello");
    });

    it("returns null for null input", () => {
      expect(emptyToNull(null)).toBe(null);
    });

    it("returns null for undefined input", () => {
      expect(emptyToNull(undefined)).toBe(null);
    });
  });

  describe("parseTagsInput", () => {
    it("parses comma-separated tags", () => {
      expect(parseTagsInput("a, b, c")).toEqual(["a", "b", "c"]);
    });

    it("trims whitespace", () => {
      expect(parseTagsInput("  tag1 ,  tag2  ")).toEqual(["tag1", "tag2"]);
    });

    it("removes empty entries", () => {
      expect(parseTagsInput("a,, b,")).toEqual(["a", "b"]);
    });

    it("returns empty array for empty string", () => {
      expect(parseTagsInput("")).toEqual([]);
    });
  });
});
