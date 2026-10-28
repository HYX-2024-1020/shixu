const fs = require("node:fs");
const path = require("node:path");
const {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} = require("node:crypto");
const { CloudWorkspace, serviceURL } = require("./cloud.cjs");
const { hydrateReadingChanges } = require("./generated/reading-transport.cjs");
const SERVICE_ORIGIN = "https://sync.shixunote.top";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file + ".next", "w", 0o600);
  try {
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(file + ".next", file);
}
class AccountWorkspace extends CloudWorkspace {
  constructor(options) {
    super(options);
    this.protocolVersion = 3;
    // Injectable only in the main-process test harness; the renderer cannot set a URL.
    this.origin = serviceURL(options.serviceOrigin || SERVICE_ORIGIN);
    this.config = { active: "", devices: {}, keys: {} };
    this.accountState = null;
  }
  async init() {
    const file = path.join(this.root, "account.enc");
    if (fs.existsSync(file))
      this.config = JSON.parse(await this.unseal(fs.readFileSync(file)));
  }
  async configure(next) {
    atomic(
      path.join(this.root, "account.enc"),
      await this.seal(JSON.stringify(next)),
    );
    this.config = next;
    this.lastError = "";
  }
  async request(base, method, api, data, extra = {}) {
    api = api.replace(/^\/api\/v2\//, "/api/v3/");
    if (
      this.accountState?.reading &&
      method === "GET" &&
      api.startsWith("/api/v3/changes?")
    )
      return hydrateReadingChanges(
        (method, path) => this.request(base, method, path),
        api,
      );
    const device = this.config.devices[base];
    const key = extra.activationKey || device?.privateKey;
    const bytes = extra.body
      ? Buffer.from(extra.body)
      : data
        ? Buffer.from(JSON.stringify(data))
        : Buffer.alloc(0);
    const headers = {
      ...(bytes.length ? { "Content-Type": "application/json" } : {}),
      ...extra.headers,
      ...(device?.token ? { Authorization: `Bearer ${device.token}` } : {}),
    };
    if (key) {
      const timestamp = String(Date.now()),
        nonce = randomBytes(24).toString("base64url");
      const message = [
        "shixu-v3",
        method,
        api,
        hash(bytes),
        timestamp,
        nonce,
      ].join("\n");
      Object.assign(headers, {
        "X-Shixu-Time": timestamp,
        "X-Shixu-Nonce": nonce,
        "X-Shixu-Signature": sign(null, Buffer.from(message), key).toString(
          "base64url",
        ),
      });
    }
    const response = await this.fetcher(this.origin + api, {
      method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      ...(bytes.length ? { body: bytes } : {}),
    });
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      if (device && response.status === 401) {
        this.authorization = "invalid";
        this.accountState = null;
      }
      throw Object.assign(
        Error(value.error || "服务暂时不可用，本地资料保留"),
        value,
        { status: response.status },
      );
    }
    if (device) this.authorization = "active";
    const result = extra.binary
      ? Buffer.from(await response.arrayBuffer())
      : await response.json();
    if (api === "/api/v3/account") this.accountState = result;
    return result;
  }
  async activate({ invite }) {
    if (typeof invite !== "string" || !invite.trim() || invite.length > 100)
      throw Error("请填写邀请码");
    if (this.config.active && this.space().client.pendingCount())
      throw Error("请先同步当前账号的待传操作，再切换账号");
    const fingerprint = hash(invite.trim());
    if (!this.config.keys[fingerprint]) {
      const pair = generateKeyPairSync("ed25519");
      await this.configure({
        ...this.config,
        keys: {
          ...this.config.keys,
          [fingerprint]: {
            privateKey: pair.privateKey
              .export({ type: "pkcs8", format: "pem" })
              .toString(),
            publicKey: pair.publicKey
              .export({ type: "spki", format: "pem" })
              .toString(),
          },
        },
      });
    }
    const pair = this.config.keys[fingerprint];
    const enrolled = await this.request(
      "",
      "POST",
      "/api/v3/activate/windows",
      { invite: invite.trim(), publicKey: pair.publicKey },
      { activationKey: pair.privateKey },
    );
    if (
      !/^[a-f0-9-]{36}$/.test(enrolled.userId) ||
      enrolled.protocolVersion !== 3 ||
      typeof enrolled.token !== "string"
    )
      throw Error("激活响应无效");
    const base = "account:" + enrolled.userId;
    const epochFile = this.space(base).cache.file("queue.json");
    if (
      fs.existsSync(epochFile) &&
      JSON.parse(fs.readFileSync(epochFile)).epoch &&
      JSON.parse(fs.readFileSync(epochFile)).epoch !== enrolled.epoch
    )
      throw Error("账号资料版本已变化，本地队列保留，请联系管理员核对");
    await this.configure({
      ...this.config,
      active: base,
      devices: {
        ...this.config.devices,
        [base]: { ...enrolled, privateKey: pair.privateKey },
      },
    });
    this.accountState = null;
    this.authorization = undefined;
    await this.sync().catch(() => {}); // Activation is durable even if its first sync fails.
    return this.status();
  }
  readJobs() {
    if (!this.config.active) return [];
    const file = this.space().cache.file("jobs.json");
    if (!fs.existsSync(file)) return [];
    const jobs = JSON.parse(fs.readFileSync(file));
    if (!Array.isArray(jobs)) throw Error("任务记录损坏，请保留资料联系管理员");
    return jobs;
  }
  writeJobs(jobs) {
    atomic(this.space().cache.file("jobs.json"), JSON.stringify(jobs));
  }
  async pollJobs() {
    if (this.accountState?.reading) {
      const remote = await this.request(
        this.config.active,
        "GET",
        "/api/v4/tasks",
      );
      const jobs = this.readJobs();
      for (const task of remote.tasks) {
        const old = jobs.find((j) => j.id === task.id);
        if (old) Object.assign(old, task);
        else
          jobs.push({
            ...task,
            request: { packetId: task.packetId, kind: "organize" },
          });
      }
      this.writeJobs(jobs);
    }
    for (const job of this.readJobs()) {
      if (job.pendingAction) {
        const { action, ...request } = job.pendingAction;
        let task;
        try {
          task = await this.request(
            this.config.active,
            "POST",
            `/api/v4/tasks/${job.id}/${action}`,
            request,
          );
        } catch (error) {
          if ([401, 403, 404, 409, 422, 426, 429, 503].includes(error.status))
            this.writeJobs(
              this.readJobs().map((j) =>
                j.id === job.id
                  ? { ...j, pendingAction: null, error: error.message }
                  : j,
              ),
            );
          throw error;
        }
        this.writeJobs(
          this.readJobs().map((j) =>
            j.id === job.id ? { ...j, ...task, pendingAction: null } : j,
          ),
        );
        continue;
      }
      if (
        [
          "done",
          "partial",
          "purged",
          "cancelled",
          "paused",
          "error",
          "conflict",
          "interrupted",
        ].includes(job.state)
      )
        continue;
      let result;
      try {
        result = await this.request(
          this.config.active,
          job.state === "submitting" ? "POST" : "GET",
          job.state === "submitting"
            ? job.protocol === 4
              ? "/api/v4/tasks"
              : "/api/v3/jobs"
            : (job.protocol === 4 ? "/api/v4/tasks/" : "/api/v3/jobs/") +
                job.id,
          job.state === "submitting" ? job.request : null,
        );
      } catch (error) {
        if (![400, 403, 404, 409, 413, 422, 429, 503].includes(error.status))
          throw error;
        result = { state: "error", error: error.message };
      }
      const jobs = this.readJobs();
      const index = jobs.findIndex((j) => j.id === job.id);
      jobs[index] = { ...jobs[index], ...result };
      this.writeJobs(jobs);
    }
  }
  async sync() {
    if (!this.config.active) return this.status();
    try {
      const status = await super.sync();
      this.accountState = await this.request(
        this.config.active,
        "GET",
        "/api/v3/account",
      );
      await this.pollJobs();
      return { ...status, ...this.status() };
    } catch (error) {
      this.lastError = error.message;
      throw error;
    }
  }
  status() {
    return {
      ...super.status(),
      activation: this.config.active
        ? this.authorization || "saved"
        : "inactive",
      account: this.accountState,
      jobs: this.readJobs().map(({ request, ...job }) => job),
    };
  }
  async createAI(value) {
    if (!this.config.active) throw Error("请先激活；本地记录仍可使用");
    await this.sync();
    const { client } = this.space();
    const row = client.records().find((r) => r.id === value.packetId);
    if (!row || row.deletedAt || row.purged || row.pending || row.conflict)
      throw Error("请先完成这次投递的同步");
    const jobs = this.readJobs();
    const v4 = !!this.accountState?.reading;
    if (v4 && value.kind !== "organize")
      throw Error("事项对话尚未接入累计账本，暂不可用");
    let saved = jobs.find(
      (j) =>
        j.request.packetId === value.packetId &&
        ![
          "done",
          "partial",
          "purged",
          "cancelled",
          "error",
          "conflict",
          "interrupted",
        ].includes(j.state),
    );
    if (
      saved &&
      (saved.request.kind !== value.kind ||
        saved.request.instruction !== value.instruction ||
        saved.request.itemId !== value.itemId)
    )
      throw Error("这次投递已有其他 AI 任务，请等待完成");
    if (!saved) {
      const request = {
        id: randomUUID(),
        packetId: value.packetId,
        kind: value.kind,
        epoch: row ? this.config.devices[this.config.active].epoch : null,
        baseVersion: row.version,
        ...(v4 ? { contractVersion: 1 } : {}),
        ...(value.kind === "chat"
          ? { itemId: value.itemId, instruction: value.instruction }
          : {}),
      };
      saved = {
        id: request.id,
        state: "submitting",
        request,
        ...(v4 ? { protocol: 4 } : {}),
      };
      jobs.push(saved);
      this.writeJobs(jobs);
    }
    await this.pollJobs();
    const submitted = this.readJobs().find((j) => j.id === saved.id);
    if (submitted?.state === "error") throw Error(submitted.error);
    return { ...this.status(), job: submitted?.id };
  }
  async call(method, value, lease) {
    if (this.config.active && method === "savePackets")
      value = value.map((p) => ({
        ...p,
        sources: p.sources?.length
          ? p.sources
          : p.text?.trim()
            ? [{ id: "input", name: "随手输入", text: p.text.trim() }]
            : [],
      }));
    return super.call(method, value, lease);
  }
  async packets() {
    const rows = await super.packets(),
      jobs = this.readJobs();
    return rows.map((packet) => {
      const job = jobs
        .filter(
          (j) =>
            j.request.kind === "organize" && j.request.packetId === packet.id,
        )
        .at(-1);
      if (!job || packet.result || packet.deletedAt) return packet;
      return {
        ...packet,
        status: [
          "error",
          "conflict",
          "interrupted",
          "paused",
          "cancelled",
          "purged",
        ].includes(job.state)
          ? "error"
          : job.state === "done"
            ? packet.status
            : "processing",
        error: job.error || "",
      };
    });
  }
  action(action, value) {
    if (action === "taskAction")
      return this.serial(async () => {
        const jobs = this.readJobs(),
          task = jobs.find((j) => j.id === value.id);
        if (
          !task ||
          task.protocol !== 4 ||
          !task.actions?.includes(value.action)
        )
          throw Error("任务状态已变化，请刷新");
        if (!task.pendingAction)
          task.pendingAction = {
            action: value.action,
            contractVersion: 1,
            operationId: randomUUID(),
            expectedGeneration: task.generation,
            expectedRevision: task.inputRevision,
          };
        this.writeJobs(jobs); // Persist intent before network; lost responses reuse the same operation.
        await this.pollJobs();
        return this.sync();
      });
    if (action === "connect" || action === "activate")
      return this.serial(() => this.activate(value));
    if (action === "ai") return this.serial(() => this.createAI(value));
    if (action === "local")
      return this.serial(async () => {
        await this.configure({
          ...this.config,
          lastAccount: this.config.active,
          active: "",
        });
        this.accountState = null;
        return this.status();
      });
    if (action === "resume")
      return this.serial(async () => {
        const base = this.config.lastAccount;
        if (!base || !this.config.devices[base])
          throw Error("此设备尚无可恢复的账号");
        await this.configure({ ...this.config, active: base });
        this.accountState = null;
        this.authorization = undefined;
        await this.sync().catch(() => {});
        return this.status();
      });
    return super.action(action, value);
  }
}
module.exports = { AccountWorkspace, SERVICE_ORIGIN };
