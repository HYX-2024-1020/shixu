import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const webRoot = resolve(repoRoot, "apps/web");

function toFsUrl(absPath: string) {
  const posixPath = absPath.replaceAll("\\", "/");
  return posixPath.startsWith("/") ? `/@fs${posixPath}` : `/@fs/${posixPath}`;
}

export default defineConfig(({ mode }) => ({
  root: webRoot,
  envDir: repoRoot,
  base: loadEnv(mode, repoRoot, "VITE_").VITE_BASE_PATH || "/",
  plugins: [
    react(),
    {
      name: "shixu-dev-boundaries-and-fixtures",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = (req.url || "").split("?")[0];
          if (/^\/(?:\.private|release|data)(?:\/|$)/.test(pathname)) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }
          if (pathname === "/tests/e2e/fixtures/account-settings.html") {
            const htmlPath = resolve(repoRoot, "tests/e2e/fixtures/account-settings.html");
            const entryPath = resolve(repoRoot, "tests/e2e/fixtures/account-settings.tsx");
            const raw = readFileSync(htmlPath, "utf8").replace(
              "/tests/e2e/fixtures/account-settings.tsx",
              toFsUrl(entryPath),
            );
            const transformed = await server.transformIndexHtml(req.url!, raw);
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(transformed);
            return;
          }
          next();
        });
      },
    },
  ],
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
