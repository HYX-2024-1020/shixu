const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { createRequire } = require("node:module");
const vm = require("node:vm");
const { SERVICE_ORIGIN, CONNECTION } = require("../lib/accounts");

function fixture(base, store = new Map()) {
  let definition,
    identity = "wechat-a";
  const wx = {
    getStorageSync: (k) => store.get(k),
    setStorageSync: (k, v) => store.set(k, structuredClone(v)),
    login: ({ success }) => success({ code: identity }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    onNetworkStatusChange() {},
    offNetworkStatusChange() {},
    showToast() {},
    request: async (options) => {
      try {
        assert.ok(options.url.startsWith(SERVICE_ORIGIN));
        const response = await fetch(
          options.url.replace(SERVICE_ORIGIN, base),
          {
            method: options.method,
            headers: options.header,
            ...(options.data ? { body: JSON.stringify(options.data) } : {}),
          },
        );
        options.success({
          statusCode: response.status,
          data: await response.json(),
        });
      } catch (e) {
        options.fail(e);
      }
    },
  };
  vm.runInNewContext(
    readFileSync(resolve(__dirname, "../pages/index/index.js"), "utf8"),
    {
      Page: (value) => {
        definition = value;
      },
      wx,
      getApp: () => ({ globalData: { updateReady: false } }),
      require: createRequire(resolve(__dirname, "../pages/index/index.js")),
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    },
  );
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(value) {
      Object.assign(this.data, value);
    },
  };
  page.onLoad();
  return {
    page,
    store,
    identity: (value) => {
      identity = value;
    },
  };
}
test("mini activation uses server-verified WeChat identity, keeps local records and isolates account drafts, queues and jobs", async (t) => {
  const { createMultiUserService } = await import(
    "../../server/sync-multi-user.mjs"
  );
  const root = mkdtempSync(join(tmpdir(), "shixu-mini-accounts-"));
  let calls = 0;
  const service = createMultiUserService({
    directory: root,
    secret: "synthetic-mini-secret-with-32-characters",
    wechat: async (code) => code,
    ai: {
      organize: async () => {
        calls++;
        return {
          result: {
            summary: "合成",
            items: [
              {
                title: "共享待办",
                kind: "task",
                summary: "合成待办",
                facts: [],
                nextSteps: [],
                uncertainties: [],
                evidence: [],
                sourceIds: ["input"],
                due: null,
              },
            ],
            warnings: [],
          },
        };
      },
    },
    aiLimits: { enabled: true, taskBudgetMicros: 10, dailyBudgetMicros: 100 },
  });
  await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    await new Promise((done) => service.server.close(done));
    assert.ok(root.startsWith(join(tmpdir(), "shixu-mini-accounts-")));
    rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${service.server.address().port}`,
    [a, b] = service.registry.generate(2);
  const f = fixture(base);
  f.page.onDraft({ detail: { value: "本机资料不自动上传" } });
  f.page.submit();
  f.page.onDraft({ detail: { value: "本机草稿" } });
  f.page.setData({ password: a.invite });
  await f.page.connect();
  assert.equal(f.page.data.connected, true);
  assert.equal(f.page._client.records().length, 0);
  assert.equal(f.page.data.draft, "");
  assert.ok(!JSON.stringify([...f.store]).includes(a.invite));
  f.page.onDraft({ detail: { value: "A账号投递" } });
  f.page.submit();
  for (let i = 0; f.page.data.syncing && i < 50; i++)
    await new Promise((done) => setTimeout(done, 10));
  await f.page.sync();
  const id = f.page._client.records()[0].id;
  await f.page._startJob("organize", id);
  assert.ok(f.page._jobs.length, f.page.data.error);
  for (let i = 0; i < 30; i++) {
    await f.page.sync();
    if (f.page._record(id).data.result) break;
    await new Promise((done) => setTimeout(done, 10));
  }
  assert.ok(
    f.page._record(id).data.result,
    JSON.stringify({ error: f.page.data.error, jobs: f.page._jobs, calls }),
  );
  assert.equal(f.page._record(id).data.result.items[0].title, "共享待办");
  assert.equal(calls, 1);
  f.page.onDraft({ detail: { value: "A账号草稿" } });
  f.identity("wechat-b");
  f.page.setData({ password: b.invite });
  await f.page.connect();
  assert.equal(f.page.data.draft, "");
  assert.equal(f.page._client.records().length, 0);
  assert.equal(f.page._jobs.length, 0);
  f.identity("wechat-a");
  f.page.setData({ password: a.invite });
  await f.page.connect();
  assert.equal(f.page.data.draft, "A账号草稿");
  assert.equal(f.page._client.records().length, 1);
  const repeated = f.store.get(CONNECTION).token;
  const reopened = fixture(base, f.store);
  await reopened.page.sync();
  assert.equal(reopened.page.data.draft, "A账号草稿");
  assert.equal(reopened.store.get(CONNECTION).token, repeated);
  reopened.page.useLocal();
  assert.equal(reopened.page.data.draft, "本机草稿");
  assert.equal(reopened.page._client.records().length, 1);
  await reopened.page.resumeAccount();
  await reopened.page.sync();
  assert.equal(reopened.page.data.draft, "A账号草稿");
  service.registry.revoke(a.userId, "wechat");
  await reopened.page.sync();
  assert.match(reopened.page.data.error, /授权|失效/);
  assert.equal(reopened.page._client.records().length, 1);
});
