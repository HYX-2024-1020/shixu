import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createMultiUserService } from "../sync-multi-user.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { readMaterial } from "./material.mjs";
const require = createRequire(import.meta.url),
  { AccountWorkspace } = require("../../desktop/accounts.cjs"),
  { DesktopStore } = require("../../desktop/storage.cjs");
const pagePath = fileURLToPath(
  new URL("../../miniprogram/pages/index/index.js", import.meta.url),
);
function mini(base, identity) {
  const store = new Map([["shixu:mini:development-service", base]]);
  let definition;
  const wx = {
    getStorageSync: (key) => store.get(key),
    setStorageSync: (key, value) => store.set(key, structuredClone(value)),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    onNetworkStatusChange() {},
    offNetworkStatusChange() {},
    showToast() {},
    login: ({ success }) => success({ code: identity }),
    showModal: ({ success }) => success({ confirm: true }),
    request: async (options) => {
      try {
        const response = await fetch(options.url, {
          method: options.method,
          headers: options.header,
          ...(options.data ? { body: JSON.stringify(options.data) } : {}),
        });
        options.success({
          statusCode: response.status,
          data: await response.json(),
        });
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
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(value) {
      Object.assign(this.data, value);
    },
  };
  page.onLoad();
  return { page, store };
}
test(
  "signed Windows and mini Page share password account, replay registration, replace full slots and recover the same WeChat identity without a new grant",
  { timeout: 20000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "shixu-v4-credentials-clients-")),
      ledger = new ReadingLedger(join(root, "ledger.sqlite"));
    ledger.freezePrice({
      id: "fixture",
      model: "fixture",
      currency: "CNY",
      source: "synthetic",
      verifiedAt: 1,
      inputMicrosPerMillion: 1000000,
      cachedMicrosPerMillion: 100000,
      outputMicrosPerMillion: 1000000,
    });
    let wechatExchanges = 0;
    const service = createMultiUserService({
      directory: join(root, "server"),
      secret: "synthetic-v4-client-secret-32-characters",
      wechat: async (code) => {
        wechatExchanges++;
        return code;
      },
      reading: {
        credentials: true,
        enabled: false,
        ledger,
        reader: async (file) => readMaterial(file),
        provider: async () => {
          throw Error("unexpected provider call");
        },
        priceId: "fixture",
        modelVersion: "fixture",
      },
    });
    await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${service.server.address().port}`;
    let clock = Date.now();
    service.credentials.now = () => clock;
    let drop = true;
    const pages = [];
    const windows = async (name, fetcher = fetch) => {
      const options = {
        root: join(root, name),
        local: new DesktopStore(join(root, name + "-local")),
        serviceOrigin: base,
        seal: async (text) => Buffer.from(text),
        unseal: async (bytes) => bytes.toString(),
        fetcher,
      };
      const client = new AccountWorkspace(options);
      await client.init();
      return client;
    };
    const value = {
      username: "TEST用户",
      password: "synthetic-password",
      invite: service.registry.generate(12)[0].invite,
    };
    try {
      let win = await windows("win1", async (url, init) => {
        const response = await fetch(url, init);
        if (drop && url.endsWith("/auth/register")) {
          drop = false;
          throw Error("lost registration reply");
        }
        return response;
      });
      await assert.rejects(
        win.action("register", value),
        /lost registration reply/,
      );
      win = await windows("win1");
      await win.action("register", value);
      const account = win.config.devices[win.config.active].userId;
      service.registry.limits(account, { requestsPerMinute: 1000 });
      assert.equal(ledger.wallet(account).granted, 20000000);
      await win.call(
        "savePackets",
        [
          {
            id: "shared",
            text: "跨端合成账号资料",
            sources: [],
            attachments: [],
            captureDate: "2026-10-28",
            capturedAt: "2026-10-28T00:00:00Z",
            updatedAt: "2026-10-28T00:00:00Z",
            doneIds: [],
            status: "pending",
            result: null,
          },
        ],
        win.config.active,
      );
      await win.action("sync");
      const clients = [win];
      for (let i = 2; i <= 3; i++) {
        clock += 61000;
        const client = await windows("win" + i);
        await client.action("login", value);
        clients.push(client);
      }
      clock += 61000;
      const fourth = await windows("win4");
      await assert.rejects(
        fourth.action("login", value),
        (e) => e.code === "DEVICE_SLOTS_FULL",
      );
      assert.equal(fourth.status().loginDevices.length, 3);
      clock += 61000;
      const old = clients[1].config.devices[clients[1].config.active].deviceId;
      await fourth.action("login", { ...value, replaceBindingId: old });
      await assert.rejects(clients[1].action("sync"), (e) => e.status === 401);
      assert.ok((await clients[1].packets()).some((p) => p.id === "shared"));
      clock += 61000;
      const m = mini(base, "wechat-one");
      pages.push(m.page);
      m.page.setData({
        accountUsername: value.username,
        accountPassword: value.password,
      });
      await m.page.credentialAction({
        currentTarget: { dataset: { action: "login" } },
      });
      assert.equal(m.page.data.error, "");
      assert.equal(m.page._record("shared").data.text, "跨端合成账号资料");
      assert.equal(m.page._connection.userId, account);
      const reinstalled = mini(base, "wechat-one");
      pages.push(reinstalled.page);
      await reinstalled.page.credentialAction({
        currentTarget: { dataset: { action: "wechat" } },
      });
      assert.equal(reinstalled.page.data.error, "");
      assert.equal(
        reinstalled.page._connection.deviceId,
        m.page._connection.deviceId,
      );
      clock += 61000;
      const other = mini(base, "wechat-two");
      pages.push(other.page);
      other.page.setData({
        accountUsername: value.username,
        accountPassword: value.password,
      });
      await other.page.credentialAction({
        currentTarget: { dataset: { action: "login" } },
      });
      assert.match(other.page.data.error, /设备.*已满/);
      assert.equal(
        service.credentials.devices(account).filter((d) => d.kind === "wechat")
          .length,
        1,
      );
      assert.equal(ledger.wallet(account).granted, 20000000);
      clock += 61000;
      const reauth = win.action("login", value);
      while (!service.credentials.hashing)
        await new Promise((done) => setImmediate(done));
      const queries = [],
        rssDuringHash = process.memoryUsage().rss;
      for (let i = 0; i < 8; i++) {
        const started = performance.now();
        const response = await fetch(base + "/api/v4/wallet", {
          headers: { Authorization: "Bearer " + m.page._connection.token },
        });
        assert.equal(response.status, 200);
        await response.json();
        queries.push(performance.now() - started);
      }
      await reauth;
      queries.sort((a, b) => a - b);
      assert.ok(queries.at(-1) < 1000);
      t.diagnostic(
        JSON.stringify({
          synthetic: true,
          walletQueriesDuringScrypt: 8,
          walletP95Ms: queries.at(-1),
          processRssDuringHash: rssDuringHash,
          processCumulativeMaxRssKiB: process.resourceUsage().maxRSS,
          realProviderCalls: 0,
        }),
      );
      clock += 61000;
      await win.action("password", {
        oldPassword: value.password,
        newPassword: "new-synthetic-password",
        revokeAll: true,
      });
      assert.equal(service.credentials.devices(account).length, 0);
      assert.equal(win.status().activation, "invalid");
      assert.throws(
        () => service.registry.authenticate(m.page._connection.token),
        (e) => e.code === "UNAUTHORIZED",
      );
      clock += 61000;
      await fourth.action("login", {
        ...value,
        password: "new-synthetic-password",
      });
      assert.equal(fourth.config.devices[fourth.config.active].userId, account);
      assert.equal(ledger.wallet(account).granted, 20000000);
      assert.ok(!JSON.stringify(fourth.config).includes("synthetic-password"));
      assert.ok(
        !JSON.stringify([...m.store.values()]).includes("synthetic-password"),
      );
      clock += 61000;
      const before = wechatExchanges;
      for (let i = 0; i < 6; i++) {
        const response = await fetch(base + "/api/v4/auth/wechat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractVersion: 1,
            code: "unbound-identity",
          }),
        });
        assert.equal(response.status, i < 5 ? 401 : 429);
        await response.json();
      }
      assert.equal(
        wechatExchanges - before,
        5,
        "network throttle runs before WeChat exchange",
      );
    } finally {
      for (const page of pages) page.onUnload?.();
      await new Promise((done) => service.server.close(done));
      await service.drained();
      ledger.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
