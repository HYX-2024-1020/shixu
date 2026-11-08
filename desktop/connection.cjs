const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

// Explicit installed private connection, provisioned outside the application.
// Renderer and test environment overrides cannot select this transport.
function readPrivateConnection(localAppData) {
  const root = path.join(localAppData, "Shixu", "Connection"),
    file = path.join(root, "connection.json");
  if (!fs.existsSync(file)) return null;
  const c = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    c.version !== 1 ||
    typeof c.host !== "string" ||
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(c.host) ||
    c.user !== "shixu-access"
  )
    throw Error("INVALID_PRIVATE_CONNECTION");
  for (const name of ["id_ed25519", "known_hosts"])
    if (!fs.statSync(path.join(root, name)).isFile())
      throw Error("PRIVATE_CONNECTION_INCOMPLETE");
  return { ...c, root, origin: "http://127.0.0.1:18788" };
}
function startPrivateConnection(c, { onError = () => {} } = {}) {
  const executable = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "OpenSSH",
    "ssh.exe",
  );
  let child,
    closed = false,
    timer,
    ready = false,
    connectionAbort = new AbortController();
  const start = () => {
    if (closed) return;
    connectionAbort = new AbortController();
    child = spawn(
      executable,
      [
        "-v",
        "-N",
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${path.join(c.root, "known_hosts")}`,
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=2",
        "-i",
        path.join(c.root, "id_ed25519"),
        "-L",
        "127.0.0.1:18788:127.0.0.1:8790",
        `${c.user}@${c.host}`,
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    let output = '';
    child.stderr.on("data", (bytes) => {
      output = (output + bytes.toString()).slice(-8192);
      if (
        output
          .includes("Local forwarding listening on 127.0.0.1 port 18788")
      )
        ready = true;
    });
    child.on("error", () =>
      onError("受保护连接无法启动，请检查 Windows OpenSSH。"),
    );
    child.on("exit", () => {
      ready = false;
      connectionAbort.abort();
      if (!closed) {
        onError("云连接已断开，正在重新连接；本机资料保留。");
        timer = setTimeout(start, 5000);
      }
    });
  };
  start();
  const stop = () => {
    closed = true;
    ready = false;
    connectionAbort.abort();
    clearTimeout(timer);
    child?.kill();
  };
  stop.fetch = async (url, options = {}) => {
    if(new URL(url).origin!==c.origin)throw Error('PRIVATE_CONNECTION_ORIGIN_REJECTED');
    const until = Date.now() + 12_000;
    while (!ready && !closed && Date.now() < until)
      await new Promise((r) => setTimeout(r, 100));
    if (!ready) throw Error("PRIVATE_CONNECTION_UNAVAILABLE");
    return fetch(url, {
      ...options,
      signal: AbortSignal.any([
        connectionAbort.signal,
        ...(options.signal ? [options.signal] : []),
      ]),
    });
  };
  return stop;
}
module.exports = { readPrivateConnection, startPrivateConnection };
