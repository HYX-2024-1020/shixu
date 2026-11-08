import { DatabaseSync } from "node:sqlite";
import { cpus, freemem, totalmem, hostname } from "node:os";
import { statfsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const fail = (status, code) => {
  throw Object.assign(Error(code), { status, code });
};
const iso = (at) => new Date(at).toISOString();
const availableMemory = () => process.platform === 'linux'
  ? Number(readFileSync('/proc/meminfo','utf8').match(/^MemAvailable:\s+(\d+) kB/m)?.[1] || Math.floor(freemem()/1024))*1024
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
  }) {
    Object.assign(this, {
      registry,
      ledger,
      routes,
      directory,
      now,
      pricingHealth,
    });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS controls(scope TEXT PRIMARY KEY,paused INTEGER NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,scope TEXT NOT NULL,operation TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,reason TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;
      CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,object TEXT NOT NULL,severity TEXT NOT NULL,message TEXT NOT NULL,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,recovered_at INTEGER,read_at INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS alerts_active ON alerts(kind,object) WHERE recovered_at IS NULL;`);
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
  paused(account) {
    return !!this.db
      .prepare("SELECT 1 FROM controls WHERE paused=1 AND scope IN ('site',?)")
      .get(account);
  }
  assertDispatch(account) {
    this.registry.account(account);
    if (this.registry.aiPaused() || this.paused(account))
      throw Error("ADMIN_PAUSED");
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
        detail: r.scope + (r.reason ? ` · ${r.reason}` : ''),
        operationId: r.operation,
      }));
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
        "SELECT id,kind,expires FROM bindings WHERE user_id=? AND revoked=0",
      )
      .all(id)
      .map((d) => ({
        id: d.id,
        name: d.kind,
        platform: d.kind,
        lastActiveAt: null,
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
      .prepare("SELECT id FROM accounts ORDER BY created_at,id")
      .all()
      .map((r) => this.user(r.id))
      .filter(
        (u) =>
          u.username.toLowerCase().includes(keyword) &&
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
    const priceError = this.pricingHealth();
    for(const failure of this.routes.snapshot().failures || [])add('task-'+failure.reason,failure.account,'warning',`${failure.count} 个任务等待处理：${failure.reason}；请核对用户任务及累计费用`);
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
      .map((r) => ({
        id: String(r.id),
        severity: r.severity,
        message: r.message,
        object: r.object,
        firstAt: iso(r.first_at),
        lastAt: iso(r.last_at),
        recoveredAt: r.recovered_at ? iso(r.recovered_at) : null,
        readAt: r.read_at ? iso(r.read_at) : null,
        actionLabel: "核对运行与审计",
        actionHref: "#/ops",
        suggestion: "检查对应服务、队列或费用门禁；已读不会解除故障。",
      }));
  }
  markRead(id, operation, actor) {
    if(!/^\d{1,20}$/.test(id)||typeof operation!=='string'||!/^[\w-]{8,120}$/.test(operation))fail(400,'INVALID_OPERATION');
    if(!this.db.prepare('SELECT 1 FROM alerts WHERE id=?').get(id))fail(404,'ALERT_NOT_FOUND');
    const fingerprint=createHash('sha256').update(JSON.stringify(['alert-read',id,actor])).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.db.prepare('SELECT fingerprint FROM audit WHERE operation=?').get(operation);
      if(old&&old.fingerprint!==fingerprint)fail(409,'IDEMPOTENCY_CONFLICT');
      if(!old){
        this.db.prepare('UPDATE alerts SET read_at=COALESCE(read_at,?) WHERE id=?').run(this.now(),id);
        this.db.prepare('INSERT INTO audit(at,actor,action,scope,operation,fingerprint,reason) VALUES(?,?,?,?,?,?,?)').run(this.now(),actor,'alert-read','alert:'+id,operation,fingerprint,'');
      }
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    return this.alerts().find(a=>a.id===id);
  }
  overview() {
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
        siteBudgetMonthMicro: null,
        siteDailyMicro: this.ledger.limits.siteDailyMicros,
        reservedMicro: reserved,
        asOf: iso(this.now()),
      },
      backup: {
        available: false,
        lastSuccessAt: null,
        lastFailureAt: null,
        retainedCount: 0,
        retentionDays: 0,
        nextExpireAt: null,
        maintenanceReason: null,
        uploadsPaused: false,
        aiPaused: this.registry.aiPaused(),
      },
      alerts: this.alerts().filter((a) => !a.recoveredAt),
      control: this.site(),
      sampledAt,
      source: "cloud-runtime",
    };
  }
  close() {
    clearInterval(this.timer);
    this.db.close();
  }
}
