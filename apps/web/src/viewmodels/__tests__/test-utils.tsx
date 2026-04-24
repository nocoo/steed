import { vi } from "vitest";
import type { ApiClient } from "@steed/api/client";

export function createMockApiClient(): ApiClient {
  return {
    overview: {
      get: vi.fn(),
    },
    hosts: {
      list: vi.fn(),
    },
    lanes: {
      list: vi.fn(),
    },
    agents: {
      list: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      listBindings: vi.fn(),
    },
    dataSources: {
      list: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      setLanes: vi.fn(),
    },
    bindings: {
      list: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    map: {
      get: vi.fn(),
    },
  };
}
