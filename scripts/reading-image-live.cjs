// Opt-in synthetic development call. Electron is used only for safeStorage;
// this entry point never creates a BrowserWindow, tray or personal workspace.
const { app, safeStorage } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const probe = process.env.SHIXU_IMAGE_PROBE_DIR;
if (
  !probe ||
  path.dirname(probe) !== path.resolve(tmpdir()) ||
  !path.basename(probe).startsWith("shixu-image-live-")
) {
  console.error("USE_READING_IMAGE_LIVE_LAUNCHER");
  app.exit(2);
}
const existing =
  process.env.SHIXU_LIVE_PROFILE ||
  path.join(process.env.APPDATA, "ShixuDesktop");
let bootstrapError;
try {
  app.setPath("userData", probe);
} catch (error) {
  bootstrapError = error;
}
app.commandLine.appendSwitch("disable-gpu");
app
  .whenReady()
  .then(async () => {
    let store, ledger, tasks;
    const load = (p) =>
      import(pathToFileURL(path.resolve(__dirname, "..", p)).href);
    try {
      if (bootstrapError) throw Error("SAFE_CONFIGURATION_UNAVAILABLE");
      if (process.argv.includes("--dry-run")) {
        console.log(
          JSON.stringify({
            dryRun: true,
            browserWindows: 0,
            realProviderCalls: 0,
          }),
        );
        return;
      }
      const key = (
        await safeStorage.decryptStringAsync(
          readFileSync(path.join(existing, "api-key.enc")),
        )
      ).result;
      const { Resvg } = require("@resvg/resvg-js");
      const { ReadingLedger } = await load("server/reading/ledger.mjs");
      const { ReadingTasks } = await load("server/reading/tasks.mjs");
      const { SyncStore } = await load("server/sync-store.mjs");
      const { createAttachmentStore } = await load("server/sync-files.mjs");
      const { readMaterial } = await load("server/reading/material.mjs");
      const { createDeepSeekReadingProvider, deepseekPriceSnapshots } =
        await load("server/reading/deepseek.mjs");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="white"/>
      <g fill="black" font-family="Microsoft YaHei" font-size="32"><text x="40" y="70">图像开发验证：合成通知</text>
      <text x="40" y="150">请提交图像实验报告，任务编号 7319。</text>
      <text x="40" y="230">截止：2026年10月30日18:00。</text>
      <text x="40" y="310">格式：PDF，命名：学号_姓名。</text>
      <text x="40" y="390">要求：说明算法思路与时间复杂度。</text>
      <text x="40" y="530">尾部核对：7319，禁止遗漏此编号。</text></g></svg>`;
      const body = new Resvg(svg).render().asPng();
      ledger = new ReadingLedger(
        process.env.SHIXU_IMAGE_LEDGER_PATH ||
          path.join(probe, "ledger.sqlite"),
      );
      ledger.grantInitial("synthetic-image-development");
      const prices = deepseekPriceSnapshots(Date.now());
      for (const price of prices) ledger.freezePrice(price);
      const beijingHour = new Date(Date.now() + 8 * 3600000).getUTCHours();
      // Only run this small probe in an unambiguous offpeak hour. No inferred
      // holiday calendar and no automatic retries or changes to provider credit.
      if (beijingHour >= 9 && beijingHour < 18)
        throw Error("RUN_PROBE_IN_VERIFIED_OFFPEAK_HOUR");
      let providerCalls = 0;
      const provider = createDeepSeekReadingProvider({
        apiKey: key,
        priceAt: () => prices[1].id,
        fetcher: async (...args) => {
          providerCalls++;
          return fetch(...args);
        },
      });
      store = new SyncStore(path.join(probe, "tenant.sqlite"));
      createAttachmentStore(store);
      const device = store.createDevice("synthetic-image-development").deviceId;
      const put = (data) =>
        store.apply(
          device,
          {
            id: "packet",
            opId: crypto.randomUUID(),
            type: "put",
            baseVersion: store.record("packet")?.version || 0,
            data,
          },
          store.epoch,
        );
      put({
        text: "",
        sources: [],
        attachments: [],
        captureDate: "2026-10-29",
        result: null,
        status: "pending",
      });
      const f = store.files.put("packet", "image", {
        name: "合成通知.png",
        body,
        type: "image/png",
        epoch: store.epoch,
      });
      put({ attachments: [f] });
      tasks = new ReadingTasks({
        store,
        ledger,
        account: "synthetic-image-development",
        reader: Object.assign((file, options) => readMaterial(file, options), {
          pdfWindows: true,
          imageWindows: true,
        }),
        provider,
        priceId: prices[1].id,
        modelVersion: prices[1].model,
        authorize: (id) => assert.equal(id, device),
      });
      tasks.enqueue({ id: "image-task", packetId: "packet", deviceId: device });
      const started = performance.now();
      for (let i = 0; i < 5 && tasks.get("image-task").state === "queued"; i++)
        await tasks.run("image-task");
      const task = tasks.get("image-task"),
        packet = store.record("packet").data;
      const serialized = JSON.stringify(packet.result || {});
      const checks = {
        published: task.state === "done",
        taskNumber: serialized.includes("7319"),
        format: serialized.includes("PDF"),
        filename: serialized.includes("学号_姓名"),
        deadline:
          serialized.includes("2026-10-30") && serialized.includes("18:00"),
        algorithm: serialized.includes("算法"),
        complexity: serialized.includes("复杂度"),
        imageWarning:
          packet.result?.warnings?.some((w) =>
            w.includes("图像内容由模型识别"),
          ) === true,
      };
      const calls = ledger.db
        .prepare(
          "SELECT id,state,price,reserved,actual,usage FROM reading_calls",
        )
        .all();
      const report = {
        kind: "synthetic-real-image-development",
        testedAt: new Date().toISOString(),
        realProviderCalls: providerCalls,
        price: prices[1],
        checks,
        state: task.state,
        reason: task.reason,
        elapsedMs: performance.now() - started,
        spentMicros: ledger.wallet("synthetic-image-development").spent,
        calls,
        result: packet.result,
        coverage: packet.readingCoverage,
        boundaries: [
          "No UI window",
          "Local Node decoder, not Linux isolation evidence",
          "Model visual understanding, not a guarantee of verbatim transcription",
          "No personal material submitted",
        ],
      };
      const output = path.resolve(
        process.env.SHIXU_IMAGE_REPORT ||
          path.join(
            __dirname,
            "..",
            "docs",
            "bcd",
            "evidence",
            "image-live.json",
          ),
      );
      writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
      console.log(
        JSON.stringify({
          report: output,
          realProviderCalls: providerCalls,
          spentMicros: report.spentMicros,
          checks,
          state: task.state,
        }),
      );
      assert.equal(providerCalls, 1);
      assert.equal(task.state, "done");
      assert.ok(Object.values(checks).every(Boolean));
    } finally {
      tasks?.close();
      ledger?.close();
      store?.close();
      assert.ok(
        path.dirname(probe) === path.resolve(tmpdir()) &&
          path.basename(probe).startsWith("shixu-image-live-"),
      );
      // Launcher removes this profile only after Electron has exited.
    }
  })
  .then(
    () => app.exit(0),
    (error) => {
      // Do not print supplier bodies, request payloads, key or decrypted settings.
      console.error(
        "SYNTHETIC_IMAGE_PROBE_FAILED",
        error.code || error.name || "Error",
      );
      app.exit(1);
    },
  );
