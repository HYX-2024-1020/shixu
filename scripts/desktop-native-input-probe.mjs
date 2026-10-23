// Local-only manual source-app probe. Never submits a packet or calls a model.
import { _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const profile = await mkdtemp(path.join(tmpdir(), "shixu-native-input-"));
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await app.evaluate(({ BrowserWindow, screen }) => {
    const work = screen.getPrimaryDisplay().workArea;
    const win = BrowserWindow.getAllWindows()[0];
    win.setBounds({
      x: work.x + Math.floor(work.width / 2),
      y: work.y,
      width: Math.floor(work.width / 2),
      height: work.height,
    });
    win.setTitle("拾序 · 原生拖拽验收（不提交）");
  });
  await page.evaluate(() => {
    window.nativeDropEvents = [];
    document.addEventListener(
      "drop",
      (e) =>
        window.nativeDropEvents.push({
          types: Array.from(e.dataTransfer?.types || []),
          items: Array.from(e.dataTransfer?.items || []).map((i) => ({
            kind: i.kind,
            type: i.type,
          })),
          files: Array.from(e.dataTransfer?.files || []).map((f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
          })),
        }),
      true,
    );
  });
  console.log("Local probe ready:", profile);
  const stop = path.join(profile, "stop");
  for (let i = 0; i < 1800; i++) {
    const report = await page.evaluate(async () => {
      const draft = await window.desktop.store("draft");
      return {
        events: window.nativeDropEvents,
        textLength: draft.text.length,
        attachments: draft.attachments.map((a) => ({
          name: a.name,
          type: a.type,
          size: a.size,
        })),
      };
    });
    await writeFile(
      "release/native-input-probe.json",
      JSON.stringify(
        { testedAt: new Date().toISOString(), profile, ...report },
        null,
        2,
      ),
    );
    try {
      await access(stop);
      break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} finally {
  await app.close();
}
