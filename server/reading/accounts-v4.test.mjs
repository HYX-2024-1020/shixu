import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountRegistry } from "../sync-accounts.mjs";
import { AccountsV4 } from "../accounts-v4.mjs";
const identity = (id, kind = "windows") => ({
  kind,
  identity: id,
  publicKey: kind === "windows" ? "synthetic-only" : null,
  name: "合成设备",
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "shixu-credentials-v4-"));
  const registry = new AccountRegistry(
    root,
    "synthetic-v4-credential-secret-32-characters",
  );
  let now = Date.now();
  t.after(async () => {
    registry.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    directory: root,
    registry,
    auth: new AccountsV4(registry, { now: () => now }),
    advance: (ms) => {
      now += ms;
    },
  };
}
test("one-time registration, canonical username, three Windows plus one WeChat and explicit replacement preserve account identity", async (t) => {
  const f = await fixture(t),
    invitation = f.registry.generate(1)[0];
  const request = {
    operationId: "register",
    invite: invitation.invite,
    username: "  Test用户  ",
    password: "synthetic-password",
  };
  const first = await f.auth.register(request, identity("win1"), "ip1");
  for (const value of ["字".repeat(7), "a".repeat(129), "😀".repeat(129)])
    await assert.rejects(
      f.auth.register(
        { ...request, password: value },
        identity("invalid"),
        "ip1",
      ),
      (e) => e.code === "INVALID_PASSWORD",
    );
  assert.equal(first.binding.user_id, invitation.userId);
  assert.deepEqual(
    await f.auth.register(request, identity("win1"), "ip1"),
    first,
  );
  assert.equal(
    f.registry.db.prepare("SELECT username FROM account_credentials").get()
      .username,
    "test用户",
  );
  let count = 0;
  const login = async (id, kind = "windows", replaceBindingId) => {
    f.advance(61000);
    return f.auth.login(
      {
        username: "TEST用户",
        password: request.password,
        operationId: "login_" + count++,
        replaceBindingId,
      },
      identity(id, kind),
      "ip1",
    );
  };
  const two = await login("win2"),
    three = await login("win3");
  await assert.rejects(
    login("win4"),
    (e) => e.code === "DEVICE_SLOTS_FULL" && e.details.devices.length === 3,
  );
  const wechat = await login("wechat1", "wechat");
  assert.equal(f.auth.wechat("wechat1").binding.id, wechat.binding.id);
  await assert.rejects(
    login("wechat2", "wechat"),
    (e) => e.code === "DEVICE_SLOTS_FULL",
  );
  const replaced = await login("win4", "windows", two.binding.id);
  assert.equal(replaced.binding.user_id, first.binding.user_id);
  assert.throws(
    () => f.registry.authenticate(two.binding.token),
    (e) => e.code === "UNAUTHORIZED",
  );
  assert.equal(
    f.auth.devices(first.binding.user_id).filter((d) => d.kind === "windows")
      .length,
    3,
  );
  f.auth.revoke(first.binding.user_id, three.binding.id, "revoke");
  assert.deepEqual(
    f.auth.revoke(first.binding.user_id, three.binding.id, "revoke"),
    { ok: true },
  );
  assert.throws(
    () => f.registry.authenticate(three.binding.token),
    (e) => e.code === "UNAUTHORIZED",
  );
  assert.equal(
    f.registry.db.prepare("SELECT COUNT(*) n FROM account_grant_intents").get()
      .n,
    1,
  );
  assert.throws(
    () => f.registry.db.exec("DELETE FROM account_v4_events"),
    /APPEND_ONLY/,
  );
});
test("legacy claim retains IDs/bindings and never creates an initial-grant intent; migration is idempotent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "shixu-claim-v4-"));
  const registry = new AccountRegistry(
    root,
    "synthetic-claim-secret-with-32-characters",
  );
  t.after(async () => {
    registry.close();
    await rm(root, { recursive: true, force: true });
  });
  const invitation = registry.generate(1)[0],
    binding = registry.bind(
      invitation.invite,
      "windows",
      "legacy-win",
      "synthetic-only",
    );
  const auth = new AccountsV4(registry);
  assert.equal(auth.devices(invitation.userId)[0].id, binding.id);
  const request = {
    operationId: "claim",
    username: "legacy",
    password: "synthetic-password",
  };
  await auth.claim(invitation.userId, request, binding.id, "ip1");
  assert.equal(auth.devices(invitation.userId)[0].id, binding.id);
  assert.equal(registry.authenticate(binding.token).user_id, invitation.userId);
  assert.equal(
    registry.db.prepare("SELECT COUNT(*) n FROM account_grant_intents").get().n,
    0,
  );
  new AccountsV4(registry);
  assert.equal(auth.devices(invitation.userId).length, 1);
  assert.throws(
    () => registry.bind(invitation.invite, "windows", "new-win", "synthetic"),
    (e) => e.code === "CLIENT_UPGRADE_REQUIRED",
  );
  const credential = registry.db
    .prepare("SELECT * FROM account_credentials")
    .get();
  assert.equal(credential.salt.length, 64);
  assert.equal(credential.hash.length, 128);
  assert.ok(!JSON.stringify(credential).includes(request.password));
});

