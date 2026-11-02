import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReadingRuntime } from "../reading-runtime.mjs";
import { AccountRegistry } from "../sync-accounts.mjs";
import { ReadingLedger } from "./ledger.mjs";

test("opt-in runtime exposes v4 accounts and all task capabilities without enabling AI, then closes and reopens its external ledger", async () => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-runtime-"));
  let runtime;
  try {
    const config = { directory: join(directory, "data"), ledgerPath: join(directory, "billing", "ledger.sqlite"),
      brokerSocket: "/run/shixu-test/reader.sock", enabled: false, pdfVisual: true,
      tariff: { id: "deepseek-flash-1017-20261028-peak", verifiedAt: 1000, validUntil: 2000 } };
    let calls = 0;
    const options = { secret: "synthetic-runtime-secret-more-than-32-chars", now: () => 1500,
      fetcher: () => { calls++; assert.fail("must not call provider"); } };
    runtime = createReadingRuntime(config, options);
    const address = await runtime.listen(0);
    assert.equal(address.address, "127.0.0.1");
    const result = await fetch(`http://127.0.0.1:${address.port}/api/v4/capabilities`).then(r => r.json());
    assert.equal(result.features.submissionManifest, true);
    assert.equal(result.features.readingEnabled, false);
    assert.equal(result.materialUseNotice.version, 1);
    assert.ok(runtime.service.credentials);
    const [invitation] = runtime.service.registry.generate(1);
    assert.throws(() => runtime.ledger.wallet(invitation.userId), /RECONCILIATION_REQUIRED/);
    assert.equal(calls, 0);
    await runtime.close();
    // An operator can reverify an unchanged tariff without rewriting its ID.
    runtime = createReadingRuntime({ ...config, tariff: { ...config.tariff, verifiedAt: 1200, validUntil: 2200 } }, options);
    assert.equal(JSON.parse(runtime.ledger.db.prepare("SELECT body FROM reading_prices WHERE id=?").get(config.tariff.id).body).verifiedAt, 1000);
    await runtime.close();
    runtime = null;
  } finally { await runtime?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("runtime refuses an unreconciled legacy account instead of issuing fresh v4 credit", () => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-runtime-legacy-"));
  const secret = "synthetic-runtime-secret-more-than-32-chars";
  const data = join(directory, "data"), billing = join(directory, "billing", "ledger.sqlite");
  const registry = new AccountRegistry(data, secret);
  const [invitation] = registry.generate(1);
  registry.bind(invitation.invite, "wechat", "c".repeat(64));
  registry.close();
  try {
    assert.throws(() => createReadingRuntime({ directory: data, ledgerPath: billing,
      brokerSocket: "/run/shixu-test/reader.sock", enabled: false, pdfVisual: false,
      tariff: { id: "deepseek-flash-1017-20261028-peak", verifiedAt: 1000, validUntil: 2000 } }, { secret, now: () => 1500 }), /LEGACY_RECONCILIATION_REQUIRED/);
    const ledger = new ReadingLedger(billing);
    try { assert.equal(ledger.db.prepare("SELECT COUNT(*) n FROM reading_wallets").get().n, 0); }
    finally { ledger.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("runtime rejects missing isolation, expired prices, missing keys, and billing inside account data before opening service", () => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-runtime-config-"));
  try {
    const config = { directory: join(directory, "data"), ledgerPath: join(directory, "billing", "ledger.sqlite"),
      brokerSocket: "/run/shixu-test/reader.sock", enabled: true, pdfVisual: false,
      tariff: { id: "deepseek-flash-1017-20261028-peak", verifiedAt: 1000, validUntil: 2000 } };
    const options = { secret: "synthetic-runtime-secret-more-than-32-chars", apiKey: "synthetic-not-live", now: () => 1500 };
    for (const change of [{ brokerSocket: "/tmp/anything" }, { ledgerPath: join(config.directory, "ledger.sqlite") },
      { enabled: "true" }, { tariff: { ...config.tariff, validUntil: 86402000 } }, { arbitraryOption: true }])
      assert.throws(() => createReadingRuntime({ ...config, ...change }, options));
    assert.throws(() => createReadingRuntime(config, { ...options, now: () => 2000 }), /VERIFIED_PRICE_EXPIRED/);
    assert.throws(() => createReadingRuntime(config, { ...options, apiKey: undefined }), /CONFIGURATION/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
