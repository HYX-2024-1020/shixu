import { test, expect, type Page } from "@playwright/test";
async function seed(p: Page) {
  await p.goto("/admin-test/");
  await expect(p.getByLabel("往桶里放入内容")).toBeEnabled();
  await p.evaluate(async () => {
    const store = await import("/src/bucket/store.ts");
    await store.putPackets(
      Array.from({ length: 18 }, (_, i) => ({
        id: `scroll-${i}`,
        text: `合成滚动验收 ${i}`,
        sources: [{ id: "input", name: "合成输入", text: `合成滚动验收 ${i}` }],
        attachments: [],
        capturedAt: `2026-10-31T00:00:${String(i).padStart(2, "0")}Z`,
        captureDate: "2026-10-31",
        status: "ready",
        error: "",
        doneIds: [],
        updatedAt: "2026-10-31T00:00:00Z",
        itemIds: [`item-${i}`],
        association: { state: "ready", links: [], warnings: [] },
        result: {
          summary: "合成滚动验收",
          warnings: [],
          items: [
            {
              kind: "task",
              title: `滚动任务 ${i}`,
              summary:
                "这段正文用于验证手指落在卡片中间时可以上下滑动，停留后也可以继续浏览。",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              sourceIds: ["input"],
              evidence: [{ sourceId: "input", quote: `合成滚动验收 ${i}` }],
              due: {
                date: "2026-11-01",
                time: "15:00",
                anchor: "2026年11月1日15:00",
                sourceId: "input",
              },
            },
          ],
        },
      })),
    );
  });
  await p.reload();
  await p.getByRole("button", { name: "整理结果", exact: true }).click();
}
test("native touch swipes over card bodies scroll after a pause; grips still reorder and taps work", async ({
  page,
  context,
}) => {
  await seed(page);
  const cdp = await context.newCDPSession(page);
  async function gesture(x: number, y: number, dy: number, hold = 0) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    if (hold) await page.waitForTimeout(hold);
    for (let step = 1; step <= 12; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + (dy * step) / 12 }],
      });
      await page.waitForTimeout(18);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  const main = page.locator(".bucket-main");
  async function swipeBody(selector: string, hold: number) {
    const body = page.locator(selector).first();
    await body.scrollIntoViewIfNeeded();
    const box = (await body.boundingBox())!;
    const bounds = (await main.boundingBox())!;
    const x = box.x + box.width / 2,
      y = Math.min(box.y + box.height / 2, bounds.y + bounds.height - 30);
    expect(
      await page.evaluate(
        ({ x, y }) =>
          !!document.elementFromPoint(x, y)?.closest(".result-card,.ddl-item"),
        { x, y },
      ),
    ).toBe(true);
    const before = await main.evaluate((el) => el.scrollTop);
    await gesture(x, y, -150, hold);
    await expect
      .poll(() => main.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(before + 45);
    await expect(page.locator(".card-drag-preview")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await swipeBody(".results-workspace .card-open", 0);
  await swipeBody(".results-workspace .card-open", 550);
  // Sorting still uses native touch, but only from the dedicated grip.
  const cards = page.locator(".results-workspace .result-card");
  await cards.nth(1).scrollIntoViewIfNeeded();
  const old = await cards.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.motionId),
  );
  const grip = cards.nth(1).locator(".mobile-card-sort");
  const g = (await grip.boundingBox())!;
  const target = (await cards.first().boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: g.x + g.width / 2, y: g.y + g.height / 2 }],
  });
  await expect(page.locator(".card-drag-preview")).toHaveCount(1);
  const tx = target.x + target.width / 2,
    ty = Math.max(target.y + target.height / 2, 130);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: tx, y: ty }],
  });
  await page.waitForTimeout(120);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".card-drag-preview")).toHaveCount(0);
  await expect
    .poll(() =>
      cards.evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.motionId),
      ),
    )
    .not.toEqual(old);
  await cards.first().getByRole("button", { name: "星标", exact: true }).tap();
  await expect(
    cards.first().getByRole("button", { name: "取消星标", exact: true }),
  ).toBeVisible();
  const order = await cards.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.motionId),
  );
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  expect(
    await cards.evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.motionId),
    ),
  ).toEqual(order);
  await cards.first().locator(".card-open").tap();
  await expect(page.getByRole("dialog", { name: "事项详情" })).toBeVisible();
  await page.getByLabel("关闭事项详情").tap();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  await swipeBody(".ddl-item .ddl-copy", 550);
  await swipeBody(".ddl-item .time-rail", 0);
});
