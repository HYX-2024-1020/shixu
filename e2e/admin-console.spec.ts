import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import {
  createAdminService,
  hashAdminPassword,
} from "../server/admin-service.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountRegistry } from "../server/sync-accounts.mjs";
import { AccountsV4 } from "../server/accounts-v4.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
import { AdminBackend } from "../server/admin-backend.mjs";
import { createConsoleGateway } from "../server/console-gateway.mjs";
import { createRequire } from "node:module";
import { readMaterial } from "../server/reading/material.mjs";
import {
  accountUIFixture,
  fixtureItem,
} from "../scripts/account-ui-fixture.mjs";

/**
 * 管理台浏览器回归：明确区分合成适配层与真实HTTP/数据库的隔离夹具。
 * 不接触生产账号或真实模型。
 */

const DEMO_USER = "admin";
const DEMO_PASS = "admin-demo";

test("真实账号、任务、预算与备份队列在同一管理界面连贯可用", async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), "shixu-console-product-"));
  const ledger = new ReadingLedger(join(root, "ledger.sqlite"));
  ledger.freezePrice({
    id: "synthetic",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic UI",
    verifiedAt: 1,
    inputMicrosPerMillion: 1,
    cachedMicrosPerMillion: 0,
    outputMicrosPerMillion: 1,
  });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = await accountUIFixture(
    {},
    {
      reading: {
        enabled: true,
        credentials: true,
        accountSafety: true,
        tenantSafety: true,
        ledger,
        priceId: "synthetic",
        modelVersion: "synthetic",
        reader: readMaterial,
        provider: async (sources, signal) => {
          signal.addEventListener("abort", release, { once: true });
          entered();
          await held;
          return {
            usage: { prompt_tokens: 10, completion_tokens: 10 },
            result: {
              summary: "合成摘要",
              warnings: [],
              items: [fixtureItem()],
            },
          };
        },
      },
    },
  );
  const require = createRequire(import.meta.url),
    { AccountWorkspace } = require("../desktop/accounts.cjs"),
    { DesktopStore } = require("../desktop/storage.cjs");
  const client = new AccountWorkspace({
    root: join(root, "client"),
    local: new DesktopStore(join(root, "local")),
    serviceOrigin: fixture.base,
    seal: async (s) => Buffer.from(s),
    unseal: async (b) => b.toString(),
  });
  await client.init();
  await client.action("register", {
    username: "product-owner",
    password: "synthetic-password",
    invite: fixture.invitation.invite,
    deviceName: "合成Windows",
  });
  const account = fixture.invitation.userId;
  await client.call(
    "savePackets",
    [
      {
        id: "product-task",
        text: "请于明天下午提交合成报告",
        sources: [],
        attachments: [],
        doneIds: [],
        capturedAt: "2026-11-11T00:00:00Z",
        captureDate: "2026-11-11",
        updatedAt: "2026-11-11T00:00:00Z",
        result: null,
        status: "pending",
      },
    ],
    client.config.active,
  );
  await client.action("sync");
  const task = await client.action("ai", {
    kind: "organize",
    packetId: "product-task",
  });
  await started;
  const backend = new AdminBackend({
    path: join(root, "ops.sqlite"),
    registry: fixture.service.registry,
    credentials: fixture.service.credentials,
    ledger,
    routes: fixture.service.readingRoutes,
    directory: join(fixture.root, "server"),
  });
  backend.cloudOperations.setInventory({
    sampledAt: new Date().toISOString(),
    releaseId: "synthetic-verified-release",
    releases: [],
    snapshots: [],
    storage: {
      dataTreeBytes: 0,
      authorityBytes: 0,
      backupBytes: 0,
      temporaryBytes: 0,
      systemJournalBytes: 0,
    },
  });
  const password = "synthetic-admin-password",
    service = createAdminService({
      username: "test-admin",
      passwordHash: await hashAdminPassword(password),
      backend,
    }),
    upstream = await service.listen(0),
    gateway = createConsoleGateway({
      staticDirectory: resolve("dist"),
      upstreamOrigin: upstream,
    }),
    origin = await gateway.listen(0);
  try {
    await page.goto(origin + "/admin/");
    await page.getByRole("textbox", { name: "管理员账号" }).fill("test-admin");
    await page.locator("input[type=password]").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("link", { name: "用户管理", exact: true }).click();
    await page.locator("tbody tr").filter({ hasText: "product-owner" }).click();
    const drawer = page.locator(".drawer");
    await drawer.getByRole("button", { name: "追加额度", exact: true }).click();
    await drawer.getByLabel("追加金额（元）").fill("5");
    await drawer.getByRole("button", { name: "确认追加", exact: true }).click();
    await expect.poll(() => ledger.wallet(account).granted).toBe(25000000);
    await expect(
      drawer.locator(".wallet-cell").filter({ hasText: "累计额度" }),
    ).toContainText("25.00");
    await drawer.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("link", { name: "任务管理", exact: true }).click();
    await page
      .locator("tbody tr")
      .filter({ hasText: "product-owner" })
      .getByRole("button", { name: "查看与处置" })
      .click();
    await expect(page.getByRole("article", { name: "任务详情" })).toBeInViewport();
    await page.getByRole("article", { name: "任务详情" }).getByText("技术编号", { exact: true }).click();
    await expect(page.getByRole("article", { name: "任务详情" })).toContainText(task.job!);
    await page.getByRole("button", { name: "暂停任务", exact: true }).click();
    await page
      .locator(".inline-confirm")
      .getByRole("button", { name: "确认执行", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await client.request(
              client.config.active,
              "GET",
              "/api/v4/tasks/" + task.job,
            )
          ).state,
      )
      .toBe("paused");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.getByRole("link", { name: "运维与审计", exact: true }).click();
    await page.getByRole("button", { name: "调整预算", exact: true }).click();
    await page.getByLabel("每日上限（元）", { exact: true }).fill("40");
    await page.getByLabel("月度上限（元，留空不设）").fill("300");
    await page.getByLabel("调整原因", { exact: true }).fill("合成验收预算");
    await page
      .locator(".inline-confirm")
      .getByRole("button", { name: "确认执行", exact: true })
      .click();
    await expect.poll(() => ledger.budget().monthlyMicro).toBe(300000000);
    await page.getByRole("link", { name: "存储与备份", exact: true }).click();
    await page.getByRole("button", { name: "立即备份", exact: true }).click();
    await page
      .getByLabel("操作原因（不含密码或资料正文）")
      .fill("合成验收备份");
    await page
      .locator(".inline-confirm")
      .getByRole("button", { name: "确认执行", exact: true })
      .click();
    await expect(page.getByText(/立即备份 · 等待后台执行/)).toBeVisible();
    expect(backend.cloudOperations.jobs()[0].state).toBe("queued");
    await page.getByRole("link", { name: "用户管理", exact: true }).click();
    await page.locator("tbody tr").filter({ hasText: "product-owner" }).click();
    await drawer.getByRole("button", { name: "重置密码", exact: true }).click();
    await drawer.getByRole("button", { name: "确认重置", exact: true }).click();
    await expect(drawer.getByText(/临时密码/).first()).toBeVisible();
    await expect
      .poll(() => !!fixture.service.credentials.passwordResetState(account))
      .toBe(true);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  } finally {
    release();
    await page.goto("about:blank");
    await gateway.close();
    await service.close();
    backend.close();
    await fixture.close();
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("真实管理 HTTP 数据、行内暂停、独立告警与审计", async ({ page }) => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-console-http-"));
  const registry = new AccountRegistry(
      directory,
      "synthetic-secret-".repeat(4),
    ),
    credentials = new AccountsV4(registry),
    ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  const [{ userId, invite }] = registry.generate(1);
  await credentials.register(
    {
      username: "fixture-owner",
      password: "synthetic-password",
      invite,
      operationId: "register-console-fixture",
    },
    {
      kind: "windows",
      identity: "c".repeat(64),
      publicKey: "synthetic-only",
      name: "合成设备",
    },
    "synthetic",
  );
  ledger.grantInitial(userId);
  registry.generate(1);
  registry.pauseAI(true);
  const backend = new AdminBackend({
    path: join(directory, "ops.sqlite"),
    registry,
    ledger,
    directory,
    routes: { snapshot: () => ({ running: 0, waiting: 0 }) },
  });
  const password = "synthetic-admin-password",
    service = createAdminService({
      username: "test-admin",
      passwordHash: await hashAdminPassword(password),
      backend,
      audit: () => {},
    }),
    upstream = await service.listen(0),
    gateway = createConsoleGateway({
      staticDirectory: resolve("dist"),
      upstreamOrigin: upstream,
    }),
    origin = await gateway.listen(0);
  try {
    await page.goto(origin + "/admin/");
    await page.getByRole("textbox", { name: "管理员账号" }).fill("test-admin");
    await page.locator("input[type=password]").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "全站 AI 权限" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "暂停全站 AI" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page
      .locator(".inline-confirm")
      .getByRole("button", { name: "确认暂停" })
      .click();
    await expect(
      page.getByRole("button", { name: "恢复全站 AI" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "用户管理", exact: true }).click();
    await page.locator("tbody tr").first().click();
    await page
      .locator(".drawer")
      .getByRole("button", { name: "暂停 AI", exact: true })
      .click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page
      .locator(".inline-confirm")
      .getByRole("button", { name: "确认暂停" })
      .click();
    await expect(
      page
        .locator(".drawer")
        .getByRole("button", { name: "恢复 AI", exact: true }),
    ).toBeVisible();
    expect(ledger.wallet(userId).spent).toBe(0);
    await page
      .locator(".drawer")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.getByRole("link", { name: /告警中心/ }).click();
    await expect(
      page.getByRole("heading", { name: "告警中心", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("服务安全开关仍关闭，人工恢复不会解除此门禁"),
    ).toBeVisible();
    const safetyAlert = page
      .getByRole("article")
      .filter({ hasText: "服务安全开关仍关闭，人工恢复不会解除此门禁" });
    const unresolved =
      (await page.locator('a[href="#/alerts"]').textContent()) || "";
    await safetyAlert
      .getByRole("button", { name: "标为已读", exact: true })
      .click();
    await expect(
      safetyAlert.getByRole("button", { name: "标为已读", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('a[href="#/alerts"]')).toHaveText(unresolved);
    await page.getByRole("link", { name: "运维与审计", exact: true }).click();
    await expect(page.locator(".audit-row")).toHaveCount(3);
  } finally {
    await page.goto("about:blank");
    await gateway.close();
    await service.close();
    backend.close();
    credentials.close();
    registry.close();
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/admin/");
  await page.fill('input[autocomplete="username"]', DEMO_USER);
  await page.fill('input[type="password"]', DEMO_PASS);
  await page.click('button[type="submit"]');
  await expect(page.getByRole("heading", { name: "服务总览" })).toBeVisible({
    timeout: 10_000,
  });
}

test("登录失败保留输入，成功后进入总览", async ({ page }) => {
  await page.goto("/admin/");
  await page.fill('input[autocomplete="username"]', DEMO_USER);
  await page.fill('input[type="password"]', "wrong");
  await page.click('button[type="submit"]');
  await expect(page.getByText("账号或密码不正确")).toBeVisible();
  // 失败不清空用户输入
  await expect(page.locator('input[autocomplete="username"]')).toHaveValue(
    DEMO_USER,
  );

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
  await expect(page.getByText("会话已过期，请重新登录后继续")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test("窄屏下导航与总览单列可读", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 860 });
  await login(page);
  await expect(page.locator(".side")).toBeVisible();
  await expect(page.locator(".metrics .metric").first()).toBeVisible();
});

test("总览入口可进入完整任务列表并返回总览", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "去任务管理" }).click();
  await expect(page.getByRole("heading", { name: "任务管理" })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新任务" })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.getByRole("link", { name: "服务总览", exact: true }).click();
  await expect(page.getByRole("heading", { name: "服务总览" })).toBeVisible();
});

test("用户详情失败后可以重试，关闭加载中的抽屉不会被迟到响应打开", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "用户管理", exact: true }).click();
  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow).toContainText("chen.li");
  await page.locator(".demo-console summary").click();
  await page.getByLabel("读取持续失败").check();
  await firstRow.click();
  const drawer = page.locator(".drawer");
  await expect(drawer.getByText("加载失败")).toBeVisible();
  // 故障开关位于模态抽屉后方，此处只解除测试注入的故障。
  await page
    .getByLabel("读取持续失败")
    .evaluate((input: HTMLInputElement) => input.click());
  await drawer.getByRole("button", { name: "重试" }).click();
  await expect(drawer.getByRole("heading", { name: "chen.li" })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await page.clock.install();
  await firstRow.click();
  await expect(drawer.getByRole("status", { name: "加载中" })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await page.clock.runFor(1000);
  await expect(drawer).toHaveCount(0);
});

test("真实回环服务登录、明确显示数据待接入，退出失败后可重试", async ({
  page,
}) => {
  const password = "synthetic-admin-password";
  const service = createAdminService({
    username: "test-admin",
    passwordHash: await hashAdminPassword(password),
    staticDirectory: resolve("dist"),
    audit: () => {},
  });
  const origin = await service.listen(0);
  try {
    await page.goto(`${origin}/admin/`);
    await expect(page).toHaveURL(`${origin}/admin/?api=http`);
    await page.getByRole("textbox", { name: "管理员账号" }).fill("test-admin");
    await page.locator('input[type="password"]').fill("wrong");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByText("账号或密码不正确")).toBeVisible();
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByText("管理数据接口尚未接入，请稍后重试", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("演示数据 · 未连接后端")).toHaveCount(0);
    await page.route("**/admin/v1/logout", (route) => route.abort());
    await page.getByRole("button", { name: "退出", exact: true }).click();
    await expect(
      page.getByText("退出未完成，请重试。管理会话仍可能有效。"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "退出", exact: true }),
    ).toBeVisible();
    await page.unroute("**/admin/v1/logout");
    await page.getByRole("button", { name: "退出", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeVisible();
  } finally {
    await page.goto("about:blank");
    await service.close();
  }
});
