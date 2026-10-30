import { defineConfig, devices } from "@playwright/test";
const channel = process.env.CI ? undefined : "msedge";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: ["**/apple.spec.ts", "**/admin-test.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel,
        viewport: { width: 1440, height: 1080 },
      },
    },
    {
      name: "mobile",
      testIgnore: ["**/apple.spec.ts", "**/admin-test.spec.ts"],
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
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
