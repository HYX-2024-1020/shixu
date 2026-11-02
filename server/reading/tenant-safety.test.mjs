import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { OriginalStore } from "../originals.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingRootSafety } from "./root-safety.mjs";
import { ensureDatabaseSchema } from "../database-schema.mjs";
import { TENANT_SYNC_SCHEMA } from "../database-schemas.mjs";
import { TenantSafety } from "../tenant-safety.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "shixu-tenant-safety-"));
  const path = join(root, "tenant.sqlite"),
    clock = { at: 1000 };
  const ledger = new ReadingLedger(join(root, "ledger.sqlite"), {
    now: () => clock.at,
  });
  let store, originals;
  const close = () => {
    originals?.close();
    store?.close();
    originals = store = null;
  };
  const open = () => {
    store = new SyncStore(path);
    createAttachmentStore(store);
    originals = new OriginalStore(store, {
      now: () => clock.at,
      safety: { ledger, account: "synthetic" },
    });
  };
  t.after(() => {
    close();
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  });
  open();
  return {
    root,
    path,
    clock,
    ledger,
    open,
    close,
    get store() {
      return store;
    },
    get originals() {
      return originals;
    },
    op(type, id = "packet", data = { text: "synthetic" }) {
      const device =
        store.db.prepare("SELECT id FROM sync_devices LIMIT 1").get()?.id ||
        store.createDevice("synthetic").deviceId;
      return store.apply(
        device,
        {
          id,
          opId: crypto.randomUUID(),
          type,
          baseVersion: store.record(id)?.version || 0,
          ...(type === "put" ? { data } : {}),
        },
        store.epoch,
      );
    },
    async snapshot(name = "before") {
      await backup(store.db, join(root, name + ".sqlite"));
    },
    restore(name = "before") {
      close();
      copyFileSync(join(root, name + ".sqlite"), path);
      open();
    },
    upload(packet = "packet", mode = "retained") {
      this.op("put", packet);
      const body = Buffer.from("synthetic-private-original"),
        file = {
          id: "file",
          name: "private-name.txt",
          type: "text/plain",
          size: body.length,
          hash: createHash("sha256").update(body).digest("hex"),
        };
      const s = originals.begin({
        submissionId: "upload-" + packet,
        packetId: packet,
        manifest: [file],
        storageIntent: mode,
        epoch: store.epoch,
      });
      originals.put(s.submissionId, file.id, body);
      const device = store.db
        .prepare("SELECT id FROM sync_devices LIMIT 1")
        .get().id;
      originals.commit(
        s.submissionId,
        {
          manifestHash: s.manifestHash,
          epoch: store.epoch,
          operation: {
            opId: "commit-" + packet,
            id: packet,
            type: "put",
            baseVersion: store.record(packet).version,
            data: { attachments: [file] },
          },
        },
        device,
      );
      return { file, body };
    },
  };
}

test("old tenant snapshot cannot resurrect a permanently purged packet; replay changes epoch", async (t) => {
  const f = fixture(t);
  f.op("put");
  const epoch = f.store.epoch;
  await f.snapshot();
  f.op("delete");
  f.op("purge");
  f.restore();
  assert.equal(f.store.record("packet").purged, true);
  assert.equal(f.store.record("packet").data, null);
  assert.notEqual(f.store.epoch, epoch);
  const device = f.store.db
    .prepare("SELECT id FROM sync_devices LIMIT 1")
    .get().id;
  assert.throws(
    () =>
      f.store.apply(
        device,
        {
          id: "packet",
          opId: "old-offline",
          type: "put",
          baseVersion: 1,
          data: { text: "old" },
        },
        epoch,
      ),
    (e) => e.code === "RESET_REQUIRED",
  );
  const replayEpoch = f.store.epoch;
  f.restore();
  assert.equal(f.store.record("packet").purged, true);
  assert.notEqual(f.store.epoch, replayEpoch);
});

