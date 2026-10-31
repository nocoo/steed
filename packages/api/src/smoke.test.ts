import { describe, it, expect } from "vitest";
import { CONNECT_OPERATIONS, diagramSchema, userProfileSchema } from "./shared/index";

describe("@steed/api", () => {
  it("exports the shared diagram, Connect and profile contracts", () => {
    expect(diagramSchema).toBeDefined();
    expect(CONNECT_OPERATIONS.length).toBeGreaterThan(0);
    expect(userProfileSchema).toBeDefined();
  });
});
