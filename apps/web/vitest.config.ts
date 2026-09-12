import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "worker/**/*.test.ts"],
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    environmentMatchGlobs: [
      ["worker/**/*.test.ts", "node"],
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}", "worker/**/*.ts"],
      exclude: ["**/*.test.{ts,tsx}", "**/index.ts", "**/test-setup.ts", "**/main.tsx", "worker/__tests__/**"],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 85,
        lines: 90,
      },
    },
  },
});
