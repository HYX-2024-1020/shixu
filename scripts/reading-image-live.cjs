// Opt-in synthetic development call. Electron is used only for safeStorage;
// this entry point never creates a BrowserWindow, tray or personal workspace.
const { app, safeStorage } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const probe = process.env.SHIXU_IMAGE_PROBE_DIR;
const jpegMode = process.argv.includes("--jpeg");
const gifMode = process.argv.includes("--gif");
const webpMode = process.argv.includes("--webp");
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
let phase = "bootstrap";
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
      phase = "imports";
      if (process.argv.includes("--chat") || process.argv.includes("--merge")) {
        const merge=process.argv.includes("--merge");
        phase = merge ? "merge" : "chat";
        const runner = await load(merge ? "scripts/reading-merge-live.mjs" : "scripts/reading-chat-live.mjs");
        await (merge ? runner.runMergeLive : runner.runChatLive)({
          probe,
          getKey: async () => (await safeStorage.decryptStringAsync(
            readFileSync(path.join(existing, "api-key.enc")),
          )).result,
          prepareOnly: process.argv.includes("--prepare-only"),
        });
        return;
      }
      const { Resvg } = require("@resvg/resvg-js");
      const { ReadingLedger } = await load("server/reading/ledger.mjs");
      const { ReadingTasks } = await load("server/reading/tasks.mjs");
      const { SyncStore } = await load("server/sync-store.mjs");
      const { createAttachmentStore } = await load("server/sync-files.mjs");
      const { readMaterial, sha256 } = await load(
        "server/reading/material.mjs",
      );
      const { createDeepSeekReadingProvider, deepseekPriceSnapshots } =
        await load("server/reading/deepseek.mjs");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="white"/>
      <g fill="black" font-family="Microsoft YaHei" font-size="32"><text x="40" y="70">图像开发验证：合成通知</text>
      <text x="40" y="150">请提交图像实验报告，任务编号 7319。</text>
      <text x="40" y="230">截止：2026年10月30日18:00。</text>
      <text x="40" y="310">格式：PDF，命名：学号_姓名。</text>
      <text x="40" y="390">要求：说明算法思路与时间复杂度。</text>
      <text x="40" y="530">尾部核对：7319，禁止遗漏此编号。</text></g></svg>`;
      const sourceSvg = jpegMode
        ? svg
            .replaceAll("图像开发验证：合成通知", "JPEG验证：旋转照片")
            .replaceAll("7319", "8642")
            .replaceAll("2026年10月30日18:00", "2026年11月2日17:30")
        : svg;
      const rendered = new Resvg(sourceSvg).render();
      phase = "fixture";
      let body = rendered.asPng();
      if(webpMode)body=readFileSync(path.join(__dirname,"../server/reading/fixtures/webp-notice.webp"));
      if(gifMode){
        const {gifBytes}=await load("server/reading/gif-fixtures.mjs");
        const second=new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="white"/><g fill="black" font-family="Microsoft YaHei" font-size="32"><text x="40" y="150">提交报告编号7319时，另附源代码。</text><text x="40" y="230">源代码须为UTF-8编码。</text><text x="40" y="500">尾部补充核对：7319。</text></g></svg>`).render();
        const indices=pixels=>Buffer.from(Array.from({length:900*600},(_,i)=>pixels[i*4]<128?1:0));
        body=gifBytes({width:900,height:600,frames:[{indices:indices(rendered.pixels),delay:100,disposal:2},{indices:indices(second.pixels),delay:100,disposal:2}]});
      }
      if (jpegMode) {
        const encode = require("../server/reading/fixtures/jpeg-encoder.cjs");
        const { jpegExif, jpegApp } = await load(
          "server/reading/jpeg-fixtures.mjs",
        );
        const upright = Buffer.from(rendered.pixels),
          rotated = Buffer.alloc(upright.length);
        for (let y = 0; y < 600; y++)
          for (let x = 0; x < 900; x++)
            upright.copy(
              rotated,
              ((899 - x) * 600 + y) * 4,
              (y * 900 + x) * 4,
              (y * 900 + x + 1) * 4,
            );
        const plain = encode(
          { width: 600, height: 900, data: rotated },
          85,
        ).data;
        body = Buffer.concat([
          plain.subarray(0, 2),
          jpegApp(0xe1, jpegExif(6)),
          plain.subarray(2),
        ]);
      }
      const normalized = jpegMode || webpMode
        ? await readMaterial(
            {
              id: "image",
              name: webpMode ? "合成通知.webp" : "合成旋转照片.jpg",
              body,
              size: body.length,
              hash: sha256(body),
            },
            { imageWindow: { tile: 1 } },
          )
        : null;
      if ((jpegMode || webpMode) && normalized.segments.length !== 1)
        throw Error("JPEG_FIXTURE_NORMALIZATION_FAILED");
      ledger = new ReadingLedger(
        process.env.SHIXU_IMAGE_LEDGER_PATH ||
          path.join(probe, "ledger.sqlite"),
      );
      phase = "ledger";
      ledger.grantInitial("synthetic-image-development");
      const prices = deepseekPriceSnapshots(Date.now());
      for (const price of prices) ledger.freezePrice(price);
      const beijingHour = new Date(Date.now() + 8 * 3600000).getUTCHours();
      // Only run this small probe in an unambiguous offpeak hour. No inferred
      // holiday calendar and no automatic retries or changes to provider credit.
      let price = prices[1];
      if (jpegMode || gifMode || webpMode) {
        const day = new Date(Date.now() + 8 * 3600000)
          .toISOString()
          .slice(0, 10);
        const period = process.env.SHIXU_VERIFIED_PRICE_PERIOD;
        if (
          process.env.SHIXU_VERIFIED_PRICE_DAY !== day ||
          !["peak", "offpeak"].includes(period)
        )
          throw Error("VERIFIED_TARIFF_DAY_REQUIRED");
        const weekday = new Date(Date.now() + 8 * 3600000).getUTCDay();
        const clockPeak =
          weekday >= 1 &&
          weekday <= 5 &&
          ((beijingHour >= 9 && beijingHour < 12) ||
            (beijingHour >= 14 && beijingHour < 18));
        if ((period === "peak") !== clockPeak)
          throw Error("VERIFIED_TARIFF_CLOCK_CHANGED");
        // The explicit day/period requires independent official holiday review.
        price = prices.find((p) => p.id.endsWith("-" + period));
        if (!price) throw Error("VERIFIED_TARIFF_SNAPSHOT_MISSING");
      } else if (beijingHour >= 9 && beijingHour < 18)
        throw Error("RUN_PROBE_IN_VERIFIED_OFFPEAK_HOUR");
      if (process.argv.includes("--prepare-only")) {
        console.log(
          JSON.stringify({
            prepared: true,
            browserWindows: 0,
            realProviderCalls: 0,
            priceId: price.id,
            inputHash: sha256(body),
            normalizedImageHash: normalized?.covered?.[0]?.imageHash,
            readerVersion: normalized?.readerVersion,
          }),
        );
        return;
      }
      const key = (
        await safeStorage.decryptStringAsync(
          readFileSync(path.join(existing, "api-key.enc")),
        )
      ).result;
      phase = "provider";
      let providerCalls = 0;
      const provider = createDeepSeekReadingProvider({
        apiKey: key,
        priceAt: () => price.id,
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
        captureDate: jpegMode ? "2026-10-30" : "2026-10-29",
        result: null,
        status: "pending",
      });
      const f = store.files.put("packet", "image", {
        name: webpMode ? "合成通知.webp" : gifMode ? "合成动画通知.gif" : jpegMode ? "合成旋转照片.jpg" : "合成通知.png",
        body,
        type: webpMode ? "image/webp" : gifMode ? "image/gif" : jpegMode ? "image/jpeg" : "image/png",
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
        priceId: price.id,
        modelVersion: price.model,
        authorize: (id) => assert.equal(id, device),
      });
      tasks.enqueue({ id: "image-task", packetId: "packet", deviceId: device });
      const started = performance.now();
      for (let i = 0; i < 12 && tasks.get("image-task").state === "queued"; i++)
        await tasks.run("image-task");
      const task = tasks.get("image-task"),
        packet = store.record("packet").data;
      const serialized = JSON.stringify(packet.result || {});
      const checks = {
        published: task.state === "done",
        ...(jpegMode
          ? {
              orientation:
                packet.readingCoverage?.[0]?.covered?.[0]?.orientation === 6,
            }
          : {}),
        taskNumber: serialized.includes(webpMode ? "9537" : jpegMode ? "8642" : "7319"),
        format: serialized.includes("PDF"),
        filename: serialized.includes("学号_姓名"),
        deadline:
          serialized.includes(webpMode ? "2026-11-03" : jpegMode ? "2026-11-02" : "2026-10-30") &&
          serialized.includes(webpMode ? "16:45" : jpegMode ? "17:30" : "18:00"),
        algorithm: serialized.includes("算法"),
        complexity: serialized.includes("复杂度"),
        ...(gifMode ? {allFrames:packet.readingCoverage?.[0]?.covered?.length===2,
          secondFrameFact:serialized.includes("UTF-8") && serialized.includes("源代码"),
          combined:packet.result?.items?.some(item=>JSON.stringify(item).includes("PDF")&&JSON.stringify(item).includes("UTF-8"))} : {}),
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
        kind: webpMode ? "synthetic-real-webp-development" : gifMode ? "synthetic-real-animated-gif-development" : jpegMode
          ? "synthetic-real-rotated-jpeg-development"
          : "synthetic-real-image-development",
        testedAt: new Date().toISOString(),
        realProviderCalls: providerCalls,
        price,
        inputHash: sha256(body),
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
      assert.ok(providerCalls>=1 && providerCalls<=(gifMode?4:2));
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
        phase,
        error.stack?.match(/reading-image-live\.cjs:\d+:\d+/)?.[0] || "",
        error.code || error.name || "Error",
      );
      app.exit(1);
    },
  );
