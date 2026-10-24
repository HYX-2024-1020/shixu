import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, body: "unavailable" }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "往桶里放入内容" }),
  ).toBeEnabled();
});

test("preview, interact, apply and persist a preset without touching the draft", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("textbox", { name: "往桶里放入内容" })
    .fill("保留在桶里的草稿");
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  const market = page.getByRole("dialog", { name: "给你的桶，换个新朋友" });
  await expect(market).toBeVisible();
  await expect(page.locator(".skin-card")).toHaveCount(8);
  await page.getByRole("button", { name: "预览摸鱼小橘" }).click();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "whale",
  );
  await market.getByRole("button", { name: "和摸鱼小橘打个招呼" }).click();
  await expect(market.locator(".skin-bubble")).toHaveText(
    "呼噜呼噜，摸到我啦！",
  );
  await expect(market.locator(".skin-mascot")).toHaveAttribute(
    "data-motion",
    "wiggle",
  );
  await market.getByRole("button", { name: "试着喂一口" }).click();
  await expect(market.locator(".skin-bubble")).toHaveText(
    "啊呜，这口是小鱼干味的！",
  );
  await market.getByRole("button", { name: "就选这个朋友" }).click();
  await expect(
    market.getByRole("button", { name: "正在陪伴你" }),
  ).toBeDisabled();
  await expect(
    market.getByRole("button", { name: "预览摸鱼小橘" }),
  ).toContainText("使用中");
  await page.evaluate(() => document.fonts.ready);
  await market.screenshot({
    path: info.outputPath("skin-market.png"),
  });
  const overflow = await market.evaluate(
    (el) => el.scrollWidth > el.clientWidth + 1,
  );
  expect(overflow).toBe(false);
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  await expect(
    page.getByRole("button", { name: "打开皮肤市场" }),
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "往桶里放入内容" }),
  ).toHaveValue("保留在桶里的草稿");
  // The app debounces autosave for 400 ms. Observe its committed draft rather
  // than letting fast mobile actions reload before the save has started.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const storeUrl = "/src/bucket/store.ts";
        const store = await import(storeUrl);
        return (await store.readDraft()).text;
      }),
    )
    .toBe("保留在桶里的草稿");
  await page.reload();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "cat",
  );
  await expect(
    page.getByRole("textbox", { name: "往桶里放入内容" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("textbox", { name: "往桶里放入内容" }),
  ).toHaveValue("保留在桶里的草稿");
  await page.screenshot({
    path: info.outputPath("skin-home.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await expect(
    page.locator(".world-skin-art [aria-label='摸鱼小橘']"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("create, edit, reload and remove an equipped custom skin", async ({
  page,
}, info) => {
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "自己做一个", exact: true }).click();
  await page.getByLabel("上传皮肤图片", { exact: true }).setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "这张图片无法读取，请换一张图片试试",
  );
  await page
    .getByLabel("上传皮肤图片", { exact: true })
    .setInputFiles("public/mascot.png");
  await expect(page.getByRole("button", { name: "换一张图片" })).toBeEnabled();
  await page.getByLabel("伙伴的名字", { exact: true }).fill("测试小伙伴");
  await page
    .getByLabel("平时说什么", { exact: true })
    .fill("你好，我来接住你。");
  await page
    .getByLabel("被戳到时说什么", { exact: true })
    .fill("转一圈，开心！");
  await page
    .getByLabel("吃到东西时说什么", { exact: true })
    .fill("啊呜，接住了！");
  await page.getByRole("button", { name: "转个圈圈", exact: true }).click();
  await page.getByRole("button", { name: "和测试小伙伴打个招呼" }).click();
  await expect(page.locator(".skin-market .skin-mascot")).toHaveAttribute(
    "data-motion",
    "spin",
  );
  await page.screenshot({
    path: info.outputPath("skin-editor.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "保存到我的收藏" }).click();
  await expect(
    page.getByRole("button", { name: "预览测试小伙伴" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "就选这个朋友" }).click();
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  await page.reload();
  await expect(page.locator(".bucket-drawing .skin-art")).toHaveAttribute(
    "src",
    /^data:image\/webp;base64,/,
  );
  await expect(page.locator(".bucket-drawing .skin-bubble")).toHaveText(
    "你好，我来接住你。",
  );
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "编辑皮肤", exact: true }).click();
  await page.getByLabel("伙伴的名字", { exact: true }).fill("新的名字");
  await page.getByRole("button", { name: "保存到我的收藏" }).click();
  await expect(
    page.getByRole("button", { name: "预览新的名字" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  await page.reload();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "whale",
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("shixu-bucket-skins-v1")!).custom,
    ),
  ).toEqual([]);
});

test("storage errors keep the applied skin and example space stays isolated", async ({
  page,
}) => {
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "预览小小宇宙" }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.includes("skins-v1"))
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "就选这个朋友" }).click();
  await expect(page.getByRole("alert")).toContainText("本机空间不足或无法保存");
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "whale",
  );
  await page.reload();
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "预览小小宇宙" }).click();
  await page.getByRole("button", { name: "就选这个朋友" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/?preview=bucket");
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "whale",
  );
  await page.goto("/");
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "planet",
  );
});

test("all presets work on a narrow screen, reduced motion and actual delivery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  const market = page.getByRole("dialog");
  for (const name of [
    "小鲸鱼",
    "摸鱼小橘",
    "发芽计划",
    "罐头同学",
    "幽幽",
    "迟到小兔",
    "小小宇宙",
    "布丁吨吨",
  ]) {
    await page.getByRole("button", { name: `预览${name}` }).click();
    await expect(
      page
        .locator(".skin-preview-panel")
        .getByRole("img", { name, exact: true }),
    ).toBeVisible();
    expect(
      await market.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "就选这个朋友" }).click();
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "和布丁吨吨打个招呼" }).click();
  await expect(page.locator(".bucket-drawing .skin-bubble")).toHaveText(
    "晃呀晃，快乐加倍！",
  );
  expect(
    await page
      .locator(".bucket-drawing .skin-body")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page
    .getByRole("textbox", { name: "往桶里放入内容" })
    .fill("测试离线投递，只在本机保存");
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await expect(page.locator(".bucket-drawing .skin-bubble")).toHaveText(
    "吨吨吨，又吃掉一件事。",
  );
  await expect(page.locator(".count-line b")).toHaveText("1");
});
