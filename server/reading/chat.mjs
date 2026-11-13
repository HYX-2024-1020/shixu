import { ensureDatabaseSchema } from "../database-schema.mjs";
import {
  READING_CHAT_REQUESTS_SCHEMA,
  LEDGER_CHAT_SCHEMA,
} from "../database-schemas.mjs";
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
    ensureDatabaseSchema(this.db, "tenant-chat", READING_CHAT_REQUESTS_SCHEMA);
    ensureDatabaseSchema(this.ledger.db, "ledger-chat", LEDGER_CHAT_SCHEMA, {
      now: this.ledger.now,
    });
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
        contextScope: request.readAttachments
          ? "当前事项、本轮指令与附件实际读取范围；未读边界另列"
          : request.scope === "account"
            ? "当前账号可访问事项；跨卡片修改待用户确认"
            : "已保存事项与本轮指令；没有重新读取原件",
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
    if (chat.scope === "group" && !validId(chat.groupId)) fail("INVALID_CHAT");
    if (
      chat.scope === "selected" &&
      (!Array.isArray(chat.targets) ||
        !chat.targets.length ||
        chat.targets.length > 20 ||
        chat.targets.some((t) => !validId(t.packetId) || !validId(t.itemId)))
    )
      fail("INVALID_CHAT");
    const intent = this.intent(id);
    const request = {
      packetId,
      deviceId,
      itemId: chat.itemId,
      instruction: chat.instruction,
      baseVersion: chat.baseVersion,
      epoch: chat.epoch,
      expectedCostOperation,
      ...(["account", "packet", "group", "selected"].includes(chat.scope)
        ? { scope: chat.scope }
        : {}),
      ...(chat.scope === "group" ? { groupId: chat.groupId } : {}),
      ...(chat.scope === "selected" ? { targets: chat.targets } : {}),
      ...(chat.readAttachments === true ? { readAttachments: true } : {}),
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
      ...(["account", "packet", "group", "selected"].includes(chat.scope)
        ? { scope: chat.scope }
        : {}),
      ...(chat.scope === "group" ? { groupId: chat.groupId } : {}),
      ...(chat.scope === "selected" ? { targets: chat.targets } : {}),
      ...(chat.readAttachments === true ? { readAttachments: true } : {}),
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
      currentTarget: {
        packetId: request.packetId,
        itemId: request.itemId,
        baseVersion: record.version,
      },
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
    if (["account", "packet", "group", "selected"].includes(request.scope)) {
      let records = this.db
        .prepare(
          "SELECT id,version,data FROM sync_records WHERE purged=0 AND deleted_at IS NULL ORDER BY version DESC LIMIT 101",
        )
        .all();
      if (request.scope === "packet")
        records = records.filter((r) => r.id === request.packetId);
      if (request.scope === "selected")
        records = request.targets
          .map((t) => this.engine.store.record(t.packetId))
          .filter((r) => r && !r.deletedAt && !r.purged)
          .map((r) => ({
            id: r.id,
            version: r.version,
            data: JSON.stringify(r.data),
          }));
      records = [...new Map(records.map((r) => [r.id, r])).values()];
      context.relatedItems = records.slice(0, 100).flatMap((row) => {
        const p = JSON.parse(row.data);
        return (p.itemIds || []).flatMap((itemId, i) => {
          const meta = p.itemState?.[itemId] || {};
          if (
            !p.result?.items[i] ||
            meta.deletedAt ||
            meta.purgedAt ||
            meta.mergedInto ||
            (request.scope === "group" &&
              !meta.groupIds?.includes(request.groupId)) ||
            (request.scope === "selected" &&
              !request.targets.some(
                (t) => t.packetId === row.id && t.itemId === itemId,
              )) ||
            (row.id === request.packetId && itemId === request.itemId)
          )
            return [];
          const item = { ...p.result.items[i] };
          for (const field of contentFields)
            if (field in meta) item[field] = meta[field];
          return [
            {
              packetId: row.id,
              itemId,
              baseVersion: row.version,
              item: absoluteItem(item, p.captureDate),
              state: {
                status: meta.status,
                starred: meta.starred,
                group: meta.group,
                pinned: meta.pinned,
                importance: meta.importance,
              },
            },
          ];
        });
      });
      context.omittedPackets = records.length > 100;
      if (context.relatedItems.length > 200) {
        context.relatedItems = context.relatedItems.slice(0, 200);
        context.omittedItems = true;
      }
      context.scope =
        ({
          account: "当前账号最近100份可访问投递",
          packet: "当前同次投递",
          group: "明确指定的小组（在最近100份投递内筛选）",
          selected: "用户明确选定卡片",
        }[request.scope] || "当前事项") +
        "；跨卡片修改和真正合并先生成预览，确认后执行";
    }
    if (request.readAttachments) {
      context.originals = (packet.attachments || [])
        .filter((f) => !f.deletedAt)
        .map((f) => {
          try {
            const actual = this.engine.store.files.get(request.packetId, f.id, {
              forReading: true,
            });
            return {
              id: actual.id,
              name: actual.name,
              hash: actual.hash,
              size: actual.size,
              available: true,
            };
          } catch {
            return { id: f.id, name: f.name, available: false };
          }
        });
      context.scope += "；本轮明确请求核对当前卡片附件，读取覆盖另列";
    }
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
  async material(task, read) {
    const request = this.request(task.id),
      context = this.context(request),
      sourceId = task.id + "_chat";
    const imageSegments = [];
    if (request.readAttachments) {
      const originals = context.originals || [];
      context.attachmentContent = [];
      let units = 0;
      for (const descriptor of originals.slice(0, 8)) {
        const entry = {
          id: descriptor.id,
          name: descriptor.name,
          contentComplete: false,
          sources: [],
          missing: [],
        };
        if (!descriptor.available) entry.missing.push("ORIGINAL_UNAVAILABLE");
        else {
          const file = this.engine.store.files.get(
            request.packetId,
            descriptor.id,
            { forReading: true },
          );
          const material = await read(file);
          entry.missing = (material.uncovered || []).map(
            (r) => r.code || "UNREAD_RANGE",
          );
          for (const segment of material.segments || []) {
            if (segment.image) {
              if (
                this.engine.provider.imageInput === true &&
                imageSegments.length < 2
              ) {
                imageSegments.push(segment);
                entry.sources.push({
                  id: segment.sourceId,
                  range: segment.range,
                  imageProvided: true,
                });
                entry.missing.push("VISUAL_CONTENT_REQUIRES_USER_CHECK");
              } else entry.missing.push("IMAGE_SCOPE_LIMIT");
              continue;
            }
            if (units + [...segment.text].length > 90000) {
              entry.missing.push("CHAT_CONTEXT_LIMIT");
              break;
            }
            units += [...segment.text].length;
            entry.sources.push({
              id: segment.sourceId,
              text: segment.text,
              range: segment.range,
            });
          }
          entry.contentComplete =
            ["read", "partial"].includes(material.state) &&
            !entry.missing.some((code) => code !== "XLSX_VISUAL_LAYOUT");
        }
        context.attachmentContent.push(entry);
      }
      context.omittedAttachments = Math.max(0, originals.length - 8);
    }
    const text = JSON.stringify(context);
    if ([...text].length > 120000) fail("CHAT_CONTEXT_LIMIT");
    const range = {
      sourceId,
      name: request.readAttachments
        ? "已保存事项、本轮指令与附件读取依据"
        : "已保存事项与本轮指令",
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
      covered: [range, ...imageSegments.map((s) => s.range)],
      uncovered: [],
      reasons: [],
      segments: [{ sourceId, range, text }, ...imageSegments],
    };
  }
  validate(task, raw, { certified = false } = {}) {
    if (
      !raw ||
      !Object.hasOwn(raw, "reply") ||
      !Object.hasOwn(raw, "patch") ||
      Object.keys(raw).some(
        (key) =>
          ![
            "patch",
            "reply",
            "proposals",
            "merge",
            ...(certified ? ["readScope"] : []),
          ].includes(key),
      ) ||
      typeof raw.reply !== "string" ||
      raw.reply.length > 3000 ||
      Buffer.byteLength(JSON.stringify(raw)) > 128000
    )
      throw Error("INVALID_MODEL_OUTPUT");
    const request = this.request(task.id),
      context = this.context(request);
    if (sha256(JSON.stringify(context)) !== this.intent(task.id)?.context_hash)
      fail("INPUT_CHANGED");
    const validated = validateChatUpdate(
      raw,
      context.currentItem,
      request.instruction,
      request.day,
    );
    if (
      request.readAttachments ||
      ["account", "packet", "group", "selected"].includes(request.scope)
    ) {
      if (certified) {
        if (typeof raw.readScope !== "string" || raw.readScope.length > 8000)
          fail("SAFETY_RECONCILIATION");
        validated.readScope = raw.readScope;
      } else {
        const material = this.engine.materials.get(task.id)?.[0];
        if (!material?.segments?.[0]?.text) fail("SAFETY_RECONCILIATION");
        const read = JSON.parse(material.segments[0].text);
        validated.readScope = request.readAttachments
          ? "\n\n本轮附件读取：" +
            (read.attachmentContent || [])
              .map(
                (f) =>
                  `${f.name}：${f.sources.length}个来源范围，${f.contentComplete ? "文本内容已覆盖" : "仍有未读内容"}${f.missing.length ? "（" + f.missing.join("、") + "）" : ""}`,
              )
              .join("；")
          : "";
        if (read.omittedAttachments)
          validated.readScope += `；另${read.omittedAttachments}份附件未读，不能据此断言不存在。`;
        if ((read.attachmentContent || []).some((f) => !f.contentComplete))
          validated.readScope +=
            "。本轮仍有未读范围，答复不表示未读范围内不存在所查内容。";
        if (["account", "packet", "group", "selected"].includes(request.scope))
          validated.readScope += `\n\n本轮跨卡片范围：${context.scope}，共${context.relatedItems.length}个其他事项摘要，未重读其他卡片附件。${context.omittedPackets || context.omittedItems ? "还有卡片或事项未纳入，不能据此断言整个账号不存在所查内容。" : ""}修改建议尚未执行，须确认后保存。`;
      }
    }
    if (raw.proposals !== undefined) {
      if (
        !["account", "packet", "group", "selected"].includes(request.scope) ||
        !Array.isArray(raw.proposals) ||
        raw.proposals.length > 10
      )
        fail("INVALID_CHAT");
      const seen = new Set();
      validated.proposals = raw.proposals.map((proposal) => {
        const target = context.relatedItems.find(
          (i) =>
            i.packetId === proposal.packetId && i.itemId === proposal.itemId,
        );
        const key = proposal.packetId + "#" + proposal.itemId;
        if (!target || seen.has(key)) fail("INVALID_CHAT");
        seen.add(key);
        const patch = { ...proposal.patch };
        if (certified) delete patch.dueCleared;
        const update = validateChatUpdate(
          { reply: "待用户确认", patch },
          target.item,
          request.instruction,
          request.day,
        );
        return {
          packetId: target.packetId,
          itemId: target.itemId,
          baseVersion: target.baseVersion,
          patch: update.patch,
          title: target.item.title,
          beforeItem: target.item,
          beforeState: target.state,
        };
      });
    }
    if (raw.merge !== undefined) {
      if (
        !context.relatedItems ||
        raw.proposals?.length ||
        Object.keys(raw.patch).length ||
        !raw.merge ||
        typeof raw.merge.title !== "string" ||
        !raw.merge.title.trim() ||
        raw.merge.title.length > 150 ||
        !Array.isArray(raw.merge.targets) ||
        raw.merge.targets.length < 2 ||
        raw.merge.targets.length > 20
      )
        fail("INVALID_CHAT");
      const allowed = [
        {
          ...context.currentTarget,
          item: context.currentItem,
          state: context.currentState,
        },
        ...context.relatedItems,
      ];
      const seen = new Set();
      validated.merge = {
        title: raw.merge.title.trim(),
        targets: raw.merge.targets.map((t) => {
          const key = t.packetId + "#" + t.itemId,
            source = allowed.find(
              (a) => a.packetId === t.packetId && a.itemId === t.itemId,
            );
          if (!source || seen.has(key)) fail("INVALID_CHAT");
          seen.add(key);
          return {
            packetId: source.packetId,
            itemId: source.itemId,
            title: source.item.title,
            beforeItem: source.item,
          };
        }),
      };
    }
    return JSON.parse(JSON.stringify(validated));
  }
  normalized(task, value) {
    const raw = structuredClone(value);
    if (raw.patch && typeof raw.patch === "object") delete raw.patch.dueCleared;
    const normalized = this.validate(task, raw, { certified: true });
    if (!isDeepStrictEqual(normalized, value)) fail("SAFETY_RECONCILIATION");
    return normalized;
  }
  certify(task, fingerprint, callId, value) {
    this.ledger.receipts.assertUsable(callId);
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
    this.ledger.receipts.assertUsable(block.call_id);
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
              text: output.reply + (output.readScope || ""),
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
          chatMerge: output.merge || null,
          chatProposals: output.proposals
            ? { id: task.id, items: output.proposals }
            : null,
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
