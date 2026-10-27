// This module can only manufacture synthetic databases; it has no user-data input.
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { AccountRegistry } from "../../server/sync-accounts.mjs";
import { SyncStore } from "../../server/sync-store.mjs";
import { createAttachmentStore } from "../../server/sync-files.mjs";
import { createJobQueue } from "../../server/sync-jobs.mjs";
import { DatabaseSync } from "node:sqlite";

const manufactured = new WeakSet();
export const fixtureTime = Date.UTC(2026, 9, 28);
export function assertManufactured(fixture) {
  if (!manufactured.has(fixture)) throw Error("SYNTHETIC_FIXTURE_REQUIRED");
}
export function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "shixu-stage-a-synthetic-"));
  const original = join(root, "original"),
    target = join(root, "target");
  mkdirSync(original);
  mkdirSync(target);
  const registry = new AccountRegistry(
    original,
    randomBytes(32).toString("hex"),
  );
  let store;
  try {
    const [first, second] = registry.generate(2);
    const win = registry.bind(
      first.invite,
      "windows",
      "synthetic-windows",
      "synthetic-public-key",
    );
    registry.bind(first.invite, "wechat", "synthetic-openid");
    const oldBinding = registry.bind(
      second.invite,
      "windows",
      "synthetic-revoked",
    );
    registry.revoke(second.userId, "windows");
    store = new SyncStore(join(original, "tenant.sqlite"));
    store.createDevice("Synthetic", fixtureTime, {
      id: win.id,
      token: "synthetic-device-token",
      expiresAt: fixtureTime + 86400000,
    });
    const files = createAttachmentStore(store);
    const queue = createJobQueue(store, null);
    queue.stop();
    const states = [
      "queued",
      "running",
      "applying",
      "done",
      "error",
      "conflict",
      "interrupted",
    ];
    states.forEach((state, n) => {
      const id = "packet_" + n;
      const data = {
        id,
        text: "合成资料：周五交报告",
        itemIds: [],
        sources: [],
      };
      if (state === "done") {
        data.result = { items: [{ title: "合成报告" }] };
        data.itemIds = ["paid_item"];
      }
      store.db
        .prepare("INSERT INTO sync_records VALUES(?,?,?,NULL,0)")
        .run(id, n + 1, JSON.stringify(data));
      store.db.prepare("INSERT INTO sync_jobs VALUES(?,?,?,?,?,?,?,?,?)").run(
        "job_" + n,
        win.id,
        id,
        "synthetic-fingerprint-" + n,
        JSON.stringify({ id: "job_" + n, packetId: id, baseVersion: n + 1 }),
        state,
        ["applying", "conflict"].includes(state)
          ? JSON.stringify({
              result: { items: [{ title: "已付费合成输出" }] },
            })
          : null,
        "",
        new Date(fixtureTime).toISOString(),
      );
      registry.db
        .prepare("INSERT INTO ai_usage VALUES(?,?,?,?,?,?)")
        .run(
          first.userId,
          "job_" + n,
          "synthetic-fingerprint-" + n,
          "2026-10-28",
          100000,
          state === "queued" ? "pending" : state,
        );
    });
    // Real attachment-store API verifies bytes and creates the real old BLOB tables.
    const file = files.put("packet_3", "synthetic_file", {
      name: "synthetic.txt",
      type: "text/plain",
      body: Buffer.from("纯合成附件"),
      epoch: store.epoch,
    });
    const record = store.record("packet_3");
    store.db
      .prepare("UPDATE sync_records SET data=? WHERE id=?")
      .run(JSON.stringify({ ...record.data, attachments: [file] }), "packet_3");
    store.db
      .prepare("INSERT INTO sync_operations VALUES(?,?,?,?,?)")
      .run(win.id, "synthetic-op", "synthetic-op-hash", "packet_3", 4);
    store.db
      .prepare("INSERT INTO sync_records VALUES('trashed',8,?,?,0)")
      .run(
        JSON.stringify({ id: "trashed", text: "合成回收记录" }),
        new Date(fixtureTime).toISOString(),
      );
    store.db
      .prepare("INSERT INTO sync_records VALUES('purged',9,NULL,?,1)")
      .run(new Date(fixtureTime).toISOString());
    store.db.exec("UPDATE sync_meta SET value='9' WHERE key='sequence'");
    registry.db
      .prepare("INSERT INTO nonces VALUES(?,?,?)")
      .run(win.id, "synthetic-nonce", fixtureTime + 60000);
    registry.db
      .prepare("INSERT INTO request_rates VALUES('synthetic-rate',1,2)")
      .run();
    store.close();
    store = null;
    registry.close();
    for (const name of ["accounts.sqlite", "tenant.sqlite"])
      copyFileSync(join(original, name), join(target, name));
    const fixture = Object.freeze({
      root,
      original,
      target,
      userId: first.userId,
      otherUserId: second.userId,
      bindingId: win.id,
      revokedId: oldBinding.id,
      cleanup() {
        const absolute = resolve(root);
        if (
          !absolute.startsWith(resolve(tmpdir()) + sep) ||
          !absolute.includes("shixu-stage-a-synthetic-")
        )
          throw Error("INVALID_SYNTHETIC_ROOT");
        rmSync(absolute, { recursive: true, force: true });
      },
    });
    manufactured.add(fixture);
    return fixture;
  } catch (error) {
    store?.close();
    try {
      registry.close();
    } catch {
      /* already closed */
    }
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
export function openFixture(fixture, migrated = true) {
  assertManufactured(fixture);
  return new DatabaseSync(
    join(migrated ? fixture.target : fixture.original, "accounts.sqlite"),
  );
}
export function restoreBeforeNewWrites(fixture) {
  assertManufactured(fixture);
  // Called with all handles closed. Synthetic checkpoint rollback before any new data.
  for (const name of readdirSync(fixture.target)) {
    if (
      !/^(accounts|tenant|ledger|safety)\.sqlite(?:-(?:wal|shm|journal))?$/.test(
        name,
      )
    )
      throw Error("UNEXPECTED_SYNTHETIC_FILE");
    rmSync(join(fixture.target, name));
  }
  for (const name of ["accounts.sqlite", "tenant.sqlite"])
    copyFileSync(join(fixture.original, name), join(fixture.target, name));
}
