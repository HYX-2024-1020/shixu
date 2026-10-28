import http from "node:http";
import { chmod, chown, lstat, realpath, readdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createLinuxReader, SANDBOX_LIMITS } from "./linux-broker.mjs";
import { MAX_FILE_BYTES } from "./material.mjs";
import { randomUUID } from "node:crypto";

async function protectedPath(path) {
  let current = path;
  for (;;) {
    const info = await lstat(current);
    if (
      info.isSymbolicLink() ||
      info.uid !== 0 ||
      info.mode & 0o022 ||
      (await realpath(current)) !== current
    )
      throw Error("UNTRUSTED_BROKER_PATH");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
async function protectedTree(path) {
  await protectedPath(path);
  const info = await lstat(path);
  if (info.isDirectory())
    for (const entry of await readdir(path))
      await protectedTree(join(path, entry));
}

// A fixed-function root broker. The application receives only permission to a
// Unix socket, never sudo, systemd properties, worker paths or probe arguments.
export async function createBrokerService({ socketPath, runtime, staging }) {
  if (process.platform !== "linux" || process.getuid() !== 0)
    throw Error("ROOT_BROKER_REQUIRED");
  if (!/^\/run\/shixu-[\w-]+\/reader\.sock$/.test(socketPath))
    throw Error("INVALID_SOCKET");
  const parent = resolve(socketPath, "..");
  for (const path of [
    parent,
    runtime,
    staging,
    fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, ""),
  ])
    await protectedPath(path);
  await protectedTree(runtime);
  const code = fileURLToPath(new URL(".", import.meta.url));
  for (const name of await readdir(code))
    if (/\.[mc]js$/.test(name)) await protectedPath(join(code, name));
  const info = await lstat(parent);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== 0 ||
    info.mode & 0o022 ||
    (await realpath(parent)) !== parent
  )
    throw Error("UNTRUSTED_SOCKET_DIRECTORY");
  // Never unlink an existing socket or symlink supplied by another process.
  const reader = createLinuxReader({ runtime, staging });
  let requests = 0;
  const cancellations = new Map();
  const server = http.createServer(async (req, res) => {
    let accepted = false,
      readId,
      cancellationOwned = false;
    const streamed = req.headers["x-shixu-reader-protocol"] === "2";
    const frame = (value) => {
      if (res.destroyed) return;
      if (!res.headersSent)
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-store",
        });
      res.write(JSON.stringify(value) + "\n");
    };
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method === "DELETE" && /^\/reads\/[a-f0-9-]{36}$/.test(req.url)) {
        cancellations.get(req.url.slice(7))?.abort();
        return send(200, { cancelled: true });
      }
      if (
        req.method !== "POST" ||
        req.url !== "/read" ||
        req.headers["content-type"] !== "application/octet-stream"
      )
        return send(400, { code: "INVALID_BROKER_REQUEST" });
      if (requests >= 21) return send(429, { code: "READING_QUEUE_FULL" });
      requests++;
      accepted = true;
      const controller = new AbortController();
      if (streamed) {
        readId = req.headers["x-shixu-read-id"];
        if (
          typeof readId !== "string" ||
          !/^[a-f0-9-]{36}$/.test(readId) ||
          cancellations.has(readId)
        )
          throw Error("INVALID_BROKER_REQUEST");
        cancellations.set(readId, controller);
        cancellationOwned = true;
      }
      req.on("aborted", () => controller.abort());
      res.on("close", () => {
        if (!res.writableFinished) controller.abort();
      });
      const descriptor = JSON.parse(
        Buffer.from(
          req.headers["x-shixu-descriptor"] || "",
          "base64url",
        ).toString("utf8"),
      );
      if (Object.keys(descriptor).sort().join(",") !== "hash,id,name,size")
        throw Error();
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_FILE_BYTES) throw Error();
        chunks.push(chunk);
      }
      const output = await reader(
        { ...descriptor, body: Buffer.concat(chunks) },
        {
          signal: controller.signal,
          ...(streamed
            ? {
                activeBudgetMs: Number(req.headers["x-shixu-active-budget-ms"]),
                onPhase: (phase) => frame({ type: "phase", ...phase }),
              }
            : {}),
        },
      );
      if (streamed) {
        frame({ type: "result", ...output });
        res.end();
      } else send(200, output);
    } catch (error) {
      if (streamed) {
        frame({
          type: "error",
          code: [
            "READING_ABORTED",
            "READING_ACTIVE_LIMIT",
            "READING_QUEUE_FULL",
            "READING_TIMEOUT",
          ].includes(error.message)
            ? error.message
            : "ISOLATED_READING_FAILED",
          timing: error.timing,
        });
        res.end();
      } else if (!res.headersSent)
        send(422, { code: "ISOLATED_READING_FAILED" });
    } finally {
      if (cancellationOwned) cancellations.delete(readId);
      if (accepted) requests--;
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(socketPath, done);
  });
  await chown(socketPath, 0, info.gid);
  await chmod(socketPath, 0o660); // Parent group is selected by the service, not the client.
  return server;
}

