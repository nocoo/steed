import { describe, it, expect } from "vitest";
import { VERSION as clientVersion } from "./client/index";
import { WorkerApiError, createWorkerClient } from "./server/index";
import { VERSION as sharedVersion } from "./shared/index";

describe("@steed/api", () => {
  it("exports client module", () => {
    expect(clientVersion).toBe("0.0.1");
  });

  it("exports server module", () => {
    expect(WorkerApiError).toBeDefined();
    expect(createWorkerClient).toBeDefined();
  });

  it("exports shared module", () => {
    expect(sharedVersion).toBe("0.0.1");
  });
});
