import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { buildRelease } from "../../scripts/build-sync-release.mjs";
import { backupDatabase } from "./backup.mjs";
import { verifyService } from "./verify.mjs";

test("release starts independently; two devices, restart, WAL backup and restored service work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-deploy-"));
  let service;
  try {
    const { directory: release } = await buildRelease(join(directory, "release"));
    const current = join(directory, "current");
    await symlink(release, current, process.platform === "win32" ? "junction" : "dir");
    for (const line of (await readFile(join(release, "SHA256SUMS"), "utf8")).trim().split("\n")) {
      const [hash, file] = line.split("  ");
      assert.equal(createHash("sha256").update(await readFile(join(release, file))).digest("hex"), hash);
    }
    assert.deepEqual((await readdir(release)).sort(), ["SHA256SUMS", "deploy", "release.json", "server"]);
    assert.deepEqual((await readdir(join(release, "server"))).sort(), ["generated", "sync-jobs.mjs", "sync-server.mjs", "sync-store.mjs"]);
    const { createSyncService } = await import(pathToFileURL(join(release, "server/sync-server.mjs")));
    const database = join(directory, "data", "workspace.sqlite");
    const password = "synthetic-deploy-password-only";
    const start = async (db) => {
      service = createSyncService({ database: db, password });
      service.server.listen(0, "127.0.0.1");
      await once(service.server, "listening");
      return `http://127.0.0.1:${service.server.address().port}`;
    };
    const stop = async () => { service.server.close(); await once(service.server, "close"); service = null; };
    let base = await start(database);
    // Restart on the same port so the HTTP probe traverses a real server restart.
    const port = service.server.address().port;
    const report = await verifyService(base, password, async () => {
      await stop();
      service = createSyncService({ database, password });
      service.server.listen(port, "127.0.0.1");
      await once(service.server, "listening");
    });
    assert.equal(report.restartPersistence, true);
    assert.equal(report.testDevicesRevoked, true);
    const sequence = service.store.sequence;
    const epoch = service.store.epoch;
    const snapshot = await backupDatabase(database, join(directory, "backups"));
    const db = new DatabaseSync(join(snapshot, "workspace.sqlite"), { readOnly: true });
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    assert.equal(Number(db.prepare("SELECT value FROM sync_meta WHERE key='sequence'").get().value), sequence);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sync_devices WHERE revoked=0").get().n, 0);
    db.close();
    const second = await backupDatabase(database, join(directory, "backups"));
    assert.notEqual(second, snapshot);
    const cliBackup = await promisify(execFile)(process.execPath, [
      join(current, "deploy/sync/backup.mjs"), database, join(directory, "cli-backup"),
    ]);
    assert.equal(JSON.parse(await readFile(join(cliBackup.stdout.trim(), "backup.json"), "utf8")).integrity, "ok");
    await stop();
    base = await start(join(snapshot, "workspace.sqlite"));
    const restored = await (await fetch(`${base}/api/v2/status`)).json();
    assert.equal(restored.epoch, epoch);
    assert.equal((await verifyService(base, password)).twoDevices, true);
    const cliProbe = await promisify(execFile)(process.execPath, [join(current, "deploy/sync/verify.mjs"), base], {
      env: { ...process.env, SYNC_PASSWORD: password },
    });
    assert.equal(JSON.parse(cliProbe.stdout).testDevicesRevoked, true);
    await stop();
    // Match systemd: chdir through current, then run a relative main script.
    const child = spawn(process.execPath, ["--preserve-symlinks-main", "server/sync-server.mjs"], {
      cwd: current, stdio: "pipe", env: { ...process.env, SYNC_PASSWORD: password,
        SYNC_HOST: "127.0.0.1", SYNC_PORT: String(port), SYNC_ORIGIN: `http://127.0.0.1:${port}`,
        SYNC_DATA_DIR: join(directory, "child-data") },
    });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/v2/status`, { signal: AbortSignal.timeout(300) });
          ready = response.ok;
          if (ready) break;
        } catch {}
        if (child.exitCode !== null) break;
        await new Promise((done) => setTimeout(done, 50));
      }
      assert.equal(ready, true, "Packaged CLI must stay running through the current symlink");
    } finally {
      if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    }
    // Existing destinations must fail instead of mixing different snapshots.
    await assert.rejects(buildRelease(release), { code: "EEXIST" });
  } finally {
    if (service) { service.server.close(); await once(service.server, "close"); }
    await rm(directory, { recursive: true, force: true });
  }
});
