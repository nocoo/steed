import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      "packages/api",
      "apps/web",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "packages/*/src/**/*.{ts,tsx}",
        "apps/web/src/**/*.{ts,tsx}",
        "apps/web/worker/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "packages/*/src/**/index.ts",
        "apps/web/src/**/index.ts",
        "apps/web/src/main.tsx",
        "apps/web/src/vite-env.d.ts",
        "apps/web/worker/bindings.d.ts",
        "apps/web/worker/__tests__/**",
        "**/test-setup.ts",
      ],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
