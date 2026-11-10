import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  lstatSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CloudOperations } from "../server/cloud-operations.mjs";
import {
  takeCloudSnapshot,
  restoreCloudSnapshot,
  listCloudSnapshots,
  rotateCloudSnapshots,
  cleanCloudStorage,
  recoverCloudMaintenance,
} from "../server/cloud-backup.mjs";
import { readingAuthorityFloor } from "../server/data-versions.mjs";

const ROOT = "/opt/shixu-cloud",
  STATE = "/var/lib/shixu-cloud-ledger/operations.sqlite",
  BACKUPS = "/var/lib/shixu-cloud-backups",
  FLOOR = "/var/lib/shixu-cloud-authority/latest.json";
const code = (e) =>
  /^[A-Z][A-Z_]{2,100}$/.test(e.code || e.message || "")
    ? e.code || e.message
    : "OPERATION_FAILED";
const command = (file, args, options = {}) =>
  execFileSync(file, args, { stdio: "ignore", timeout: 45000, ...options });
const systemctl = (action) =>
  command("/usr/bin/systemctl", [action, "shixu-cloud"]);
function floor() {
  if (existsSync(FLOOR))
    readingAuthorityFloor(
      configuration().ledgerPath,
      JSON.parse(readFileSync(FLOOR, "utf8")),
    );
  const value = readingAuthorityFloor(configuration().ledgerPath);
  mkdirSync(dirname(FLOOR), { recursive: true, mode: 0o750 });
  writeFileSync(FLOOR + ".tmp", JSON.stringify(value) + "\n", { mode: 0o640 });
  renameSync(FLOOR + ".tmp", FLOOR);
  command("/usr/bin/chown", ["root:shixu-cloud", dirname(FLOOR), FLOOR]);
}
function configuration() {
  const runtime = JSON.parse(readFileSync(process.env.SYNC_V4_CONFIG, "utf8"));
  if (
    runtime.directory !== "/var/lib/shixu-cloud/accounts" ||
    runtime.ledgerPath !== "/var/lib/shixu-cloud-ledger/ledger.sqlite" ||
    process.env.SHIXU_ADMIN_STATE !== STATE
  )
    throw Error("OPERATION_CONFIG_REJECTED");
  return {
    ...runtime,
    secret: process.env.SYNC_ACCOUNT_SECRET,
    operationsPath: STATE,
    backupRoot: BACKUPS,
    authorityFloor: existsSync(FLOOR)
      ? JSON.parse(readFileSync(FLOOR, "utf8"))
      : undefined,
    startedAt: Date.now(),
  };
}
function releases() {
  return readdirSync(join(ROOT, "releases"))
    .filter((id) => /^deploy-[a-f0-9]{7,40}$/.test(id))
    .map((id) => {
      const directory = join(ROOT, "releases", id);
      if (lstatSync(directory).isSymbolicLink())
        throw Error("RELEASE_PATH_REJECTED");
      const m = JSON.parse(
        readFileSync(join(directory, "release.json"), "utf8"),
      );
      return {
        id,
        source: m.sourceRevision,
        version: m.version || null,
        ledgerCoreVersion: m.ledgerCoreVersion || 7,
      };
    });
}
function treeBytes(path) {
  if (!existsSync(path)) return 0;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  return readdirSync(path).reduce(
    (n, name) => n + treeBytes(join(path, name)),
    0,
  );
}
function inventory(ops) {
  ops.setInventory({
    sampledAt: new Date().toISOString(),
    releaseId: realpathSync(join(ROOT, "current")).split("/").at(-1),
    releases: releases(),
    snapshots: listCloudSnapshots(BACKUPS, { verifyHashes: false }),
    storage: {
      dataTreeBytes: treeBytes("/var/lib/shixu-cloud"),
      authorityBytes: treeBytes("/var/lib/shixu-cloud-ledger"),
      backupBytes: treeBytes(BACKUPS),
      temporaryBytes: treeBytes("/run/shixu-cloud-staging"),
      systemJournalBytes: treeBytes("/var/log/journal"),
    },
  });
}
async function health() {
  for (let i = 0; i < 15; i++) {
    try {
      const r = await fetch("http://127.0.0.1:8790/api/v4/capabilities", {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok && (await r.json()).contractVersion === 1) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("SERVICE_HEALTH_FAILED");
}
function offline(kind, id) {
  try {
    command(
      "/usr/sbin/runuser",
      [
        "-u",
        "shixu-cloud",
        "--",
        "/usr/bin/env",
        "node",
        "--env-file=/etc/shixu-cloud/service.env",
        join(ROOT, "current/scripts/cloud-operations-worker.mjs"),
        "--offline",
        kind,
        id,
      ],
      { timeout: 270000, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    const message = String(e.stderr || "").trim();
    throw Error(/^[A-Z_]{3,100}$/.test(message) ? message : "OPERATION_FAILED");
  }
}
export async function tick() {
  const ops = new CloudOperations(STATE);
  try {
    const orphan = ops.jobs().find((j) => j.state === "running");
    if (orphan) {
      systemctl("stop");
      ops.event(orphan.id, "failed", "OPERATION_INTERRUPTED");
      ops.setMaintenance(true, "上次维护中断，请核对后手动恢复", orphan.id);
      try {
        command(
          "/usr/sbin/runuser",
          [
            "-u",
            "shixu-cloud",
            "--",
            "/usr/bin/env",
            "node",
            "--env-file=/etc/shixu-cloud/service.env",
            join(ROOT, "current/scripts/cloud-operations-worker.mjs"),
            "--recover",
            orphan.id,
          ],
          { timeout: 45000 },
        );
      } finally {
        systemctl("start");
      }
    }
    floor();
    const local = new Date(Date.now() + 8 * 3600000).toISOString(),
      scheduled = "scheduled-backup-" + local.slice(0, 10).replaceAll("-", "");
    if (
      Number(local.slice(11, 13)) < 4 &&
      !ops.db.prepare("SELECT 1 FROM cloud_jobs WHERE kind='backup'").get()
    )
      ops.request(
        "backup",
        { reason: "首次部署一致性备份" },
        "initial-cloud-backup",
        "system",
      );
    if (
      Number(local.slice(11, 13)) >= 4 &&
      !ops.db.prepare("SELECT 1 FROM cloud_jobs WHERE id=?").get(scheduled)
    ) {
      try {
        ops.request(
          "backup",
          { reason: "每日北京时间04:00一致备份" },
          scheduled,
          "system",
        );
      } catch (e) {
        if (e.code !== "OPERATION_BUSY") throw e;
      }
    }
    const job = ops.jobs().find((j) => j.state === "queued");
    if (!job) {
      rotateCloudSnapshots(BACKUPS);
      inventory(ops);
      return;
    }
    ops.event(job.id, "running");
    let stopped = false,
      previous;
    try {
      if (job.kind === "resume") {
        systemctl("start");
        await health();
        ops.setMaintenance(false, "", job.id);
        ops.event(job.id, "succeeded");
      } else {
        systemctl("stop");
        stopped = true;
        floor();
        if (["backup", "restore", "cleanup"].includes(job.kind))
          offline(job.kind, job.id);
        if (job.kind === "rollback") {
          const current = realpathSync(join(ROOT, "current")),
            target = join(ROOT, "releases", job.args.releaseId);
          if (
            !releases().some(
              (r) => r.id === job.args.releaseId && r.ledgerCoreVersion >= 8,
            )
          )
            throw Error("RELEASE_SCHEMA_INCOMPATIBLE");
          command("/usr/bin/sha256sum", ["--strict", "-c", "SHA256SUMS"], {
            cwd: target,
          });
          previous = current;
          command("/usr/bin/ln", ["-sfn", target, join(ROOT, "current")]);
        }
        systemctl("start");
        stopped = false;
        await health();
        floor();
        ops.setMaintenance(false, "", job.id);
        if (!["backup", "restore", "cleanup"].includes(job.kind))
          ops.event(job.id, "succeeded");
        else
          ops.event(
            job.id,
            "succeeded",
            "",
            ops.jobs().find((j) => j.id === job.id).result || {},
          );
      }
    } catch (e) {
      if (previous)
        command("/usr/bin/ln", ["-sfn", previous, join(ROOT, "current")]);
      ops.setMaintenance(
        true,
        "维护失败：" + code(e) + "；上传和AI保持暂停，基本读取尽量保留",
        job.id,
      );
      ops.event(job.id, "failed", code(e));
      if (stopped || previous) {
        systemctl("start");
        try {
          await health();
        } catch {}
      }
    }
    inventory(ops);
  } finally {
    ops.close();
  }
}
async function main() {
  if (process.argv[2] === "--recover") {
    const config = configuration(),
      ops = new CloudOperations(STATE),
      id = process.argv[3];
    try {
      if (
        !/^[\w-]{8,90}$/.test(id || "") ||
        !ops.jobs().some((j) => j.id === id && j.state === "failed")
      )
        throw Error("RECOVERY_JOB_REQUIRED");
      recoverCloudMaintenance(config, "recover-" + id.slice(0, 70));
    } finally {
      ops.close();
    }
    return;
  }
  if (process.argv[2] === "--offline") {
    const [kind, id] = process.argv.slice(3),
      config = configuration(),
      ops = new CloudOperations(STATE);
    try {
      const job = ops
        .jobs()
        .find((j) => j.id === id && j.kind === kind && j.state === "running");
      if (!job) throw Error("OPERATION_NOT_RUNNING");
      let result;
      if (kind === "backup") {
        cleanCloudStorage(config);
        result = await takeCloudSnapshot(config);
      } else if (kind === "restore")
        result = restoreCloudSnapshot(config, job.args.snapshotId);
      else if (kind === "cleanup") result = cleanCloudStorage(config);
      else throw Error("INVALID_OPERATION");
      ops.event(id, "running", "", result);
    } catch (e) {
      throw Error(code(e));
    } finally {
      ops.close();
    }
  } else if (process.argv[2] === "--tick" && process.getuid?.() === 0)
    await tick();
  else if (process.argv[2] === "--seal-floor" && process.getuid?.() === 0)
    floor();
  else throw Error("OPERATION_AUTHORITY_REQUIRED");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    process.stderr.write(code(e) + "\n");
    process.exitCode = 1;
  });
