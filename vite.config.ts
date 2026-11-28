import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const webRoot = resolve(repoRoot, "apps/web");

export default defineConfig(({ mode }) => ({
  root: webRoot,
  envDir: repoRoot,
  base: loadEnv(mode, repoRoot, "VITE_").VITE_BASE_PATH || "/",
  plugins: [react()],
  build: {
    outDir: resolve(repoRoot, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(webRoot, "index.html"),
        admin: resolve(webRoot, "admin-test/index.html"),
        console: resolve(webRoot, "admin/index.html"),
      },
    },
  },
  test: { include: ["src/**/*.test.{ts,js}"] },
  // Evidence copies and browser traces can hold Windows file locks. They are
  // not application sources and must not bring down the HMR file watcher.
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        "**/.private/**",
        "**/release/**",
        "**/data/**",
        "**/docs/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
    fs: {
      allow: [repoRoot],
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/.private/**",
        "**/release/**",
        "**/data/**",
      ],
    },
  },
  preview: { port: 4173, strictPort: true },
}));
