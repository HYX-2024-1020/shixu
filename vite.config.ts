import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: { include: ["src/**/*.test.ts"] },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