for (const kind of ["delete", "expiry"])
  test(`independent ${kind} replay keeps shared blobs but never restores the removed logical original`, async (t) => {
    const f = fixture(t),
      { file, body } = f.upload();
    f.upload("shared");
    const deadline = f.originals.file("packet", "file").cleanup;
    await f.snapshot();
    if (kind === "delete")
      f.originals.action("delete", {
        operationId: "remove",
        ids: [{ packetId: "packet", id: "file", expectedVersion: 1 }],
      });
    else {
      f.clock.at = deadline;
      f.originals.sweep();
    }
    f.restore();
    assert.equal(
      f.originals.file("packet", "file").state,
      kind === "delete" ? "deleted" : "cleaned",
    );
    assert.equal(f.originals.file("packet", "file").cleanup, deadline);
    assert.throws(
      () => f.store.files.get("packet", "file"),
      (e) => e.code === "REUPLOAD_REQUIRED",
    );
    if (kind === "delete") {
      assert.deepEqual(f.store.files.get("shared", "file").body, body);
      assert.equal(
        f.store.db.prepare("SELECT COUNT(*) n FROM sync_blobs").get().n,
        1,
      );
    }
    f.originals.verifyForReading("packet", "file", body);
    assert.deepEqual(
      f.store.files.get("packet", "file", { forReading: true }).body,
      body,
    );
    assert.throws(
      () => f.store.files.get("packet", "file"),
      (e) => e.code === "REUPLOAD_REQUIRED",
    );
    assert.equal(f.originals.file("packet", "file").hash, file.hash);
    const token = f.store.safety.local();
    f.close();
    f.open();
    assert.equal(f.store.safety.local(), token);
    const payload = f.ledger.db
      .prepare("SELECT state FROM tenant_safety_intents")
      .all()
      .map((r) => r.state)
      .join("");
    assert.ok(
      !payload.includes("synthetic-private-original") &&
        !payload.includes("private-name"),
    );
  });

test("trash deadline is replayed and enforced at seven days; ordinary restore and renewal still work", async (t) => {
  const f = fixture(t);
  f.upload();
  await f.snapshot();
  f.op("delete");
  const deadline = f.originals.list().trash[0].cleanupAt;
  f.restore();
  assert.equal(f.originals.list().trash[0].cleanupAt, deadline);
  f.op("restore");
  f.originals.action("renew", {
    operationId: "renew",
    ids: [{ packetId: "packet", id: "file", expectedVersion: 1 }],
  });
  assert.equal(f.originals.file("packet", "file").state, "available");
  f.op("delete");
  f.clock.at = deadline;
  assert.throws(
    () => f.op("restore"),
    (e) => e.code === "TRASH_EXPIRED",
  );
  f.originals.sweep();
  assert.equal(f.store.record("packet").purged, true);
});

test("a stale snapshot cannot silently replay a later renewal as new authority", async (t) => {
  const f = fixture(t);
  f.upload();
  await f.snapshot();
  f.clock.at += 86400000;
  f.originals.action("renew", {
    operationId: "renew",
    ids: [{ packetId: "packet", id: "file", expectedVersion: 1 }],
  });
  assert.throws(
    () => f.restore(),
    (e) => e.code === "TENANT_SAFETY_RECONCILIATION",
  );
});

test("rolling back only the independent authority or using another tenant cannot bless the current tenant", async (t) => {
  const f = fixture(t);
  f.op("put");
  await backup(f.ledger.db, join(f.root, "ledger-before.sqlite"));
  f.op("delete");
  const oldLedger = new ReadingLedger(join(f.root, "ledger-before.sqlite"));
  try {
    assert.throws(
      () => new TenantSafety(f.store, oldLedger, "synthetic"),
      (e) => e.code === "TENANT_SAFETY_RECONCILIATION",
    );
  } finally {
    oldLedger.close();
  }
  assert.throws(
    () => new TenantSafety(f.store, f.ledger, "another-account"),
    /TENANT_SAFETY_BASELINE_REQUIRED/,
  );
  f.store.safety.assert();
});

