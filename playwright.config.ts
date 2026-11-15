import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.SHIXU_E2E_PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("INVALID_E2E_PORT");
const baseURL = `http://localhost:${port}`;
const channel = process.env.CI ? undefined : "msedge";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: [
        "**/apple.spec.ts",
        "**/admin-test.spec.ts",
        "**/admin-touch.spec.ts",
        "**/admin-console.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
        channel,
        viewport: { width: 1440, height: 1080 },
      },
    },
    {
      name: "mobile",
      testIgnore: [
        "**/apple.spec.ts",
        "**/admin-test.spec.ts",
        "**/admin-touch.spec.ts",
        "**/admin-console.spec.ts",
      ],
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel },
    },
    {
      name: "admin-iphone",
      testMatch: "**/admin-test.spec.ts",
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
        channel: undefined,
      },
    },
    {
      name: "admin-touch",
      testMatch: "**/admin-touch.spec.ts",
      use: { ...devices["iPhone 13"], browserName: "chromium", channel },
    },
    {
      name: "admin-console",
      testMatch: "**/admin-console.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        channel,
      },
    },
    ...["iPhone 13", "iPad (gen 7)", "iPad (gen 7) landscape"].map(
      (device) => ({
        name: device,
        testMatch: "**/apple.spec.ts",
        use: {
          ...devices[device],
          browserName: "webkit" as const,
          channel: undefined,
        },
      }),
    ),
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !process.env.SHIXU_E2E_PORT,
    timeout: 30000,
  },
});
