import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared",
  "packages/worker",
  // dashboard runs separately due to jsdom environment requirement
]);
