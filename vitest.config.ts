import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "packages/dashboard/**", // Dashboard tests run separately with jsdom
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "packages/shared/src/**/*.ts",
        "packages/worker/src/**/*.ts",
        "packages/cli/src/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/index.ts", "**/test-helpers.ts"],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 85,
        lines: 90,
      },
    },
  },
});
