import { expect, type Page } from "@playwright/test";

// Read only synthetic records in Playwright's fresh browser context. All writes
// and user actions still go through the real UI; no production profile is used.
export async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const storeUrl = "/src/bucket/store.ts";
    const relationsUrl = "/shared/relations.mjs";
    const store = await import(storeUrl);
    const { buildGroups } = await import(relationsUrl);
    const packets = await store.allPackets();
    return {
      packets,
      groups: buildGroups(packets),
      usage: await store.allUsage(),
    };
  });
}

export async function waitReady(page: Page, count: number) {
  await expect
    .poll(
      async () =>
        (await snapshot(page)).packets.filter(
          (p: any) =>
            !p.deletedAt &&
            p.status === "ready" &&
            p.association?.state === "ready",
        ).length,
    )
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
    await page.locator("input[type=file]").setInputFiles({
      name: file.name,
      mimeType: "text/plain",
      buffer: Buffer.from(file.text),
    });
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
}

export async function openResults(page: Page) {
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await expect(page.getByLabel("搜索整理结果")).toBeVisible();
}

export async function openRecords(page: Page) {
  await openResults(page);
  await page.getByRole("button", { name: "整理记录", exact: true }).click();
  return page.getByRole("dialog", { name: "整理记录", exact: true });
}

export async function closeDialog(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.locator(".dialog-close").click();
  await expect(dialog).not.toBeVisible();
}

export async function deleteReceipt(page: Page, text: string) {
  const records = await openRecords(page);
  const receipt = records
    .locator(".delivery-receipt")
    .filter({ hasText: text });
  await expect(receipt).toHaveCount(1);
  await receipt.getByText("原文、遗漏与操作", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await receipt
    .getByRole("button", { name: "删除整次投递", exact: true })
    .click();
  await expect(receipt).toHaveCount(0);
  await closeDialog(page);
}
