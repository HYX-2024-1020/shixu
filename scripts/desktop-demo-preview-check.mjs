// Read the user's existing generated demo batch; exercise a separate profile only.
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { DesktopStore } from "../desktop/storage.cjs";
const manifest = JSON.parse(
  await readFile("release/demo20-manifest.json", "utf8"),
);
const personal = new DesktopStore(
  path.join(process.env.APPDATA, "ShixuDesktop/workspace"),
);
const packets = (await personal.call("packets")).filter((p) =>
  manifest.packetIds.includes(p.id),
);
assert.equal(packets.length, 20);
const profile = await mkdtemp(
  path.join(tmpdir(), "shixu-existing-demo-preview-"),
);
await new DesktopStore(path.join(profile, "workspace")).call(
  "savePackets",
  packets,
);
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
const results = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.route("https://api.deepseek.com/**", (r) => r.abort());
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  for (const packet of packets) {
    const index = packet.result.items.findIndex(
      (_, i) => !packet.itemState?.[packet.itemIds[i]]?.deletedAt,
    );
    if (index < 0) continue;
    const done =
      packet.itemState?.[packet.itemIds[index]]?.status === "done" ||
      packet.doneIds.includes(index);
    await page.getByLabel("结果范围").selectOption(done ? "done" : "active");
    const card = page
      .locator(".result-card")
      .filter({
        has: page.getByRole("button", {
          name: "查看 " + packet.result.items[index].title,
          exact: true,
        }),
      });
    await card.locator(".card-source-link").click();
    const dialog = page.getByRole("dialog", { name: "同行材料", exact: true });
    for (const file of packet.attachments.filter((a) => !a.deletedAt)) {
      await dialog
        .getByRole("button", { name: file.name, exact: true })
        .click();
      const preview = dialog.getByLabel("预览 " + file.name, { exact: true });
      await expect(preview.getByRole("status")).toHaveCount(0, {
        timeout: 15000,
      });
      if (file.type.startsWith("image/")) {
        await expect
          .poll(() =>
            preview
              .locator("img")
              .evaluate((img) => img.complete && img.naturalWidth > 0),
          )
          .toBeTruthy();
      } else if (/\.pdf$/i.test(file.name)) {
        await expect(
          preview.getByRole("button", { name: "上一页", exact: true }),
        ).toBeVisible();
        assert.ok(await preview.locator("canvas").evaluate((c) => c.width > 0));
      } else {
        await expect(preview.locator("pre")).not.toBeEmpty();
      }
      assert.equal(
        await preview.getByText(/暂不支持|暂时无法|原件不在/).count(),
        0,
      );
      results.push({ name: file.name, preview: "PASS" });
    }
    await dialog
      .getByRole("button", { name: "关闭同行材料", exact: true })
      .click();
  }
  assert.equal(downloads, 0);
  await writeFile(
    "release/demo-preview-validation.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        deliveries: packets.length,
        attachments: results.length,
        downloads,
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: existing ${packets.length} demo deliveries, ${results.length} original attachments previewed from companion-material entry; zero downloads; personal workspace untouched`,
  );
} finally {
  await app.close();
}
