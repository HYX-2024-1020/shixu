import { expect, test } from "@playwright/test";

/**
 * 管理台（E 阶段首批：服务总览 + 用户管理）浏览器回归。
 * 全部使用合成数据适配层（默认 source=synthetic），不触真实后端。
 */

const DEMO_USER = "admin";
const DEMO_PASS = "admin-demo";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/admin/");
  await page.fill('input[autocomplete="username"]', DEMO_USER);
  await page.fill('input[type="password"]', DEMO_PASS);
  await page.click('button[type="submit"]');
  await expect(page.getByRole("heading", { name: "服务总览" })).toBeVisible({ timeout: 10_000 });
}

test("登录失败保留输入，成功后进入总览", async ({ page }) => {
  await page.goto("/admin/");
  await page.fill('input[autocomplete="username"]', DEMO_USER);
  await page.fill('input[type="password"]', "wrong");
  await page.click('button[type="submit"]');
  await expect(page.getByText("账号或密码不正确")).toBeVisible();
  // 失败不清空用户输入
  await expect(page.locator('input[autocomplete="username"]')).toHaveValue(DEMO_USER);

  await page.fill('input[type="password"]', DEMO_PASS);
  await page.click('button[type="submit"]');
  await expect(page.getByRole("heading", { name: "服务总览" })).toBeVisible();
  // 演示数据标识可见
  await expect(page.getByText("演示数据 · 未连接后端")).toBeVisible();
});

test("总览渲染需要处理的问题、服务状态、费用与备份", async ({ page }) => {
  await login(page);
  await expect(page.getByText("需要处理").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "服务状态" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "任务队列" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "费用" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "备份" })).toBeVisible();
  // 金额带 ¥ 单位，时间标注北京时间
  await expect(page.getByText("¥").first()).toBeVisible();
  await expect(page.getByText(/北京时间/).first()).toBeVisible();
});

test("用户列表 → 详情 → 追加额度（幂等确认后余额更新）", async ({ page }) => {
  await login(page);
  await page.click('a[href="#/users"]');
  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow).toContainText("chen.li");
  await firstRow.click();

  const drawer = page.locator(".drawer");
  await expect(drawer).toContainText("累计额度");
  await expect(drawer).toContainText("¥50.00");

  // 追加额度：确认文案必须区分供应商充值
  await drawer.getByRole("button", { name: "追加额度" }).click();
  const dialog = page.locator(".dialog");
  await expect(dialog).toContainText("与 DeepSeek 供应商账户充值无关");
  await dialog.getByRole("button", { name: "确认追加" }).click();
  await expect(page.locator(".toast-ok").first()).toBeVisible();
  // 余额 36.40 + 10 = 46.40
  await expect(drawer.getByText("¥46.40")).toBeVisible();
});

test("会话失效自动回到登录页并提示", async ({ page }) => {
  await login(page);
  await page.click(".demo-console summary");
  await page.locator(".demo-console input[type=checkbox]").nth(3).check();
  await page.click('a[href="#/users"]');
  await expect(page.getByText("会话已过期，请重新登录后继续")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test("窄屏下导航与总览单列可读", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 860 });
  await login(page);
  await expect(page.locator(".side")).toBeVisible();
  await expect(page.locator(".metrics .metric").first()).toBeVisible();
});
