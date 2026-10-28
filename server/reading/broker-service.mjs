import http from "node:http";
import { chmod, chown, lstat, realpath, readdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createLinuxReader, SANDBOX_LIMITS } from "./linux-broker.mjs";
import { MAX_FILE_BYTES } from "./material.mjs";

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
  const server = http.createServer(async (req, res) => {
    let accepted = false;
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
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
        { signal: controller.signal },
      );
      send(200, output);
    } catch {
      if (!res.headersSent) send(422, { code: "ISOLATED_READING_FAILED" });
    } finally {
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
  return (file, { signal } = {}) =>
    new Promise((done, reject) => {
      const request = http.request(
        {
          socketPath,
          path: "/read",
          method: "POST",
          signal,
          headers: {
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
          let size = 0;
          const chunks = [];
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > SANDBOX_LIMITS.outputBytes)
              request.destroy(Error("READING_OUTPUT_LIMIT"));
            else chunks.push(chunk);
          });
          response.on("end", () => {
            try {
              if (response.statusCode !== 200)
                throw Error("ISOLATED_READING_FAILED");
              const value = JSON.parse(Buffer.concat(chunks));
              if (!value.material) throw Error("INVALID_READER_OUTPUT");
              done({ ...value.material, timing: value.timing });
            } catch (error) {
              reject(error);
            }
          });
          response.on("error", reject);
        },
      );
      request.setTimeout(35000, () =>
        request.destroy(Error("READING_TIMEOUT")),
      );
      request.on("error", reject);
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
