import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { updateSecrets, secretValues } from "./configure-secrets.mjs";
test("configuration writes only validated server values, preserves existing settings and secret, and keeps AI off", async () => {
  const root = await mkdtemp(join(tmpdir(), "shixu-secret-configuration-")),
    file = join(root, "service.env");
  try {
    await writeFile(
      file,
      "SYNC_PASSWORD=synthetic-legacy-password\nSYNC_AI_ENABLED=true\nCUSTOM=preserved\n",
      { mode: 0o600 },
    );
    const result = await updateSecrets(file, {
      DEEPSEEK_API_KEY: "synthetic-key-with-no-provider-access",
      WECHAT_APP_SECRET: "a".repeat(32),
      WECHAT_APP_ID: "wx03d8b4c63a26177c",
    });
    assert.equal(result.aiEnabled, false);
    assert.ok(!JSON.stringify(result).includes("synthetic-key"));
    const first = await readFile(file, "utf8"),
      accountSecret = first.match(/^SYNC_ACCOUNT_SECRET=(.+)$/m)[1];
    assert.ok(accountSecret.length >= 32);
    assert.match(first, /SYNC_AI_ENABLED=false/);
    assert.match(first, /CUSTOM=preserved/);
    await updateSecrets(file, {
      DEEPSEEK_API_KEY: "synthetic-replacement-provider-key",
    });
    assert.equal(
      (await readFile(file, "utf8")).match(/^SYNC_ACCOUNT_SECRET=(.+)$/m)[1],
      accountSecret,
    );
    await assert.rejects(
      updateSecrets(file, { WECHAT_APP_SECRET: "bad\nSYNC_AI_ENABLED=true" }),
    );
    assert.match(await readFile(file, "utf8"), /SYNC_AI_ENABLED=false/);
    assert.throws(
      () => secretValues({ DEEPSEEK_API_KEY: "leak\nsecret" }),
      /Invalid configuration/,
    );
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), "shixu-secret-configuration-")));
    await rm(root, { recursive: true, force: true });
  }
});
