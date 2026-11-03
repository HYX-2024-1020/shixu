import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { AccountRegistry } from "../sync-accounts.mjs";
import { AccountsV4 } from "../accounts-v4.mjs";
import { AccountSafety } from "../account-safety.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ensureDatabaseSchema } from "../database-schema.mjs";
import {
  ACCOUNTS_CORE_SCHEMA,
  LEDGER_CORE_SCHEMA,
} from "../database-schemas.mjs";

const secret = "synthetic-account-safety-secret-32-chars";
const identity = (n) => ({
  kind: "windows",
  identity: `synthetic-${n}`,
  publicKey: null,
  name: `合成设备${n}`,
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "shixu-account-safety-"));
  let registry, auth, ledger, safety;
  const close = () => {
    auth?.close();
    registry?.close();
    ledger?.close();
    registry = auth = ledger = safety = null;
  };
  const open = () => {
    ledger = new ReadingLedger(join(root, "ledger.sqlite"));
    registry = new AccountRegistry(join(root, "data"), secret);
    auth = new AccountsV4(registry);
    safety = new AccountSafety(registry, ledger);
  };
  t.after(() => {
    close();
    rmSync(root, { recursive: true, force: true });
  });
  const f = {
    root,
    open,
    close,
    get registry() {
      return registry;
    },
    get auth() {
      return auth;
    },
    get ledger() {
      return ledger;
    },
    get safety() {
      return safety;
    },
  };
  open();
  return f;
}
async function register(f) {
  const [invite] = f.registry.generate(1);
  const result = await f.auth.register(
    {
      username: "合成学生",
      password: "synthetic-password-1",
      invite: invite.invite,
      operationId: "register-one",
    },
    identity(1),
    "synthetic-ip",
  );
  f.ledger.grantInitial(result.binding.user_id);
  return result.binding;
}

test("independent checkpoint rejects an older registry after revoke or password change, preserving its current ledger", async (t) => {
  const f = fixture(t),
    binding = await register(f);
  const second = (
    await f.auth.login(
      {
        username: "合成学生",
        password: "synthetic-password-1",
        operationId: "login-second",
      },
      identity(2),
      "synthetic-ip",
    )
  ).binding;
  await backup(f.registry.db, join(f.root, "before-revoke.sqlite"));
  f.auth.revoke(binding.user_id, second.id, "revoke-second");
  assert.throws(() => f.registry.authenticate(second.token), /撤销|失效/);
  await f.auth.changePassword(
    binding.user_id,
    {
      oldPassword: "synthetic-password-1",
      newPassword: "synthetic-password-2",
      operationId: "password-two",
      revokeAll: false,
    },
    binding.id,
    "synthetic-ip",
  );
  const wallet = f.ledger.wallet(binding.user_id),
    token = f.safety.local();
  f.close();
  copyFileSync(
    join(f.root, "before-revoke.sqlite"),
    join(f.root, "data", "accounts.sqlite"),
  );
  assert.throws(() => f.open(), /账号安全记录不一致/);
  assert.equal(f.registry.db.prepare("SELECT revoked FROM bindings WHERE id=?").get(second.id).revoked, 0);
  assert.equal(
    f.ledger.db
      .prepare(
        "SELECT token FROM account_safety_intents ORDER BY seq DESC LIMIT 1",
      )
      .get().token,
    token,
  );
  assert.deepEqual(f.ledger.wallet(binding.user_id), wallet);
});

test("a confirmed revoke replays onto a verified account ancestor and retains its idempotency receipt", async (t) => {
  const f = fixture(t);
  const binding = await register(f);
  const older = join(f.root, "before-revoke.sqlite");
  await backup(f.registry.db, older);
  f.auth.revoke(binding.user_id, binding.id, "confirmed-revoke");
  const latest = f.safety.local();
  const wallet = f.ledger.wallet(binding.user_id);
  f.close();
  copyFileSync(older, join(f.root, "data", "accounts.sqlite"));
  f.open();
  assert.equal(f.safety.local(), latest);
  assert.throws(() => f.registry.authenticate(binding.token), /撤销|失效/);
  assert.deepEqual(f.auth.revoke(binding.user_id, binding.id, "confirmed-revoke"), { ok: true });
  assert.equal(f.safety.local(), latest);
  assert.deepEqual(f.ledger.wallet(binding.user_id), wallet);
});

