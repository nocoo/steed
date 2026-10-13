import { defineConfig, defineProject } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as { version: string };

const shared = {
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
};

const coverage = {
  provider: "v8" as const,
  reporter: ["text", "json-summary"],
  include: ["src/**/*.{ts,tsx}", "worker/**/*.ts"],
  exclude: ["**/*.test.{ts,tsx}", "**/index.ts", "**/test-setup.ts", "**/main.tsx", "worker/__tests__/**"],
  thresholds: {
    statements: 90,
    branches: 85,
    functions: 85,
    lines: 90,
  },
};

export default defineConfig({
  ...shared,
  test: {
    coverage,
    projects: [
      defineProject({
        extends: false,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./src/test-setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
        },
        ...shared,
      }),
      defineProject({
        extends: false,
        test: {
          name: "worker",
          environment: "node",
          include: ["worker/**/*.test.ts"],
        },
        resolve: shared.resolve,
        define: shared.define,
      }),
    ],
  },
});
