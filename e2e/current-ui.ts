import { expect, type Page } from "@playwright/test";
export async function packets(page: Page) {
  return page.evaluate(async () => {
    const modulePath = "/src/bucket/store.ts";
    return (await import(modulePath)).allPackets();
  });
}
export async function world(page: Page) {
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
}
export async function records(page: Page) {
  await world(page);
  await page.getByRole("button", { name: "整理记录", exact: true }).click();
  return page.getByRole("dialog", { name: "整理记录", exact: true });
}
export async function closeRecords(page: Page) {
  await page.getByLabel("关闭整理记录", { exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "整理记录", exact: true }),
  ).toHaveCount(0);
}
export async function finished(page: Page, count: number) {
  await expect
    .poll(async () => {
      const ps = await packets(page);
      return ps.filter(
        (p: any) =>
          !p.deletedAt &&
          p.status === "ready" &&
          p.association?.state !== "pending" &&
          p.association?.state !== "processing",
      ).length;
    })
    .toBe(count);
}
export async function capture(
  page: Page,
  text: string,
  file?: { name: string; text: string },
) {
  await page.getByRole("button", { name: "投递桶", exact: true }).click();
  await page.getByLabel("往桶里放入内容").fill(text);
  if (file)
    await page
      .locator("input[type=file]")
      .setInputFiles({
        name: file.name,
        mimeType: "text/plain",
        buffer: Buffer.from(file.text),
      });
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
}
export async function deleteReceipt(page: Page, index = 0) {
  const d = await records(page);
  const receipt = d.locator(".delivery-receipt").nth(index);
  await receipt
    .locator(":scope > details")
    .filter({
      has: page.locator("summary").filter({ hasText: "原文、遗漏与操作" }),
    })
    .locator("summary")
    .first()
    .click();
  page.once("dialog", (d) => d.accept());
  await receipt
    .getByRole("button", { name: "删除整次投递", exact: true })
    .click();
  await closeRecords(page);
}
