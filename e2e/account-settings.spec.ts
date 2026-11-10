import { test, expect } from "@playwright/test";

async function openSettings(page, connected = false) {
  await page.addInitScript(
    ({ connected }) => {
      const state = {
        base: connected ? "account:synthetic" : "",
        pending: 0,
        conflicts: [],
        error: "",
        activation: connected ? "active" : "local",
        capabilities: { features: { registration: true } },
        devices: [],
        jobs: [],
        account: connected
          ? {
              authentication: {
                version: 4,
                claimed: true,
                username: "fixture-user",
              },
              ai: { enabled: false, usage: [], dailyLimit: 0 },
            }
          : null,
      };
      window.desktop = {
        cloud: async (name) => {
          if (name === "login" || name === "password") {
            await new Promise((resolve) => setTimeout(resolve, 500));
            throw Error(
              name === "login" ? "账号或密码不正确" : "当前密码不正确",
            );
          }
          return state;
        },
      } as any;
    },
    { connected },
  );
  await page.goto("/e2e/fixtures/account-settings.html");
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("账号登录不索要邀请码，提交反馈和错误紧邻操作并保留输入", async ({
  page,
}, info) => {
  await openSettings(page);
  await expect(page.getByLabel("注册邀请码", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "账号登录", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("请输入账号名称。", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("账号名称", { exact: true }).fill("fixture-user");
  await page.getByLabel("登录密码", { exact: true }).fill("synthetic-password");
  await page.getByLabel("登录密码", { exact: true }).press("Enter");
  await expect(
    page.getByText("正在登录并连接云空间…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".account-access form").getByRole("alert"),
  ).toContainText("账号或密码不正确");
  await expect(page.getByLabel("账号名称", { exact: true })).toHaveValue(
    "fixture-user",
  );
  await expect(page.getByLabel("登录密码", { exact: true })).toHaveValue(
    "synthetic-password",
  );
  await page.screenshot({ path: info.outputPath("login-feedback.png") });
  await page.getByRole("button", { name: "首次注册", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "账号登录", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("注册邀请码", { exact: true })).toBeVisible();
  await expect(page.getByText(/首次注册需要邀请码/)).toBeVisible();
  await page.getByLabel("注册密码", { exact: true }).fill("short");
  await expect(
    page.getByText("注册密码至少8位。", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("注册密码", { exact: true }).fill("synthetic-password");
  await page.getByLabel("注册邀请码", { exact: true }).fill("synthetic-invite");
  await expect(
    page.getByRole("button", { name: "注册新账号", exact: true }),
  ).toBeEnabled();
});

test("已连接账号清楚可见，改密使用本区当前密码并保留错误反馈", async ({
  page,
}, info) => {
  await openSettings(page, true);
  await expect(
    page.getByRole("heading", { name: "账号已连接", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/当前账号：fixture-user/)).toBeVisible();
  await expect(page.getByLabel("登录密码", { exact: true })).toHaveCount(0);
  await page.getByLabel("当前密码", { exact: true }).fill("synthetic-current");
  await page.getByLabel("新密码", { exact: true }).fill("synthetic-new");
  await page
    .getByRole("button", { name: "修改密码并撤销全部设备", exact: true })
    .click();
  const security = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "设备与密码", exact: true }),
    });
  await expect(security.getByRole("alert")).toContainText("当前密码不正确");
  await expect(page.getByLabel("当前密码", { exact: true })).toHaveValue(
    "synthetic-current",
  );
  await page.screenshot({ path: info.outputPath("password-feedback.png") });
  await page.getByRole("button", { name: "切换账号", exact: true }).click();
  await expect(page.getByLabel("账号名称", { exact: true })).toHaveValue(
    "fixture-user",
  );
  await page.getByRole("button", { name: "保留当前账号", exact: true }).click();
  await expect(page.getByLabel("账号名称", { exact: true })).toHaveCount(0);
});
