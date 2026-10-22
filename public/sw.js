const CACHE_PREFIX =
  "shixu-shell-" + encodeURIComponent(self.registration.scope) + "-";
const CACHE = CACHE_PREFIX + "v1";
const PRECACHE = ["./", "./icon.svg", "./manifest.webmanifest"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            // Keep the preceding shell for tabs still using its hashed chunks.
            .slice(0, -1)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith(
      new URL("api/", self.registration.scope).pathname,
    ) ||
    !url.href.startsWith(self.registration.scope)
  )
    return;
  event.respondWith(serveShell(event.request));
});

async function serveShell(request) {
  const current = await caches.open(CACHE);
  const cached = await current.match(request, { ignoreVary: true });
  if (cached) return cached;

  if (request.mode === "navigate") {
    const home = await current.match(self.registration.scope, {
      ignoreVary: true,
    });
    if (home) return home;
  }

  const previousKeys = (await caches.keys()).filter(
    (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE,
  );
  for (const key of previousKeys.reverse()) {
    const previous = await (
      await caches.open(key)
    ).match(request, { ignoreVary: true });
    if (previous) return previous;
  }

  const controller = new AbortController();
  let timeout;
  try {
    const response = await Promise.race([
      fetch(request, { signal: controller.signal }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Network timeout"));
        }, 8000);
      }),
    ]);
    if (response.ok) {
      await current.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return new Response("暂时无法连接，请在网络恢复后重新打开拾序。", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } finally {
    clearTimeout(timeout);
  }
}
