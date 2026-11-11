import { randomUUID } from "node:crypto";
import { ensureDatabaseSchema } from "../database-schema.mjs";

// Independent of tenant snapshots. Never persist exception messages, source
// names, bodies, instructions, model output or stack frames containing data.
const schema = [{ version: 1, sql: `
CREATE TABLE reading_diagnostics(id TEXT PRIMARY KEY,account TEXT NOT NULL,task TEXT NOT NULL,generation INTEGER NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL);
CREATE INDEX reading_diagnostics_task ON reading_diagnostics(account,task,at);
CREATE TRIGGER reading_diagnostics_no_update BEFORE UPDATE ON reading_diagnostics BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER reading_diagnostics_no_delete BEFORE DELETE ON reading_diagnostics BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
` }];
const known = new Set([
  "INVALID_MODEL_OUTPUT", "INVALID_MODEL_SOURCE", "INVALID_MERGE_OUTPUT", "INVALID_MERGE_SOURCE", "INVALID_MERGE_CONFLICT",
  "INVALID_ASSOCIATION_OUTPUT", "INVALID_ASSOCIATION_SOURCE", "INVALID_ASSOCIATION_CONFLICT", "INVALID_VISUAL_REVIEW",
  "UNKNOWN_COST", "READING_TIMEOUT", "ADMIN_PAUSED", "MAINTENANCE", "PERSONAL_BUDGET", "SITE_BUDGET", "SITE_MONTH_BUDGET",
  "RECONCILIATION_REQUIRED", "SAFETY_RECONCILIATION", "WINDOW_STATE_RECONCILIATION", "EXECUTION_LIMIT", "REUPLOAD_REQUIRED",
  "LEDGER_PAUSED", "NO_READABLE_MATERIAL", "CHECKPOINT_NO_PROGRESS", "ACTIVE_TIME_RECONCILIATION",
]);
function safeCode(error) {
  const code = error?.code || error?.message;
  if (known.has(code)) return code;
  if (/^第 \d+ 条引用不在原文中$/.test(code)) return "MODEL_EVIDENCE_NOT_IN_SOURCE";
  if (/^第 \d+ 条缺少原文依据$/.test(code)) return "MODEL_EVIDENCE_MISSING";
  if (/^第 \d+ 条的类型或标题无效$/.test(code)) return "MODEL_KIND_OR_TITLE_INVALID";
  if (code === "模型返回结构不完整") return "MODEL_STRUCTURE_INVALID";
  return "UNEXPECTED_FAILURE";
}
export class ReadingDiagnostics {
  constructor(engine) {
    this.e = engine;
    this.db = engine.ledger.db;
    ensureDatabaseSchema(this.db, "reading-diagnostics", schema, { now: engine.ledger.now });
  }
  record(task, error) {
    const e = this.e;
    const phase = e.chat.isChat(task.id) ? "chat" : e.association.active(task.id) ? "associating" : e.merge.active(task.id) ? "merging" : e.visual.active(task.id) ? "verifying" : "reading";
    const report = {
      id: randomUUID(), at: e.ledger.now(), taskId: task.id, generation: task.generation,
      version: "0.3.26", phase, code: safeCode(error),
      calls: this.db.prepare("SELECT id,state,reserved,actual FROM reading_calls WHERE account=? AND task=? ORDER BY rowid").all(e.account, task.id),
    };
    this.db.prepare("INSERT INTO reading_diagnostics VALUES(?,?,?,?,?,?)").run(report.id, e.account, task.id, task.generation, report.at, JSON.stringify(report));
    return report;
  }
  latest(task) {
    const row = this.db.prepare("SELECT body FROM reading_diagnostics WHERE account=? AND task=? ORDER BY rowid DESC LIMIT 1").get(this.e.account, task);
    return row ? JSON.parse(row.body) : null;
  }
}
