import { describe, it, expect } from "vitest";
import { LANE_IDS } from "@steed/shared";

import {
  agentUpdateSchema,
  createBindingSchema,
  dataSourceUpdateSchema,
  emptyToNull,
  parseTagsInput,
  setLanesSchema,
} from "./index";

describe("agentUpdateSchema", () => {
  it("accepts a partial update with nickname", () => {
    const r = agentUpdateSchema.safeParse({ nickname: "Coder" });
    expect(r.success).toBe(true);
  });

  it("accepts null for clearing nickname/role/lane_id", () => {
    const r = agentUpdateSchema.safeParse({
      nickname: null,
      role: null,
      lane_id: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown lane_id", () => {
    const r = agentUpdateSchema.safeParse({ lane_id: "lane_misc" });
    expect(r.success).toBe(false);
  });

  it("rejects metadata that is not a plain object (array)", () => {
    const r = agentUpdateSchema.safeParse({ metadata: [] });
    expect(r.success).toBe(false);
  });

  it("rejects an empty object (no fields)", () => {
    const r = agentUpdateSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe("dataSourceUpdateSchema", () => {
  it("accepts metadata object", () => {
    const r = dataSourceUpdateSchema.safeParse({
      metadata: { notes: "hi", tags: ["a"] },
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing metadata", () => {
    const r = dataSourceUpdateSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects metadata that is an array", () => {
    const r = dataSourceUpdateSchema.safeParse({ metadata: [] });
    expect(r.success).toBe(false);
  });
});

describe("setLanesSchema", () => {
  it("accepts the empty array (clear all)", () => {
    const r = setLanesSchema.safeParse({ lane_ids: [] });
    expect(r.success).toBe(true);
  });

  it("accepts a list of preset lane ids", () => {
    const r = setLanesSchema.safeParse({
      lane_ids: [LANE_IDS.work, LANE_IDS.learning],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown lane id", () => {
    const r = setLanesSchema.safeParse({
      lane_ids: [LANE_IDS.work, "lane_misc"],
    });
    expect(r.success).toBe(false);
  });
});

describe("createBindingSchema", () => {
  it("accepts non-empty ids", () => {
    const r = createBindingSchema.safeParse({
      agent_id: "agent_1",
      data_source_id: "ds_1",
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty strings", () => {
    const r = createBindingSchema.safeParse({
      agent_id: "",
      data_source_id: "ds_1",
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const r = createBindingSchema.safeParse({ agent_id: "agent_1" });
    expect(r.success).toBe(false);
  });
});

describe("emptyToNull", () => {
  it("returns null for undefined/null", () => {
    expect(emptyToNull(undefined)).toBeNull();
    expect(emptyToNull(null)).toBeNull();
  });

  it("returns null for whitespace-only strings", () => {
    expect(emptyToNull("   ")).toBeNull();
    expect(emptyToNull("")).toBeNull();
  });

  it("trims surrounding whitespace and keeps the value", () => {
    expect(emptyToNull("  hello  ")).toBe("hello");
  });
});

describe("parseTagsInput", () => {
  it("splits on commas", () => {
    expect(parseTagsInput("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims each fragment", () => {
    expect(parseTagsInput(" a , b ,  c")).toEqual(["a", "b", "c"]);
  });

  it("drops empty fragments from trailing or doubled commas", () => {
    expect(parseTagsInput("a, ,b,")).toEqual(["a", "b"]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseTagsInput("")).toEqual([]);
    expect(parseTagsInput("   ")).toEqual([]);
  });
});
