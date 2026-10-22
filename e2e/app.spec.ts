import { test, expect } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";

test("capture, confirm, finish, restore and persist a Chinese task", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "你好，同学。" }),
  ).toBeVisible();
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "随手记一笔", exact: true })
      .last()
      .click();
  else
    await page.getByRole("button", { name: "新建记录", exact: true }).click();
  await page
    .getByLabel("待整理的内容")
    .fill(
      "明天下午 3 点提交高数作业 #学习\n每天读书 20 分钟\n灵感：校园旧书地图",
    );
  await page.getByRole("button", { name: "本机提取整理", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "整理好了，来确认一下" }),
  ).toBeVisible();
  await expect(page.getByText("本机规则提取 · 3 条")).toBeVisible();
  await page.getByRole("button", { name: "确认并收纳", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await page.getByLabel("搜索全部事项").fill("高数作业");
  await expect(page.locator(".entry-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "完成：明天下午 3 点提交高数作业" })
    .click();
  await expect(page.locator(".entry-row")).toHaveClass(/is-done/);
  await page
    .getByRole("button", { name: "取消完成：明天下午 3 点提交高数作业" })
    .click();
  await page.locator(".entry-main").click();
  await expect(page.getByLabel("时间", { exact: true })).toHaveValue("15:00");
  await page.getByLabel("标题", { exact: true }).fill("测试后的高数作业");
  await page.getByLabel("标签", { exact: true }).fill("");
  await page.getByLabel("标签", { exact: true }).pressSequentially("学习，生活");
  await expect(page.getByLabel("标签", { exact: true })).toHaveValue("学习，生活");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await page.getByLabel("搜索全部事项").fill("测试后的高数作业");
  await expect(page.locator(".entry-row")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("demo layout is responsive and habits can be checked", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "体验示例空间" }).click();
  await expect(
    page.getByText("完成线性代数第三章习题", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "打卡：每天读 20 分钟", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "打卡：每天读 20 分钟", exact: true }),
  ).toHaveClass(/checked/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${info.project.name}-overview.png`,
    fullPage: true,
  });
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "展开导航" }).click();
  }
  await page.getByRole("button", { name: "灵感花园", exact: true }).click();
  await page.locator(".idea-card").click();
  await page.getByRole("button", { name: "生成思考提纲" }).click();
  await expect(page.locator(".expansion")).toContainText("思考");
  await page.getByRole("button", { name: "附加到内容中" }).click();
  await page.getByRole("button", { name: "保存修改" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("text files stay local and cloud setup rejects secret keys", async ({
  page,
}, info) => {
  await page.goto("/");
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "随手记一笔", exact: true })
      .last()
      .click();
  else await page.getByRole("button", { name: "新建记录" }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "class-notice.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("通知：下周三 15:00 召开小组会议。请提交项目提纲。"),
    });
  await expect(page.getByLabel("待整理的内容")).toContainText("下周三");
  await page.getByRole("button", { name: "本机提取整理", exact: true }).click();
  await expect(page.getByText("本机规则提取 · 2 条")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "展开导航" }).click();
  await page.getByRole("button", { name: "设置与数据", exact: true }).click();
  await page.getByRole("tab", { name: "登录与同步" }).click();
  await page.getByLabel("Supabase 项目 URL").fill("https://test.supabase.co");
  await page
    .getByLabel("Publishable / anon 公钥")
    .fill("sb_secret_NOT_A_REAL_KEY");
  await page.getByLabel("邮箱", { exact: true }).fill("example@example.test");
  await page.getByLabel("密码", { exact: true }).fill("not-a-real-password");
  await page.getByRole("button", { name: "登录并开启同步" }).click();
  await expect(page.getByRole("status")).toContainText("不能使用");
});

test("extracts DOCX and PDF text in the browser", async ({ page }, info) => {
  await page.goto("/");
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "随手记一笔", exact: true })
      .last()
      .click();
  else await page.getByRole("button", { name: "新建记录" }).click();
  const document =
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>明天提交课程作业</w:t></w:r></w:p></w:body></w:document>';
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "fixture.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from(zipSync({ "word/document.xml": strToU8(document) })),
    });
  await expect(page.getByLabel("待整理的内容")).toHaveValue("明天提交课程作业");
  const stream =
    "BT /F1 18 Tf 40 180 Td (Class notice: submit project on Friday.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 250] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => String(o).padStart(10, "0") + " 00000 n ")
    .join(
      "\n",
    )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "fixture.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(pdf),
    });
  await expect(page.getByLabel("待整理的内容")).toContainText(
    "submit project on Friday",
  );
});

test("two devices exchange entries and logging out returns to a separate local space", async ({
  browser,
}, info) => {
  test.skip(
    info.project.name === "mobile",
    "Desktop test covers the shared sync logic",
  );
  const remote = new Map<string, Record<string, string>>();
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  for (const context of contexts) {
    await context.route(
      "https://sync-fixture.supabase.co/**",
      async (route) => {
        if (route.request().method() === "OPTIONS")
          return route.fulfill({
            status: 200,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-headers": "*",
            },
          });
        if (route.request().url().includes("/auth/v1/logout"))
          return route.fulfill({ status: 204 });
        if (route.request().url().includes("/auth/"))
          return route.fulfill({
            json: {
              access_token: "fixture-token",
              refresh_token: "fixture-refresh",
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user: { id: "fixture-account", email: "example@example.test" },
            },
          });
        const incoming = route.request().postDataJSON().incoming as Record<
          string,
          string
        >[];
        for (const e of incoming)
          if (!remote.has(e.id) || e.updatedAt > remote.get(e.id)!.updatedAt)
            remote.set(e.id, e);
        return route.fulfill({
          json: [...remote.values()].map((payload) => ({ payload })),
        });
      },
    );
  }
  const [one, two] = await Promise.all(contexts.map((c) => c.newPage()));
  async function login(page: typeof one) {
    await page.goto("http://localhost:5173");
    await page.getByRole("button", { name: "设置与数据", exact: true }).click();
    await page.getByRole("tab", { name: "登录与同步" }).click();
    await page
      .getByLabel("Supabase 项目 URL")
      .fill("https://sync-fixture.supabase.co");
    await page
      .getByLabel("Publishable / anon 公钥")
      .fill("sb_publishable_fixture");
    await page.getByLabel("邮箱", { exact: true }).fill("example@example.test");
    await page.getByLabel("密码", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "登录并开启同步" }).click();
    await expect(
      page.getByRole("heading", { name: "example@example.test", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
  }
  await login(one);
  await one.getByRole("button", { name: "新建记录" }).click();
  await one.getByLabel("待整理的内容").fill("明天提交跨设备测试作业");
  await one.getByRole("button", { name: "本机提取整理", exact: true }).click();
  await one.getByRole("button", { name: "确认并收纳", exact: true }).click();
  await expect.poll(() => remote.size).toBe(1);
  await login(two);
  await two.getByLabel("搜索全部事项").fill("跨设备测试");
  await expect(two.locator(".entry-row")).toHaveCount(1);
  await two.getByRole("button", { name: "设置与数据", exact: true }).click();
  await two.getByRole("tab", { name: "登录与同步" }).click();
  await two.getByRole("button", { name: "退出登录", exact: true }).click();
  await two.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(two.locator(".entry-row")).toHaveCount(0);
  await Promise.all(contexts.map((c) => c.close()));
});
