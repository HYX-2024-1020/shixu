import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncStore as OldStore } from "../../scripts/stage-a/legacy/sync-store.mjs";
import { createJobQueue as oldQueue } from "../../scripts/stage-a/legacy/sync-jobs.mjs";
import { SyncStore } from "../sync-store.mjs";
import { createJobQueue } from "../sync-jobs.mjs";
import { migrateLegacyJobs } from "./legacy-jobs.mjs";
import { sha256 } from "./material.mjs";
import { DatabaseSync } from "node:sqlite";
import { ensureDatabaseSchema } from "../database-schema.mjs";
import { TENANT_SYNC_SCHEMA } from "../database-schemas.mjs";
const states = [
  "queued",
  "running",
  "applying",
  "done",
  "error",
  "conflict",
  "interrupted",
];
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-legacy-jobs-")),
    path = join(directory, "tenant.sqlite");

  const old = new OldStore(path),
    device = old.createDevice("synthetic").deviceId;
  oldQueue(old, null).stop();
  for (const [n, state] of states.entries()) {
    const packet = "packet_" + n;
    old.apply(
      device,
      {
        id: packet,
        opId: "seed_" + n,
        type: "put",
        baseVersion: 0,
        data: {
          text: "canonical",
          sources: [{ id: "input", name: "input", text: "canonical" }],
          attachments: [],
          itemIds: ["saved"],
          doneIds: [0],
          result: { items: [{ title: "preserved" }] },
        },
      },
      old.epoch,
    );
    old.db.prepare("INSERT INTO sync_jobs VALUES(?,?,?,?,?,?,?,?,?)").run(
      "job_" + n,
      device,
      packet,
      sha256("job_" + n),
      JSON.stringify({
        id: "job_" + n,
        packetId: packet,
        kind: n % 2 ? "chat" : "organize",
        instruction: "private instruction",
        sources: [{ text: "obsolete extraction" }],
      }),
      state,
      ["applying", "conflict"].includes(state)
        ? JSON.stringify({
            result: {
              items: [
                {
                  title: "paid unverified",
                  evidence: [{ sourceId: "input", quote: "canonical" }],
                },
              ],
            },
          })
        : null,
      "old error",
      new Date(0).toISOString(),
    );
  }
  const epoch = old.epoch;
  old.close();
  const store = new SyncStore(path);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, device, epoch };
}
test("all seven legacy states migrate once, clean request/source copies and preserve paid results, identity and saved items", (t) => {
  const { store, device, epoch } = fixture(t),
    output = store.db
      .prepare("SELECT output FROM sync_jobs WHERE id='job_2'")
      .get().output;
  const queue = createJobQueue(store, null, {}, { archiveLegacy: true });
  queue.start();
  queue.stop();
  assert.deepEqual(
    store.db
      .prepare("SELECT state FROM sync_jobs ORDER BY id")
      .all()
      .map((r) => r.state),
    [
      "interrupted",
      "interrupted",
      "conflict",
      "done",
      "error",
      "conflict",
      "interrupted",
    ],
  );
  assert.equal(
    queue.get("job_2").output.result.items[0].title,
    "paid unverified",
  );
  assert.equal(
    store.db.prepare("SELECT output FROM sync_jobs WHERE id='job_2'").get()
      .output,
    output,
  );
  assert.equal(store.sequence, 14);
  assert.equal(store.epoch, epoch);
  for (const { data } of store.pull({ cursor: 7, epoch }).records) {
    assert.deepEqual(data.sources, []);
    assert.deepEqual(data.itemIds, ["saved"]);
    assert.deepEqual(data.doneIds, [0]);
    assert.equal(data.text, "canonical");
  }
  assert.equal(
    JSON.stringify(
      store.db.prepare("SELECT request,error FROM sync_jobs").all(),
    ).includes("private instruction"),
    false,
  );
  assert.equal(
    JSON.stringify(
      store.db.prepare("SELECT * FROM legacy_job_archive").all(),
    ).includes("canonical"),
    false,
  );
  assert.throws(
    () => queue.enqueue(device, {}),
    (e) => e.code === "CLIENT_UPGRADE_REQUIRED",
  );
  assert.deepEqual(migrateLegacyJobs(store), { jobs: 7, repeated: true });
  assert.equal(store.sequence, 14);
  assert.throws(
    () => store.db.exec("DELETE FROM legacy_job_archive"),
    /APPEND_ONLY/,
  );
  store.apply(
    device,
    {
      id: "packet_0",
      opId: "preview-again",
      type: "put",
      baseVersion: store.record("packet_0").version,
      data: { sources: [{ id: "input", text: "reuploaded extraction" }] },
    },
    epoch,
  );
  assert.deepEqual(store.record("packet_0").data.sources, []);
  assert.equal(migrateLegacyJobs(store).repeated, true);
  assert.throws(
    () =>
      createJobQueue(store, {
        organize: async () => {
          throw Error("provider must not run");
        },
      }),
    /LEGACY_QUEUE_DISABLED/,
  );
});
for (const [name, sql, error] of [
  [
    "unknown state",
    "UPDATE sync_jobs SET state='future' WHERE id='job_6'",
    /LEGACY_JOB_RECONCILIATION/,
  ],
  [
    "raw output",
    `UPDATE sync_jobs SET output='{"result":{"sources":[{"text":"full original"}]}}' WHERE id='job_6'`,
    /LEGACY_OUTPUT_RECONCILIATION/,
  ],
  [
    "uncanonical source",
    `UPDATE sync_records SET data='{"text":"","sources":[{"id":"manual","text":"only copy"}]}' WHERE id='packet_6'`,
    /LEGACY_SOURCE_RECONCILIATION/,
  ],
])
  test(
    name +
      " fails closed and atomically rolls back every preceding row and receipt",
    (t) => {
      const { store } = fixture(t);
      store.db.exec(sql);
      const before = store.db
        .prepare("SELECT * FROM sync_jobs ORDER BY id")
        .all();
      assert.throws(
        () => createJobQueue(store, null, {}, { archiveLegacy: true }),
        error,
      );
      assert.deepEqual(
        store.db.prepare("SELECT * FROM sync_jobs ORDER BY id").all(),
        before,
      );
      assert.equal(store.meta("legacy_jobs_v4"), undefined);
      assert.equal(store.sequence, 7);
      assert.equal(
        store.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='legacy_job_archive'",
          )
          .get(),
        undefined,
      );
    },
  );
