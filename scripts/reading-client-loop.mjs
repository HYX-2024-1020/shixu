import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createMultiUserService } from "../server/sync-multi-user.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
const require = createRequire(import.meta.url);
const { AccountWorkspace } = require("../desktop/accounts.cjs");
const { DesktopStore } = require("../desktop/storage.cjs");
const { SERVICE_ORIGIN } = require("../miniprogram/lib/accounts.js");
const pagePath = fileURLToPath(
  new URL("../miniprogram/pages/index/index.js", import.meta.url),
);
const tick = () => new Promise((done) => setTimeout(done, 10));

export async function runClientLoop({ directory, reader, original }) {
  const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  ledger.freezePrice({
    id: "synthetic",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic fixture, no provider request",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 1000000,
  });
  let release, enter;
  const entered = new Promise((done) => {
    enter = done;
  });
  const held = new Promise((done) => {
    release = done;
  });
  let calls = 0,
    parserRuns = 0,
    tailSeen = false;
  const reading = {
    ledger,
    enabled: true,
    reader: async (...args) => {
      parserRuns++;
      return reader(...args);
    },
    priceId: "synthetic",
    modelVersion: "synthetic/1",
    provider: async (sources) => {
      calls++;
      if (calls === 1) {
        enter();
        await held;
      }
      tailSeen ||= sources.some((s) => s.text.includes("尾部唯一标记"));
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: {
          summary: "合成摘要",
          warnings: [],
          items: [
            {
              kind: "note",
              title: "有来源的合成事项",
              summary: "合成事项",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              due: null,
              evidence: [
                {
                  sourceId: sources[0].id,
                  quote: sources[0].text.slice(0, 10),
                },
              ],
            },
          ],
        },
      };
    },
  };
  const service = createMultiUserService({
    directory: join(directory, "server"),
    secret: "synthetic-v4-client-secret-with-32-characters",
    reading,
    wechat: async (code) => "synthetic-" + code,
  });
  await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const cloud = new AccountWorkspace({
    root: join(directory, "windows"),
    local: new DesktopStore(join(directory, "local")),
    serviceOrigin: base,
    seal: async (s) => Buffer.from(s),
    unseal: async (b) => b.toString(),
  }); // Synthetic harness only, never a personal profile.
  let page;
  try {
    const invite = service.registry.generate(1)[0].invite;
    await cloud.init();
    await cloud.action("activate", { invite });
    const account = cloud.config.devices[cloud.config.active].userId;
    service.registry.limits(account, { requestsPerMinute: 1000 }); // Burst-heavy synthetic replay only.
    ledger.grantInitial(account); // Explicit synthetic reconciliation, never automatic on login.
    const response = await fetch(base + "/api/v3/activate/wechat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invite, code: "client-a" }),
    });
    const binding = await response.json();
    assert.equal(response.status, 201);
    let definition;
    const storage = new Map();
    const wx = {
      getStorageSync: (k) => storage.get(k),
      setStorageSync: (k, v) => storage.set(k, structuredClone(v)),
      getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
      onNetworkStatusChange() {},
      offNetworkStatusChange() {},
      showToast() {},
      request: async (options) => {
        try {
          const res = await fetch(options.url.replace(SERVICE_ORIGIN, base), {
            method: options.method,
            headers: options.header,
            ...(options.data ? { body: JSON.stringify(options.data) } : {}),
          });
          options.success({ statusCode: res.status, data: await res.json() });
        } catch (e) {
          options.fail(e);
        }
      },
    };
    vm.runInNewContext(readFileSync(pagePath, "utf8"), {
      Page: (value) => {
        definition = value;
      },
      wx,
      getApp: () => ({ globalData: {} }),
      require: createRequire(pagePath),
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    page = {
      ...definition,
      data: structuredClone(definition.data),
      setData(value) {
        Object.assign(this.data, value);
      },
    };
    page.onLoad();
    page._activate({ ...binding, base: SERVICE_ORIGIN });
    const body =
      original?.body ||
      Buffer.from("合成报告要求与顺序😀。\n".repeat(20000) + "尾部唯一标记");
    await cloud.call(
      "savePackets",
      [
        {
          id: "packet",
          text: "",
          sources: [{ id: "forged", name: "客户端伪造正文", text: "禁止信任" }],
          attachments: [
            {
              id: "original",
              name: original?.name || "合成.txt",
              type: original?.type || "text/plain",
              bytes: body,
            },
          ],
          captureDate: "2026-10-28",
          capturedAt: "2026-10-28T00:00:00.000Z",
          updatedAt: "2026-10-28T00:00:00.000Z",
          doneIds: [],
          result: null,
          status: "pending",
        },
      ],
      cloud.config.active,
    );
    await cloud.action("sync");
    const initial = await cloud.action("ai", {
      kind: "organize",
      packetId: "packet",
    });
    await entered;
    await page.sync();
    assert.equal(page.data.error, "");
    const task = page._jobs.find((j) => j.id === initial.job);
    assert.ok(task?.actions.includes("stop"));
    await page.taskAction({
      currentTarget: { dataset: { id: task.id, action: "stop" } },
    });
    assert.equal(page._jobs.find((j) => j.id === task.id).state, "cancelled");
    release();
    while (service.readingRoutes.snapshot().accounts) await tick();
    await cloud.action("sync");
    assert.equal(
      cloud.readJobs().find((j) => j.id === task.id).state,
      "cancelled",
    );
    assert.equal((await cloud.packets())[0].result, null);
    await page.sync();
    await page.taskAction({
      currentTarget: { dataset: { id: task.id, action: "continue" } },
    });
    while (service.readingRoutes.snapshot().accounts) await tick();
    await page.sync();
    await cloud.action("sync");
    const win = (await cloud.packets())[0],
      mini = page._record("packet").data;
    assert.deepEqual(
      JSON.parse(JSON.stringify(win.result)),
      JSON.parse(JSON.stringify(mini.result)),
    );
    assert.equal(cloud.readJobs().find((j) => j.id === task.id).state, "done");
    assert.ok(tailSeen);
    assert.ok(calls > 2);
    assert.equal(JSON.stringify(win.sources), "[]");
    assert.deepEqual(
      JSON.parse(JSON.stringify(win.readingCoverage)),
      JSON.parse(JSON.stringify(mini.readingCoverage)),
    );
    if (original?.verify) original.verify({ win, mini, page });
    const old = await cloud
      .request(cloud.config.active, "POST", "/api/v3/jobs", {
        kind: "organize",
      })
      .then(
        () => null,
        (e) => e.code,
      );
    assert.equal(old, "CLIENT_UPGRADE_REQUIRED");
    return {
      synthetic: true,
      realProviderCalls: 0,
      simulatedProviderCalls: calls,
      bytes: body.length,
      parserRuns,
      tailSeen,
      desktopTransport:
        "AccountWorkspace with signed HTTP and isolated profile",
      miniTransport:
        "actual Page lifecycle with Node wx adapter, not WeChat UI",
      stopFromOtherDevice: true,
      continueFromOtherDevice: true,
      lateResponseDiscarded: true,
      resultsEqual: true,
      v3AIBlocked: true,
      spentMicros: ledger.wallet(account).spent,
    };
  } finally {
    release();
    page?.onUnload?.();
    await new Promise((done) => service.server.close(done));
    await service.drained();
    ledger.close();
  }
}