test("an older registry can replay platform-wide revocation and account disable together", async (t) => {
  const f = fixture(t);
  const binding = await register(f);
  const older = join(f.root, "before-restrictions.sqlite");
  await backup(f.registry.db, older);
  f.registry.revoke(binding.user_id, "windows");
  f.registry.enable(binding.user_id, false);
  const latest = f.safety.local();
  f.close();
  copyFileSync(older, join(f.root, "data", "accounts.sqlite"));
  f.open();
  assert.equal(f.safety.local(), latest);
  assert.equal(f.registry.db.prepare("SELECT enabled FROM accounts WHERE id=?").get(binding.user_id).enabled, 0);
  assert.equal(f.registry.db.prepare("SELECT revoked FROM bindings WHERE id=?").get(binding.id).revoked, 1);
  assert.throws(() => f.registry.authenticate(binding.token), /撤销|失效|停用/);
  f.registry.enable(binding.user_id, true);
  const enabled = f.safety.local();
  f.close();
  copyFileSync(older, join(f.root, "data", "accounts.sqlite"));
  assert.throws(() => f.open(), /账号安全记录不一致/);
  assert.notEqual(latest, enabled);
});

test("normal failed operations roll back without poisoning service; unchanged replay and last-seen telemetry do not append safety intents", async (t) => {
  const f = fixture(t),
    binding = await register(f);
  const count = () =>
    f.ledger.db.prepare("SELECT COUNT(*) n FROM account_safety_intents").get()
      .n;
  const before = count();
  assert.throws(() =>
    f.auth.revoke(binding.user_id, "missing", "invalid-revoke"),
  );
  f.registry.authenticate(binding.token);
  assert.equal(count(), before);
  f.auth.revoke(binding.user_id, binding.id, "revoke-one");
  const after = count();
  f.auth.revoke(binding.user_id, binding.id, "revoke-one");
  assert.equal(count(), after);
  assert.throws(() => f.registry.authenticate(binding.token), /撤销|失效/);
  const serialized = JSON.stringify(
    f.ledger.db.prepare("SELECT * FROM account_safety_intents").all(),
  );
  for (const privateValue of [
    "synthetic-password",
    "合成学生",
    binding.token,
    binding.id,
    "合成设备",
  ])
    assert.equal(serialized.includes(privateValue), false);
  assert.throws(
    () => f.ledger.db.exec("DELETE FROM account_safety_intents"),
    /APPEND_ONLY/,
  );
});

test("uncoordinated current and prior writers cannot mutate protected authority or discard its checkpoint", async (t) => {
  const f = fixture(t),
    binding = await register(f);
  for (const sql of [
    "UPDATE bindings SET revoked=0",
    "UPDATE account_credentials SET version=1",
    "DELETE FROM account_safety_checkpoint",
    "DELETE FROM account_device_slots",
  ])
    assert.throws(
      () => f.registry.db.exec(sql),
      /ACCOUNT_SAFETY_WRITER_REQUIRED/,
    );
  const other = new AccountRegistry(join(f.root, "data"), secret);
  try {
    assert.throws(
      () => other.enable(binding.user_id, false),
      /ACCOUNT_SAFETY_WRITER_REQUIRED/,
    );
  } finally {
    other.close();
  }
  for (const [path, component, schema] of [
    [
      join(f.root, "data", "accounts.sqlite"),
      "accounts-core",
      ACCOUNTS_CORE_SCHEMA.slice(0, -1),
    ],
    [
      join(f.root, "ledger.sqlite"),
      "ledger-core",
      LEDGER_CORE_SCHEMA.slice(0, -1),
    ],
  ]) {
    const old = new DatabaseSync(path);
    try {
      assert.throws(
        () => ensureDatabaseSchema(old, component, schema),
        /DATABASE_SCHEMA_MISMATCH/,
      );
    } finally {
      old.close();
    }
  }
  f.registry.authenticate(binding.token);
});

test("restoring only the independent journal is rejected, and an existing unprotected identity is never silently enrolled", async (t) => {
  const f = fixture(t);
  await backup(f.ledger.db, join(f.root, "ledger-before.sqlite"));
  await register(f);
  f.close();
  copyFileSync(
    join(f.root, "ledger-before.sqlite"),
    join(f.root, "ledger.sqlite"),
  );
  assert.throws(() => f.open(), /账号安全记录不一致/);
  f.close();
  const registry = new AccountRegistry(join(f.root, "legacy"), secret),
    ledger = new ReadingLedger(":memory:");
  try {
    const [invite] = registry.generate(1);
    registry.bind(invite.invite, "wechat", "synthetic-wechat");
    new AccountsV4(registry);
    assert.throws(
      () => new AccountSafety(registry, ledger),
      /ACCOUNT_SAFETY_BASELINE_REQUIRED/,
    );
    assert.equal(
      ledger.db.prepare("SELECT COUNT(*) n FROM account_safety_intents").get()
        .n,
      0,
    );
  } finally {
    registry.close();
    ledger.close();
  }
});

