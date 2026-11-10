import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

test("published current link starts the actual runtime and maintenance entrypoint", async () => {
  const root = mkdtempSync(join(tmpdir(), "shixu-linked-entry-"));
  let child;
  try {
    const current = join(root, "current");
    symlinkSync(
      fileURLToPath(new URL("../../", import.meta.url)),
      current,
      process.platform === "win32" ? "junction" : "dir",
    );
    const worker = spawnSync(
      process.execPath,
      [join(current, "scripts/cloud-operations-worker.mjs"), "--invalid"],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
    );
    assert.equal(
      worker.status,
      1,
      "linked worker must execute its authority gate, not silently exit",
    );
    assert.match(worker.stderr, /OPERATION_AUTHORITY_REQUIRED/);
    const imported = spawnSync(process.execPath, ["--input-type=module", "-"], {
      input: `await import(${JSON.stringify(new URL("../reading-runtime.mjs", import.meta.url).href)});await import(${JSON.stringify(new URL("../../scripts/cloud-operations-worker.mjs", import.meta.url).href)});console.log('imported-without-starting');`,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    });
    assert.equal(imported.status, 0, imported.stderr);
    assert.match(imported.stdout, /imported-without-starting/);
    const config = join(root, "runtime.json"),
      now = Date.now();
    writeFileSync(
      config,
      JSON.stringify({
        directory: join(root, "data"),
        ledgerPath: join(root, "billing/ledger.sqlite"),
        brokerSocket: "/run/shixu-test/reader.sock",
        enabled: false,
        pdfVisual: false,
        tariff: {
          id: "deepseek-flash-1017-20261028-peak",
          verifiedAt: now,
          validUntil: now + 3600000,
        },
      }),
    );
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    child = spawn(
      process.execPath,
      [join(current, "server/reading-runtime.mjs")],
      {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...process.env,
          SYNC_V4_CONFIG: config,
          SYNC_PORT: String(port),
          SYNC_ACCOUNT_SECRET: "synthetic-linked-entry-secret-".repeat(2),
          SHIXU_ADMIN_STATE: "",
          SHIXU_AUTHORITY_FLOOR: "",
          DEEPSEEK_API_KEY: "",
          WECHAT_APP_ID: "",
          WECHAT_APP_SECRET: "",
        },
      },
    );
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk.toString();
    });
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null)
        assert.fail("Linked runtime exited: " + errors);
      try {
        const response = await fetch(
          `http://127.0.0.1:${port}/api/v4/capabilities`,
          { signal: AbortSignal.timeout(500) },
        );
        if (response.ok && (await response.json()).contractVersion === 1) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, errors);
  } finally {
    if (child && child.exitCode === null) {
      const closed = once(child, "exit");
      child.kill();
      await closed;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
