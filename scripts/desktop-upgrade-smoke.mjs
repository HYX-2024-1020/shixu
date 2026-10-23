import { waitForPageState } from "./desktop-test-wait.mjs";
import { _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const profile = await mkdtemp(path.join(tmpdir(), "shixu-upgrade-test-")),
  env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .fill("");
  await page.evaluate(async () => {
    const item = {
      kind: "task",
      title: "旧桌面记录",
      summary: "需要保留",
      facts: [],
      nextSteps: [],
      uncertainties: [],
      evidence: [{ sourceId: "input", quote: "需要保留" }],
      sourceIds: ["input"],
      due: null,
    };
    const packet = (id) => ({
      id,
      text: "需要保留",
      sources: [{ id: "input", name: "原文", text: "需要保留" }],
      attachments: [],
      capturedAt: new Date().toISOString(),
      captureDate: "2026-10-23",
      updatedAt: new Date().toISOString(),
      status: "ready",
      error: "",
      doneIds: [],
      result: { summary: "原有结果", items: [item], warnings: [] },
    });
    const a = packet("old-a"),
      b = packet("old-b");
    a.doneIds = [0];
    a.attachments = [
      {
        id: "old-file",
        name: "旧原件.txt",
        type: "text/plain",
        size: 3,
        bytes: Uint8Array.from([1, 2, 3]).buffer,
      },
    ];
    b.association = {
      state: "ready",
      warnings: [],
      links: [
        {
          id: "old-link",
          from: "old-b#0",
          target: "old-a#0",
          relation: "same",
          title: "原有分组",
          confidence: 1,
        },
      ],
    };
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("shixu-bucket", 3);
      r.onsuccess = () => resolve(r.result);
      r.onerror = reject;
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["packets", "draft"], "readwrite");
      tx.objectStore("packets").put(a);
      tx.objectStore("packets").put(b);
      tx.objectStore("draft").put(
        { text: "旧桌面草稿", attachments: [] },
        "current",
      );
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
    db.close();
    localStorage.setItem(
      "shixu-bucket-connection",
      JSON.stringify({
        key: "legacy-dummy-key",
        rememberKey: true,
        model: "deepseek-flash",
      }),
    );
    localStorage.removeItem("shixu-native-store-v1");
  });
  await page.reload();
  await waitForPageState(
    page,
    () =>
      document.querySelector('textarea[aria-label="往桶里放入内容"]')?.value ===
      "旧桌面草稿",
  );
  const result = await page.evaluate(async () => ({
    packets: await window.desktop.store("packets"),
    key: await window.desktop.key("read"),
    config: JSON.parse(localStorage.getItem("shixu-bucket-connection")),
    originalLength: await new Promise((resolve) => {
      const r = indexedDB.open("shixu-bucket", 3);
      r.onsuccess = () => {
        const db = r.result;
        const get = db.transaction("packets").objectStore("packets").getAll();
        get.onsuccess = () => {
          resolve(get.result.length);
          db.close();
        };
      };
    }),
  }));
  assert.equal(result.packets.length, 2);
  assert.equal(result.key, "legacy-dummy-key");
  assert.equal(result.config.key, undefined);
  assert.equal(result.originalLength, 2);
  const a = result.packets.find((p) => p.id === "old-a"),
    b = result.packets.find((p) => p.id === "old-b");
  assert.ok(a.itemIds?.[0]);
  assert.equal(b.association.links[0].target, "old-a#" + a.itemIds[0]);
  assert.equal(b.association.links[0].from, "old-b#" + b.itemIds[0]);
  assert.equal(
    await page.evaluate(
      async () =>
        (await window.desktop.store("packets")).find((p) => p.id === "old-a")
          .attachments[0].bytes.byteLength,
    ),
    3,
  );
  console.log(
    "PASS: first desktop profile upgrades records/originals/draft/relations, encrypts legacy key, and leaves original IndexedDB intact",
  );
} finally {
  await app.close();
}
