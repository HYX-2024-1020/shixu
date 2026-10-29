import { spawn } from "node:child_process";
import {
  mkdtemp,
  writeFile,
  chmod,
  rm,
  realpath,
  lstat,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { MAX_FILE_BYTES, sha256 } from "./material.mjs";
import { validateArchiveWindow } from "./archive-window.mjs";
import { validatePdfWindow } from "./pdf-window.mjs";

const moduleDirectory = fileURLToPath(new URL(".", import.meta.url));
export const SANDBOX_LIMITS = Object.freeze({
  memory: "512M",
  tasks: 16,
  cpu: "50%",
  scratch: "256M",
  timeoutSeconds: 30,
  outputBytes: 64 * 1024 * 1024,
});

export function sandboxArguments({
  runtime,
  input,
  unit,
  worker = "/reader/worker.mjs",
  timeoutSeconds = 30,
}) {
  if (
    !/^shixu-reader-[a-f0-9-]+$/.test(unit) ||
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds < 0.001 ||
    timeoutSeconds > 30
  )
    throw Error("INVALID_SANDBOX_CONFIG");
  for (const path of [runtime, input, moduleDirectory])
    if (!path.startsWith("/") || /[\x00-\x20:%]/.test(path))
      throw Error("INVALID_SANDBOX_PATH");
  if (!input.startsWith("/run/shixu-") || input.split("/").includes(".."))
    throw Error("EPHEMERAL_INPUT_REQUIRED");
  if (!["/reader/worker.mjs", "/reader/probe.mjs"].includes(worker))
    throw Error("INVALID_WORKER");
  const properties = {
    RootDirectory: runtime,
    DynamicUser: "yes",
    PrivateNetwork: "yes",
    PrivateDevices: "yes",
    PrivateIPC: "yes",
    ProtectSystem: "strict",
    ProtectHome: "yes",
    ProtectProc: "invisible",
    ProcSubset: "pid",
    NoNewPrivileges: "yes",
    CapabilityBoundingSet: "",
    AmbientCapabilities: "",
    RestrictAddressFamilies: "AF_UNIX",
    IPAddressDeny: "any",
    RestrictNamespaces: "yes",
    RestrictSUIDSGID: "yes",
    LockPersonality: "yes",
    UMask: "0077",
    MemoryMax: SANDBOX_LIMITS.memory,
    MemorySwapMax: "0",
    TasksMax: String(SANDBOX_LIMITS.tasks),
    CPUQuota: SANDBOX_LIMITS.cpu,
    RuntimeMaxSec: String(timeoutSeconds),
    TimeoutStopSec: "1",
    KillMode: "control-group",
    LimitCORE: "0",
    LimitNOFILE: "64",
    TemporaryFileSystem:
      "/scratch:rw,nosuid,nodev,noexec,mode=1777,size=" +
      SANDBOX_LIMITS.scratch,
    WorkingDirectory: "/scratch",
    MountAPIVFS: "yes",
    RuntimeDirectory: input.slice("/run/".length),
    RuntimeDirectoryMode: "0700",
    RuntimeDirectoryPreserve: "no",
    ReadOnlyPaths: input,
    SystemCallFilter:
      "~@mount @reboot @swap @raw-io @privileged @obsolete @debug",
  };
  return [
    "--quiet",
    "--wait",
    "--pipe",
    "--collect",
    "--service-type=exec",
    "--unit=" + unit,
    ...Object.entries(properties).flatMap(([key, value]) => [
      "--property",
      `${key}=${value}`,
    ]),
    "--property",
    `BindReadOnlyPaths=${moduleDirectory}:/reader`,
    "--property",
    `BindReadOnlyPaths=${input}:/input`,
    "/env",
    "-i",
    "PATH=/",
    "LANG=C.UTF-8",
    "/node",
    worker,
  ];
}

function run(args, unit, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(Error("READING_ABORTED"));
  return new Promise((resolvePromise, reject) => {
    const child = spawn("/usr/bin/systemd-run", args, {
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let size = 0,
      errors = 0,
      failure = null;
    const chunks = [];
    // Killing only systemd-run would leave the service alive. Always stop its
    // entire cgroup on broker timeout, output overflow or caller cancellation.
    const stop = (code) => {
      if (failure) return;
      failure = Error(code);
      const killer = spawn("/usr/bin/systemctl", ["stop", unit], {
        env: { PATH: "/usr/bin:/bin" },
        stdio: "ignore",
      });
      killer.on("error", () => {});
    };
    const abort = () => stop("READING_ABORTED");
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("READING_TIMEOUT"), 35000);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > SANDBOX_LIMITS.outputBytes) stop("READING_OUTPUT_LIMIT");
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk.length;
      if (errors > 65536) stop("READING_DIAGNOSTIC_LIMIT");
    });
    child.on("error", () => {
      failure = Error("ISOLATION_UNAVAILABLE");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure || code) reject(failure || Error("ISOLATED_READING_FAILED"));
      else {
        try {
          resolvePromise(JSON.parse(Buffer.concat(chunks)));
        } catch {
          reject(Error("INVALID_READER_OUTPUT"));
        }
      }
    });
  });
}

