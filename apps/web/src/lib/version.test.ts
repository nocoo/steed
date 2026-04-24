import { describe, it, expect } from "vitest";
import { APP_VERSION } from "./version";

describe("version", () => {
  it("exports APP_VERSION", () => {
    expect(typeof APP_VERSION).toBe("string");
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
