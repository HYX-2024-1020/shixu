import { test, expect } from "@playwright/test";
import { world } from "./current-ui";
test("native bridge onboarding remains reachable and world keeps separate records and task entries", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("shixu-native-store-v1", "complete");
    window.desktop = {
      key: async () => "",
      cloud: async () => ({
        base: "",
        pending: 0,
        conflicts: [],
        jobs: [],
        devices: [],
        error: "",
        activation: "inactive",
        materialConsentAccepted: true,
        capabilities: { features: { registration: true } },
      }),
      store: async (method: string, value: any) =>
        method === "draft"
          ? { text: "", attachments: [] }
          : method === "packets" || method === "usage"
            ? []
            : value,
    } as any;
  });
  await page.goto("/");
  const intro = page.getByRole("complementary", { name: "首次使用拾序" });
  await expect(intro).toBeVisible();
  await intro
    .getByRole("button", { name: "注册 / 已有账号登录", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "首次注册", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await intro
    .getByRole("button", { name: "先用本机手动记录", exact: true })
    .click();
  await expect(intro).toHaveCount(0);
  await world(page);
  await page.getByRole("button", { name: "整理任务", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "整理任务", exact: true }),
  ).toContainText("原有投递仍可从世界的整理记录查看");
  await page.getByRole("button", { name: "关闭整理任务", exact: true }).click();
  await page.getByRole("button", { name: "整理记录", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "整理记录", exact: true }),
  ).toBeVisible();
});
