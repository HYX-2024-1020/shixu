import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SyncStore } from "../sync-store.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { createReadingRoutes } from "./routes.mjs";
const { hydrateReadingChanges } = createRequire(import.meta.url)(
  "../../miniprogram/lib/reading-transport.js",
);

test("published output beyond 800KB is paged losslessly, ordinary edits preserve it, and a changed page version fails closed", async () => {
  const store = new SyncStore(":memory:"),
    ledger = new ReadingLedger(":memory:");
  ledger.freezePrice({
    id: "fixture",
    model: "fixture",
    currency: "CNY",
    source: "synthetic",
    verifiedAt: 1,
    inputMicrosPerMillion: 1,
    cachedMicrosPerMillion: 0,
    outputMicrosPerMillion: 1,
  });
  const device = store.createDevice("synthetic");
  const routes = createReadingRoutes({
    ledger,
    reader() {},
    provider() {},
    priceId: "fixture",
    modelVersion: "fixture",
    authorize(account, id) {
      assert.equal(account, "a");
      assert.equal(id, device.deviceId);
    },
  });
  const put = (data, internal = {}) =>
    store.apply(
      device.deviceId,
      {
        opId: crypto.randomUUID(),
        id: "packet",
        type: "put",
        baseVersion: store.record("packet")?.version || 0,
        data,
      },
      store.epoch,
      internal,
    );
  const result = {
    summary: "完整长结果",
    items: Array.from({ length: 600 }, (_, i) => ({
      title: `事项${i}`,
      summary: "完整😀摘要".repeat(160),
    })),
    warnings: [],
  };
  try {
    put({ text: "合成", result: null });
    assert.throws(
      () => put({ result }),
      (e) => e.code === "TOO_LARGE",
    );
    put(
      {
        result,
        readingCoverage: [{ state: "read", covered: [{ start: 0, end: 2 }] }],
      },
      { taskId: "synthetic-publication" },
    );
    const expected = store.record("packet");
    assert.ok(Buffer.byteLength(JSON.stringify(expected)) > 800000);
    let pageCount = 0,
      mutate = false;
    const request = async (method, path) => {
      const response = await routes.handle({
        account: "a",
        device: device.deviceId,
        store,
        method,
        url: new URL(path, "http://localhost"),
        value: {},
      });
      assert.ok(Buffer.byteLength(JSON.stringify(response)) < 400000);
      if (path.includes("/records/")) {
        pageCount++;
        if (mutate) {
          mutate = false;
          put({ text: "修改" });
        }
      }
      return response;
    };
    const path = `/api/v3/changes?cursor=0&epoch=${store.epoch}`;
    const hydrated = await hydrateReadingChanges(request, path);
    assert.deepEqual(hydrated.records[0], expected);
    assert.ok(pageCount > 5);
    put({ itemState: { item599: { starred: true } } });
    assert.deepEqual(store.record("packet").data.result, result);
    mutate = true;
    await assert.rejects(
      hydrateReadingChanges(request, path),
      (e) => e.code === "REVISION_CONFLICT",
    );
  } finally {
    await routes.close();
    ledger.close();
    store.close();
  }
});

test("v4 input and account authority cannot be supplied by HTTP callers", async () => {
  const store = new SyncStore(":memory:"),
    ledger = new ReadingLedger(":memory:");
  ledger.freezePrice({
    id: "fixture",
    model: "fixture",
    currency: "CNY",
    source: "synthetic",
    verifiedAt: 1,
    inputMicrosPerMillion: 1,
    cachedMicrosPerMillion: 0,
    outputMicrosPerMillion: 1,
  });
  const routes = createReadingRoutes({
    ledger,
    reader() {},
    provider() {},
    priceId: "fixture",
    modelVersion: "fixture",
    authorize() {
      throw Error("REVOKED");
    },
  });
  try {
    await assert.rejects(
      routes.handle({
        account: "forged",
        device: "forged",
        store,
        method: "GET",
        url: new URL("http://localhost/api/v4/tasks"),
      }),
      /REVOKED/,
    );
  } finally {
    await routes.close();
    ledger.close();
    store.close();
  }
});
