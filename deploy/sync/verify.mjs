import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Uses only a unique synthetic record; no personal records are edited or logged.
export async function verifyService(base, password, restart = null) {
  const request = async (path, { token, method = "GET", data, expected = 200 } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method, signal: AbortSignal.timeout(10000),
      // Probes intentionally restart the listener; do not reuse a pre-restart socket.
      headers: { Connection: "close", ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    assert.equal(response.status, expected, `${method} ${path} returned ${response.status}`);
    return response.json();
  };
  const status = await request("/api/v2/status");
  assert.equal(status.application, "shixu-sync");
  assert.equal(status.protocolVersion, 2);
  await request("/api/v2/changes", { expected: 401 });
  const devices = [];
  const recordId = `deployment-probe-${randomUUID()}`;
  let current = null;
  let report;
  try {
    for (const name of ["deployment-probe-A", "deployment-probe-B"]) {
      devices.push(await request("/api/v2/devices", { method: "POST", expected: 201, data: { name, password } }));
    }
    const write = (device, operation, expected = 200) => request("/api/v2/operations", {
      token: device.token, method: "POST", expected, data: { epoch: status.epoch, operation },
    });
    const operation = { opId: randomUUID(), id: recordId, type: "put", baseVersion: 0,
      data: { id: recordId, text: "Synthetic deployment probe", attachments: [], itemState: { probe: { done: false } } } };
    current = (await write(devices[0], operation)).record;
    const replay = await write(devices[0], operation);
    assert.equal(replay.replayed, true);
    assert.equal(replay.acceptedVersion, current.version);
    const pull = await request("/api/v2/changes", { token: devices[1].token });
    // Follow pagination so the check remains valid after the staging DB grows.
    const find = async (device) => {
      let page = pull;
      let record = page.records.find((r) => r.id === recordId);
      while (!record && page.more) {
        page = await request(`/api/v2/changes?cursor=${page.cursor}&epoch=${encodeURIComponent(page.epoch)}`, { token: device.token });
        record = page.records.find((r) => r.id === recordId);
      }
      return record;
    };
    assert.equal((await find(devices[1])).data.itemState.probe.done, false);
    const before = current.version;
    current = (await write(devices[1], { opId: randomUUID(), id: recordId, type: "put", baseVersion: before,
      data: { itemState: { probe: { done: true } } } })).record;
    assert.equal(current.data.itemState.probe.done, true);
    const conflict = await write(devices[0], { opId: randomUUID(), id: recordId, type: "put", baseVersion: before,
      data: { text: "Stale device change" } }, 409);
    assert.equal(conflict.code, "REVISION_CONFLICT");
    if (restart) {
      await restart();
      const after = await request(`/api/v2/changes?cursor=${before}&epoch=${encodeURIComponent(status.epoch)}`, { token: devices[0].token });
      assert.equal(after.epoch, status.epoch);
      assert.equal(after.records.find((r) => r.id === recordId).data.itemState.probe.done, true);
    }
    current = (await write(devices[0], { opId: randomUUID(), id: recordId, type: "delete", baseVersion: current.version })).record;
    assert.ok(current.deletedAt);
    current = (await write(devices[1], { opId: randomUUID(), id: recordId, type: "restore", baseVersion: current.version })).record;
    assert.equal(current.deletedAt, null);
    assert.equal(current.data.itemState.probe.done, true);
    report = { application: status.application, protocolVersion: status.protocolVersion,
      unauthorizedRejected: true, twoDevices: true, idempotentRetry: true,
      conflictProtected: true, deleteRestore: true, restartPersistence: !!restart };
  } finally {
    if (current) {
      if (!current.deletedAt) current = (await request("/api/v2/operations", { token: devices[0].token,
        method: "POST", data: { epoch: status.epoch, operation: {
          opId: randomUUID(), id: recordId, type: "delete", baseVersion: current.version,
        } } })).record;
      await request("/api/v2/operations", { token: devices[0].token, method: "POST", data: {
        epoch: status.epoch, operation: { opId: randomUUID(), id: recordId, type: "purge", baseVersion: current.version },
      } });
    }
    for (const device of devices) {
      await request("/api/v2/device", { token: device.token, method: "DELETE" });
      await request("/api/v2/changes", { token: device.token, expected: 401 });
    }
  }
  return { ...report, testRecordPurged: true, testDevicesRevoked: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const base = process.argv[2] || "http://127.0.0.1:8788";
  const url = new URL(base);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("Deployment probe only accepts a local service or SSH tunnel");
  if (!process.env.SYNC_PASSWORD) throw new Error("Load the service environment file before probing");
  const restart = process.argv.includes("--restart-service") ? async () => {
    execFileSync("systemctl", ["restart", "shixu-sync.service"], { stdio: "pipe" });
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if ((await fetch(`${base}/api/v2/status`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error("Service did not return after restart");
  } : null;
  console.log(JSON.stringify(await verifyService(base, process.env.SYNC_PASSWORD, restart), null, 2));
}