test("unknown tenant baselines and missing local checkpoints fail closed", (t) => {
  const f = fixture(t);
  f.op("put");
  f.close();
  const unprotected = new SyncStore(":memory:");
  createAttachmentStore(unprotected);
  const device = unprotected.createDevice("synthetic").deviceId;
  unprotected.apply(
    device,
    {
      id: "old",
      opId: "seed",
      type: "put",
      baseVersion: 0,
      data: { text: "old" },
    },
    unprotected.epoch,
  );
  try {
    assert.throws(
      () =>
        new OriginalStore(unprotected, {
          safety: { ledger: f.ledger, account: "unverified" },
        }),
      /TENANT_SAFETY_BASELINE_REQUIRED/,
    );
    assert.throws(
      () =>
        new OriginalStore(unprotected, {
          safety: { ledger: f.ledger, account: "synthetic" },
        }),
      (e) => e.code === "TENANT_SAFETY_RECONCILIATION",
    );
  } finally {
    unprotected.originals?.close();
    unprotected.close();
  }
});

test("ordinary failed operations do not poison the tenant; protected writers cannot bypass the coordinator", (t) => {
  const f = fixture(t);
  f.upload();
  const token = f.store.safety.local();
  assert.throws(
    () => f.op("restore"),
    (e) => e.code === "NOT_DELETED",
  );
  assert.equal(f.store.safety.local(), token);
  f.store.safety.assert();
  assert.throws(
    () => f.store.db.exec("UPDATE sync_records SET purged=1"),
    /TENANT_SAFETY_WRITER_REQUIRED/,
  );
  assert.throws(
    () => f.store.db.exec("UPDATE original_files SET cleanup=9999999999999"),
    /TENANT_SAFETY_WRITER_REQUIRED/,
  );
  assert.throws(
    () => f.store.db.exec("DELETE FROM original_safety_checkpoint"),
    /TENANT_SAFETY_WRITER_REQUIRED/,
  );
  assert.throws(
    () => f.store.db.exec("DELETE FROM sync_meta WHERE key='tenant_safety'"),
    /TENANT_SAFETY_WRITER_REQUIRED/,
  );
  const old = new DatabaseSync(f.path);
  try {
    assert.throws(
      () =>
        ensureDatabaseSchema(
          old,
          "tenant-sync",
          TENANT_SYNC_SCHEMA.slice(0, -1),
        ),
      /DATABASE_SCHEMA_MISMATCH/,
    );
    assert.throws(
      () => old.exec("DELETE FROM sync_records"),
      /function|SCHEMA_WRITER/,
    );
  } finally {
    old.close();
  }
  assert.throws(
    () => f.ledger.db.exec("DELETE FROM tenant_safety_intents"),
    /APPEND_ONLY/,
  );
});

test("temporary material remains transient across restart with lifecycle protection enabled", (t) => {
  const f = fixture(t),
    { body } = f.upload("packet", "temporary");
  assert.deepEqual(f.store.files.get("packet", "file").body, body);
  f.close();
  f.open();
  assert.throws(
    () => f.store.files.get("packet", "file"),
    (e) => e.code === "REUPLOAD_REQUIRED",
  );
  f.originals.put("upload-packet", "file", body);
  assert.deepEqual(f.store.files.get("packet", "file").body, body);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM sync_blobs").get().n,
    0,
  );
});

