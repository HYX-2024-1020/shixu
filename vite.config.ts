import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, ".", "VITE_").VITE_BASE_PATH || "/",
  plugins: [react()],
  test: { include: ["src/**/*.test.{ts,js}"] },
  server: { port: 5173, strictPort: true, watch: { ignored: ["**/.private/**", "**/data/**"] } },
  preview: { port: 4173, strictPort: true },
}));
