import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createSyncService } from "./sync-server.mjs";
import { backupDatabase } from "../deploy/sync/backup.mjs";

async function fixture(t, { limits = {}, ai = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "shixu-files-test-")),
    database = join(dir, "workspace.sqlite");
  let service, base;
  async function start() {
    service = createSyncService({
      database,
      password: "synthetic-files-passphrase",
      fileLimits: limits,
      ai,
    });
    await new Promise((resolve) =>
      service.server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${service.server.address().port}`;
  }
  const stop = () => new Promise((resolve) => service.server.close(resolve));
  await start();
  t.after(async () => {
    await stop();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    assert.ok(dir.includes("shixu-files-test-"));
    rmSync(dir, { recursive: true, force: true });
  });
  const json = async (path, data, token, method = "POST") => {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const body = await r.json();
    if (!r.ok)
      throw Object.assign(Error(body.error), body, { status: r.status });
    return body;
  };
  const device = await json("/api/v2/devices", {
    name: "synthetic",
    password: "synthetic-files-passphrase",
  });
  const apply = (id, type, data, opId = crypto.randomUUID()) =>
    json(
      "/api/v2/operations",
      {
        epoch: device.epoch,
        operation: {
          opId,
          id,
          type,
          baseVersion: service.store.record(id)?.version || 0,
          ...(data ? { data } : {}),
        },
      },
      device.token,
    );
  const put = (
    packetId,
    id,
    bytes,
    name = "通知.txt",
    token = device.token,
    extra = {},
  ) =>
    fetch(
      `${base}/api/v2/attachments/${packetId}/${id}?epoch=${device.epoch}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "X-Shixu-File-Name": encodeURIComponent(name),
          "X-Shixu-File-Type": "text/plain",
          ...extra,
        },
        body: bytes,
      },
    );
  const get = (packetId, id, token = device.token, epoch = device.epoch) =>
    fetch(
      `${base}/api/v2/attachments/${packetId}/${id}?epoch=${encodeURIComponent(epoch)}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
  const packet = async (id) =>
    apply(id, "put", {
      text: "合成投递",
      sources: [{ id: "input", name: "输入", text: "合成投递" }],
      attachments: [],
      captureDate: "2026-10-24",
      status: "pending",
      result: null,
      doneIds: [],
    });
  return {
    dir,
    database,
    json,
    device,
    apply,
    put,
    get,
    packet,
    service: () => service,
    restart: async () => {
      await stop();
      await start();
    },
  };
}
test("binary originals require authentication and cannot be referenced before upload", async (t) => {
  const f = await fixture(t);
  await f.packet("p");
  assert.equal((await f.get("p", "a", null)).status, 401);
  assert.equal(
    (await f.put("p", "a", Buffer.from("secret"), "a.txt", "invalid")).status,
    401,
  );
  await assert.rejects(
    f.apply("p", "put", {
      attachments: [
        {
          id: "missing",
          name: "a.txt",
          type: "text/plain",
          size: 1,
          hash: "0".repeat(64),
        },
      ],
    }),
    (e) => e.code === "ATTACHMENT_MISSING",
  );
});
test("an original survives upload retry, restart, soft delete and restore byte-for-byte", async (t) => {
  const f = await fixture(t);
  await f.packet("p");
  const bytes = Buffer.from("合成文字原件\n第二行");
  const first = await (await f.put("p", "a", bytes)).json(),
    retry = await (await f.put("p", "a", bytes)).json();
  assert.deepEqual(retry.file, first.file);
  assert.equal(first.reading.source.text, bytes.toString());
  assert.equal(
    (await f.get("p", "a")).status,
    404,
    "unlinked staging bytes are private to upload flow",
  );
  await f.apply("p", "put", { attachments: [first.file] });
  const download = await f.get("p", "a");
  assert.equal(download.headers.get("x-shixu-sha256"), first.file.hash);
  assert.equal(
    download.headers.get("content-type"),
    "application/octet-stream",
  );
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  await f.restart();
  assert.deepEqual(
    Buffer.from(await (await f.get("p", "a")).arrayBuffer()),
    bytes,
  );
  assert.equal(
    (await f.get("p", "a", f.device.token, "old-workspace")).status,
    409,
  );
  await f.apply("p", "delete");
  assert.equal((await f.get("p", "a")).status, 409);
  await f.apply("p", "restore");
  assert.deepEqual(
    Buffer.from(await (await f.get("p", "a")).arrayBuffer()),
    bytes,
  );
  assert.equal((await f.put("p", "a", Buffer.from("different"))).status, 409);
});
test("attachment IDs are packet-scoped; names, local paths and forged metadata are rejected", async (t) => {
  const f = await fixture(t);
  await f.packet("p");
  await f.packet("q");
  const { file } = await (await f.put("p", "a", Buffer.from("text"))).json();
  await assert.rejects(
    f.apply("q", "put", { attachments: [file] }),
    (e) => e.code === "ATTACHMENT_MISSING",
  );
  await assert.rejects(
    f.apply("p", "put", {
      attachments: [{ ...file, path: "C:/private/file" }],
    }),
    (e) => e.code === "INVALID_ATTACHMENT",
  );
  await assert.rejects(
    f.apply("p", "put", { attachments: [{ ...file, size: 999 }] }),
    (e) => e.code === "ATTACHMENT_MISSING",
  );
  assert.equal(
    (await f.put("p", "bad", Buffer.from("text"), "../outside.txt")).status,
    400,
  );
  assert.equal(
    (await f.put("p", "bad", Buffer.from("text"), "name\nheader.txt")).status,
    400,
  );
});
test("quotas bound uploads while shared bytes remain deduplicated and purge cannot resurrect files", async (t) => {
  const f = await fixture(t, {
    limits: { maxFileBytes: 12, maxFilesPerPacket: 2, maxWorkspaceBytes: 12 },
  });
  await f.packet("p");
  await f.packet("q");
  assert.equal((await f.put("p", "large", Buffer.alloc(13))).status, 413);
  const one = await (await f.put("p", "a", Buffer.from("12345678"))).json(),
    two = await (await f.put("q", "a", Buffer.from("12345678"))).json();
  await f.apply("p", "put", { attachments: [one.file] });
  await f.apply("q", "put", { attachments: [two.file] });
  assert.equal(
    f.service().store.db.prepare("SELECT COUNT(*) AS n FROM sync_blobs").get()
      .n,
    1,
  );
  assert.equal((await f.put("p", "b", Buffer.from("otherbytes"))).status, 413);
  await f.apply("p", "delete");
  await f.apply("p", "purge");
  assert.equal((await f.get("p", "a")).status, 404);
  assert.equal((await f.put("p", "a", Buffer.from("12345678"))).status, 404);
  assert.equal((await f.get("q", "a")).status, 200);
  await f.apply("q", "delete");
  await f.apply("q", "purge");
  assert.equal(
    f.service().store.db.prepare("SELECT COUNT(*) AS n FROM sync_blobs").get()
      .n,
    0,
  );
});
test("SQLite online backup includes originals and restores complete bytes", async (t) => {
  const f = await fixture(t);
  await f.packet("p");
  const bytes = Buffer.from([0, 1, 2, 255, 100]),
    { file } = await (await f.put("p", "a", bytes, "photo.png")).json();
  await f.apply("p", "put", { attachments: [file] });
  const result = await backupDatabase(f.database, join(f.dir, "backups"));
  const restored = createSyncService({
    database: join(result, "workspace.sqlite"),
    password: "synthetic-restore-passphrase",
  });
  try {
    assert.deepEqual(restored.files.get("p", "a").body, bytes);
  } finally {
    restored.jobs.stop();
    restored.store.close();
  }
});
test("AI reads UTF-8 original bytes rather than client-provided attachment text", async (t) => {
  let seen;
  const f = await fixture(t, {
    ai: {
      organize: async (p) => {
        seen = p.sources;
        return { result: { summary: "synthetic", warnings: [], items: [] } };
      },
    },
  });
  await f.packet("p");
  const { file } = await (
    await f.put("p", "a", Buffer.from("原件中的要求"))
  ).json();
  await f.apply("p", "put", {
    attachments: [file],
    sources: [{ id: "a", name: "伪造", text: "不是原件" }],
  });
  const record = f.service().store.record("p");
  await f.json(
    "/api/v2/jobs",
    {
      id: "file-job",
      packetId: "p",
      kind: "organize",
      baseVersion: record.version,
      epoch: f.device.epoch,
    },
    f.device.token,
  );
  for (let i = 0; i < 100 && !seen; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(seen.find((s) => s.id === "a").text, "原件中的要求");
});
test("unsupported binary documents preserve originals and never trigger a fake AI read", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    ai: {
      organize: async () => {
        calls++;
        throw Error("must not call");
      },
    },
  });
  await f.packet("p");
  const result = await (
    await f.put("p", "a", Buffer.from("%PDF-synthetic"), "report.pdf")
  ).json();
  assert.equal(result.reading.state, "unsupported");
  await f.apply("p", "put", { attachments: [result.file] });
  await assert.rejects(
    f.json(
      "/api/v2/jobs",
      {
        id: "pdf-job",
        packetId: "p",
        kind: "organize",
        baseVersion: f.service().store.record("p").version,
        epoch: f.device.epoch,
      },
      f.device.token,
    ),
    (e) => e.code === "ATTACHMENT_READING_NOT_READY",
  );
  assert.equal(calls, 0);
  assert.equal((await f.get("p", "a")).status, 200);
});

test("unlinked uploads block AI until their reference is committed", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    ai: {
      organize: async () => {
        calls++;
        return { result: { summary: "x", items: [], warnings: [] } };
      },
    },
  });
  await f.packet("p");
  await f.put("p", "a", Buffer.from("original"));
  await assert.rejects(
    f.json(
      "/api/v2/jobs",
      {
        id: "staged-job",
        packetId: "p",
        kind: "organize",
        baseVersion: f.service().store.record("p").version,
        epoch: f.device.epoch,
      },
      f.device.token,
    ),
    (e) => e.code === "ATTACHMENTS_PENDING",
  );
  assert.equal(calls, 0);
});
test("hash corruption prevents download rather than returning altered original bytes", async (t) => {
  const f = await fixture(t);
  await f.packet("p");
  const { file } = await (await f.put("p", "a", Buffer.from("good"))).json();
  await f.apply("p", "put", { attachments: [file] });
  f.service()
    .store.db.prepare("UPDATE sync_blobs SET body=? WHERE hash=?")
    .run(Buffer.from("evil"), file.hash);
  const response = await f.get("p", "a");
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, "FILE_INTEGRITY");
});
test("per-packet limits, duplicate descriptors and invalid UTF-8 preserve originals without reading them", async (t) => {
  const f = await fixture(t, { limits: { maxFilesPerPacket: 1 } });
  await f.packet("p");
  assert.equal(
    (await f.put("p", "input", Buffer.from("reserved"))).status,
    400,
  );
  const result = await (
    await f.put("p", "a", Buffer.from([255, 254, 253]))
  ).json();
  assert.equal(result.reading.state, "unsupported");
  assert.equal((await f.put("p", "b", Buffer.from("next"))).status, 422);
  await assert.rejects(
    f.apply("p", "put", { attachments: [result.file, result.file] }),
    (e) => e.code === "TOO_MANY_FILES",
  );
  await f.apply("p", "put", { attachments: [result.file] });
  assert.deepEqual(
    [...Buffer.from(await (await f.get("p", "a")).arrayBuffer())],
    [255, 254, 253],
  );
});
