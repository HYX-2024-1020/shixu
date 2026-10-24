const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function pageFixture({
  store = new Map(),
  failWrite = () => false,
  app = { globalData: { updateReady: true } },
  confirm = false,
} = {}) {
  let definition,
    applies = 0;
  app.updateManager = {
    applyUpdate() {
      applies++;
    },
  };
  const context = {
    Page(value) {
      definition = value;
    },
    getApp: () => app,
    require: createRequire(resolve(__dirname, "../pages/index/index.js")),
    setInterval,
    clearInterval,
    wx: {
      getStorageSync: (key) => store.get(key),
      setStorageSync: (key, value) => {
        if (failWrite(key, value)) throw new Error("disk full");
        store.set(key, structuredClone(value));
      },
      onNetworkStatusChange() {},
      offNetworkStatusChange() {},
      getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
      showToast() {},
      showModal: (options) => options.success({ confirm }),
    },
  };
  vm.runInNewContext(
    readFileSync(resolve(__dirname, "../pages/index/index.js"), "utf8"),
    context,
  );
  const page = Object.assign({}, definition, {
    data: structuredClone(definition.data),
    setData(value) {
      Object.assign(this.data, value);
    },
  });
  page.onLoad();
  return { page, store, applied: () => applies };
}
test("a failed draft clear reuses the durable capture ID after restart", () => {
  let full = false;
  const fixture = pageFixture({
    failWrite: (key, value) => full && key.includes(":draft:") && value === "",
  });
  const ids = [];
  fixture.page.onDraft({ detail: { value: "老师的通知" } });
  const queuedId = fixture.store.get("shixu:mini:draft:v1").id;
  fixture.page._client = {
    newId: () => assert.fail("must reuse draft ID"),
    put: (id) => ids.push(id),
  };
  fixture.page._refresh = () => {};
  fixture.page.syncQuietly = () => {};
  full = true;
  fixture.page.submit();
  assert.equal(ids[0], queuedId);
  assert.equal(fixture.page.data.draft, "老师的通知");
  const reopened = pageFixture({ store: fixture.store });
  reopened.page._client = {
    newId: () => assert.fail("must reuse persisted draft ID"),
    put: (id) => ids.push(id),
  };
  reopened.page._refresh = () => {};
  reopened.page.syncQuietly = () => {};
  reopened.page.submit();
  assert.equal(ids[1], ids[0]);
  assert.equal(reopened.page.data.draft, "");
});
test("updates require a successful draft save and wait for active synchronization", () => {
  const failed = pageFixture({ failWrite: () => true, confirm: true });
  failed.page.setData({ draft: "keep my input" });
  failed.page.applyUpdate();
  assert.equal(failed.applied(), 0);
  assert.match(failed.page.data.error, /草稿保存失败/);
  const busy = pageFixture({ confirm: true });
  busy.page.setData({ syncing: true });
  busy.page.applyUpdate();
  assert.equal(busy.applied(), 0);
  const ready = pageFixture({ confirm: true });
  ready.page.onDraft({ detail: { value: "saved before update" } });
  ready.page.applyUpdate();
  assert.equal(ready.applied(), 1);
  assert.equal(
    ready.store.get("shixu:mini:draft:v1").text,
    "saved before update",
  );
});
test("launching a new version preserves draft and merely offers the downloaded update", () => {
  let definition,
    callback,
    applies = 0;
  const visible = {
    setData(value) {
      this.value = value;
    },
  };
  vm.runInNewContext(readFileSync(resolve(__dirname, "../app.js"), "utf8"), {
    App(value) {
      definition = value;
    },
    getCurrentPages: () => [visible],
    wx: {
      getUpdateManager: () => ({
        onUpdateReady(fn) {
          callback = fn;
        },
        onUpdateFailed() {},
        applyUpdate() {
          applies++;
        },
      }),
    },
  });
  definition.onLaunch();
  callback();
  assert.equal(definition.globalData.updateReady, true);
  assert.equal(visible.value.updateReady, true);
  assert.equal(applies, 0);
});