test("twenty unused invitations do not count as registered accounts; ten actual legacy users block new registration", async (t) => {
  const f = await fixture(t),
    invitations = f.registry.generate(20);
  for (let i = 0; i < 10; i++)
    f.registry.transaction(() =>
      f.auth.binding(invitations[i].userId, identity("legacy-" + i)),
    );
  await assert.rejects(
    f.auth.register(
      {
        operationId: "eleventh",
        username: "eleventh",
        password: "synthetic-password",
        invite: invitations[10].invite,
      },
      identity("new"),
      "ip",
    ),
    (e) => e.code === "REGISTRATION_FULL",
  );
  assert.equal(
    f.registry.db
      .prepare("SELECT COUNT(*) n FROM bindings WHERE revoked=0")
      .get().n,
    10,
  );
  assert.equal(
    f.registry.db.prepare("SELECT COUNT(*) n FROM account_credentials").get().n,
    0,
  );
});

test("two real registry connections cannot allocate the same final Windows slot", async (t) => {
  const f = await fixture(t),
    invitation = f.registry.generate(1)[0],
    value = {
      operationId: "register",
      invite: invitation.invite,
      username: "concurrent",
      password: "synthetic-password",
    };
  await f.auth.register(value, identity("one"), "ip");
  f.advance(61000);
  await f.auth.login({ ...value, operationId: "two" }, identity("two"), "ip");
  const otherRegistry = new AccountRegistry(
      f.directory,
      "synthetic-v4-credential-secret-32-characters",
    ),
    other = new AccountsV4(otherRegistry);
  try {
    const results = await Promise.allSettled([
      f.auth.login({ ...value, operationId: "three" }, identity("three"), "ip"),
      other.login({ ...value, operationId: "four" }, identity("four"), "ip"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      results.find((r) => r.status === "rejected").reason.code,
      "DEVICE_SLOTS_FULL",
    );
    assert.equal(f.auth.devices(invitation.userId).length, 3);
  } finally {
    otherRegistry.close();
  }
});

test("unknown credential schema aborts the account migration transaction without dropping legacy protection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "shixu-auth-migration-failure-")),
    registry = new AccountRegistry(
      root,
      "synthetic-migration-secret-32-characters",
    );
  try {
    const invitation = registry.generate(1)[0],
      binding = registry.bind(
        invitation.invite,
        "windows",
        "legacy",
        "synthetic",
      );
    registry.db.exec("CREATE TABLE account_credentials(unexpected TEXT)");
    assert.throws(() => new AccountsV4(registry), /UNKNOWN_CREDENTIAL_SCHEMA/);
    assert.equal(
      registry.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='index' AND name='active_slot'",
        )
        .get()[1],
      1,
    );
    assert.equal(
      registry.db
        .prepare("SELECT 1 FROM account_meta WHERE key='auth_v4'")
        .get(),
      undefined,
    );
    assert.equal(
      registry.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='account_device_slots'",
        )
        .get(),
      undefined,
    );
    assert.equal(
      registry.authenticate(binding.token).user_id,
      invitation.userId,
    );
  } finally {
    registry.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("five sliding attempts per minute and ten failures lock for fifteen minutes without extending the lock", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      f.auth.verify("missing", "synthetic-wrong", "ip"),
      (e) => e.code === "UNAUTHORIZED",
    );
  await assert.rejects(
    f.auth.verify("missing", "synthetic-wrong", "ip"),
    (e) => e.code === "LOGIN_RATE_LIMIT",
  );
  f.advance(61000);
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      f.auth.verify("missing", "synthetic-wrong", "ip"),
      (e) => e.code === "UNAUTHORIZED",
    );
  const before = f.registry.db
    .prepare("SELECT * FROM account_login_failures")
    .get();
  f.advance(61000);
  await assert.rejects(
    f.auth.verify("missing", "synthetic-wrong", "ip"),
    (e) => e.code === "UNAUTHORIZED",
  );
  assert.equal(
    f.registry.db
      .prepare("SELECT locked_until FROM account_login_failures")
      .get().locked_until,
    before.locked_until,
  );
  f.advance(15 * 60000);
  await assert.rejects(
    f.auth.verify("missing", "synthetic-wrong", "ip"),
    (e) => e.code === "UNAUTHORIZED",
  );
  assert.equal(
    f.registry.db.prepare("SELECT failures FROM account_login_failures").get()
      .failures,
    1,
  );
});
