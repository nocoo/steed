import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    extends: "packages/shared/vitest.config.ts",
    test: {
      root: "packages/shared",
    },
  },
  {
    extends: "packages/worker/vitest.config.ts",
    test: {
      root: "packages/worker",
    },
  },
]);
