import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/shared",
      "packages/worker",
      "packages/cli",
      "packages/api",
      "apps/web",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/web_legacy/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "packages/*/src/**/*.{ts,tsx}",
        "apps/web/src/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/index.ts",
        "apps/web_legacy/**",
        "apps/web/src/main.tsx",
        "apps/web/src/vite-env.d.ts",
        "packages/cli/src/bin/**",
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
