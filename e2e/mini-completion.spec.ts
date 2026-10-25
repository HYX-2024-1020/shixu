import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// Exercise the shipped WXSS against a native-button minimum width. This is a
// browser geometry regression, separate from official WeChat compilation.
test("mini completion remains circular beside long titles and draws both strokes", async ({
  page,
}) => {
  const width = 390;
  await page.setViewportSize({ width, height: 844 });
  const css = readFileSync(
    "miniprogram/pages/index/index.wxss",
    "utf8",
  ).replace(/([\d.]+)rpx/g, (_, n) => `${(Number(n) * width) / 750}px`);
  const check =
    '<div class="completion-check"><div class="check-short"></div><div class="check-long"></div></div>';
  await page.setContent(`<style>
    button { min-width:184px; padding:0 14px; border-radius:5px; }
    view { display:block; }
    ${css}
  </style><main style="width:350px">
    ${[false, true]
      .map(
        (done) => `<article class="ddl-item"><div class="ddl-row">
      <button size="mini" class="done-button ${done ? "checked" : ""}" aria-label="${done ? "撤销完成" : "标记完成"}">${done ? check : ""}</button>
      <div class="ddl-copy"><h3 class="item-title">很长的截止事项标题，需要完整保留且不能把圆圈挤成长椭圆</h3><p>交付 · 合成回归资料</p></div>
    </div></article>`,
      )
      .join("")}
  </main>`);
  const controls = page.locator(".done-button");
  for (const button of await controls.all()) {
    const box = await button.boundingBox();
    expect(box!.width).toBeCloseTo(box!.height, 0);
    expect(box!.width).toBeCloseTo((64 * width) / 750, 0);
    await expect(button).toHaveCSS("border-radius", "50%");
  }
  await expect(controls.nth(1)).toHaveCSS(
    "background-color",
    "rgb(255, 212, 59)",
  );
  const samples = await controls.first().evaluate(async (button, check) => {
    button.innerHTML = check;
    button.classList.add("is-checking");
    const strokes = Array.from(
      button.querySelectorAll(".check-short,.check-long"),
    );
    const values: number[][] = [];
    const start = performance.now();
    while (performance.now() - start < 250) {
      values.push(
        strokes.map((stroke) => {
          const m = new DOMMatrixReadOnly(getComputedStyle(stroke).transform);
          return Math.hypot(m.a, m.b);
        }),
      );
      await new Promise(requestAnimationFrame);
    }
    return values;
  }, check);
  expect(
    samples.some(([short, long]) => short > 0 && short < 1 && long === 0),
  ).toBe(true);
  expect(
    samples.some(([short, long]) => short > 0.99 && long > 0 && long < 1),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/mini-completion-${test.info().project.name}.png`,
  });
});
