const fs = require("node:fs");
const path = require("node:path");
const {
  createHash,
  createPublicKey,
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
    this.minimumReadIntervalMs = options.minimumReadIntervalMs || 0;
    if (
      !Number.isSafeInteger(this.minimumReadIntervalMs) ||
      this.minimumReadIntervalMs < 0 ||
      this.minimumReadIntervalMs > 30000
    )
      throw Error("INVALID_POLL_INTERVAL");
    this.protocolVersion = 3;
    // Injectable only in the main-process test harness; the renderer cannot set a URL.
    this.origin = serviceURL(options.serviceOrigin || SERVICE_ORIGIN);
    this.config = { active: "", devices: {}, keys: {} };
    this.accountState = null;
    this.confirmTemporaryLoss =
      options.confirmTemporaryLoss || (async () => false);
    this.saveOriginal = options.saveOriginal;
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
    if (
      `${this.config.active}#${this.config.devices[this.config.active]?.userId || ""}` !==
      `${next.active}#${next.devices[next.active]?.userId || ""}`
    ) {
      this.identityGeneration = (this.identityGeneration || 0) + 1;
      this.taskPreview = null;
      this.accountState = null;
      this.originalStorage = undefined;
      this.originalDownload = null;
      this.originalNotice = "";
      this.deviceList = [];
      this.loginDevices = [];
      this.authorization = undefined;
      this.readSyncBase = undefined;
      this.nextReadAt = 0;
      this.retryBase = undefined;
      this.retryUntil = 0;
    }
    this.config = next;
    this.lastError = "";
  }
  async request(base, method, api, data, extra = {}) {
    const identityGeneration = this.identityGeneration || 0;
    if (
      base === this.retryBase &&
      this.retryUntil > Date.now() &&
      !extra.activationKey
    )
      throw Object.assign(Error("请求较多，稍后自动重试；资料和任务进度保留"), {
        status: 429,
        retryable: true,
      });
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
    if (identityGeneration !== (this.identityGeneration || 0))
      throw Object.assign(Error("账号已切换，已忽略上一账号的响应"), {
        code: "ACCOUNT_CHANGED",
      });
    if (!response.ok) {
      if (response.status === 429) {
        const seconds = Number(response.headers?.get?.("retry-after"));
        this.retryBase = base;
        this.retryUntil =
          Date.now() +
          (Number.isFinite(seconds) && seconds > 0
            ? Math.min(300, seconds)
            : 60) *
            1000;
      }
      const value = await response.json().catch(() => ({}));
      if (device && response.status === 401) {
        this.authorization = "invalid";
        this.accountState = null;
        this.originalStorage = undefined;
        this.originalDownload = null;
        this.originalNotice = "";
        this.deviceList = [];
        this.taskPreview = null;
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
    if (identityGeneration !== (this.identityGeneration || 0))
      throw Object.assign(Error("账号已切换，已忽略上一账号的响应"), {
        code: "ACCOUNT_CHANGED",
      });
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
        if (this.taskPreview?.taskId === task.id)
          this.taskPreview =
            task.state === "purged"
              ? null
              : {
                  ...this.taskPreview,
                  published: ["done", "partial"].includes(task.state),
                };
        const old = jobs.find((j) => j.id === task.id);
        if (old) Object.assign(old, task);
        else
          jobs.push({
            ...task,
            request: {
              packetId: task.packetId,
              kind: task.kind || "organize",
              ...(task.itemId ? { itemId: task.itemId } : {}),
            },
          });
      }
      this.writeJobs(jobs);
    }
    for (const job of this.readJobs()) {
      if (job.pendingAction) {
        const { action, ...request } = job.pendingAction;
        if (["continue", "remaining"].includes(action))
          this.requireMaterialConsent();
        let task;
        try {
          if (["continue", "accept-partial", "remaining"].includes(action))
            await this.reuploadTemporary(job.packetId || job.request.packetId);
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
        if (action === "remaining") {
          const latest = this.readJobs().map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  pendingAction: null,
                  actions: j.actions?.filter((a) => a !== "remaining"),
                }
              : j,
          );
          if (!latest.some((j) => j.id === task.id))
            latest.push({
              ...task,
              request: { packetId: task.packetId, kind: "organize" },
            });
          this.writeJobs(latest);
          continue;
        }
        if (action === "purge" && this.taskPreview?.taskId === job.id)
          this.taskPreview = null;
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
      if (job.state === "submitting" && job.protocol === 4)
        this.requireMaterialConsent();
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
        // A temporary read/rate failure is not a terminal server task result.
        // Preserve ID, paid progress and action state; the next bounded poll
        // obtains the authoritative result without creating a replacement job.
        if (
          error.status === 429 ||
          (job.state !== "submitting" && error.status === 503)
        )
          throw error;
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
  async sync({ force = false } = {}) {
    if (!this.config.active) return this.status();
    if (this.retryBase === this.config.active && this.retryUntil > Date.now()) {
      this.lastError = `请求较多，${Math.ceil((this.retryUntil - Date.now()) / 1000)}秒后自动重试；资料和任务进度保留`;
      return this.status();
    }
    if (
      !force &&
      this.readSyncBase === this.config.active &&
      this.nextReadAt > Date.now() &&
      !this.space().client.pendingCount() &&
      !this.readJobs().some((j) => j.pendingAction || j.state === "submitting")
    )
      return this.status();
    try {
      // A new/temporary login must pass its password gate before material sync.
      // For an established space, refresh the wallet after polling: the last
      // call may settle while that poll publishes the completed task.
      if (
        !this.accountState ||
        this.accountState.authentication?.passwordChangeRequired
      )
        this.accountState = await this.request(
          this.config.active,
          "GET",
          "/api/v3/account",
        );
      if (this.accountState.authentication?.passwordChangeRequired) {
        this.lastError =
          "请在账号设置中先修改管理员签发的临时密码，再同步和使用 AI";
        this.authorization = "active";
        return this.status();
      }
      const status = await super.sync();
      if (this.accountState.authentication?.version === 4)
        this.deviceList = (
          await this.request(this.config.active, "GET", "/api/v4/devices")
        ).devices;
      if (this.accountState.reading?.features?.submissionManifest)
        this.originalStorage = await this.request(
          this.config.active,
          "GET",
          "/api/v4/storage",
        );
      await this.pollJobs();
      this.accountState = await this.request(
        this.config.active,
        "GET",
        "/api/v3/account",
      );
      this.readSyncBase = this.config.active;
      this.nextReadAt = Date.now() + this.minimumReadIntervalMs;
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
      materialUseNotice: this.accountState?.reading?.materialUseNotice || null,
      materialConsentAccepted: this.materialConsentAccepted(),
      materialPurposeAccepted: this.materialAcknowledgement("purpose"),
      materialRetentionAccepted: this.materialAcknowledgement("retention"),
      taskPreview: this.taskPreview || null,
      jobs: this.readJobs().map(({ request, ...job }) => job),
      capabilities: this.publicCapabilities,
      devices: this.deviceList || [],
      loginDevices: this.loginDevices || [],
      originalStorage: this.originalStorage,
      originalNotice: this.originalNotice || "",
      originalDownload: this.originalDownload || null,
      localSaveNotice: this.space()?.cache.localSaveError || "",
    };
  }
  async createAI(value) {
    if (!this.config.active) throw Error("请先激活；本地记录仍可使用");
    await this.sync();
    this.requireMaterialConsent();
    const { client } = this.space();
    const row = client.records().find((r) => r.id === value.packetId);
    if (!row || row.deletedAt || row.purged || row.pending || row.conflict)
      throw Error("请先完成这次投递的同步");
    const jobs = this.readJobs();
    const v4 = !!this.accountState?.reading;
    if (
      v4 &&
      value.kind === "chat" &&
      !this.accountState?.reading?.features?.itemChat
    )
      throw Error("事项对话尚未接入累计账本，暂不可用");
    if (
      v4 &&
      value.kind === "chat" &&
      value.readAttachments &&
      !this.accountState.reading.features.attachmentChat
    )
      throw Error("当前服务尚未支持附件对话，请更新服务后再核对原件");
    if (
      v4 &&
      value.kind === "chat" &&
      value.scope === "account" &&
      !this.accountState.reading.features.accountChatProposals
    )
      throw Error("当前服务尚未支持跨卡片查询与修改建议");
    if (v4) await this.reuploadTemporary(value.packetId);
    let saved = jobs.findLast(
      (j) =>
        j.request.packetId === value.packetId &&
        !j.disposition &&
        !(row.data?.defaultCardDisposition && j.request.kind === "organize") &&
        ![
          "done",
          "partial",
          "purged",
          ...(j.actions?.includes("continue")
            ? []
            : ["cancelled", "error", "conflict", "interrupted"]),
        ].includes(j.state),
    );
    if (
      saved &&
      (saved.request.kind !== value.kind ||
        saved.request.instruction !== value.instruction ||
        saved.request.scope !== value.scope ||
        saved.request.groupId !== value.groupId ||
        JSON.stringify(saved.request.targets) !==
          JSON.stringify(value.targets) ||
        saved.request.readAttachments !== value.readAttachments ||
        saved.request.itemId !== value.itemId)
    )
      throw Error("这次投递已有其他 AI 任务，请等待完成");
    if (saved?.protocol === 4 && saved.actions?.includes("continue")) {
      // A fresh user retry explicitly resumes the authoritative task. Merely
      // returning a paused ID leaves it paused forever and loses the UI intent.
      saved.pendingAction ||= {
        action: "continue",
        contractVersion: 1,
        operationId: randomUUID(),
        expectedGeneration: saved.generation,
        expectedRevision: saved.inputRevision,
        expectedMaintenanceOperation: saved.maintenanceOperation || null,
      };
      this.writeJobs(jobs);
    }
    if (!saved) {
      const request = {
        id: randomUUID(),
        packetId: value.packetId,
        kind: value.kind,
        epoch: row ? this.config.devices[this.config.active].epoch : null,
        baseVersion: row.version,
        ...(v4
          ? {
              contractVersion: 1,
              expectedCostOperation:
                this.accountState?.wallet?.costAuditOperation || null,
            }
          : {}),
        ...(value.kind === "chat"
          ? {
              itemId: value.itemId,
              instruction: value.instruction,
              scope: value.scope,
              groupId: value.groupId,
              targets: value.targets,
              readAttachments: value.readAttachments,
            }
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
  async submitOriginals(base, cache, operation, epoch) {
    if (!this.accountState?.reading?.features?.submissionManifest) return null;
    const manifest = operation.data.attachments.map(
      ({ id, name, type, size, hash }) => ({ id, name, type, size, hash }),
    );
    if (operation.baseVersion > 0) {
      const existing = await this.request(
        base,
        "GET",
        `/api/v4/storage?packetId=${encodeURIComponent(operation.id)}`,
      );
      // Editing a published item must not re-upload or revive a deleted original.
      if (
        manifest.every((f) =>
          existing.originals.some((old) =>
            ["id", "name", "type", "size", "hash"].every(
              (k) => old[k] === f[k],
            ),
          ),
        )
      )
        return this.request(base, "POST", "/api/v3/operations", {
          operation,
          epoch,
        });
    }
    let op = operation;
    if (op.baseVersion === 0) {
      const scaffold = await this.request(base, "POST", "/api/v3/operations", {
        epoch,
        operation: {
          ...op,
          opId: op.opId + "_originals",
          data: { ...op.data, attachments: [] },
        },
      });
      op = { ...op, baseVersion: scaffold.acceptedVersion };
    }
    const submission = await this.request(base, "POST", "/api/v4/submissions", {
      submissionId: op.opId,
      packetId: op.id,
      manifest,
      epoch,
      storageIntent: "retained",
    });
    this.originalNotice = submission.warning;
    if (
      submission.mode === "temporary" &&
      manifest.some((f) => cache.volatileOriginals.has(f.hash)) &&
      !(await this.confirmTemporaryLoss())
    )
      throw Error(
        "本机未保存且云端空间不足；已暂停上传，请另存副本或明确选择临时整理",
      );
    for (const f of manifest) {
      const file = cache.file("files/" + f.hash);
      const bytes =
        cache.volatileOriginals.get(f.hash) ||
        (fs.existsSync(file) ? fs.readFileSync(file) : null);
      if (!bytes) continue;
      await this.request(
        base,
        "PUT",
        `/api/v4/submissions/${submission.submissionId}/files/${f.id}`,
        null,
        {
          headers: { "Content-Type": "application/octet-stream" },
          body: bytes,
        },
      );
    }
    const result = await this.request(
      base,
      "POST",
      `/api/v4/submissions/${submission.submissionId}/commit`,
      { manifestHash: submission.manifestHash, operation: op, epoch },
    );
    return result;
  }
  async reuploadTemporary(packetId) {
    if (!this.accountState?.reading?.features?.submissionManifest) return;
    const storage = await this.request(
      this.config.active,
      "GET",
      `/api/v4/storage?packetId=${encodeURIComponent(packetId)}`,
    );
    for (const f of storage.originals.filter(
      (f) =>
        f.packetId === packetId &&
        !f.available &&
        !f.readingAvailable &&
        (f.mode === "temporary" || ["deleted", "cleaned"].includes(f.state)),
    )) {
      const file = this.space().cache.file("files/" + f.hash);
      const bytes =
        this.space().cache.volatileOriginals.get(f.hash) ||
        (fs.existsSync(file) ? fs.readFileSync(file) : null);
      if (!bytes)
        throw Error("原件已清理，请在有本地副本的设备继续，或重新选择同一原件");
      await this.request(
        this.config.active,
        "PUT",
        ["deleted", "cleaned"].includes(f.state)
          ? `/api/v4/originals/${packetId}/${f.id}/verify`
          : `/api/v4/submissions/${f.submissionId}/files/${f.id}`,
        null,
        {
          headers: { "Content-Type": "application/octet-stream" },
          body: bytes,
        },
      );
      if (["deleted", "cleaned"].includes(f.state))
        this.originalNotice =
          "云端原件保持已清除；本次仅临时核验，停止或结束后清理";
    }
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
      if (packet.result || packet.deletedAt) return packet;
      if (!job) {
        if (
          this.accountState?.reading &&
          !this.space()
            .client.records()
            .find((r) => r.id === packet.id)?.pending &&
          packet.status === "pending" &&
          Date.now() - Date.parse(packet.capturedAt) > 30000
        )
          return {
            ...packet,
            status: "error",
            error: "这次材料尚未启动整理，可手动保留、删除或主动重试。",
          };
        return packet;
      }
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
  materialConsentKey() {
    return `${this.config.active}#${this.config.devices[this.config.active]?.userId || ""}`;
  }
  materialAcknowledgement(kind) {
    const notice = this.accountState?.reading?.materialUseNotice;
    if (!notice) return true;
    const record =
      this.config.materialAcknowledgements?.[this.materialConsentKey()];
    if (record)
      return (
        record[kind]?.version === notice.version &&
        record[kind]?.accepted === true
      );
    // Existing explicit agreement remains valid; never infer new-user consent.
    return (
      this.config.materialConsents?.[this.materialConsentKey()] ===
      notice.version
    );
  }
  materialConsentAccepted() {
    return (
      this.materialAcknowledgement("purpose") &&
      this.materialAcknowledgement("retention")
    );
  }
  requireMaterialConsent() {
    if (!this.materialConsentAccepted())
      throw Error("请先在账号设置确认资料用途和保存期限；尚未发起AI调用");
  }
  action(action, value) {
    if (action === "cardOperation")
      return this.serial(async () => {
        if (!this.config.active || !["merge", "undo"].includes(value?.kind))
          throw Error("请先连接账号并核对卡片");
        await this.sync({ force: true });
        if (!this.accountState?.reading?.features?.manualCardMerge)
          throw Error(
            "当前服务尚未接入多卡合并，请更新服务后重试；资料保持原样",
          );
        if (
          this.space().client.pendingCount() ||
          this.space().client.conflicts().length
        )
          throw Error("请先处理同步冲突，再合并卡片");
        const file = this.space().cache.file("card-actions.json");
        const saved = fs.existsSync(file)
          ? JSON.parse(fs.readFileSync(file, "utf8"))
          : {};
        const key = hash(JSON.stringify(value));
        saved[key] ||= {
          contractVersion: 1,
          epoch: this.config.devices[this.config.active].epoch,
          operationId: randomUUID(),
          receiptPacketId: value.targets?.[0]?.packetId,
          ...value,
        };
        atomic(file, JSON.stringify(saved));
        await this.request(
          this.config.active,
          "POST",
          "/api/v4/cards/" + value.kind,
          saved[key],
        );
        delete saved[key];
        atomic(file, JSON.stringify(saved));
        return this.sync({ force: true });
      });
    if (action === "sync" && value?.force)
      return this.serial(() => this.sync({ force: true }));
    if (action === "taskPreview")
      return this.serial(async () => {
        this.taskPreview = await this.request(
          this.config.active,
          "GET",
          `/api/v4/tasks/${encodeURIComponent(value.id)}/preview?offset=${value.offset || 0}`,
        );
        return this.status();
      });
    if (action === "materialConsent")
      return this.serial(async () => {
        const notice = this.accountState?.reading?.materialUseNotice;
        if (
          !this.config.active ||
          !notice ||
          typeof value?.accepted !== "boolean"
        )
          throw Error("请先连接账号并刷新资料说明");
        const key = this.materialConsentKey();
        const old =
          this.config.materialAcknowledgements?.[key] ||
          Object.fromEntries(
            ["purpose", "retention"].map((kind) => [
              kind,
              {
                version: notice.version,
                accepted: this.materialAcknowledgement(kind),
              },
            ]),
          );
        if (
          value.kind !== undefined &&
          !["purpose", "retention"].includes(value.kind)
        )
          throw Error("无效的用途确认");
        const updates = Object.fromEntries(
          (value.kind ? [value.kind] : ["purpose", "retention"]).map((kind) => [
            kind,
            {
              version: notice.version,
              accepted: value.accepted,
              at: new Date().toISOString(),
            },
          ]),
        );
        await this.configure({
          ...this.config,
          materialAcknowledgements: {
            ...this.config.materialAcknowledgements,
            [key]: { ...old, ...updates },
          },
          materialConsents: { ...this.config.materialConsents, [key]: 0 },
        });
        return this.status();
      });
    if (action === "purgeAttachment")
      return this.action("stopPacket", { packetId: value.packetId }).then(() =>
        this.serial(async () => {
          const { client, cache } = this.space();
          const row = client.records().find((r) => r.id === value.packetId);
          if (!row || row.pending || row.conflict || row.deletedAt)
            throw Error("请先同步并核对所属投递");
          const file = cache.file("attachment-purge-intents.json");
          const intents = fs.existsSync(file)
            ? JSON.parse(fs.readFileSync(file, "utf8"))
            : {};
          const key = value.packetId + "/" + value.id;
          if (!intents[key]) {
            const storage = await this.request(
              this.config.active,
              "GET",
              `/api/v4/storage?packetId=${encodeURIComponent(value.packetId)}&includeDeleted=true`,
            );
            const original = storage.originals.find((f) => f.id === value.id);
            if (!original) throw Error("未找到云端原件，附件引用尚未移除");
            intents[key] = {
              contractVersion: 1,
              operationId: randomUUID(),
              packetId: value.packetId,
              id: value.id,
              baseVersion: row.version,
              expectedVersion: original.version,
              epoch: this.config.devices[this.config.active].epoch,
            };
            atomic(file, JSON.stringify(intents));
          }
          await this.request(
            this.config.active,
            "POST",
            "/api/v4/originals/purge-reference",
            intents[key],
          );
          await client.sync();
          this.originalStorage = await this.request(
            this.config.active,
            "GET",
            "/api/v4/storage",
          );
          delete intents[key];
          atomic(file, JSON.stringify(intents));
          return this.status();
        }),
      );
    if (action === "moreOriginals")
      return this.serial(async () => {
        if (this.originalStorage?.hasMore) {
          const next = await this.request(
            this.config.active,
            "GET",
            `/api/v4/storage?cursor=${this.originalStorage.nextCursor}`,
          );
          this.originalStorage = {
            ...next,
            originals: [...this.originalStorage.originals, ...next.originals],
          };
        }
        return this.status();
      });
    if (["renewOriginal", "deleteOriginal"].includes(action))
      return this.serial(async () => {
        const kind = action === "renewOriginal" ? "renew" : "delete";
        const file = this.space().cache.file("original-actions.json");
        const saved = fs.existsSync(file)
          ? JSON.parse(fs.readFileSync(file, "utf8"))
          : {};
        const key = hash(JSON.stringify({ kind, value }));
        if (!saved[key]) {
          saved[key] = randomUUID();
          atomic(file, JSON.stringify(saved));
        }
        const result = await this.request(
          this.config.active,
          "POST",
          `/api/v4/originals/${kind}`,
          {
            operationId: saved[key],
            ids: [
              {
                packetId: value.packetId,
                id: value.id,
                expectedVersion: value.version,
              },
            ],
            stopTask: value.stopTask === true,
          },
        );
        delete saved[key];
        atomic(file, JSON.stringify(saved));
        this.originalStorage = await this.request(
          this.config.active,
          "GET",
          "/api/v4/storage",
        );
        if (result.results.some((r) => r.code !== "OK"))
          throw Error("原件版本已变化，请刷新后重试");
        return this.status();
      });
    if (action === "downloadOriginal")
      return this.serial(async () => {
        const bytes = await this.request(
          this.config.active,
          "GET",
          `/api/v3/attachments/${value.packetId}/${value.id}?epoch=${encodeURIComponent(this.config.devices[this.config.active].epoch)}`,
          null,
          { binary: true },
        );
        const f = this.originalStorage?.originals.find(
          (f) => f.packetId === value.packetId && f.id === value.id,
        );
        if (!f || hash(bytes) !== f.hash || bytes.length !== f.size)
          throw Error("下载校验不一致，未保存原件");
        atomic(this.space().cache.file("files/" + f.hash), bytes);
        if (this.saveOriginal) {
          const destination = await this.saveOriginal(f, bytes);
          this.originalDownload = destination
            ? { saved: true, path: destination }
            : { saved: false, path: "" };
        }
        this.originalNotice = "原件已校验并保存到本机，可从材料面板打开";
        return this.status();
      });
    if (action === "capabilities")
      return this.serial(async () => {
        try {
          this.publicCapabilities = await this.request(
            this.config.active,
            "GET",
            "/api/v4/capabilities",
          );
        } catch (error) {
          if (error.status !== 404) throw error;
          this.publicCapabilities = { features: { registration: false } };
        }
        return this.status();
      });
    if (["register", "login", "claim"].includes(action))
      return this.serial(() => this.credentials(action, value));
    if (action === "revokeDevice")
      return this.serial(async () => {
        await this.request(
          this.config.active,
          "POST",
          `/api/v4/devices/${value.id}/revoke`,
          { contractVersion: 1, operationId: randomUUID() },
        );
        if (value.id === this.config.devices[this.config.active]?.deviceId) {
          this.authorization = "invalid";
          return this.status();
        }
        return this.sync();
      });
    if (action === "password")
      return this.serial(async () => {
        const response = await this.request(
          this.config.active,
          "POST",
          "/api/v4/auth/password",
          { contractVersion: 1, operationId: randomUUID(), ...value },
        );
        if (response.revokedAll) {
          this.authorization = "invalid";
          return this.status();
        }
        return this.sync();
      });
    if (action === "stopPacket")
      return this.serial(async () => {
        const { client } = this.space();
        const packet = client.records().find((r) => r.id === value.packetId);
        if (
          !packet ||
          packet.deletedAt ||
          packet.purged ||
          packet.conflict ||
          packet.pending
        )
          throw Error("材料状态已变化或尚未同步，请刷新后再停止");
        const remote = await this.request(
          this.config.active,
          "GET",
          "/api/v4/tasks",
        );
        for (const task of remote.tasks.filter(
          (t) =>
            t.packetId === value.packetId &&
            !["done", "partial", "purged", "cancelled"].includes(t.state),
        )) {
          const jobs = this.readJobs();
          let local = jobs.find((j) => j.id === task.id);
          if (!local) {
            local = {
              ...task,
              request: {
                packetId: task.packetId,
                kind: task.kind || "organize",
              },
            };
            jobs.push(local);
          }
          const intent =
            local.pendingAction?.action === "stop"
              ? local.pendingAction
              : {
                  action: "stop",
                  contractVersion: 1,
                  operationId: randomUUID(),
                  expectedGeneration: task.generation,
                  expectedRevision: task.inputRevision,
                  expectedMaintenanceOperation:
                    task.maintenanceOperation || null,
                };
          local.pendingAction = intent;
          this.writeJobs(jobs);
          const { action: _, ...body } = intent;
          const stopped = await this.request(
            this.config.active,
            "POST",
            `/api/v4/tasks/${task.id}/stop`,
            body,
          );
          this.writeJobs(
            this.readJobs().map((j) =>
              j.id === task.id ? { ...j, ...stopped, pendingAction: null } : j,
            ),
          );
        }
        if (!packet.data.result) {
          client.put(packet.id, {
            status: "error",
            error: "本次整理已停止，原材料保留；可手动保留、删除或主动重试。",
          });
          await client.sync();
        }
        return this.status();
      });
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
        if (["continue", "remaining"].includes(value.action))
          this.requireMaterialConsent();
        if (!task.pendingAction)
          task.pendingAction = {
            action: value.action,
            contractVersion: 1,
            operationId: randomUUID(),
            expectedGeneration: task.generation,
            expectedRevision: task.inputRevision,
            expectedMaintenanceOperation: task.maintenanceOperation || null,
            ...(value.action === "remaining"
              ? {
                  expectedCostOperation:
                    this.accountState?.wallet?.costAuditOperation || null,
                }
              : {}),
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
  async credentials(action, value) {
    if (this.config.active && this.space().client.pendingCount())
      throw Error("请先同步待传操作，再登录或切换账号");
    const username = String(value.username || "")
      .trim()
      .replace(/[A-Z]/g, (c) => c.toLowerCase());
    const keyId =
      action === "claim"
        ? "claim:" + this.config.active
        : "credential:" + username;
    const operationKey = `${action}:${keyId}:${value.replaceBindingId || ""}`;
    const next = structuredClone(this.config);
    next.authOperations ||= {};
    next.authOperations[operationKey] ||= randomUUID();
    if (action !== "claim" && !next.keys[keyId]) {
      const pair = generateKeyPairSync("ed25519");
      next.keys[keyId] = {
        privateKey: pair.privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
        publicKey: pair.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      };
    }
    await this.configure(next); // Signing identity/operation only; never persist the password.
    this.loginDevices = [];
    const pair = next.keys[keyId];
    const request = {
      contractVersion: 1,
      operationId: next.authOperations[operationKey],
      username,
      password: value.password,
      ...(action === "register" ? { invite: value.invite } : {}),
      ...(action === "claim"
        ? {}
        : {
            platform: "windows",
            deviceName: value.deviceName || "拾序 Windows",
            publicKey: pair.publicKey,
          }),
      ...(value.replaceBindingId
        ? { replaceBindingId: value.replaceBindingId }
        : {}),
    };
    let enrolled;
    try {
      enrolled = await this.request(
        this.config.active,
        "POST",
        `/api/v4/auth/${action === "claim" ? "claim-legacy" : action}`,
        request,
        action === "claim" ? {} : { activationKey: pair.privateKey },
      );
    } catch (error) {
      if (error.code === "DEVICE_SLOTS_FULL")
        this.loginDevices = error.devices || [];
      if (
        [400, 401, 403, 404, 409, 422, 426, 429, 503].includes(error.status)
      ) {
        const config = structuredClone(this.config);
        delete config.authOperations[operationKey];
        await this.configure(config);
      }
      throw error;
    }
    if (action === "claim") {
      const device = this.config.devices[this.config.active],
        config = structuredClone(this.config);
      config.keys["credential:" + username] = {
        privateKey: device.privateKey,
        publicKey: createPublicKey(device.privateKey)
          .export({ type: "spki", format: "pem" })
          .toString(),
      };
      await this.configure(config);
      return this.sync();
    }
    if (
      enrolled.protocolVersion !== 3 ||
      !/^[a-f0-9-]{36}$/.test(enrolled.userId) ||
      typeof enrolled.token !== "string"
    )
      throw Error("账号登录响应无效");
    const base = "account:" + enrolled.userId;
    const queueFile = this.space(base).cache.file("queue.json");
    if (fs.existsSync(queueFile)) {
      const epoch = JSON.parse(fs.readFileSync(queueFile)).epoch;
      if (epoch && epoch !== enrolled.epoch)
        throw Error("账号资料版本已变化，本机队列保留，请核对后接入");
    }
    const config = structuredClone(this.config);
    config.active = base;
    config.devices[base] = { ...enrolled, privateKey: pair.privateKey };
    if (action === "login") delete config.authOperations[operationKey];
    await this.configure(config);
    this.accountState = null;
    this.authorization = "active";
    await this.sync().catch(() => {});
    return this.status();
  }
}
module.exports = { AccountWorkspace, SERVICE_ORIGIN };
