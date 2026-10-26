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

test("card tap applies and persists immediately without touching the draft", async ({
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
  await expect(page.locator(".skin-card")).toHaveCount(3);
  await page.getByRole("button", { name: "使用冰冰冰" }).click();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "ice",
  );
  await expect(market.locator(".skin-bubble,.skin-spark")).toHaveCount(0);
  await expect(market.locator(".skin-preview-stage")).toHaveCSS(
    "background-color",
    "rgb(222, 243, 255)",
  );
  await expect(market.locator(".skin-mascot")).toHaveAttribute(
    "data-motion",
    "idle",
  );
  await expect(
    market.getByRole("button", { name: "使用冰冰冰" }),
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
    "ice",
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
  await expect(page.locator(".world-skin-art [alt='冰冰冰']")).toBeVisible();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  await expect(page.locator(".ddl-head img")).toHaveAttribute("alt", "冰冰冰");
  await expect(page.locator(".ddl-head img")).toHaveAttribute(
    "src",
    /ice\.png$/,
  );
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "使用小鲸鱼" }).click();
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  await expect(page.locator(".ddl-head img")).toHaveAttribute("alt", "小鲸鱼");

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
  await page.getByRole("button", { name: "使用测试小伙伴" }).click();
  await expect(
    page.getByRole("button", { name: "使用测试小伙伴" }),
  ).toBeVisible();
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
    page.getByRole("button", { name: "使用新的名字" }),
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
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.includes("skins-v1"))
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "使用冰冰冰" }).click();
  await expect(page.getByRole("alert")).toContainText("本机空间不足或无法保存");
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "whale",
  );
  await page.reload();
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "使用冰冰冰" }).click();
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
    "ice",
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
  for (const name of ["小鲸鱼", "冰冰冰"]) {
    await page.getByRole("button", { name: `使用${name}` }).click();
    await expect(
      page
        .locator(".skin-preview-panel")
        .getByRole("img", { name, exact: true }),
    ).toBeVisible();
    expect(
      await market.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "和冰冰冰打个招呼" }).click();
  await expect(
    page.locator(".bucket-drawing .skin-bubble,.bucket-drawing .skin-spark"),
  ).toHaveCount(0);
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
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-motion",
    "idle",
  );
  await expect(page.locator(".count-line b")).toHaveText("1");
});

test("ice voices decode as single short utterances, switch and persist with no overlap", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).__plays = [];
    HTMLMediaElement.prototype.play = async function () {
      (window as any).__plays.push({
        src: this.src,
        time: this.currentTime,
        loop: this.loop,
      });
    };
  });
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "使用冰冰冰" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "声音二", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  const tap = page.getByRole("button", { name: "和冰冰冰打个招呼" }).last();
  await tap.click();
  await page.getByRole("button", { name: "声音二", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "声音二", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await tap.click();
  await tap.click();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-motion",
    "idle",
  );
  await expect(
    page.locator(".bucket-drawing .skin-bubble,.bucket-drawing .skin-spark"),
  ).toHaveCount(0);
  await expect(page.locator(".bucket-drawing .skin-art")).toHaveCSS(
    "filter",
    "none",
  );
  await expect(page.locator(".bucket-drawing .skin-body")).toHaveCSS(
    "animation-name",
    "none",
  );
  const plays = await page.evaluate(() => (window as any).__plays);
  expect(plays.map((p: any) => p.src.split("/").at(-1))).toEqual([
    "ice-voice-1.mp3",
    "ice-voice-2.mp3",
    "ice-voice-2.mp3",
  ]);
  expect(plays.every((p: any) => p.time === 0 && !p.loop)).toBe(true);
  const durations = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    return Promise.all(
      ["ice-voice-1.mp3", "ice-voice-2.mp3"].map(async (name) => {
        const response = await fetch("/" + name);
        const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
        const samples = decoded.getChannelData(0);
        let squares = 0;
        for (const sample of samples) squares += sample * sample;
        if (Math.sqrt(squares / samples.length) < 0.01)
          throw Error(name + " is silent");
        return decoded.duration;
      }),
    );
  });
  expect(durations[0]).toBeCloseTo(1, 1);
  expect(durations[1]).toBeCloseTo(0.73, 1);
  await page.reload();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "ice",
  );
  await expect(
    page.getByRole("button", { name: "声音二", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("switching skins keeps the market frame stable and whale has no feed demo", async ({
  page,
}) => {
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  const market = page.getByRole("dialog");
  const before = await market.boundingBox();
  await expect(market.getByRole("button", { name: "试着喂一口" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "使用冰冰冰" }).click();
  const after = await market.boundingBox();
  expect(after!.width).toBeCloseTo(before!.width, 0);
  expect(after!.height).toBeCloseTo(before!.height, 0);
  expect(after!.y).toBeCloseTo(before!.y, 0);
});

test("ice itself stays centered with voice buttons independently on the right", async ({
  page,
}) => {
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "使用冰冰冰" }).click();
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  const ice = await page.locator(".bucket-drawing .skin-art").boundingBox();
  const hero = await page.locator(".bucket-intro").boundingBox();
  const controls = await page.locator(".ice-home-voices").boundingBox();
  expect(
    Math.abs(ice!.x + ice!.width / 2 - hero!.x - hero!.width / 2),
  ).toBeLessThan(1);
  expect(controls!.x).toBeGreaterThan(ice!.x + ice!.width - 8);
  expect(controls!.x + controls!.width).toBeLessThanOrEqual(
    await page.evaluate(() => innerWidth),
  );
});
