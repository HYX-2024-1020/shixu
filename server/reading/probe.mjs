// Only the synthetic security harness selects this fixed broker entry point.
import {
  readFileSync,
  writeFileSync,
  openSync,
  writeSync,
  closeSync,
  symlinkSync,
} from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
const { probe } = JSON.parse(readFileSync("/input/descriptor.json", "utf8"));
if (probe === "timeout") {
  for (;;) {}
}
if (probe === "memory") {
  const blocks = [];
  for (;;) blocks.push(Buffer.alloc(32 * 1024 * 1024, 0x41));
}
if (probe === "process") {
  // Each Node child consumes native threads; pids controller bounds both.
  const children = [];
  let denied = 0;
  for (let i = 0; i < 64; i++) {
    const c = spawn("/node", ["-e", "setInterval(()=>{},1000)"], {
      stdio: "ignore",
      env: {},
    });
    c.on("error", (error) => {
      if (error.code === "EAGAIN") denied++;
    });
    children.push(c);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  for (const child of children) child.kill("SIGKILL");
  process.stdout.write(
    JSON.stringify({ processLimitDenied: denied > 0, denied }),
  );
} else if (probe === "boundary") {
  const denied = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  let scratchBytes = 0,
    diskDenied = false;
  const fd = openSync("/scratch/fill", "w"),
    block = Buffer.alloc(1024 * 1024, 1);
  try {
    while (scratchBytes < 300 * 1024 * 1024)
      scratchBytes += writeSync(fd, block);
  } catch (e) {
    diskDenied = e.code === "ENOSPC";
  } finally {
    closeSync(fd);
  }
  const networkDenied = await new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: 8788 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(true));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(true);
    });
  });
  symlinkSync("/opt/shixu-sync/current/.env", "/scratch/escape");
  process.stdout.write(
    JSON.stringify({
      uid: process.getuid(),
      envKeys: Object.keys(process.env).sort(),
      noNewPrivileges: /NoNewPrivs:\s+1/.test(
        readFileSync("/proc/self/status", "utf8"),
      ),
      noCapabilities: /CapEff:\s+0+\n/.test(
        readFileSync("/proc/self/status", "utf8"),
      ),
      hostDenied: denied(() => readFileSync("/opt/shixu-sync/current/.env")),
      symlinkDenied: denied(() => readFileSync("/scratch/escape")),
      otherTaskDenied: denied(() =>
        readFileSync("/input/../other-task/sentinel"),
      ),
      inputReadOnly: denied(() => writeFileSync("/input/original", "evil")),
      runtimeReadOnly: denied(() => writeFileSync("/reader/evil", "evil")),
      networkDenied,
      diskDenied,
      scratchBytes,
    }),
  );
}
