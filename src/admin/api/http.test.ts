import { afterEach, expect, test, vi } from "vitest";
import { createHttpApi } from "./http";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const session = { username: "test-admin", expiresAt: "2026-11-05T00:00:00.000Z", csrfToken: "c".repeat(43) };

test("login errors retain their explanation, and CSRF and operation headers coexist", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: "账号或密码不正确", code: "UNAUTHORIZED", retryable: false }, { status: 401 }))
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(Response.json({ availableMicro: 10_000_000 }));
  vi.stubGlobal("fetch", fetcher);
  const api = createHttpApi();
  await expect(api.login("test-admin", "wrong")).rejects.toMatchObject({ code: "UNAUTHORIZED", error: "账号或密码不正确" });
  await api.login("test-admin", "synthetic-password");
  await api.topupQuota("synthetic-user", 10_000_000, "合成备注", "operation-1");
  const headers = new Headers(fetcher.mock.calls[2][1].headers);
  expect(headers.get("content-type")).toBe("application/json");
  expect(headers.get("x-operation-id")).toBe("operation-1");
  expect(headers.get("x-csrf-token")).toBe(session.csrfToken);
});

test("response-body timeout remains bounded after response headers arrive", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (_path: string, init: RequestInit) => ({
    ok: true, status: 200,
    json: () => new Promise((_done, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
  })));
  const pending = createHttpApi().getOverview();
  const result = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
  await vi.advanceTimersByTimeAsync(10_000);
  await result;
});

test("failed logout keeps the operation credential for a safe retry", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json(session))
    .mockRejectedValueOnce(new TypeError("synthetic network failure"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const api = createHttpApi();
  await api.getSession();
  await expect(api.logout()).rejects.toMatchObject({ code: "NETWORK" });
  await api.logout();
  for (const call of fetcher.mock.calls.slice(1))
    expect(new Headers(call[1].headers).get("x-csrf-token")).toBe(session.csrfToken);
});

test("HTTP sessions require an operation credential", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ username: "test-admin", expiresAt: session.expiresAt })));
  await expect(createHttpApi().getSession()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("a late anonymous session query cannot erase a successful login credential", async () => {
  let respond!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockReturnValueOnce(new Promise<Response>((done) => { respond = done; }))
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const api = createHttpApi();
  const pending = api.getSession();
  await api.login("test-admin", "synthetic-password");
  respond(Response.json(null));
  await pending;
  await api.logout();
  expect(new Headers(fetcher.mock.calls[2][1].headers).get("x-csrf-token")).toBe(session.csrfToken);
});

test("an old unauthorized response cannot invalidate a newer login", async () => {
  let respond!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockReturnValueOnce(new Promise<Response>((done) => { respond = done; }))
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const api = createHttpApi();
  const pending = expect(api.getOverview()).rejects.toMatchObject({ code: "STALE_SESSION" });
  await api.login("test-admin", "synthetic-password");
  respond(Response.json({ error: "会话已过期", code: "SESSION_EXPIRED", retryable: false }, { status: 401 }));
  await pending;
  await api.logout();
  expect(new Headers(fetcher.mock.calls[2][1].headers).get("x-csrf-token")).toBe(session.csrfToken);
});
