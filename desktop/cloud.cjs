const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { DesktopStore } = require("./storage.cjs");
const { createSyncClient } = require("./generated/sync-client.cjs");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
function atomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file + ".next", "w", 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(file + ".next", file);
}
function serviceURL(value) {
  const url = new URL(String(value).trim());
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    )
  )
    throw Error("请填写 HTTPS 服务地址；本机 HTTP 仅用于 SSH 隧道调试");
  return url.origin;
}
class CloudWorkspace {
  constructor({ root, local, seal, unseal, fetcher = fetch }) {
    Object.assign(this, { root, local, seal, unseal, fetcher });
    this.config = { active: "", devices: {} };
    this.tail = Promise.resolve();
    this.spaces = new Map();
    this.lastError = "";
  }
  async init() {
    const file = path.join(this.root, "connection.enc");
    if (fs.existsSync(file)) {
      this.config = JSON.parse(await this.unseal(fs.readFileSync(file)));
      if (this.config.active) serviceURL(this.config.active);
    }
  }
  serial(fn) {
    const result = this.tail.catch(() => {}).then(fn);
    this.tail = result;
    return result;
  }
  async configure(next) {
    atomic(
      path.join(this.root, "connection.enc"),
      await this.seal(JSON.stringify(next)),
    );
    this.config = next;
    this.lastError = "";
  }
  space(base = this.config.active) {
    if (!base) return null;
    if (!this.spaces.has(base)) {
      const root = path.join(this.root, hash(base));
      const cache = new DesktopStore(root, { allowVolatileOriginals: true });
      fs.mkdirSync(cache.file("files"), { recursive: true });
      const file = cache.file("queue.json");
      const client = createSyncClient({
        protocolVersion: this.protocolVersion || 2,
        read: () =>
          fs.existsSync(file)
            ? JSON.parse(fs.readFileSync(file, "utf8"))
            : null,
        write: (value) => atomic(file, JSON.stringify(value)),
        makeId: randomUUID,
        request: async (method, api, data) => {
          if (
            method === "POST" &&
            ["/api/v2/operations", "/api/v3/operations"].includes(api) &&
            data.operation.type === "put"
          ) {
            const op = data.operation;
            if (op.data.attachments?.length && this.submitOriginals) {
              const result = await this.submitOriginals(
                base,
                cache,
                op,
                data.epoch,
              );
              if (result) return result;
            }
            if (op.baseVersion === 0 && op.data.attachments?.length) {
              // A stable scaffold operation makes original upload replayable even when copying a conflict.
              const scaffold = await this.request(base, method, api, {
                epoch: data.epoch,
                operation: {
                  ...op,
                  opId: op.opId + "_originals",
                  data: { ...op.data, attachments: [] },
                },
              });
              data = {
                ...data,
                operation: { ...op, baseVersion: scaffold.acceptedVersion },
              };
            }
            try {
              await this.upload(
                base,
                cache,
                op.id,
                op.data.attachments || [],
                data.epoch,
              );
            } catch (error) {
              if (error.code === "NOT_FOUND" && op.baseVersion > 0)
                error.code = "PURGED";
              throw error;
            }
          }
          return this.request(base, method, api, data);
        },
      });
      this.spaces.set(base, { cache, client });
    }
    return this.spaces.get(base);
  }
  async request(base, method, api, data, extra = {}) {
    const token = this.config.devices[base]?.token;
    const response = await this.fetcher(base + api, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extra.headers,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
      ...extra,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Object.assign(
        Error(body.error || `同步请求失败 (${response.status})`),
        body,
      );
    }
    return extra.binary
      ? Buffer.from(await response.arrayBuffer())
      : response.json();
  }
  status() {
    const space = this.space();
    return {
      base: this.config.active,
      pending: space?.client.pendingCount() || 0,
      conflicts: (space?.client.conflicts() || []).map((c) => ({
        id: c.id,
        text: c.local.data?.text || "投递",
      })),
      error: this.lastError,
    };
  }
  async connect({ base: value, password, device }) {
    const base = serviceURL(value);
    const status = await this.request(base, "GET", "/api/v2/status");
    if (status.application !== "shixu-sync" || status.protocolVersion !== 2)
      throw Error("该地址不是兼容的拾序同步服务");
    const space = this.space(base);
    const storedEpoch =
      fs.existsSync(space.cache.file("queue.json")) &&
      JSON.parse(fs.readFileSync(space.cache.file("queue.json"))).epoch;
    if (storedEpoch && storedEpoch !== status.epoch)
      throw Error("服务器资料版本已变化，请保留本机队列并核对");
    const enrolled =
      device ||
      (await this.request(base, "POST", "/api/v2/devices", {
        password,
        name: "拾序 Windows",
      }));
    if (typeof enrolled.token !== "string" || enrolled.epoch !== status.epoch)
      throw Error("设备授权无效");
    // Verify supplied enrollment without ever returning credentials to the renderer.
    const probe = await this.fetcher(
      base +
        "/api/v2/changes?cursor=0&epoch=" +
        encodeURIComponent(status.epoch),
      {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${enrolled.token}` },
      },
    );
    if (!probe.ok) throw Error("设备授权验证失败");
    await this.configure({
      active: base,
      devices: { ...this.config.devices, [base]: enrolled },
    });
    return this.status();
  }
  async upload(base, cache, packetId, attachments, epoch) {
    for (const a of attachments) {
      const file = cache.file("files/" + a.hash);
      // A remote-only original already has a validated server reference.
      if (!fs.existsSync(file)) continue;
      const bytes = fs.readFileSync(file);
      if (hash(bytes) !== a.hash || bytes.length !== a.size)
        throw Error("原件校验失败：" + a.name);
      const result = await this.request(
        base,
        "PUT",
        `/api/v2/attachments/${packetId}/${a.id}?epoch=${encodeURIComponent(epoch)}`,
        null,
        {
          headers: {
            Authorization: `Bearer ${this.config.devices[base].token}`,
            "Content-Type": "application/octet-stream",
            "X-Shixu-File-Name": encodeURIComponent(a.name),
            "X-Shixu-File-Type": a.type,
          },
          body: bytes,
        },
      );
      if (result.file.hash !== a.hash || result.file.size !== a.size)
        throw Error("服务端原件确认不一致");
    }
  }
  async packets() {
    const { client, cache } = this.space();
    return Promise.all(
      client
        .records()
        .filter((r) => !r.purged && r.data)
        .map(async (r) => {
          const p = {
            text: "",
            sources: [],
            attachments: [],
            status: "pending",
            result: null,
            error: "",
            doneIds: [],
            capturedAt: new Date(0).toISOString(),
            captureDate: "1970-01-01",
            updatedAt: new Date(0).toISOString(),
            ...r.data,
            syncVersion: r.version,
            syncAutoOrganize:
              r.data.desktopOwner ===
              this.config.devices[this.config.active]?.deviceId,
            deletedAt: r.deletedAt || undefined,
          };
          p.attachments = await Promise.all(
            p.attachments.map(async (a) => {
              if (!/^[a-f0-9]{64}$/.test(a.hash)) return a;
              const file = cache.file("files/" + a.hash);
              const volatile = cache.volatileOriginals.get(a.hash);
              if (volatile)
                return {
                  ...a,
                  bytes: Uint8Array.from(volatile).buffer,
                  localSaved: false,
                };
              if (!fs.existsSync(file)) return a;
              const bytes = fs.readFileSync(file);
              if (hash(bytes) !== a.hash || bytes.length !== a.size)
                throw Error("本机原件校验失败：" + a.name);
              return { ...a, bytes: Uint8Array.from(bytes).buffer };
            }),
          );
          return p;
        }),
    );
  }
  async sync() {
    if (!this.config.active) return this.status();
    try {
      const { client, cache } = this.space();
      const result = await client.sync();
      for (const r of client.records()) {
        if (r.purged || r.deletedAt || !r.data || r.pending || r.conflict)
          continue;
        for (const a of r.data.attachments || []) {
          if (
            a.deletedAt ||
            !/^[a-f0-9]{64}$/.test(a.hash) ||
            cache.volatileOriginals.has(a.hash) ||
            fs.existsSync(cache.file("files/" + a.hash))
          )
            continue;
          let bytes;
          try {
            bytes = await this.request(
              this.config.active,
              "GET",
              `/api/v2/attachments/${r.id}/${a.id}?epoch=${encodeURIComponent(result.epoch)}`,
              null,
              { binary: true },
            );
          } catch (e) {
            if ([404, 409].includes(e.status)) {
              cache.localSaveError ||=
                "部分云端原件已清理；已有本机副本保留，继续可能需要重传";
              continue;
            }
            throw e;
          }
          if (hash(bytes) !== a.hash || bytes.length !== a.size)
            throw Error("下载原件校验失败：" + a.name);
          try {
            atomic(cache.file("files/" + a.hash), bytes);
          } catch {
            cache.keepVolatile(a.hash, bytes);
          }
        }
      }
      // Keep every pending/conflicting original and the independent draft; remove only unreferenced cache bytes.
      const snapshot = JSON.parse(
        fs.readFileSync(cache.file("queue.json"), "utf8"),
      );
      const draft = (await cache.load()).draft;
      const referenced = new Set(
        [
          ...client.records().flatMap((r) => r.data?.attachments || []),
          ...snapshot.outbox.flatMap(
            (e) => e.operation.data?.attachments || [],
          ),
          ...draft.attachments,
        ].map((a) => a.hash),
      );
      for (const name of fs.readdirSync(cache.file("files")))
        if (/^[a-f0-9]{64}$/.test(name) && !referenced.has(name))
          fs.unlinkSync(cache.file("files/" + name));
      this.lastError = "";
    } catch (e) {
      this.lastError = e.message;
      throw e;
    }
    return this.status();
  }
  async call(method, value, lease) {
    if (lease !== this.config.active)
      throw Error("资料空间已切换，请重新打开窗口");
    const space = this.space();
    if (!space)
      return method === "cleanup"
        ? this.local.cleanup()
        : this.local.call(method, value);
    const { client, cache } = space;
    if (method === "packets") return this.packets();
    if (method === "savePackets") {
      // Persist originals before queuing their references. An interrupted save can only leave an unreferenced cache file.
      const prepared = [];
      for (const p of value) {
        const {
          remote,
          remoteDirty,
          deletedAt,
          attachments,
          syncVersion,
          syncAutoOrganize,
          ...data
        } = p;
        data.attachments = [];
        const prior = client.records().find((r) => r.id === p.id);
        if (prior && prior.version !== (syncVersion ?? 0))
          throw Error("云端已有新修改，请刷新后再编辑；这次输入尚未保存");
        if (!prior || syncAutoOrganize === true)
          data.desktopOwner = this.config.devices[this.config.active]?.deviceId;
        if (prior?.conflict) throw Error("请先在云同步中处理这次投递的冲突");
        for (const a of attachments) {
          let descriptor;
          if (a.bytes) {
            const bytes = Buffer.from(a.bytes);
            if (!bytes.length || bytes.length > 10 * 1024 * 1024)
              throw Error("同步原件应在 1 字节至 10 MiB 之间");
            descriptor = {
              id: a.id,
              name: a.name,
              type: a.type || "application/octet-stream",
              size: bytes.length,
              hash: hash(bytes),
            };
            try {
              atomic(cache.file("files/" + descriptor.hash), bytes);
            } catch {
              cache.keepVolatile(descriptor.hash, bytes);
              descriptor.localSaved = false;
            }
          } else {
            if (!/^[a-f0-9]{64}$/.test(a.hash))
              throw Error("原件缺失：" + a.name);
            if (
              !fs.existsSync(cache.file("files/" + a.hash)) &&
              !prior?.data?.attachments?.some(
                (old) => old.id === a.id && old.hash === a.hash,
              )
            )
              throw Error("原件缺失：" + a.name);
            descriptor = {
              id: a.id,
              name: a.name,
              type: a.type,
              size: a.size,
              hash: a.hash,
            };
          }
          for (const key of ["deletedAt", "restoredAt"])
            if (a[key]) descriptor[key] = a[key];
          data.attachments.push(descriptor);
        }
        if (data.attachments.length > 20)
          throw Error("每次投递最多同步 20 个原件");
        prepared.push({ id: p.id, data: clone(data), deletedAt, prior });
      }
      // Each accepted packet has its own durable operation chain; an error never clears the draft.
      for (const { id, data, deletedAt, prior } of prepared) {
        if (prior?.deletedAt && !deletedAt) client.restore(id);
        if (!deletedAt) {
          client.put(id, data);
        } else if (!prior?.deletedAt) {
          if (!prior) client.put(id, data);
          client.remove(id);
        }
      }
      const rows = await this.packets();
      return value.map((p) => rows.find((r) => r.id === p.id));
    }
    if (method === "removePacket") {
      client.purge(value);
      return;
    }
    if (method === "cleanup")
      throw Error("云端空间不会按本机保留期自动清理；请在最近删除中处理");
    if (["draft", "saveDraft", "usage", "saveUsage"].includes(method))
      return cache.call(method, value);
    throw Error("不支持的数据操作");
  }
  action(action, value) {
    return this.serial(async () => {
      if (action === "status") return this.status();
      if (action === "connect") return this.connect(value);
      if (action === "local") {
        await this.configure({ ...this.config, active: "" });
        return this.status();
      }
      if (action === "sync") return this.sync();
      if (action === "resolve") {
        const { client } = this.space();
        if (value.keep) client.keepLocalCopy(value.id);
        else client.acceptRemote(value.id);
        return this.status();
      }
      throw Error("不支持的同步操作");
    });
  }
}
module.exports = { CloudWorkspace, serviceURL };
