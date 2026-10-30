import { isDeepStrictEqual } from "node:util";
import { SyncError } from "../sync-store.mjs";
import { absoluteItem, validateChatUpdate } from "../generated/ai-core.mjs";
import { sha256 } from "./material.mjs";
import { beijingDay } from "./ledger.mjs";

const fail = (code) => {
  throw new SyncError(
    409,
    code,
    {
      CHAT_NOT_READY: "事项对话尚未接入累计账本，暂不可用",
      INVALID_CHAT: "请填写当前事项及1至4000字的指令",
      ITEM_DELETED: "事项不存在或已删除",
      CHAT_CONTEXT_LIMIT:
        "已保存事项的对话上下文超过本步骤范围，请先整理笔记或历史",
      INPUT_CHANGED: "事项或原件已变化，请同步后明确发起新对话",
      SAFETY_RECONCILIATION: "对话进度与独立安全记录不一致，请联系维护者核对",
    }[code] || code,
  );
};
const validId = (v) => typeof v === "string" && /^[\w-]{1,110}$/.test(v);
const contentFields = [
  "title",
  "summary",
  "facts",
  "kind",
  "due",
  "dueCleared",
];

// The stored request contains the user's bounded instruction, never extracted
// original text. Immutable independent intents/proofs survive tenant rollback.
export class ReadingChat {
  constructor(engine) {
    this.engine = engine;
    this.db = engine.db;
    this.ledger = engine.ledger;
    this.account = engine.account;
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS reading_chat_requests(task TEXT PRIMARY KEY,request_hash TEXT NOT NULL,body TEXT);`,
    );
    this.ledger.db.exec(`CREATE TABLE IF NOT EXISTS reading_chat_intents(
      account TEXT NOT NULL,task TEXT NOT NULL,packet TEXT NOT NULL,request_hash TEXT NOT NULL,context_hash TEXT NOT NULL,day TEXT NOT NULL,
      PRIMARY KEY(account,task));
      CREATE TABLE IF NOT EXISTS reading_chat_proofs(call_id TEXT PRIMARY KEY,account TEXT NOT NULL,task TEXT NOT NULL,
      fingerprint TEXT NOT NULL,request_hash TEXT NOT NULL,result_hash TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reading_chat_proofs_task ON reading_chat_proofs(account,task,fingerprint);
      CREATE TRIGGER IF NOT EXISTS reading_chat_intents_no_update BEFORE UPDATE ON reading_chat_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CHAT_INTENT'); END;
      CREATE TRIGGER IF NOT EXISTS reading_chat_intents_no_delete BEFORE DELETE ON reading_chat_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CHAT_INTENT'); END;
      CREATE TRIGGER IF NOT EXISTS reading_chat_proofs_no_update BEFORE UPDATE ON reading_chat_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CHAT_PROOF'); END;
      CREATE TRIGGER IF NOT EXISTS reading_chat_proofs_no_delete BEFORE DELETE ON reading_chat_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CHAT_PROOF'); END;`);
  }
  intent(id) {
    return this.ledger.db
      .prepare("SELECT * FROM reading_chat_intents WHERE account=? AND task=?")
      .get(this.account, id);
  }
  isChat(id) {
    return (
      !!this.intent(id) ||
      !!this.db
        .prepare("SELECT 1 FROM reading_chat_requests WHERE task=?")
        .get(id)
    );
  }
  publicInfo(id) {
    if (!this.isChat(id)) return { kind: "organize" };
    if (this.engine.get(id)?.state === "purged")
      return { kind: "chat", contextScope: "对话请求已清除" };
    try {
      const request = this.request(id);
      return {
        kind: "chat",
        itemId: request.itemId,
        contextScope: "已保存事项与本轮指令；没有重新读取原件",
      };
    } catch {
      return {
        kind: "chat",
        chatSafetyReason: "SAFETY_RECONCILIATION",
        contextScope: "事项对话安全记录待核对",
      };
    }
  }
  request(id) {
    const intent = this.intent(id),
      row = this.db
        .prepare("SELECT * FROM reading_chat_requests WHERE task=?")
        .get(id);
    if (!intent && !row) return null;
    if (!intent || !row?.body || row.request_hash !== intent.request_hash)
      fail("SAFETY_RECONCILIATION");
    let request;
    try {
      request = JSON.parse(row.body);
    } catch {
      fail("SAFETY_RECONCILIATION");
    }
    if (!request || typeof request !== "object" || Array.isArray(request))
      fail("SAFETY_RECONCILIATION");
    if (
      this.requestHash(request) !== intent.request_hash ||
      request.day !== intent.day ||
      request.packetId !== intent.packet
    )
      fail("SAFETY_RECONCILIATION");
    return request;
  }
  requestHash(request) {
    const { day, ...identity } = request;
    return sha256(JSON.stringify(identity));
  }
  prepare(id, packetId, deviceId, chat, expectedCostOperation) {
    if (typeof this.engine.provider.chat !== "function") fail("CHAT_NOT_READY");
    if (
      !chat ||
      !validId(chat.itemId) ||
      typeof chat.instruction !== "string" ||
      !chat.instruction.trim() ||
      chat.instruction.length > 4000 ||
      !Number.isSafeInteger(chat.baseVersion) ||
      chat.baseVersion < 1 ||
      typeof chat.epoch !== "string"
    )
      fail("INVALID_CHAT");
    if (chat.epoch !== this.engine.store.epoch) fail("RESET_REQUIRED");
    if (this.engine.store.record(packetId)?.version !== chat.baseVersion)
      fail("REVISION_CONFLICT");
    const intent = this.intent(id);
    const request = {
      packetId,
      deviceId,
      itemId: chat.itemId,
      instruction: chat.instruction,
      baseVersion: chat.baseVersion,
      epoch: chat.epoch,
      expectedCostOperation,
      day: intent?.day || beijingDay(this.ledger.now()),
    };
    const requestHash = this.requestHash(request),
      contextHash = sha256(JSON.stringify(this.context(request)));
    if (
      intent &&
      (intent.packet !== packetId ||
        intent.request_hash !== requestHash ||
        intent.context_hash !== contextHash)
    )
      fail("IDEMPOTENCY_CONFLICT");
    return { request, requestHash, contextHash };
  }
  sameRequest(id, packetId, deviceId, chat, expectedCostOperation) {
    const intent = this.intent(id);
    if (!intent || !chat) return false;
    const request = {
      packetId,
      deviceId,
      itemId: chat.itemId,
      instruction: chat.instruction,
      baseVersion: chat.baseVersion,
      epoch: chat.epoch,
      expectedCostOperation,
    };
    return this.requestHash(request) === intent.request_hash;
  }
  register(task, prepared) {
    const values = {
      account: this.account,
      task: task.id,
      packet: task.packet,
      request_hash: prepared.requestHash,
      context_hash: prepared.contextHash,
      day: prepared.request.day,
    };
    const prior = this.intent(task.id);
    if (prior && !isDeepStrictEqual({ ...prior }, values))
      fail("SAFETY_RECONCILIATION");
    if (!prior)
      this.ledger.db
        .prepare("INSERT INTO reading_chat_intents VALUES(?,?,?,?,?,?)")
        .run(...Object.values(values));
    this.db
      .prepare("INSERT INTO reading_chat_requests VALUES(?,?,?)")
      .run(task.id, prepared.requestHash, JSON.stringify(prepared.request));
  }
  context(request) {
    const record = this.engine.store.record(request.packetId),
      packet = record?.data;
    const index = packet?.itemIds?.indexOf(request.itemId) ?? -1,
      meta = packet?.itemState?.[request.itemId] || {};
    if (
      !record ||
      record.deletedAt ||
      record.purged ||
      index < 0 ||
      !packet.result?.items[index] ||
      meta.deletedAt ||
      meta.purgedAt
    )
      fail("ITEM_DELETED");
    const item = { ...packet.result.items[index] };
    for (const field of contentFields)
      if (field in meta) item[field] = meta[field];
    const currentItem = absoluteItem(item, packet.captureDate, [], meta.chat);
    const conversation = Array.isArray(meta.chat) ? meta.chat : [];
    const context = {
      schema: "saved-item-chat/1",
      scope: "已保存的当前事项与本轮指令；没有重新读取原件",
      today: request.day,
      currentItem,
      currentState: {
        group: meta.group ?? item.group,
        status: meta.status,
        importance: meta.importance,
        starred: meta.starred,
        pinned: meta.pinned,
      },
      conversation: conversation.slice(-16),
      omittedConversationTurns: Math.max(0, conversation.length - 16),
      previousNotes: meta.additions || [],
      instruction: request.instruction,
    };
    const json = JSON.stringify(context);
    if (Buffer.byteLength(json) > 512 * 1024 || [...json].length > 120000)
      fail("CHAT_CONTEXT_LIMIT");
    return context;
  }
  revision(id, base, prepared) {
    const request = prepared?.request || this.request(id);
    return request
      ? sha256(
          JSON.stringify([base, "saved-item-chat/1", this.context(request)]),
        )
      : base;
  }
  material(task) {
    const request = this.request(task.id),
      text = JSON.stringify(this.context(request)),
      sourceId = task.id + "_chat";
    const range = {
      sourceId,
      name: "已保存事项与本轮指令",
      kind: "item-chat",
      itemId: request.itemId,
      start: 0,
      end: [...text].length,
    };
    return {
      attachmentId: "item_chat",
      name: "已保存事项与本轮指令.txt",
      contentHash: sha256(Buffer.from(text)),
      readerVersion: "saved-item/1",
      normalizationVersion: "json/1",
      state: "read",
      covered: [range],
      uncovered: [],
      reasons: [],
      segments: [{ sourceId, range, text }],
    };
  }
  validate(task, raw) {
    if (
      !raw ||
      Object.keys(raw).sort().join(",") !== "patch,reply" ||
      typeof raw.reply !== "string" ||
      raw.reply.length > 3000 ||
      Buffer.byteLength(JSON.stringify(raw)) > 128000
    )
      throw Error("INVALID_MODEL_OUTPUT");
    const request = this.request(task.id),
      context = this.context(request);
    if (sha256(JSON.stringify(context)) !== this.intent(task.id)?.context_hash)
      fail("INPUT_CHANGED");
    return validateChatUpdate(
      raw,
      context.currentItem,
      request.instruction,
      request.day,
    );
  }
  normalized(task, value) {
    const raw = structuredClone(value);
    if (raw.patch && typeof raw.patch === "object") delete raw.patch.dueCleared;
    const normalized = this.validate(task, raw);
    if (!isDeepStrictEqual(normalized, value)) fail("SAFETY_RECONCILIATION");
    return normalized;
  }
  certify(task, fingerprint, callId, value) {
    this.normalized(task, value);
    const call = this.ledger.call(callId),
      intent = this.intent(task.id);
    if (
      !call ||
      call.account !== this.account ||
      call.task !== task.id ||
      call.block !== fingerprint ||
      call.state !== "settled" ||
      !intent
    )
      fail("SAFETY_RECONCILIATION");
    const proof = {
      call_id: callId,
      account: this.account,
      task: task.id,
      fingerprint,
      request_hash: intent.request_hash,
      result_hash: sha256(JSON.stringify(value)),
    };
    const prior = this.ledger.db
      .prepare("SELECT * FROM reading_chat_proofs WHERE call_id=?")
      .get(callId);
    if (prior && !isDeepStrictEqual({ ...prior }, proof))
      fail("SAFETY_RECONCILIATION");
    if (!prior)
      this.ledger.db
        .prepare("INSERT INTO reading_chat_proofs VALUES(?,?,?,?,?,?)")
        .run(...Object.values(proof));
  }
  verifyBlock(task, block) {
    const call = this.ledger.call(block.call_id),
      intent = this.intent(task.id);
    const proof = this.ledger.db
      .prepare("SELECT * FROM reading_chat_proofs WHERE call_id=?")
      .get(block.call_id);
    if (
      !proof ||
      !intent ||
      proof.account !== this.account ||
      proof.task !== task.id ||
      proof.fingerprint !== block.fingerprint ||
      proof.request_hash !== intent.request_hash ||
      proof.result_hash !== sha256(block.result) ||
      !call ||
      call.state !== "settled" ||
      call.account !== this.account ||
      call.task !== task.id ||
      call.block !== block.fingerprint
    ) {
      this.engine.roots.block(task.id, "SAFETY_RECONCILIATION");
      fail("SAFETY_RECONCILIATION");
    }
    return this.normalized(task, JSON.parse(block.result));
  }
  guardLostBlock(task, fingerprint) {
    if (
      this.ledger.db
        .prepare(
          "SELECT 1 FROM reading_chat_proofs WHERE account=? AND task=? AND fingerprint=?",
        )
        .get(this.account, task.id, fingerprint)
    ) {
      this.engine.roots.block(task.id, "SAFETY_RECONCILIATION");
      fail("SAFETY_RECONCILIATION");
    }
  }
  publication(task) {
    const blocks = this.db
      .prepare("SELECT * FROM reading_blocks WHERE task=? ORDER BY rowid")
      .all(task.id);
    if (blocks.length !== 1) fail("SAFETY_RECONCILIATION");
    const output = this.verifyBlock(task, blocks[0]),
      request = this.request(task.id),
      packet = this.engine.store.record(task.packet).data;
    const index = packet.itemIds.indexOf(request.itemId),
      result = structuredClone(packet.result),
      meta = packet.itemState?.[request.itemId] || {},
      changes = { ...output.patch };
    for (const field of contentFields)
      if (field in changes) {
        result.items[index][field] = changes[field];
        delete changes[field];
      }
    const at = new Date(this.ledger.now()).toISOString(),
      done = new Set(packet.doneIds || []);
    const edits = Object.keys(output.patch).filter(
      (field) =>
        JSON.stringify(
          contentFields.includes(field)
            ? packet.result.items[index][field]
            : meta[field],
        ) !== JSON.stringify(output.patch[field]),
    );
    if (changes.status === "done") done.add(index);
    else if (changes.status) done.delete(index);
    if (changes.status)
      changes.completedAt = changes.status === "done" ? at : null;
    return {
      result,
      doneIds: [...done],
      updatedAt: at,
      itemState: {
        [request.itemId]: {
          ...changes,
          ...(edits.length ? { corrected: true } : {}),
          chat: [
            ...(meta.chat || []),
            {
              id: task.id + "_user",
              role: "user",
              text: request.instruction,
              at,
            },
            {
              id: task.id + "_assistant",
              role: "assistant",
              text: output.reply,
              at,
            },
          ],
          history: [
            ...(meta.history || []),
            ...edits.map((field) => ({
              at,
              field,
              before:
                JSON.stringify(
                  field in meta
                    ? meta[field]
                    : packet.result.items[index][field],
                ) || "",
              after: JSON.stringify(output.patch[field]),
              source: "AI 对话",
            })),
          ],
        },
      },
    };
  }
  purge(id) {
    this.db
      .prepare("UPDATE reading_chat_requests SET body=NULL WHERE task=?")
      .run(id);
  }
}