test("deletion replay leaves current spending, unknown calls and independent cumulative watermarks intact", async (t) => {
  const f = fixture(t);
  f.op("put");
  await f.snapshot();
  const ledger = f.ledger,
    account = "synthetic";
  ledger.freezePrice({
    id: "synthetic-price",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic test",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 2000000,
  });
  ledger.grantInitial(account);
  const request = (n) => ({
    callId: "call-" + n,
    account,
    task: "task",
    block: "block-" + n,
    generation: 1,
    priceId: "synthetic-price",
    maxPromptTokens: 100,
    maxOutputTokens: 100,
  });
  ledger.reserve(request(1));
  ledger.sent("call-1");
  ledger.settle("call-1", { prompt_tokens: 10, completion_tokens: 2 });
  ledger.reserve(request(2));
  ledger.sent("call-2");
  ledger.recoverSent();
  const safety = new ReadingRootSafety(ledger, account);
  safety.bind("packet", "task", "root");
  safety.observe("root", {
    calls: 24,
    activeMs: 1200,
    completed: 2,
    checkpointCalls: 24,
    reason: "",
  });
  const wallet = ledger.wallet(account),
    water = safety.latest("root");
  f.op("delete");
  f.op("purge");
  f.restore();
  assert.deepEqual(ledger.wallet(account), wallet);
  assert.deepEqual(safety.latest("root"), water);
  assert.equal(ledger.call("call-2").state, "unknown");
  assert.throws(() => ledger.reserve(request(3)), /UNKNOWN_COST/);
  const observed = safety.observe("root", {
    calls: 0,
    activeMs: 0,
    completed: 0,
    checkpointCalls: 0,
    reason: "",
  });
  assert.equal(observed.calls, 24);
  assert.equal(observed.activeMs, 1200);
});

for (const replay of [false, true])
  for (const point of ["prepared", "tenant-committed"])
    test(`actual process exit at ${point} during ${replay ? "deletion replay" : "normal deletion"} resolves cross-database decisions once`, async (t) => {
      const f = fixture(t);
      f.op("put");
      if (replay) {
        await f.snapshot();
        f.op("delete");
        f.op("purge");
      }
      f.close();
      if (replay) copyFileSync(join(f.root, "before.sqlite"), f.path);
      const script = `
    import {SyncStore} from ${JSON.stringify(new URL("../sync-store.mjs", import.meta.url).href)};
    import {createAttachmentStore} from ${JSON.stringify(new URL("../sync-files.mjs", import.meta.url).href)};
    import {OriginalStore} from ${JSON.stringify(new URL("../originals.mjs", import.meta.url).href)};
    import {ReadingLedger} from ${JSON.stringify(new URL("./ledger.mjs", import.meta.url).href)};
    const ledger=new ReadingLedger(${JSON.stringify(join(f.root, "ledger.sqlite"))});
    const store=new SyncStore(${JSON.stringify(f.path)});createAttachmentStore(store);
    const originals=new OriginalStore(store,{safety:{ledger,account:'synthetic',fault:p=>{if(p===${JSON.stringify(point)})process.exit(77);}}});
    const device=store.db.prepare('SELECT id FROM sync_devices LIMIT 1').get().id;
    store.apply(device,{id:'packet',opId:'crash-delete',type:'delete',baseVersion:store.record('packet').version},store.epoch);
  `;
      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", script],
        { encoding: "utf8", timeout: 10000, windowsHide: true },
      );
      assert.equal(child.status, 77, child.stderr);
      f.open();
      assert.equal(
        !!f.store.record("packet").deletedAt,
        replay || point === "tenant-committed",
      );
      if (replay) assert.equal(f.store.record("packet").purged, true);
      const rows = f.store.safety.rows();
      assert.equal(
        rows.at(-1).decision,
        !replay && point === "prepared" ? "aborted" : "committed",
      );
      if (point === "prepared")
        assert.ok(rows.some((r) => r.decision === "aborted"));
      f.close();
      f.open();
      assert.equal(f.store.safety.rows().length, rows.length);
    });

test("independent finalization failure closes reads and writes until restart reconciles the committed tenant", (t) => {
  const f = fixture(t);
  f.op("put");
  f.store.safety.fault = (point) => {
    if (point === "tenant-committed") throw Error("synthetic disk failure");
  };
  assert.throws(
    () => f.op("delete"),
    (e) => e.code === "TENANT_SAFETY_RECONCILIATION",
  );
  assert.throws(
    () => f.store.record("packet"),
    (e) => e.code === "TENANT_SAFETY_RECONCILIATION",
  );
  assert.throws(
    () => f.originals.list(),
    (e) => e.code === "TENANT_SAFETY_RECONCILIATION",
  );
  f.close();
  f.open();
  assert.ok(f.store.record("packet").deletedAt);
});
