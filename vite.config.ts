import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, ".", "VITE_").VITE_BASE_PATH || "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { main: "index.html", admin: "admin-test/index.html" },
    },
  },
  test: { include: ["src/**/*.test.{ts,js}"] },
  // Evidence copies and browser traces can hold Windows file locks. They are
  // not application sources and must not bring down the HMR file watcher.
  server: { port: 5173, strictPort: true, watch: { ignored: ["**/.private/**", "**/data/**", "**/docs/**", "**/test-results/**", "**/playwright-report/**"] } },
  preview: { port: 4173, strictPort: true },
}));
