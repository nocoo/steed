import { describe, it, expect } from "vitest";
import { createApiClient, ApiHttpError as ClientApiHttpError } from "./client/index";
import { WorkerApiError, createWorkerClient } from "./server/index";
import { laneIdSchema, buildGraph } from "./shared/index";

describe("@steed/api", () => {
  it("exports client module", () => {
    expect(createApiClient).toBeDefined();
    expect(ClientApiHttpError).toBeDefined();
  });

  it("exports server module", () => {
    expect(WorkerApiError).toBeDefined();
    expect(createWorkerClient).toBeDefined();
  });

  it("exports shared module", () => {
    expect(laneIdSchema).toBeDefined();
    expect(buildGraph).toBeDefined();
  });
});
