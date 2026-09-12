import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    host: "127.0.0.1",
    port: 7035,
    strictPort: true,
    allowedHosts: ["steed.dev.hexly.ai"],
    proxy: {
      "/api": {
        target: process.env.STEED_API_PROXY ?? "http://127.0.0.1:37035",
        changeOrigin: false,
      },
    },
  },
});