// One broker per server, not per tenant: the heavy parser queue is global.
// Waiting entries hold only caller promises; callers retain their input until
// acquired. Abort removes a waiting entry without starting another worker.
export function createLinuxReader({ runtime, staging }) {
  if (process.platform !== "linux") throw Error("LINUX_ISOLATION_REQUIRED");
  if (!staging.startsWith("/run/shixu-"))
    throw Error("EPHEMERAL_STAGING_REQUIRED");
  let busy = false;
  const waiting = [];
  const acquire = (signal, queued) =>
    new Promise((resolveAcquire, reject) => {
      if (signal?.aborted) return reject(Error("READING_ABORTED"));
      if (!busy) {
        busy = true;
        return resolveAcquire();
      }
      if (waiting.length >= 20) return reject(Error("READING_QUEUE_FULL"));
      const entry = { resolve: resolveAcquire, reject, signal, abort: null };
      entry.abort = () => {
        waiting.splice(waiting.indexOf(entry), 1);
        reject(Error("READING_ABORTED"));
      };
      signal?.addEventListener("abort", entry.abort, { once: true });
      waiting.push(entry);
      queued();
    });
  const release = () => {
    const next = waiting.shift();
    if (!next) {
      busy = false;
      return;
    }
    next.signal?.removeEventListener("abort", next.abort);
    next.resolve();
  };
  const reader = async (
    file,
    { signal, probe, onPhase, activeBudgetMs = 1800000, pdfWindow, archiveWindow } = {},
  ) => {
    archiveWindow = validateArchiveWindow(archiveWindow);
    if (archiveWindow && !/\.(zip|rar|7z)$/i.test(file.name)) throw Error("INVALID_ARCHIVE_WINDOW");
    pdfWindow = validatePdfWindow(pdfWindow);
    if (pdfWindow && !/\.pdf$/i.test(file.name)) throw Error("INVALID_PDF_WINDOW");
    if (
      !Number.isFinite(activeBudgetMs) ||
      activeBudgetMs < 1 ||
      activeBudgetMs > 1800000
    )
      throw Error("INVALID_READING_BUDGET");
    const queuedAt = performance.now();
    let acquiredAt,
      directory,
      timer,
      queued = false;
    const deadline = new AbortController();
    try {
      await acquire(signal, () => {
        queued = true;
        onPhase?.({ phase: "queued" });
      });
      acquiredAt = performance.now();
      const waitingMs = queued ? acquiredAt - queuedAt : 0;
      onPhase?.({ phase: "active", waitingMs });
      timer = setTimeout(
        () => deadline.abort(Error("READING_ACTIVE_LIMIT")),
        activeBudgetMs,
      );
      signal = signal
        ? AbortSignal.any([signal, deadline.signal])
        : deadline.signal;
      if (signal?.aborted) throw Error("READING_ABORTED");
      for (const path of [runtime, staging]) {
        const s = await lstat(path);
        if (
          !s.isDirectory() ||
          s.isSymbolicLink() ||
          s.uid !== 0 ||
          s.mode & 0o022 ||
          (path === staging && s.mode & 0o077) ||
          (await realpath(path)) !== resolve(path)
        )
          throw Error("UNTRUSTED_SANDBOX_DIRECTORY");
      }
      // Never rely on a filename/MIME/client preview as proof of integrity.
      const body = Buffer.from(file.body);
      if (
        !body.length ||
        body.length > MAX_FILE_BYTES ||
        file.size !== body.length ||
        file.hash !== sha256(body)
      )
        throw Error("INPUT_INTEGRITY");
      directory = await mkdtemp(join(staging, "read-"));
      await chmod(directory, 0o700);
      await writeFile(join(directory, "original"), body, { mode: 0o400 });
      await writeFile(
        join(directory, "descriptor.json"),
        JSON.stringify({
          id: file.id,
          name: file.name,
          size: file.size,
          hash: file.hash,
          ...(pdfWindow ? { pdfWindow } : {}),
          ...(archiveWindow ? { archiveWindow } : {}),
          ...(probe ? { probe } : {}),
        }),
        { mode: 0o400 },
      );
      const unit = "shixu-reader-" + randomUUID(),
        started = performance.now();
      const output = await run(
        sandboxArguments({
          runtime,
          input: directory,
          unit,
          timeoutSeconds: Math.max(0.001, Math.min(30, activeBudgetMs / 1000)),
          ...(probe
            ? {
                worker: "/reader/probe.mjs",
                timeoutSeconds: probe === "timeout" ? 2 : 30,
              }
            : {}),
        }),
        unit,
        { signal },
      );
      return {
        ...output,
        timing: {
          waitingMs,
          prepareMs: started - acquiredAt,
          isolatedMs: performance.now() - started,
        },
      };
    } catch (error) {
      const failure = deadline.signal.aborted
        ? Error("READING_ACTIVE_LIMIT")
        : error;
      failure.timing = {
        waitingMs: queued ? (acquiredAt || performance.now()) - queuedAt : 0,
      };
      throw failure;
    } finally {
      clearTimeout(timer);
      // Only the mkdtemp path owned by this invocation can be removed.
      try {
        if (directory) await rm(directory, { recursive: true, force: true });
      } finally {
        if (acquiredAt !== undefined) release();
      }
    }
  };
  return Object.assign(reader, { pdfWindows:true, archiveWindows:true });
}
