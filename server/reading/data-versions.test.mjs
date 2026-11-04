import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountRegistry } from "../sync-accounts.mjs";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { createJobQueue } from "../sync-jobs.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingRootSafety } from "./root-safety.mjs";
import { createMultiUserService } from "../sync-multi-user.mjs";
import { createRuntimeMigrator } from "../data-migration.mjs";
import { backup } from "node:sqlite";
import { spawn } from "node:child_process";
import { backupAccounts } from "../../deploy/sync/backup-accounts.mjs";
import {
  acquireDataLease,
  resolveDataVersion,
  prepareShadowVersion,
  activateDataVersion,
  completeDataActivation,
  reviewDataWriters,
  recoverDataWriters,
} from "../data-versions.mjs";
const secret = "synthetic-version-secret-at-least-32-chars";
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-data-versions-")),
    root = join(directory, "accounts"),
    ledgerPath = join(directory, "authoritative-ledger.sqlite");
  const registry = new AccountRegistry(root, secret),
    accounts = registry.generate(3).map((a) => a.userId);
  registry.close();
  for (const account of accounts.slice(0, 2)) {
    const store = new SyncStore(
      join(root, "users", account, "workspace.sqlite"),
    );
    createAttachmentStore(store);
    createJobQueue(store, null).stop();
    const device = store.createDevice("synthetic").deviceId;
    store.apply(
      device,
      {
        id: "packet",
        opId: "seed",
        type: "put",
        baseVersion: 0,
        data: {
          text: "canonical",
          sources: [{ id: "input", text: "canonical" }],
          attachments: [],
          itemIds: ["kept"],
          result: { items: [{ title: "preserved" }] },
        },
      },
      store.epoch,
    );
    store.close();
  }
  const ledger = new ReadingLedger(ledgerPath);
  ledger.freezePrice({
    id: "synthetic",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic",
    verifiedAt: 1,
    inputMicrosPerMillion: 1,
    cachedMicrosPerMillion: 0,
    outputMicrosPerMillion: 1,
  });
  ledger.grantInitial(accounts[0]);
  new ReadingRootSafety(ledger, accounts[0]);
  const leases = [];
  t.after(() => {
    for (const lease of leases) lease.release();
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const acquire = (mode = "maintenance") => {
    const lease = acquireDataLease(root, mode);
    leases.push(lease);
    return lease;
  };
  const migrate = createRuntimeMigrator({
    secret,
    ledger,
    priceId: "synthetic",
    modelVersion: "synthetic",
    credentials: false,
  });
  const prepare = (lease, id = "v1", extra = {}) =>
    prepareShadowVersion(lease, { id, ledgerPath, migrate, ...extra });
  return { root, ledgerPath, accounts, ledger, acquire, prepare };
}
test("shared runtime/admin writers and exclusive maintenance are mutually excluded without stale PID guessing", (t) => {
  const f = fixture(t),
    writer = f.acquire("writer"),
    other = f.acquire("writer");
  assert.throws(()=>{writer.mode='maintenance';},TypeError);
  assert.throws(()=>{writer.root=join(f.root,'other');},TypeError);
  assert.throws(() => f.acquire(), /DATA_WRITERS_ACTIVE/);
  writer.release();
  assert.throws(() => f.acquire(), /DATA_WRITERS_ACTIVE/);
  other.release();
  const exclusive = f.acquire();
  assert.throws(() => f.acquire("writer"), /DATA_MAINTENANCE/);
  assert.throws(() => f.acquire(), /DATA_WRITERS_ACTIVE/);
  exclusive.release();
  f.acquire("writer");
});
test("complete shadow set migrates every tenant and preserves missing tenant identity; atomic activation routes actual service and keeps ledger external", async (t) => {
  const f = fixture(t),
    lease = f.acquire(),
    prepared = f.prepare(lease);
  assert.equal(prepared.accounts, 3);
  assert.equal(prepared.tenants, 2);
  assert.equal(resolveDataVersion(lease).version, null);
  activateDataVersion(lease, prepared);
  const selected = resolveDataVersion(lease, { ledgerPath: f.ledgerPath });
  assert.equal(selected.version, "v1");
  assert.equal(selected.manifest.databases.length, 3);
  assert.equal(existsSync(join(selected.directory, "ledger.sqlite")), false);
  lease.release();
  const service = createMultiUserService({
    directory: f.root,
    secret,
    reading: {
      ledger: f.ledger,
      priceId: "synthetic",
      modelVersion: "synthetic",
      enabled: false,
      reader: () => {
        throw Error("NO_READ");
      },
      provider: () => {
        throw Error("NO_MODEL");
      },
    },
  });
  assert.equal(service.dataVersion, "v1");
  assert.throws(() => f.acquire(), /DATA_WRITERS_ACTIVE/);
  service.server.listen(0, "127.0.0.1");
  await new Promise((done) => service.server.once("listening", done));
  assert.equal(
    (
      await (
        await fetch(
          "http://127.0.0.1:" +
            service.server.address().port +
            "/api/v4/capabilities",
        )
      ).json()
    ).features.readingTasks,
    true,
  );
  await service.quiesce();
  assert.equal(f.ledger.wallet(f.accounts[0]).granted, 20000000);
  const again = f.acquire();
  assert.equal(
    resolveDataVersion(again, { ledgerPath: f.ledgerPath }).version,
    "v1",
  );
});
for (const step of ["accounts.sqlite", "tenant"])
  test(
    "shadow failure at " +
      step +
      " cannot alter the current pointer or produce a startable partial set",
    (t) => {
      const f = fixture(t),
        lease = f.acquire();
      assert.throws(
        () =>
          f.prepare(lease, "broken", {
            afterStep: (member) => {
              if (
                step === "tenant"
                  ? member.startsWith("users/")
                  : member === step
              )
                throw Error("INJECTED_SHADOW_CRASH");
            },
          }),
        /INJECTED_SHADOW_CRASH/,
      );
      assert.equal(resolveDataVersion(lease).version, null);
      assert.equal(
        existsSync(join(f.root, "data-versions", "broken", "manifest.json")),
        false,
      );
      assert.throws(() =>
        activateDataVersion(lease, {
          id: "broken",
          manifestHash: "a".repeat(64),
        }),
      );
    },
  );
test("modified or omitted member, orphan tenant and wrong manifest prevent activation", (t) => {
  const f = fixture(t),
    lease = f.acquire(),
    prepared = f.prepare(lease);
  const member = join(
    f.root,
    "data-versions",
    "v1",
    "users",
    f.accounts[0],
    "workspace.sqlite",
  );
  const store = new SyncStore(member);
  store.db
    .prepare("UPDATE sync_records SET version=99 WHERE id='packet'")
    .run();
  store.close();
  assert.throws(
    () => activateDataVersion(lease, prepared),
    /DATA_VERSION_RECONCILIATION/,
  );
  assert.equal(existsSync(join(f.root, "data-version.json")), false);
  const orphan = join(f.root, "users", "orphan");
  mkdirSync(orphan);
  assert.throws(() => f.prepare(lease, "v2"), /DATA_VERSION_RECONCILIATION/);
});
for (const after of [false, true])
  test(
    "pointer rename crash " +
      (after ? "after" : "before") +
      " stays closed and can be completed only under maintenance",
    (t) => {
      const f = fixture(t),
        lease = f.acquire(),
        prepared = f.prepare(lease);
      assert.throws(
        () =>
          activateDataVersion(lease, prepared, {
            [after ? "afterRename" : "beforeRename"]: () => {
              throw Error("INJECTED_POINTER_CRASH");
            },
          }),
        /INJECTED_POINTER_CRASH/,
      );
      assert.throws(() => resolveDataVersion(lease));
      if (after) completeDataActivation(lease);
      else activateDataVersion(lease, prepared);
      assert.equal(resolveDataVersion(lease).version, "v1");
      assert.equal(completeDataActivation(lease).id, "v1");
    },
  );
test("an old pointer cannot undo newer grants or a completed version switch", (t) => {
  const f = fixture(t),
    lease = f.acquire(),
    first = f.prepare(lease);
  activateDataVersion(lease, first);
  const oldPointer = readFileSync(join(f.root, "data-version.json"));
  f.ledger.grantInitial(f.accounts[1]);
  const second = f.prepare(lease, "v2");
  activateDataVersion(lease, second, { expectedVersion: "v1" });
  assert.throws(
    () => activateDataVersion(lease, first, { expectedVersion: "v2" }),
    /DATA_VERSION_RECONCILIATION|DATA_VERSION_ALREADY_ACTIVATED/,
  );
  writeFileSync(join(f.root, "data-version.json"), oldPointer);
  assert.throws(() => resolveDataVersion(lease), /DATA_VERSION_RECONCILIATION/);
  assert.equal(f.ledger.wallet(f.accounts[1]).granted, 20000000);
});
test("runtime startup errors release their writer registration and an exclusive lease blocks all startup routes", (t) => {
  const f = fixture(t);
  assert.throws(() =>
    createMultiUserService({ directory: f.root, secret: "short" }),
  );
  const lease = f.acquire();
  assert.throws(
    () => createMultiUserService({ directory: f.root, secret }),
    /DATA_MAINTENANCE/,
  );
  lease.release();
});

test("a live source tenant WAL is rejected before copying any of its uncheckpointed contents", (t) => {
  const f = fixture(t),
    lease = f.acquire(),
    store = new SyncStore(
      join(f.root, "users", f.accounts[0], "workspace.sqlite"),
    );
  try {
    store.db
      .prepare("UPDATE sync_records SET version=99 WHERE id='packet'")
      .run();
    assert.throws(
      () => f.prepare(lease, "live-wal"),
      /DATA_DATABASE_NOT_CLOSED/,
    );
    assert.equal(
      existsSync(join(f.root, "data-versions", "live-wal", "manifest.json")),
      false,
    );
  } finally {
    store.close();
  }
});
test("independent ledger rollback below the sealed append-only prefix blocks data-version startup", async (t) => {
  const f = fixture(t),
    lease = f.acquire(),
    old = join(f.root, "old-authority.sqlite");
  await backup(f.ledger.db, old);
  f.ledger.grantInitial(f.accounts[1]);
  const prepared = f.prepare(lease);
  activateDataVersion(lease, prepared);
  f.ledger.close();
  f.ledger.close = () => {};
  copyFileSync(old, f.ledgerPath);
  assert.throws(() => resolveDataVersion(lease), /DATA_VERSION_RECONCILIATION/);
});
test("only one runtime can own the data root and legacy root access is fenced after activation", (t) => {
  const f = fixture(t),
    writer = f.acquire("runtime");
  assert.throws(
    () => createMultiUserService({ directory: f.root, secret }),
    /DATA_WRITERS_ACTIVE/,
  );
  writer.release();
  const lease = f.acquire(),
    prepared = f.prepare(lease);
  activateDataVersion(lease, prepared);
  assert.throws(
    () => new AccountRegistry(f.root, secret),
    /DATA_VERSION_ROOT_FENCED/,
  );
  lease.release();
  assert.throws(
    () => createMultiUserService({ directory: f.root, secret }),
    /VERSIONED_READING_REQUIRED/,
  );
});
test("the existing stopped backup path snapshots only the selected complete version and excludes the fenced legacy root", async (t) => {
  const f = fixture(t),
    lease = f.acquire(),
    prepared = f.prepare(lease);
  activateDataVersion(lease, prepared);
  lease.release();
  const snapshot = await backupAccounts(f.root, join(f.root, "snapshots"), {
    serviceStopped: true,
  });
  assert.equal(
    JSON.parse(readFileSync(join(snapshot, "backup.json"), "utf8")).databases,
    3,
  );
  const registry = new AccountRegistry(snapshot, secret);
  try {
    assert.equal(
      registry.db.prepare("SELECT COUNT(*) n FROM accounts").get().n,
      3,
    );
    assert.equal(
      registry.db
        .prepare("SELECT value FROM account_meta WHERE key=?")
        .get("data_version_required"),
      undefined,
    );
  } finally {
    registry.close();
  }
});
test("a legacy-root backup never recursively copies a partial migration shadow", async (t) => {
  const f = fixture(t),
    lease = f.acquire();
  assert.throws(
    () =>
      f.prepare(lease, "incomplete", {
        afterStep: () => {
          throw Error("INJECTED_SHADOW");
        },
      }),
    /INJECTED_SHADOW/,
  );
  lease.release();
  const snapshot = await backupAccounts(
    f.root,
    join(f.root, "..", "legacy-backups"),
    { serviceStopped: true },
  );
  assert.equal(existsSync(join(snapshot, "data-versions")), false);
});

test("independent Node processes cannot accept shared writers and exclusive maintenance at the same barrier", async (t) => {
  const f = fixture(t),
    url = new URL("../data-versions.mjs", import.meta.url).href;
  const script = `import {acquireDataLease} from ${JSON.stringify(url)};let lease;process.send({ready:true});process.on('message',message=>{if(message==='go'){try{lease=acquireDataLease(process.argv[1],process.argv[2]);process.send({accepted:true});}catch(error){process.send({accepted:false,code:error.message});}}else if(message==='release'){lease?.release();process.exit(0);}});`;
  const children = [];
  try {
    for (const mode of ["maintenance", "writer", "writer", "writer"]) {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", script, f.root, mode],
        { stdio: ["ignore", "ignore", "pipe", "ipc"] },
      );
      const ready = new Promise((done, reject) => {
        child.once("message", done);
        child.once("error", reject);
        child.once("exit", () => reject(Error("CHILD_REGISTRATION_FAILED")));
      });
      const exited = new Promise((done) => child.once("exit", done));
      children.push({ child, mode, ready, exited });
    }
    await Promise.all(children.map((c) => c.ready));
    const results = children.map(
      (c) =>
        new Promise((done) =>
          c.child.once("message", (value) => done({ ...value, mode: c.mode })),
        ),
    );
    for (const { child } of children) child.send("go");
    const accepted = (await Promise.all(results)).filter((r) => r.accepted);
    assert.ok(accepted.length > 0);
    assert.ok(
      !accepted.some((r) => r.mode === "maintenance") || accepted.length === 1,
    );
  } finally {
    for (const { child } of children)
      if (child.connected) child.send("release");
    await Promise.all(children.map((c) => c.exited));
  }
});
test("pointer v2 cannot start between the file receipt and independent activation record; host completion rechecks the baseline", (t) => {
  const f = fixture(t),
    lease = f.acquire(),
    prepared = f.prepare(lease);
  assert.throws(
    () =>
      activateDataVersion(lease, prepared, {
        afterReceipt: () => {
          throw Error("INJECTED_ACTIVATION_RECORD");
        },
      }),
    /INJECTED_ACTIVATION_RECORD/,
  );
  assert.throws(() => resolveDataVersion(lease), /DATA_VERSION_RECONCILIATION/);
  completeDataActivation(lease);
  assert.equal(resolveDataVersion(lease).version, "v1");
});
test("a real dead maintenance process can be recovered after the first pre-rename activation failure without an unrecoverable lock cycle", async (t) => {
  const f = fixture(t),
    lease = f.acquire(),
    prepared = f.prepare(lease);
  assert.throws(
    () =>
      activateDataVersion(lease, prepared, {
        beforeRename: () => {
          throw Error("INJECTED_INITIAL");
        },
      }),
    /INJECTED_INITIAL/,
  );
  lease.release();
  const url = new URL("../data-versions.mjs", import.meta.url).href;
  const code = `import {acquireDataLease} from ${JSON.stringify(url)};acquireDataLease(process.argv[1],'maintenance');process.send('ready');process.on('message',()=>process.exit(0));`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", code, f.root],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  const exit = new Promise((done) => child.once("exit", done));
  await new Promise((done, reject) => {
    child.once("message", done);
    child.once("error", reject);
    child.once("exit", () => reject(Error("CHILD_REGISTRATION_FAILED")));
  });
  child.send("exit");
  await exit;
  const authority = ({ actor }) => actor === "synthetic-host",
    review = reviewDataWriters(f.root, "synthetic-host", authority);
  recoverDataWriters(
    f.root,
    {
      operationId: "initial-recovery",
      actor: "synthetic-host",
      expectedSnapshotHash: review.snapshotHash,
    },
    authority,
  );
  const maintained = f.acquire();
  activateDataVersion(maintained, prepared);
  assert.equal(resolveDataVersion(maintained).version, "v1");
});