export function createBrokerClient(socketPath) {
  if (
    typeof socketPath !== "string" ||
    !/^\/run\/shixu-[\w-]+\/reader\.sock$/.test(socketPath)
  )
    throw Error("INVALID_SOCKET");
  return (file, { signal, onPhase, activeBudgetMs = 1800000 } = {}) =>
    new Promise((done, reject) => {
      if (signal?.aborted)
        return reject(
          Object.assign(Error("READING_ABORTED"), { timing: { waitingMs: 0 } }),
        );
      const id = randomUUID();
      let completed = false,
        drainTimer;
      const finish = (error, value) => {
        if (completed) return;
        completed = true;
        clearTimeout(drainTimer);
        signal?.removeEventListener("abort", cancel);
        error ? reject(error) : done(value);
      };
      const uncertain = (error) =>
        finish(Object.assign(error, { timingUncertain: true }));
      // Keep the read response open to receive its final timing and cleanup ack.
      const cancel = () => {
        const cancellation = http.request(
          { socketPath, path: "/reads/" + id, method: "DELETE", agent: false },
          (r) => r.resume(),
        );
        cancellation.on("error", () => {});
        cancellation.setTimeout(1000, () => cancellation.destroy());
        cancellation.end();
        drainTimer = setTimeout(() => {
          uncertain(Error("READING_CANCEL_UNCONFIRMED"));
          request.destroy();
        }, 2000);
      };
      const request = http.request(
        {
          socketPath,
          agent: false,
          path: "/read",
          method: "POST",
          headers: {
            "X-Shixu-Reader-Protocol": "2",
            "X-Shixu-Read-Id": id,
            "X-Shixu-Active-Budget-Ms": String(activeBudgetMs),
            "Content-Type": "application/octet-stream",
            "Content-Length": file.body.length,
            "X-Shixu-Descriptor": Buffer.from(
              JSON.stringify({
                id: file.id,
                name: file.name,
                size: file.size,
                hash: file.hash,
              }),
            ).toString("base64url"),
          },
        },
        (response) => {
          if (response.statusCode === 429) {
            response.resume();
            response.on("end", () =>
              finish(
                Object.assign(Error("READING_QUEUE_FULL"), {
                  timing: { waitingMs: 0 },
                }),
              ),
            );
            response.on("error", uncertain);
            return;
          }
          let size = 0;
          let pending = "",
            terminal;
          if (
            response.statusCode !== 200 ||
            response.headers["content-type"] !== "application/x-ndjson"
          ) {
            response.resume();
            uncertain(Error("BROKER_PROTOCOL_REQUIRED"));
            return;
          }
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            if (completed) return;
            size += Buffer.byteLength(chunk);
            if (size > SANDBOX_LIMITS.outputBytes) {
              uncertain(Error("READING_OUTPUT_LIMIT"));
              request.destroy();
              return;
            }
            pending += chunk;
            let newline;
            while ((newline = pending.indexOf("\n")) !== -1) {
              const line = pending.slice(0, newline);
              pending = pending.slice(newline + 1);
              try {
                const value = JSON.parse(line);
                if (terminal) throw Error("INVALID_READER_OUTPUT");
                if (value.type === "phase") onPhase?.(value);
                else if (["result", "error"].includes(value.type))
                  terminal = value;
                else throw Error("INVALID_READER_OUTPUT");
              } catch (error) {
                uncertain(error);
                request.destroy();
                return;
              }
            }
          });
          response.on("end", () => {
            try {
              if (pending || !terminal) throw Error("INVALID_READER_OUTPUT");
              if (terminal.type === "error")
                finish(
                  Object.assign(Error(terminal.code), {
                    timing: terminal.timing,
                    timingUncertain: !terminal.timing,
                  }),
                );
              else if (terminal.material)
                finish(null, { ...terminal.material, timing: terminal.timing });
              else throw Error("INVALID_READER_OUTPUT");
            } catch (error) {
              uncertain(error);
            }
          });
          response.on("error", uncertain);
        },
      );
      // Queue is bounded by 20 x the 30s worker limit; inactivity is transport failure.
      request.setTimeout(650000, () =>
        request.destroy(Error("READING_TRANSPORT_TIMEOUT")),
      );
      request.on("error", uncertain);
      signal?.addEventListener("abort", cancel, { once: true });
      request.end(file.body);
    });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = await createBrokerService({
    socketPath: process.argv[2],
    runtime: process.argv[3],
    staging: process.argv[4],
  });
  const stop = () => server.close();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
