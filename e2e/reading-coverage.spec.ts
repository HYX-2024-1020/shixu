import { test, expect } from "@playwright/test";
import { world } from "./current-ui";
test("server partial coverage and exact source locator remain visible without a full extracted-text copy", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const store = await import("/src/bucket/store.ts");
    await store.putPacket({
      id: "coverage_fixture",
      text: "",
      sources: [],
      attachments: [
        { id: "a", name: "合成表.csv", size: 10, type: "text/csv" },
      ],
      capturedAt: "2026-10-28T00:00:00Z",
      captureDate: "2026-10-28",
      status: "ready",
      error: "",
      doneIds: [],
      updatedAt: "2026-10-28T00:00:00Z",
      itemIds: ["coverage_item"],
      readingCoverage: [
        {
          attachmentId: "a",
          name: "合成表.csv",
          state: "partial",
          covered: [
            {
              sourceId: "row_1",
              kind: "csv",
              row: 1,
              rowEnd: 2,
              start: 0,
              end: 8,
            },
          ],
          uncovered: [
            { kind: "csv", row: 3, start: 8, end: 15, code: "CSV_MALFORMED" },
          ],
          reasons: ["CSV_MALFORMED"],
        },
      ],
      result: {
        summary: "合成结果",
        warnings: [],
        items: [
          {
            kind: "note",
            title: "查看合成表要求",
            summary: "已有安全可读部分",
            facts: [],
            nextSteps: [],
            uncertainties: [],
            evidence: [{ sourceId: "row_1", quote: "合成要求" }],
            sourceIds: ["row_1"],
            due: null,
          },
        ],
      },
    });
  });
  await page.reload();
  await world(page);
  await page.getByRole("button", { name: "1 份同行材料" }).click();
  const materials = page.getByRole("dialog", { name: "同行材料", exact: true });
  await expect(materials.getByText("合成表.csv · 部分读取")).toBeVisible();
  await expect(
    materials.getByText("CSV 第 3 行：CSV 行或引号损坏"),
  ).toBeVisible();
  await expect(materials.getByText("已读取 1 个来源范围")).toBeVisible();
});