test("failure to finalize independent authority closes authentication until startup reconciles the committed registry", async (t) => {
  const f = fixture(t),
    binding = await register(f);
  const decide = f.safety.decide.bind(f.safety);
  f.safety.decide = () => {
    throw Error("synthetic independent finalization failure");
  };
  assert.throws(
    () => f.auth.revoke(binding.user_id, binding.id, "finalization-failure"),
    /账号安全记录不一致/,
  );
  assert.throws(
    () => f.registry.authenticate(binding.token),
    /账号安全记录不一致/,
  );
  f.safety.decide = decide;
  assert.equal(f.safety.pending().length, 1);
  f.close();
  f.open();
  assert.equal(f.safety.pending().length, 0);
  assert.throws(() => f.registry.authenticate(binding.token), /撤销|失效/);
  f.ledger.audit();
  const events = f.ledger.db
    .prepare("SELECT * FROM reading_events WHERE kind LIKE 'account-safety-%'")
    .all();
  assert.ok(events.length >= 3);
  assert.ok(
    events.every(
      (row) =>
        row.amount === 0 &&
        row.call === null &&
        row.account === "system:account-safety",
    ),
  );
});

for (const phase of ["prepared", "registry-committed"])
  test(`actual process exit at ${phase} reconciles exactly one decision and does not lower current billing`, async (t) => {
    const f = fixture(t),
      binding = await register(f);
    const wallet = f.ledger.wallet(binding.user_id);
    f.close();
    const worker = `
    import {AccountRegistry} from ${JSON.stringify(new URL("../sync-accounts.mjs", import.meta.url).href)};
    import {AccountsV4} from ${JSON.stringify(new URL("../accounts-v4.mjs", import.meta.url).href)};
    import {AccountSafety} from ${JSON.stringify(new URL("../account-safety.mjs", import.meta.url).href)};
    import {ReadingLedger} from ${JSON.stringify(new URL("./ledger.mjs", import.meta.url).href)};
    import {join} from 'node:path';
    const [root,secret,account,binding,phase]=process.argv.slice(1);
    const ledger=new ReadingLedger(join(root,'ledger.sqlite'));
    const registry=new AccountRegistry(join(root,'data'),secret);
    const auth=new AccountsV4(registry);
    new AccountSafety(registry,ledger,{fault:at=>{if(at===phase)process.exit(23)}});
    auth.revoke(account,binding,'crash-revoke');
  `;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        worker,
        f.root,
        secret,
        binding.user_id,
        binding.id,
        phase,
      ],
      { windowsHide: true, timeout: 15000, encoding: "utf8" },
    );
    assert.equal(child.status, 23, child.stderr);
    f.open();
    assert.ok(f.ledger.db.prepare(
      "SELECT 1 FROM reading_events WHERE operation='account-safety-prepare:' || (SELECT token FROM account_safety_intents ORDER BY seq DESC LIMIT 1) AND amount=0",
    ).get());
    assert.deepEqual(f.ledger.wallet(binding.user_id), wallet);
    const pending = f.safety.pending();
    assert.equal(pending.length, 0);
    const decisions = f.ledger.db
      .prepare(
        "SELECT d.decision FROM account_safety_decisions d JOIN account_safety_intents i ON d.token=i.token ORDER BY i.seq DESC LIMIT 1",
      )
      .get();
    assert.equal(
      decisions.decision,
      phase === "prepared" ? "aborted" : "committed",
    );
    if (phase === "prepared") f.registry.authenticate(binding.token);
    else
      assert.throws(() => f.registry.authenticate(binding.token), /撤销|失效/);
    const count = f.ledger.db
      .prepare("SELECT COUNT(*) n FROM account_safety_decisions")
      .get().n;
    f.close();
    f.open();
    assert.equal(
      f.ledger.db
        .prepare("SELECT COUNT(*) n FROM account_safety_decisions")
        .get().n,
      count,
    );
  });
