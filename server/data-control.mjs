import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { hostname } from "node:os";
import { readFileSync, lstatSync, readlinkSync } from "node:fs";
import { ensureDatabaseSchema } from "./database-schema.mjs";
import { execFileSync } from "node:child_process";

const schema = [
  {
    version: 1,
    sql: `
CREATE TABLE data_recovery_intents(operation TEXT PRIMARY KEY,actor TEXT NOT NULL,snapshot_hash TEXT NOT NULL,snapshot TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE data_recovery_finalizations(operation TEXT PRIMARY KEY REFERENCES data_recovery_intents(operation),evidence_hash TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE data_retirements(id TEXT PRIMARY KEY,source TEXT NOT NULL,expires INTEGER NOT NULL,files TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE data_retirement_disposals(id TEXT PRIMARY KEY REFERENCES data_retirements(id),operation TEXT UNIQUE NOT NULL,actor TEXT NOT NULL,tombstone_path TEXT,tombstone_hash TEXT,at INTEGER NOT NULL);
CREATE TABLE data_retirement_completions(id TEXT PRIMARY KEY REFERENCES data_retirements(id),at INTEGER NOT NULL);
CREATE TABLE data_shadow_intents(id TEXT PRIMARY KEY,source TEXT NOT NULL,files TEXT NOT NULL,expires INTEGER NOT NULL,at INTEGER NOT NULL);
CREATE TABLE data_shadow_disposals(id TEXT PRIMARY KEY REFERENCES data_shadow_intents(id),operation TEXT UNIQUE NOT NULL,actor TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE data_shadow_completions(id TEXT PRIMARY KEY REFERENCES data_shadow_intents(id),at INTEGER NOT NULL);
CREATE TABLE data_activations(id TEXT PRIMARY KEY,manifest_hash TEXT NOT NULL,previous TEXT,at INTEGER NOT NULL);
CREATE TRIGGER data_recovery_intents_no_update BEFORE UPDATE ON data_recovery_intents BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_recovery_intents_no_delete BEFORE DELETE ON data_recovery_intents BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_recovery_finalizations_no_update BEFORE UPDATE ON data_recovery_finalizations BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_recovery_finalizations_no_delete BEFORE DELETE ON data_recovery_finalizations BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_retirements_no_update BEFORE UPDATE ON data_retirements BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_retirements_no_delete BEFORE DELETE ON data_retirements BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_retirement_disposals_no_update BEFORE UPDATE ON data_retirement_disposals BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_retirement_disposals_no_delete BEFORE DELETE ON data_retirement_disposals BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_retirement_completions_no_update BEFORE UPDATE ON data_retirement_completions BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_retirement_completions_no_delete BEFORE DELETE ON data_retirement_completions BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_shadow_intents_no_update BEFORE UPDATE ON data_shadow_intents BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_shadow_intents_no_delete BEFORE DELETE ON data_shadow_intents BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_shadow_disposals_no_update BEFORE UPDATE ON data_shadow_disposals BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_shadow_disposals_no_delete BEFORE DELETE ON data_shadow_disposals BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_shadow_completions_no_update BEFORE UPDATE ON data_shadow_completions BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_shadow_completions_no_delete BEFORE DELETE ON data_shadow_completions BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_activations_no_update BEFORE UPDATE ON data_activations BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
CREATE TRIGGER data_activations_no_delete BEFORE DELETE ON data_activations BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
`,
  },
];

// Short SQLite OS-lock transactions serialize filesystem registration changes,
// including recovery. A dead recovery process cannot strand this mutex.
export function withDataControl(root, action) {
  const path = join(root, ".data-control.sqlite");
  let present;
  try {
    lstatSync(path);
    present = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    present = false;
  }
  if (present) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw Error("DATA_CONTROL_RECONCILIATION");
  }
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA synchronous=FULL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000",
    );
    ensureDatabaseSchema(db, "data-control", schema);
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = action(db);
      if (value && typeof value.then === "function")
        throw Error("SYNCHRONOUS_DATA_CONTROL_REQUIRED");
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}
function linuxStart(pid) {
  const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
  const start = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/)[19];
  if (!/^\d+$/.test(start || "")) throw Error("HOST_EVIDENCE_REQUIRED");
  return start;
}
let ownWindowsBirth;
function windowsBirth(pid) {
  const script = `$processInfo=[System.Diagnostics.Process]::GetProcessById(${pid}); [string]$processInfo.StartTime.ToUniversalTime().Ticks`;
  const value = execFileSync(
    join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    },
  ).trim();
  if (!/^\d{16,20}$/.test(value)) throw Error("HOST_EVIDENCE_REQUIRED");
  return value;
}
export function processIdentity() {
  return {
    platform: process.platform,
    host: hostname(),
    pid: process.pid,
    ...(process.platform === "linux"
      ? {
          bootId: readFileSync(
            "/proc/sys/kernel/random/boot_id",
            "utf8",
          ).trim(),
          startTicks: linuxStart(process.pid),
          pidNamespace: readlinkSync("/proc/self/ns/pid"),
        }
      : process.platform === "win32"
        ? { birthTicks: (ownWindowsBirth ??= windowsBirth(process.pid)) }
        : {}),
  };
}
// Evidence comes from the current kernel, never a request boolean. On Windows
// PID presence alone cannot unlock a lease. Windows creation time is read from
// the local OS in a hidden, profile-free metadata helper, cached for this process.
export function terminatedIdentity(identity) {
  if (
    !identity ||
    identity.platform !== process.platform ||
    identity.host !== hostname() ||
    !Number.isSafeInteger(identity.pid) ||
    identity.pid <= 0
  )
    throw Error("HOST_EVIDENCE_REQUIRED");
  if (process.platform === "linux") {
    if (
      !/^[a-f0-9-]{36}$/.test(identity.bootId || "") ||
      !/^\d+$/.test(identity.startTicks || "") ||
      !/^pid:\[\d+\]$/.test(identity.pidNamespace || "")
    )
      throw Error("HOST_EVIDENCE_REQUIRED");
    if (
      identity.bootId !==
      readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
    )
      return { terminated: true, reason: "previous-boot" };
    if (identity.pidNamespace !== readlinkSync("/proc/self/ns/pid"))
      throw Error("HOST_EVIDENCE_REQUIRED");
    try {
      return {
        terminated: linuxStart(identity.pid) !== identity.startTicks,
        reason: "kernel-process-generation",
      };
    } catch (error) {
      if (error.code === "ENOENT")
        return { terminated: true, reason: "kernel-process-absent" };
      throw error;
    }
  }
  try {
    process.kill(identity.pid, 0);
    if (process.platform === "win32") {
      if (!/^\d{16,20}$/.test(identity.birthTicks || ""))
        throw Error("HOST_EVIDENCE_REQUIRED");
      return {
        terminated: windowsBirth(identity.pid) !== identity.birthTicks,
        reason: "kernel-process-generation",
      };
    }
    return { terminated: false, reason: "pid-present" };
  } catch (error) {
    if (error.code === "ESRCH")
      return { terminated: true, reason: "kernel-process-absent" };
    throw Error("HOST_EVIDENCE_REQUIRED");
  }
}
