import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

function workerHarness() {
  const handlers = {};
  const scope = "https://example.test/shixu/";
  const prefix = "shixu-shell-" + encodeURIComponent(scope) + "-";
  const stores = new Map([[prefix + "v1", new Map()]]);
  const match = (store, request) =>
    Promise.resolve(
      store.get(typeof request === "string" ? request : request.url),
    );
  const caches = {
    open: async (key) => {
      if (!stores.has(key)) stores.set(key, new Map());
      const store = stores.get(key);
      return {
        match: (request) => match(store, request),
        put: async (request, response) => store.set(request.url, response),
        addAll: async () => {},
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (key) => stores.delete(key),
  };
  const fetch = vi.fn(() => new Promise(() => {}));
  const self = {
    registration: { scope },
    location: { origin: new URL(scope).origin },
    addEventListener: (name, fn) => {
      handlers[name] = fn;
    },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
  };
  runInNewContext(
    readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"),
    {
      self,
      caches,
      fetch,
      URL,
      Response,
      AbortController,
      encodeURIComponent,
      setTimeout,
      clearTimeout,
      Promise,
    },
  );
  return {
    scope,
    prefix,
    stores,
    fetch,
    handlers,
    async request(url, mode = "cors") {
      let result;
      handlers.fetch({
        request: { url, method: "GET", mode },
        respondWith: (value) => {
          result = value;
        },
      });
      return result;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("installed application shell", () => {
  it("opens cached navigation immediately without waiting for a hanging network", async () => {
    const w = workerHarness();
    w.stores.get(w.prefix + "v1").set(w.scope, new Response("cached home"));
    expect(await (await w.request(w.scope, "navigate")).text()).toBe(
      "cached home",
    );
    expect(w.fetch).not.toHaveBeenCalled();
  });
  it("keeps the administrator entry on offline Home Screen navigation", async () => {
    const w = workerHarness();
    const cache = w.stores.get(w.prefix + "v1");
    cache.set(w.scope, new Response("ordinary home"));
    cache.set(
      w.scope + "admin-test/index.html",
      new Response("administrator home"),
    );
    expect(
      await (
        await w.request(w.scope + "admin-test/?from=home", "navigate")
      ).text(),
    ).toBe("administrator home");
    expect(w.fetch).not.toHaveBeenCalled();
  });
  it("serves cached lazy chunks and supports a preceding open tab", async () => {
    const w = workerHarness(),
      url = w.scope + "assets/previous.js";
    w.stores.set(w.prefix + "old", new Map([[url, new Response("old chunk")]]));
    expect(await (await w.request(url)).text()).toBe("old chunk");
    expect(w.fetch).not.toHaveBeenCalled();
  });
  it("ends unavailable uncached requests after eight seconds", async () => {
    vi.useFakeTimers();
    const w = workerHarness();
    const response = w.request(w.scope + "assets/missing.js");
    await vi.advanceTimersByTimeAsync(8001);
    expect((await response).status).toBe(503);
  });
  it("does not intercept another application or external AI and sync requests", async () => {
    const w = workerHarness();
    expect(await w.request(w.scope + "api/packets")).toBeUndefined();
    expect(
      await w.request("https://api.example.test/chat/completions"),
    ).toBeUndefined();
    expect(await w.request("https://example.test/other-app/")).toBeUndefined();
  });
});