test("receipt mismatch and lost migration marker cannot silently recertify old tasks", (t) => {
  const { store } = fixture(t);
  createJobQueue(store, null, {}, { archiveLegacy: true }).stop();
  store.db.exec("UPDATE sync_jobs SET state='queued' WHERE id='job_0'");
  assert.throws(() => migrateLegacyJobs(store), /LEGACY_JOB_RECONCILIATION/);
  store.db.exec("DELETE FROM sync_meta WHERE key='legacy_jobs_v4'");
  assert.throws(() => migrateLegacyJobs(store), /LEGACY_JOB_RECONCILIATION/);
});
test("legacy job purge keeps metadata receipt and never resurrects its output", (t) => {
  const { store, device, epoch } = fixture(t);
  const queue = createJobQueue(store, null, {}, { archiveLegacy: true });
  queue.stop();
  store.apply(
    device,
    {
      id: "packet_2",
      opId: "delete",
      type: "delete",
      baseVersion: store.record("packet_2").version,
    },
    epoch,
  );
  store.apply(
    device,
    {
      id: "packet_2",
      opId: "purge",
      type: "purge",
      baseVersion: store.record("packet_2").version,
    },
    epoch,
  );
  queue.redact("packet_2");
  assert.equal(queue.get("job_2"), null);
  assert.equal(migrateLegacyJobs(store).repeated, true);
  assert.equal(
    store.db
      .prepare("SELECT output_hash FROM legacy_job_archive WHERE id='job_2'")
      .get().output_hash.length,
    64,
  );
});

test("unverified paid outputs expire after seven days without deleting saved results, receipts or publication ownership", (t) => {
  const { store } = fixture(t);
  migrateLegacyJobs(store, { now: 100 });
  const saved = structuredClone(store.record("packet_2").data.result);
  migrateLegacyJobs(store, { now: 100 + 7 * 86400000 - 1 });
  assert.ok(
    store.db.prepare("SELECT output FROM sync_jobs WHERE id='job_2'").get()
      .output,
  );
  migrateLegacyJobs(store, { now: 100 + 7 * 86400000 });
  assert.equal(
    store.db.prepare("SELECT output FROM sync_jobs WHERE id='job_2'").get()
      .output,
    null,
  );
  assert.deepEqual(store.record("packet_2").data.result, saved);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM legacy_job_disposals").get().n,
    2,
  );
  assert.equal(
    migrateLegacyJobs(store, { now: 100 + 8 * 86400000 }).repeated,
    true,
  );
});
test("an already connected tenant writer version 2 cannot reintroduce extraction copies after the version 3 upgrade", () => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-legacy-writer-")),
    path = join(directory, "tenant.sqlite");
  const previous = new DatabaseSync(path);
  let current;
  try {
    ensureDatabaseSchema(
      previous,
      "tenant-sync",
      TENANT_SYNC_SCHEMA.slice(0, 2),
    );
    previous.exec(
      "INSERT INTO sync_meta VALUES('schema','1'),('epoch','synthetic'),('sequence','0')",
    );
    current = new SyncStore(path);
    assert.throws(
      () =>
        previous
          .prepare("INSERT INTO sync_records VALUES('old',1,?,NULL,0)")
          .run(JSON.stringify({ sources: [{ text: "full extraction" }] })),
      /INCOMPATIBLE_SCHEMA_WRITER/,
    );
    assert.equal(current.record("old"), null);
  } finally {
    current?.close();
    previous.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
