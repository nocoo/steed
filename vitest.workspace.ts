import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared",
  "packages/worker",
  "packages/cli",
  "packages/api",
  "apps/web",
  // web_legacy excluded from default test chain
]);
