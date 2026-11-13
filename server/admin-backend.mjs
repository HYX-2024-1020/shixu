import { DatabaseSync } from "node:sqlite";
import { cpus, freemem, totalmem, hostname } from "node:os";
import { statfsSync, readFileSync, existsSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { CloudOperations } from "./cloud-operations.mjs";
import { serviceFailureSignals } from "./admin-risk.mjs";

const fail = (status, code) => {
  throw Object.assign(Error(code), { status, code });
};
const iso = (at) => new Date(at).toISOString();
const availableMemory = () =>
  process.platform === "linux"
    ? Number(
        readFileSync("/proc/meminfo", "utf8").match(
          /^MemAvailable:\s+(\d+) kB/m,
        )?.[1] || Math.floor(freemem() / 1024),
      ) * 1024
    : freemem();

// Separate operational state: never edits account credentials, safety records or billing.
export class AdminBackend {
  constructor({
    path,
    registry,
    ledger,
    routes,
    directory,
    now = Date.now,
    pricingHealth = () => null,
    credentials = null,
  }) {
    Object.assign(this, {
      registry,
      ledger,
      routes,
      directory,
      now,
      pricingHealth,
      credentials,
    });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS controls(scope TEXT PRIMARY KEY,paused INTEGER NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,scope TEXT NOT NULL,operation TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,reason TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
      CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,object TEXT NOT NULL,severity TEXT NOT NULL,message TEXT NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,recovered_at INTEGER,read_at INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS alerts_active ON alerts(kind,object) WHERE recovered_at IS NULL;`);
    this.db.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS operation_intents(operation TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,action TEXT NOT NULL,scope TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS intents_no_update BEFORE UPDATE ON operation_intents BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
      CREATE TRIGGER IF NOT EXISTS intents_no_delete BEFORE DELETE ON operation_intents BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;`);
    this.operations = new Map();
    this.failureObservations = new Map();
    this.cloudOperations = new CloudOperations(path, { now });
    this.cpu = this.cpuTimes();
    this.sample();
    this.timer = setInterval(() => {
      try {
        this.sample();
      } catch {
        /* last sample expires visibly */
      }
    }, 10_000);
    this.timer.unref();
  }
  cpuTimes() {
    return cpus().reduce(
      (v, c) => ({
        idle: v.idle + c.times.idle,
        total: v.total + Object.values(c.times).reduce((a, b) => a + b, 0),
      }),
      { idle: 0, total: 0 },
    );
  }
  async mutate(action, scope, operation, actor, input, apply) {
    if (
      typeof operation !== "string" ||
      !/^[\w-]{8,90}$/.test(operation) ||
      typeof actor !== "string" ||
      !actor ||
      typeof input.reason !== "string" ||
      input.reason.length > 200
    )
      fail(400, "INVALID_OPERATION");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([action, scope, actor, input]))
      .digest("hex");
    const intent = this.db
      .prepare("SELECT * FROM operation_intents WHERE operation=?")
      .get(operation);
    const audit = this.db
      .prepare("SELECT * FROM audit WHERE operation=?")
      .get(operation);
    if (
      (intent && intent.fingerprint !== fingerprint) ||
      (audit && audit.fingerprint !== fingerprint)
    )
      fail(409, "IDEMPOTENCY_CONFLICT");
    if (!intent)
      this.db
        .prepare("INSERT INTO operation_intents VALUES(?,?,?,?,?,?,?)")
        .run(
          operation,
          fingerprint,
          action,
          scope,
          actor,
          input.reason,
          this.now(),
        );
    if (this.operations.has(operation)) return this.operations.get(operation);
    const pending = (async () => {
      const result = await apply(); // Underlying coordinator must also be idempotent.
      this.db
        .prepare(
          "INSERT OR IGNORE INTO audit(at,actor,action,scope,operation,fingerprint,reason) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          this.now(),
          actor,
          action,
          scope,
          operation,
          fingerprint,
          input.reason,
        );
      return result;
    })().finally(() => this.operations.delete(operation));
    this.operations.set(operation, pending);
    return pending;
  }
  topup(id, amount, note, operation, actor) {
    this.user(id);
    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 1000000000 ||
      typeof note !== "string" ||
      note.length > 200
    )
      fail(400, "INVALID_GRANT");
    return this.mutate(
      "quota-add",
      id,
      operation,
      actor,
      { amount, reason: note },
      () => {
        const w = this.ledger.grantAdditional(id, amount, operation);
        return { grantedMicro: w.granted, availableMicro: w.available };
      },
    );
  }
  revokeDevice(id, device, operation, actor) {
    this.user(id);
    if (!this.credentials) fail(503, "CREDENTIALS_UNAVAILABLE");
    return this.mutate(
      "device-revoke",
      id,
      operation,
      actor,
      { device, reason: "" },
      () => {
        this.credentials.revoke(id, device, operation);
        return this.user(id);
      },
    );
  }
  resetPassword(id, operation, actor) {
    this.user(id);
    if (!this.credentials) fail(503, "CREDENTIALS_UNAVAILABLE");
    return this.mutate(
      "password-reset",
      id,
      operation,
      actor,
      { reason: "" },
      () => this.credentials.adminReset(id, operation, actor),
    );
  }
  setAccountEnabled(id, enabled, operation, actor, reason) {
    this.user(id);
    if (
      typeof enabled !== "boolean" ||
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.length > 200
    )
      fail(400, "INVALID_OPERATION");
    return this.mutate(
      enabled ? "account-enable" : "account-disable",
      id,
      operation,
      actor,
      { enabled, reason },
      () => {
        // Replays of a committed intent only read the current state; a later
        // independent control must not be silently undone by an old HTTP retry.
        if (!this.credentials) fail(503, "CREDENTIALS_UNAVAILABLE");
        this.credentials.adminSetEnabled(id, enabled, operation, actor);
        return this.user(id);
      },
    );
  }
  extendTaskLimit(ref, value, operation, actor) {
    const [account, task, ...rest] = ref.split("~");
    if (
      rest.length ||
      ![account, task].every(
        (v) => typeof v === "string" && /^[\w-]{1,90}$/.test(v),
      ) ||
      !Number.isSafeInteger(value.newLimitSeconds) ||
      value.newLimitSeconds < 1 ||
      value.newLimitSeconds > 86400 ||
      !Number.isSafeInteger(value.generation) ||
      !Number.isSafeInteger(value.watermark) ||
      typeof value.reason !== "string" ||
      !value.reason.trim() ||
      value.reason.length > 200
    )
      fail(400, "INVALID_MAINTENANCE_REQUEST");
    this.user(account);
    return this.mutate("task-limit-extend", ref, operation, actor, value, () =>
      this.routes.extendExecutionLimit(
        account,
        task,
        {
          operationId: operation,
          expectedGeneration: value.generation,
          expectedWatermark: value.watermark,
          newLimitMs: value.newLimitSeconds * 1000,
          evidenceHash: createHash("sha256")
            .update(JSON.stringify([actor, ref, value]))
            .digest("hex"),
        },
        actor,
      ),
    );
  }
  budget() {
    return this.ledger.budget();
  }
  storage(cutoff = this.now()) {
    const root = dirname(this.registry.db.location());
    const users = this.users(new URLSearchParams("pageSize=100")).items.map(
      (user) => {
        const path = join(root, "users", user.id, "workspace.sqlite");
        if (!existsSync(path))
          return {
            accountId: user.id,
            username: user.username,
            available: false,
            physicalBytes: 0,
            usedBytes: 0,
            reservedBytes: 0,
            freePageBytes: 0,
            originals: [],
          };
        if (lstatSync(path).isSymbolicLink())
          fail(503, "STORAGE_PATH_REJECTED");
        const db = new DatabaseSync(path, { readOnly: true });
        try {
          const has = db
            .prepare("SELECT 1 FROM sqlite_master WHERE name='original_files'")
            .get();
          const originals = has
            ? db
                .prepare(
                  "SELECT state,COUNT(*) count,COALESCE(SUM(size),0) bytes FROM original_files WHERE mode='retained' GROUP BY state",
                )
                .all()
            : [];
          const hasTasks = db
            .prepare("SELECT 1 FROM sqlite_master WHERE name='reading_tasks'")
            .get();
          const eligible = has
            ? db
                .prepare(
                  "SELECT packet,id,version,size,cleanup FROM original_files f WHERE mode='retained' AND state NOT IN ('deleted','cleaned') AND cleanup<=?" +
                    (hasTasks
                      ? " AND NOT EXISTS(SELECT 1 FROM reading_tasks t WHERE t.packet=f.packet AND t.state IN ('queued','running','applying'))"
                      : "") +
                    " ORDER BY packet,id",
                )
                .all(cutoff)
            : [];
          const page = db.prepare("PRAGMA page_size").get().page_size;
          return {
            accountId: user.id,
            username: user.username,
            available: true,
            physicalBytes:
              lstatSync(path).size +
              (existsSync(path + "-wal") ? lstatSync(path + "-wal").size : 0),
            freePageBytes:
              db.prepare("PRAGMA freelist_count").get().freelist_count * page,
            autoVacuum: db.prepare("PRAGMA auto_vacuum").get().auto_vacuum,
            usedBytes: originals
              .filter((r) => !["deleted", "cleaned"].includes(r.state))
              .reduce((n, r) => n + r.bytes, 0),
            reservedBytes: has
              ? db
                  .prepare(
                    "SELECT COALESCE(SUM(reserved),0) n FROM original_submissions WHERE state='uploading'",
                  )
                  .get().n
              : 0,
            originals,
            cleanupEligibleCount: eligible.length,
            cleanupEligibleBytes: eligible.reduce((n, f) => n + f.size, 0),
            cleanupStamp: createHash("sha256")
              .update(JSON.stringify(eligible))
              .digest("hex"),
          };
        } finally {
          db.close();
        }
      },
    );
    return {
      sampledAt: iso(this.now()),
      users,
      physicalBytes: users.reduce((n, u) => n + u.physicalBytes, 0),
      usedBytes: users.reduce((n, u) => n + u.usedBytes, 0),
      freePageBytes: users.reduce((n, u) => n + u.freePageBytes, 0),
      disk: this.resources,
      backup: this.overview().backup,
      categories: this.cloudOperations.inventory()?.storage || null,
    };
  }
  changeBudget(value, operation, actor) {
    return this.mutate("budget-change", "site", operation, actor, value, () =>
      this.ledger.changeBudget(
        value.dailyMicro,
        value.monthlyMicro,
        value.reason,
        operation,
        actor,
      ),
    );
  }
  tasks(query) {
    const page = Number(query.get("page") || 1),
      pageSize = Number(query.get("pageSize") || 20);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      fail(400, "INVALID_PAGE");
    const keyword = (query.get("keyword") || "").toLowerCase(),
      status = query.get("status");
    const rows = this.routes
      .adminTasks()
      .map((t) => ({ ...t, username: this.user(t.accountId).username }))
      .filter(
        (t) =>
          (!status || status === "all" || status === t.status) &&
          [t.username, t.accountId, t.taskId, t.errorCode || ""].some((s) =>
            s.toLowerCase().includes(keyword),
          ),
      );
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  }
  taskAction(ref, value, operation, actor) {
    const parts = ref.split("~");
    if (
      parts.length !== 2 ||
      !parts.every((v) => /^[\w-]{1,90}$/.test(v)) ||
      !["pause", "stop", "retry"].includes(value.action) ||
      !Number.isSafeInteger(value.generation) ||
      typeof value.revision !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.revision) ||
      (value.maintenanceOperation !== null &&
        typeof value.maintenanceOperation !== "string")
    )
      fail(400, "INVALID_ACTION");
    this.user(parts[0]);
    return this.mutate(
      "task-" + value.action,
      ref,
      operation,
      actor,
      { ...value, reason: "" },
      () =>
        this.routes.adminTaskAction(parts[0], parts[1], value.action, {
          operationId: operation,
          expectedGeneration: value.generation,
          expectedRevision: value.revision,
          expectedMaintenanceOperation: value.maintenanceOperation,
        }),
    );
  }
  paused(account) {
    return !!this.db
      .prepare("SELECT 1 FROM controls WHERE paused=1 AND scope IN ('site',?)")
      .get(account);
  }
  assertDispatch(account) {
    this.registry.account(account);
    if (this.cloudOperations.maintenance().paused) throw Error("MAINTENANCE");
    if (this.registry.aiPaused() || this.paused(account))
      throw Error("ADMIN_PAUSED");
  }
  assertUpload() {
    if (this.cloudOperations.maintenance().paused) fail(503, "MAINTENANCE");
    const disk = statfsSync(this.directory);
    if (Number(disk.bavail) / Number(disk.blocks) <= 0.2)
      fail(503, "DISK_FULL");
  }
  cleanupPreview(cutoff = this.now()) {
    const storage = this.storage(cutoff);
    const snapshots = this.cloudOperations.inventory()?.snapshots || [];
    const source = {
      cutoff,
      originals: storage.users.map((u) => [u.accountId, u.cleanupStamp || ""]),
      snapshots: snapshots.map((s) => [s.id, s.expiresAt, s.available]),
    };
    return {
      at: cutoff,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(source))
        .digest("hex"),
      originals: storage.users.reduce(
        (n, u) => n + (u.cleanupEligibleCount || 0),
        0,
      ),
      logicalBytes: storage.users.reduce(
        (n, u) => n + (u.cleanupEligibleBytes || 0),
        0,
      ),
      reusablePageBytes: storage.freePageBytes,
      expiredBackups: snapshots.filter(
        (s) => s.expiresAt && Date.parse(s.expiresAt) <= cutoff,
      ).length,
      protected:
        "有效原件引用、在途任务、卡片、账本、安全审计及最后一份校验有效备份保留；物理回收量以执行结果为准",
    };
  }
  operationsStatus() {
    return {
      maintenance: this.cloudOperations.maintenance(),
      jobs: this.cloudOperations.jobs(),
      budget: this.budget(),
      inventory: this.cloudOperations.inventory(),
      cleanupPreview: this.cleanupPreview(),
    };
  }
  requestOperation(value, operation, actor) {
    if (!["kind", "args"].every((k) => Object.hasOwn(value, k)))
      fail(400, "INVALID_OPERATION");
    return this.mutate(
      "ops-" + value.kind,
      "site",
      operation,
      actor,
      { ...value, reason: value.args?.reason || "" },
      () => {
        if (
          value.kind === "cleanup" &&
          !this.cloudOperations.jobs().some((j) => j.id === operation)
        ) {
          if (
            !Number.isSafeInteger(value.args.cleanupBefore) ||
            value.args.cleanupBefore > this.now() ||
            this.now() - value.args.cleanupBefore > 120000 ||
            value.args.cleanupFingerprint !==
              this.cleanupPreview(value.args.cleanupBefore).fingerprint
          )
            fail(409, "CLEANUP_PREVIEW_CHANGED");
        }
        return this.cloudOperations.request(
          value.kind,
          value.args,
          operation,
          actor,
        );
      },
    );
  }
  control(scope, paused, operation, actor, reason = "") {
    if (
      scope !== "site" &&
      !this.registry.db.prepare("SELECT 1 FROM accounts WHERE id=?").get(scope)
    )
      fail(404, "USER_NOT_FOUND");
    if (
      typeof operation !== "string" ||
      !/^[\w-]{8,120}$/.test(operation) ||
      typeof reason !== "string" ||
      reason.length > 200
    )
      fail(400, "INVALID_OPERATION");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([scope, paused, reason, actor]))
      .digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.db
          .prepare("SELECT 1 FROM operation_intents WHERE operation=?")
          .get(operation)
      )
        fail(409, "IDEMPOTENCY_CONFLICT");
      const old = this.db
        .prepare("SELECT fingerprint FROM audit WHERE operation=?")
        .get(operation);
      if (old && old.fingerprint !== fingerprint)
        fail(409, "IDEMPOTENCY_CONFLICT");
      if (!old) {
        this.db
          .prepare(
            "INSERT INTO controls VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET paused=excluded.paused,reason=excluded.reason,at=excluded.at",
          )
          .run(scope, Number(paused), reason, this.now());
        this.db
          .prepare(
            "INSERT INTO audit(at,actor,action,scope,operation,fingerprint,reason) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            this.now(),
            actor,
            paused ? "ai-pause" : "ai-resume",
            scope,
            operation,
            fingerprint,
            reason,
          );
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    // No scheduler kick and no ledger changes. Old tasks require explicit continue.
    return scope === "site" ? this.site() : this.user(scope);
  }
  site() {
    return {
      paused: this.paused("site"),
      safetyPaused: this.registry.aiPaused(),
    };
  }
  audits(scope) {
    return this.db
      .prepare(
        `SELECT * FROM audit ${scope ? "WHERE scope=?" : ""} ORDER BY id DESC LIMIT 200`,
      )
      .all(...(scope ? [scope] : []))
      .map((r) => ({
        id: String(r.id),
        at: iso(r.at),
        actor: r.actor,
        action: r.action,
        detail: r.scope + (r.reason ? ` · ${r.reason}` : ""),
        operationId: r.operation,
      }));
  }
  auditSearch(query) {
    const page = Number(query.get("page") || 1),
      pageSize = Number(query.get("pageSize") || 50),
      keyword = query.get("keyword") || "";
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      keyword.length > 200
    )
      fail(400, "INVALID_PAGE");
    const pattern =
      "%" +
      keyword
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_") +
      "%";
    const where =
      "actor LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR scope LIKE ? ESCAPE '\\' OR reason LIKE ? ESCAPE '\\' OR operation LIKE ? ESCAPE '\\'";
    const params = Array(5).fill(pattern),
      total = this.db
        .prepare("SELECT COUNT(*) n FROM audit WHERE " + where)
        .get(...params).n;
    const items = this.db
      .prepare(
        "SELECT * FROM audit WHERE " +
          where +
          " ORDER BY id DESC LIMIT ? OFFSET ?",
      )
      .all(...params, pageSize, (page - 1) * pageSize)
      .map((r) => ({
        id: String(r.id),
        at: iso(r.at),
        actor: r.actor,
        action: r.action,
        detail: r.scope + (r.reason ? " · " + r.reason : ""),
        operationId: r.operation,
      }));
    return { items, total, page, pageSize };
  }
  user(id) {
    const row = this.registry.db
      .prepare("SELECT id,enabled,created_at FROM accounts WHERE id=?")
      .get(id);
    if (!row) fail(404, "USER_NOT_FOUND");
    const named = this.registry.db
      .prepare("SELECT username FROM account_credentials WHERE user_id=?")
      .get(id);
    let w;
    try {
      w = this.ledger.wallet(id);
    } catch {
      w = {
        granted: 0,
        spent: 0,
        reserved: 0,
        unknownRisk: 0,
        available: 0,
        pausedReason: "RECONCILIATION_REQUIRED",
      };
    }
    const devices = this.registry.db
      .prepare(
        "SELECT b.id,b.kind,b.expires,s.name,s.last_seen FROM bindings b LEFT JOIN account_device_slots s ON s.binding=b.id WHERE b.user_id=? AND b.revoked=0",
      )
      .all(id)
      .map((d) => ({
        id: d.id,
        name: d.name || d.kind,
        platform: d.kind,
        lastActiveAt: d.last_seen ? iso(d.last_seen) : null,
      }));
    const control = this.db
      .prepare("SELECT * FROM controls WHERE scope=?")
      .get(id);
    return {
      id,
      username: named?.username || id,
      personalAiPaused: !!control?.paused,
      siteAiPaused: this.paused("site"),
      status: !row.enabled
        ? "disabled"
        : this.paused(id)
          ? "ai-paused"
          : "active",
      deviceCount: devices.length,
      grantedMicro: w.granted,
      spentMicro: w.spent,
      reservedMicro: w.reserved,
      unknownRiskMicro: w.unknownRisk,
      availableMicro: w.available,
      aiPausedReason: this.paused(id)
        ? control?.reason || "管理员暂停（含全站控制）"
        : w.pausedReason || null,
      createdAt: iso(row.created_at),
      updatedAt: iso(control?.at || row.created_at),
      devices,
      recentAudit: this.audits(id),
    };
  }
  users(query) {
    const page = Number(query.get("page") || 1),
      pageSize = Number(query.get("pageSize") || 10);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      fail(400, "INVALID_PAGE");
    const keyword = (query.get("keyword") || "").toLowerCase(),
      status = query.get("status");
    const items = this.registry.db
      .prepare(
        `SELECT id FROM accounts a WHERE
        EXISTS(SELECT 1 FROM account_credentials c WHERE c.user_id=a.id) OR
        EXISTS(SELECT 1 FROM bindings b WHERE b.user_id=a.id) OR
        EXISTS(SELECT 1 FROM ai_usage u WHERE u.user_id=a.id)
        ORDER BY created_at,id`,
      )
      .all()
      .map((r) => this.user(r.id))
      .filter(
        (u) =>
          (u.username.toLowerCase().includes(keyword) ||
            u.id.toLowerCase().includes(keyword)) &&
          (!status || status === "all" || u.status === status),
      );
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
      page,
      pageSize,
    };
  }
  sample() {
    const at = this.now(),
      cpu = this.cpuTimes(),
      elapsed = cpu.total - this.cpu.total;
    const disk = statfsSync(this.directory),
      total = disk.blocks * disk.bsize,
      free = disk.bavail * disk.bsize;
    this.resources = {
      cpuPercent: elapsed
        ? Math.round(100 * (1 - (cpu.idle - this.cpu.idle) / elapsed))
        : 0,
      memoryUsedMB: Math.round((totalmem() - availableMemory()) / 1048576),
      memoryTotalMB: Math.round(totalmem() / 1048576),
      diskUsedGB: (total - free) / 1073741824,
      diskTotalGB: total / 1073741824,
      diskPauseThresholdPercent: 80,
      sampledAt: iso(at),
      source: `${hostname()} · OS CPU/内存/statfs`,
    };
    this.cpu = cpu;
    const signals = [];
    const add = (kind, object, severity, message) =>
      signals.push({ kind, object, severity, message });
    const maintenance = this.cloudOperations.maintenance(),
      inventory = this.cloudOperations.inventory();
    if (maintenance.paused)
      add(
        "maintenance",
        "site",
        "warning",
        maintenance.reason || "维护暂停，等待执行回执",
      );
    const failed = this.cloudOperations
      .jobs()
      .find((j) => j.state === "failed");
    if (failed && maintenance.paused)
      add(
        "operation-failed",
        failed.id,
        "critical",
        "维护失败：" + failed.code + "；核对运维执行记录后处理",
      );
    if (inventory && this.now() - Date.parse(inventory.sampledAt) > 120000)
      add(
        "operations-worker",
        "site",
        "critical",
        "运维执行器超过两分钟未更新，请核对定时备份和服务运维",
      );
    if (inventory && !inventory.snapshots.some((s) => s.available))
      add(
        "backup-missing",
        "site",
        "warning",
        "当前没有通过验证且未到期的备份，请执行一致性备份",
      );
    const budget = this.budget();
    if (budget.daySpentMicro + budget.riskMicro >= budget.dailyMicro)
      add(
        "daily-budget",
        "site",
        "warning",
        "全站每日预算不足，保留进度，预算恢复后需主动继续",
      );
    if (
      budget.monthlyMicro !== null &&
      budget.monthSpentMicro + budget.riskMicro >= budget.monthlyMicro
    )
      add(
        "monthly-budget",
        "site",
        "warning",
        "全站月预算不足，保留进度，核对预算后需主动继续",
      );
    const priceError = this.pricingHealth();
    signals.push(
      ...serviceFailureSignals(
        this.routes.snapshot().failures,
        this.failureObservations,
        at,
      ),
    );
    if (priceError)
      add("tariff", "site", "critical", `模型价格验证门禁：${priceError}`);
    if (this.routes.snapshot().waiting >= 10)
      add("backlog", "site", "warning", "处理队列积压达到 10 个任务");
    if (this.resources.cpuPercent >= 90)
      add("cpu", "host", "warning", "CPU 占用达到 90%，请核对任务积压");
    if ((totalmem() - availableMemory()) / totalmem() >= 0.9)
      add("memory", "host", "warning", "内存占用达到 90%");
    if ((total - free) / total >= 0.8)
      add("disk", "host", "critical", "磁盘占用达到 80%，请核对存储空间");
    if (this.registry.aiPaused())
      add(
        "safety",
        "site",
        "warning",
        "服务安全开关仍关闭，人工恢复不会解除此门禁",
      );
    for (const { account } of this.ledger.db
      .prepare("SELECT account FROM reading_wallets")
      .all()) {
      const w = this.ledger.wallet(account);
      if (w.unknownRisk)
        add(
          "unknown-cost",
          account,
          "critical",
          "存在费用不明预留，需核对后继续",
        );
      if (w.pausedReason)
        add("ledger", account, "critical", `账本门禁：${w.pausedReason}`);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const keys = new Set(signals.map((s) => s.kind + ":" + s.object));
      for (const r of this.db
        .prepare("SELECT id,kind,object FROM alerts WHERE recovered_at IS NULL")
        .all())
        if (!keys.has(r.kind + ":" + r.object))
          this.db
            .prepare("UPDATE alerts SET recovered_at=?,last_at=? WHERE id=?")
            .run(at, at, r.id);
      for (const s of signals) {
        const old = this.db
          .prepare(
            "SELECT id FROM alerts WHERE kind=? AND object=? AND recovered_at IS NULL",
          )
          .get(s.kind, s.object);
        if (old)
          this.db
            .prepare("UPDATE alerts SET last_at=?,message=? WHERE id=?")
            .run(at, s.message, old.id);
        else
          this.db
            .prepare(
              "INSERT INTO alerts(kind,object,severity,message,first_at,last_at) VALUES(?,?,?,?,?,?)",
            )
            .run(s.kind, s.object, s.severity, s.message, at, at);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  alerts() {
    return this.db
      .prepare("SELECT * FROM alerts ORDER BY id DESC LIMIT 200")
      .all()
      .map((r) => {
        const taskFailure = r.kind.startsWith("task-");
        const userIssue = ["unknown-cost", "ledger"].includes(r.kind);
        const friendlyMessage = taskFailure
          ? r.message
          : r.kind === "operation-failed"
            ? "最近的维护操作未完成，维护权限仍暂停；请核对执行回执并修复原因。"
            : r.kind === "operation-pending"
              ? "维护请求已入队，等待后台执行；请查看后续执行回执。"
              : r.kind === "maintenance"
                ? "服务维护中，新增上传和AI暂停，已保存资料继续保留。"
                : r.message;
        const titles = {
          "daily-budget": "全站今日预算已用尽",
          "monthly-budget": "全站本月预算已用尽",
          "backup-missing": "缺少可恢复的备份",
          "operation-failed": "维护操作未完成",
          maintenance: "服务维护中",
          "operations-worker": "运维执行器未及时回应",
          tariff: "模型计价依据需要核对",
          disk: "服务器空间不足",
          cpu: "服务器处理繁忙",
          memory: "服务器内存紧张",
          "unknown-cost": "有调用费用需要核对",
          ledger: "账号费用门禁尚未解除",
          backlog: "新任务正在排队",
          safety: "AI安全开关已关闭",
        };
        const followup = this.db
          .prepare(
            "SELECT action,actor,reason,at FROM audit WHERE scope=? AND action LIKE 'alert-followup-%' ORDER BY id DESC LIMIT 1",
          )
          .get("alert:" + r.id);
        return {
          id: String(r.id),
          title: taskFailure
            ? "多人持续处理异常，需要核对服务"
            : titles[r.kind] || "服务状态需要核对",
          kind: r.kind,
          technicalMessage: r.message,
          severity: r.severity,
          message: friendlyMessage,
          object: r.object,
          firstAt: iso(r.first_at),
          lastAt: iso(r.last_at),
          recoveredAt: r.recovered_at ? iso(r.recovered_at) : null,
          readAt: r.read_at ? iso(r.read_at) : null,
          actionLabel: taskFailure
            ? "定位受影响任务"
            : userIssue
              ? "查看账号与费用"
              : ["backup-missing", "operation-failed"].includes(r.kind)
                ? "查看备份与维护回执"
                : "核对运行与审计",
          actionHref: taskFailure
            ? "#/tasks"
            : userIssue
              ? "#/users?account=" + encodeURIComponent(r.object)
              : ["backup-missing", "operation-failed"].includes(r.kind)
                ? "#/storage"
                : "#/ops",
          suggestion: taskFailure
            ? "查看任务报告和费用；管理员可暂停或停止在途任务。核对失败需开发修复，恢复权限后原任务仍需用户主动继续。不得通过清账或强制放行结果处理。"
            : userIssue
              ? "核对该账号的费用和权限；费用不明需可信收据，不能清除预留来强行恢复。"
              : r.kind === "backup-missing"
                ? "在存储与备份页发起一致备份，再查看实际执行回执；提交请求还不代表备份成功。"
                : ["daily-budget", "monthly-budget"].includes(r.kind)
                  ? "在运维页核对并调整预算，或等待预算周期更新；费用和风险保留。"
                  : "查看对应维护或服务回执；权限或主机故障需维护者按具体报告修复。",
          followup: followup
            ? {
                state: followup.action.slice("alert-followup-".length),
                actor: followup.actor,
                note: followup.reason,
                at: iso(followup.at),
              }
            : null,
        };
      });
  }
  followAlert(id, state, note, operation, actor) {
    if (
      !/^\d{1,20}$/.test(id) ||
      !["following", "developer", "user-action", "reviewed"].includes(state) ||
      typeof note !== "string" ||
      !note.trim() ||
      note.length > 200
    )
      fail(400, "INVALID_OPERATION");
    const alert = this.db
      .prepare("SELECT recovered_at FROM alerts WHERE id=?")
      .get(id);
    if (!alert) fail(404, "ALERT_NOT_FOUND");
    if (state === "reviewed" && !alert.recovered_at)
      fail(409, "ALERT_NOT_RECOVERED");
    return this.mutate(
      "alert-followup-" + state,
      "alert:" + id,
      operation,
      actor,
      { reason: note },
      () => ({ accepted: true, recovered: !!alert.recovered_at }),
    );
  }
  markRead(id, operation, actor) {
    if (
      !/^\d{1,20}$/.test(id) ||
      typeof operation !== "string" ||
      !/^[\w-]{8,120}$/.test(operation)
    )
      fail(400, "INVALID_OPERATION");
    if (!this.db.prepare("SELECT 1 FROM alerts WHERE id=?").get(id))
      fail(404, "ALERT_NOT_FOUND");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(["alert-read", id, actor]))
      .digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.db
          .prepare("SELECT 1 FROM operation_intents WHERE operation=?")
          .get(operation)
      )
        fail(409, "IDEMPOTENCY_CONFLICT");
      const old = this.db
        .prepare("SELECT fingerprint FROM audit WHERE operation=?")
        .get(operation);
      if (old && old.fingerprint !== fingerprint)
        fail(409, "IDEMPOTENCY_CONFLICT");
      if (!old) {
        this.db
          .prepare("UPDATE alerts SET read_at=COALESCE(read_at,?) WHERE id=?")
          .run(this.now(), id);
        this.db
          .prepare(
            "INSERT INTO audit(at,actor,action,scope,operation,fingerprint,reason) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            this.now(),
            actor,
            "alert-read",
            "alert:" + id,
            operation,
            fingerprint,
            "",
          );
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.alerts().find((a) => a.id === id);
  }
  overview() {
    const jobs = this.cloudOperations.jobs(),
      snapshots =
        this.cloudOperations
          .inventory()
          ?.snapshots?.filter((s) => s.available) || [];
    const backupSuccess = jobs.find(
        (j) => j.kind === "backup" && j.state === "succeeded",
      ),
      backupFailure = jobs.find(
        (j) => j.kind === "backup" && j.state === "failed",
      );
    const sampledAt = this.resources.sampledAt,
      q = this.routes.snapshot();
    const day = iso(this.now() + 8 * 3600000).slice(0, 10);
    const today = this.ledger.db
      .prepare(
        "SELECT COALESCE(SUM(actual),0) n FROM reading_calls WHERE state='settled' AND day=?",
      )
      .get(day).n;
    const month = this.ledger.db
      .prepare(
        "SELECT COALESCE(SUM(actual),0) n FROM reading_calls WHERE state='settled' AND day LIKE ?",
      )
      .get(day.slice(0, 7) + "%").n;
    const reserved = this.ledger.db
      .prepare(
        "SELECT COALESCE(SUM(reserved),0) n FROM reading_calls WHERE state IN ('reserved','sent','unknown')",
      )
      .get().n;
    return {
      services: [
        {
          id: "sync",
          name: "拾序云服务",
          status: "ok",
          detail: "真实运行进程 · v4",
          updatedAt: iso(this.now()),
        },
      ],
      resources: this.resources,
      queue: [
        {
          stage: "reading",
          label: "云端处理",
          pending: q.waiting,
          running: q.running,
          waitingUser: q.waitingUser || 0,
          oldestPendingSeconds: null,
        },
      ],
      costs: {
        currency: "CNY",
        todayMicro: today,
        monthMicro: month,
        siteBudgetMonthMicro: this.budget().monthlyMicro,
        siteDailyMicro: this.budget().dailyMicro,
        reservedMicro: reserved,
        asOf: iso(this.now()),
      },
      backup: {
        available: !!this.cloudOperations.inventory(),
        lastSuccessAt: backupSuccess?.updatedAt || null,
        lastFailureAt: backupFailure?.updatedAt || null,
        retainedCount: snapshots.length,
        retentionDays: 7,
        nextExpireAt: snapshots.map((s) => s.expiresAt).sort()[0] || null,
        maintenanceReason: this.cloudOperations.maintenance().reason,
        uploadsPaused: this.cloudOperations.maintenance().paused,
        aiPaused:
          this.registry.aiPaused() || this.cloudOperations.maintenance().paused,
      },
      alerts: this.alerts().filter((a) => !a.recoveredAt),
      control: this.site(),
      sampledAt,
      source: "cloud-runtime",
    };
  }
  close() {
    clearInterval(this.timer);
    this.cloudOperations.close();
    this.db.close();
  }
}
