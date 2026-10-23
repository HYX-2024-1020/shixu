const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const empty = () => ({
  version: 1,
  tombstones: [],
  attachmentTombstones: [],
  packets: [],
  usage: [],
  draft: { text: "", attachments: [] },
});
const retention = 30 * 86400000;
function validate(state) {
  if (
    !state ||
    state.version !== 1 ||
    !Array.isArray(state.packets) ||
    !Array.isArray(state.usage) ||
    !state.draft ||
    typeof state.draft.text !== "string" ||
    !Array.isArray(state.draft.attachments)
  )
    throw new Error("备份版本或结构无效");
  if (
    state.tombstones &&
    (!Array.isArray(state.tombstones) ||
      !state.tombstones.every((id) => typeof id === "string"))
  )
    throw new Error("永久删除记录无效");
  const ids = new Set();
  if (
    state.attachmentTombstones &&
    (!Array.isArray(state.attachmentTombstones) ||
      !state.attachmentTombstones.every((id) => typeof id === "string"))
  )
    throw new Error("附件清理记录无效");
  for (const p of state.packets) {
    if (
      !p ||
      typeof p.id !== "string" ||
      ids.has(p.id) ||
      !Array.isArray(p.attachments) ||
      typeof p.text !== "string" ||
      !Array.isArray(p.sources) ||
      !Array.isArray(p.doneIds) ||
      !["pending", "processing", "ready", "error"].includes(p.status)
    )
      throw new Error("投递记录结构无效");
    ids.add(p.id);
    if (
      !p.sources.every(
        (s) =>
          s && ["id", "name", "text"].every((k) => typeof s[k] === "string"),
      )
    )
      throw new Error("来源记录无效");
    if (
      p.coverage &&
      (!Array.isArray(p.coverage) ||
        !p.coverage.every(
          (c) =>
            c &&
            ["attachmentId", "name", "detail"].every(
              (k) => typeof c[k] === "string",
            ) &&
            ["read", "failed"].includes(c.state) &&
            Array.isArray(c.sourceIds),
        ))
    )
      throw new Error("读取覆盖清单无效");
    if (
      p.receipt &&
      !["created", "updated", "merged"].every(
        (k) => Number.isFinite(p.receipt[k]) && p.receipt[k] >= 0,
      )
    )
      throw new Error("整理回执无效");
    if (p.deletedAt && !Number.isFinite(Date.parse(p.deletedAt)))
      throw new Error("删除时间无效");
    if (p.result) {
      if (
        typeof p.result.summary !== "string" ||
        !Array.isArray(p.result.items) ||
        !Array.isArray(p.result.warnings)
      )
        throw new Error("整理结果结构无效");
      if (p.proposedItems && !Array.isArray(p.proposedItems))
        throw new Error("补充候选结构无效");
      for (const item of [...p.result.items, ...(p.proposedItems || [])]) {
        if (
          !item ||
          ![
            "task",
            "idea",
            "habit",
            "note",
            "event",
            "notice",
            "other",
          ].includes(item.kind) ||
          typeof item.title !== "string" ||
          typeof item.summary !== "string" ||
          !["facts", "nextSteps", "uncertainties", "sourceIds"].every(
            (k) =>
              Array.isArray(item[k]) &&
              item[k].every((v) => typeof v === "string"),
          ) ||
          !Array.isArray(item.evidence)
        )
          throw new Error("事项结构无效");
        if (
          !item.evidence.every(
            (e) =>
              e &&
              typeof e.sourceId === "string" &&
              typeof e.quote === "string",
          )
        )
          throw new Error("事项来源依据无效");
        if (
          item.due &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(item.due.date) ||
            typeof item.due.time !== "string" ||
            typeof item.due.anchor !== "string")
        )
          throw new Error("事项日期无效");
      }
      if (
        p.itemIds &&
        (!Array.isArray(p.itemIds) ||
          p.itemIds.length !== p.result.items.length ||
          new Set(p.itemIds).size !== p.itemIds.length)
      )
        throw new Error("事项身份无效");
    }
    for (const meta of Object.values(p.itemState || {})) {
      if (
        !meta ||
        typeof meta !== "object" ||
        (meta.deletedAt && !Number.isFinite(Date.parse(meta.deletedAt))) ||
        (meta.checkins &&
          (!Array.isArray(meta.checkins) ||
            !meta.checkins.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))))
      )
        throw new Error("事项状态或打卡记录无效");
      if (
        meta.history &&
        (!Array.isArray(meta.history) ||
          !meta.history.every(
            (h) =>
              h &&
              ["at", "field", "before", "after", "source"].every(
                (k) => typeof h[k] === "string",
              ),
          ))
      )
        throw new Error("修改记录无效");
    }
  }
  for (const a of [
    ...state.draft.attachments,
    ...state.packets.flatMap((p) => p.attachments),
  ]) {
    if (
      !a ||
      typeof a.id !== "string" ||
      typeof a.name !== "string" ||
      !/^[a-f0-9]{64}$/.test(a.hash)
    )
      throw new Error("附件引用无效");
    if (a.deletedAt && !Number.isFinite(Date.parse(a.deletedAt)))
      throw new Error("附件删除时间无效");
  }
  return state;
}
class DesktopStore {
  constructor(root) {
    this.root = root;
    this.tail = Promise.resolve();
  }
  file(name) {
    return path.join(this.root, name);
  }
  serial(action) {
    const operation = this.tail.catch(() => {}).then(action);
    this.tail = operation;
    return operation;
  }
  async load() {
    await fs.mkdir(this.file("files"), { recursive: true });
    try {
      return validate(
        JSON.parse(await fs.readFile(this.file("state.json"), "utf8")),
      );
    } catch (e) {
      if (e.code === "ENOENT") return empty();
      throw new Error("资料读取失败，已保留原文件：" + e.message);
    }
  }
  async commit(state) {
    validate(state);
    const target = this.file("state.json"),
      temporary = this.file("state.next.json");
    const handle = await fs.open(temporary, "w");
    try {
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.copyFile(target, this.file("state.previous.json"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await fs.rename(temporary, target);
  }
  async encode(attachments) {
    return Promise.all(
      attachments.map(async ({ bytes, blob, ...a }) => {
        if (bytes) {
          const data = Buffer.from(bytes),
            hash = crypto.createHash("sha256").update(data).digest("hex");
          if (data.length > 32 * 1024 * 1024)
            throw new Error("单文件超过 32MB");
          await fs
            .writeFile(this.file("files/" + hash), data, { flag: "wx" })
            .catch((e) => {
              if (e.code !== "EEXIST") throw e;
            });
          return { ...a, hash };
        }
        if (!/^[a-f0-9]{64}$/.test(a.hash))
          throw new Error("附件原件缺失：" + a.name);
        await fs.access(this.file("files/" + a.hash)).catch(() => {
          throw new Error("原件已清理或缺失，无法恢复：" + a.name);
        });
        return a;
      }),
    );
  }
  async decode(attachments) {
    return Promise.all(
      attachments.map(async (a) => {
        const bytes = await fs.readFile(this.file("files/" + a.hash));
        if (crypto.createHash("sha256").update(bytes).digest("hex") !== a.hash)
          throw new Error("原件校验失败：" + a.name + "；请从备份恢复");
        return { ...a, bytes: Uint8Array.from(bytes).buffer };
      }),
    );
  }
  call(method, value) {
    return this.serial(async () => {
      const state = await this.load();
      switch (method) {
        case "packets":
          return Promise.all(
            state.packets.map(async (p) => ({
              ...p,
              attachments: await this.decode(p.attachments),
            })),
          );
        case "usage":
          return state.usage;
        case "draft":
          return {
            ...state.draft,
            attachments: await this.decode(state.draft.attachments),
          };
        case "savePackets":
          for (const p of value) {
            if (state.tombstones?.includes(p.id))
              throw new Error(
                "这次投递已超过保留期或已永久删除，请重新投递原件",
              );
            const index = state.packets.findIndex((x) => x.id === p.id);
            const previous = state.packets[index];
            state.attachmentTombstones = [
              ...new Set([
                ...(state.attachmentTombstones || []),
                ...(previous?.attachments || [])
                  .filter((old) => !p.attachments.some((a) => a.id === old.id))
                  .map((a) => p.id + "/" + a.id),
              ]),
            ];
            const attachments = p.attachments
              .filter((a) => {
                if (!state.attachmentTombstones.includes(p.id + "/" + a.id))
                  return true;
                if (!a.deletedAt)
                  throw new Error(
                    "此附件已永久删除或超过30天，无法恢复：" + a.name,
                  );
                return false;
              })
              .map((a) => {
                const old = previous?.attachments.find((b) => b.id === a.id);
                return old?.deletedAt &&
                  !a.deletedAt &&
                  !(
                    a.restoredAt &&
                    Date.parse(a.restoredAt) >= Date.parse(old.deletedAt)
                  )
                  ? { ...a, deletedAt: old.deletedAt }
                  : a;
              });
            const encoded = {
              ...p,
              attachments: await this.encode(attachments),
            };
            if (previous?.itemState)
              for (const [id, meta] of Object.entries(previous.itemState))
                if (meta.purgedAt) {
                  const position = previous.itemIds?.indexOf(id) ?? -1;
                  if (position >= 0 && encoded.result?.items[position])
                    encoded.result.items[position] =
                      previous.result.items[position];
                  encoded.itemState = { ...encoded.itemState, [id]: meta };
                }
            if (index < 0) state.packets.push(encoded);
            else state.packets[index] = encoded;
          }
          break;
        case "saveDraft":
          state.draft = {
            ...value,
            attachments: await this.encode(value.attachments),
          };
          break;
        case "saveUsage":
          state.usage = [
            ...state.usage.filter((x) => x.id !== value.id),
            value,
          ];
          break;
        case "removePacket":
          state.tombstones = [...new Set([...(state.tombstones || []), value])];
          state.packets = state.packets.filter((p) => p.id !== value);
          break;
        default:
          throw new Error("不支持的数据操作");
      }
      await this.commit(state);
      if (
        method === "removePacket" ||
        state.packets.some((p) =>
          Object.values(p.itemState || {}).some((m) => m.purgedAt),
        )
      ) {
        await fs.copyFile(
          this.file("state.json"),
          this.file("state.previous.json"),
        );
      }
      if (method === "savePackets")
        return value.map((p) =>
          state.packets.find((saved) => saved.id === p.id),
        );
      if (method === "saveDraft") return state.draft;
    });
  }
  cleanup(now = Date.now()) {
    return this.serial(async () => {
      const state = await this.load();
      state.tombstones = [
        ...new Set([
          ...(state.tombstones || []),
          ...state.packets
            .filter(
              (p) => p.deletedAt && now - Date.parse(p.deletedAt) >= retention,
            )
            .map((p) => p.id),
        ]),
      ];
      state.packets = state.packets.filter(
        (p) => !p.deletedAt || now - Date.parse(p.deletedAt) < retention,
      );
      for (const p of state.packets) {
        state.attachmentTombstones = [
          ...new Set([
            ...(state.attachmentTombstones || []),
            ...p.attachments
              .filter(
                (a) =>
                  a.deletedAt && now - Date.parse(a.deletedAt) >= retention,
              )
              .map((a) => p.id + "/" + a.id),
          ]),
        ];
        p.attachments = p.attachments.filter(
          (a) => !a.deletedAt || now - Date.parse(a.deletedAt) < retention,
        );
        for (let index = 0; index < (p.result?.items.length || 0); index++) {
          const id = p.itemIds?.[index] || `${p.id}:${index}`,
            meta = p.itemState?.[id];
          if (
            meta?.deletedAt &&
            now - Date.parse(meta.deletedAt) >= retention
          ) {
            p.result.items[index] = {
              kind: "other",
              title: "已永久删除",
              summary: "",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              evidence: [],
              sourceIds: [],
              due: null,
            };
            p.itemState[id] = { purgedAt: new Date(now).toISOString() };
          }
        }
        const referencedSources = new Set(
          (p.result?.items || []).flatMap((item) => item.sourceIds),
        );
        p.sources = p.sources.filter(
          (s) =>
            s.id === "input" ||
            referencedSources.has(s.id) ||
            p.attachments.some(
              (a) => s.id === a.id || s.id.startsWith(a.id + ":"),
            ),
        );
      }
      // Only delete files after the new reference set has been durably committed.
      await this.commit(state);
      await fs.copyFile(
        this.file("state.json"),
        this.file("state.previous.json"),
      );
      const referenced = new Set(
        [
          ...state.draft.attachments,
          ...state.packets.flatMap((p) => p.attachments),
        ].map((a) => a.hash),
      );
      let removed = 0,
        bytes = 0,
        failures = [];
      for (const name of await fs.readdir(this.file("files")))
        if (/^[a-f0-9]{64}$/.test(name) && !referenced.has(name)) {
          try {
            await fs.unlink(this.file("files/" + name));
            removed++;
          } catch (e) {
            failures.push(name + ": " + e.code);
          }
        }
      for (const hash of referenced) {
        try {
          bytes += (await fs.stat(this.file("files/" + hash))).size;
        } catch (e) {
          failures.push(hash + ": " + e.code);
        }
      }
      const cacheRoot = this.file("cache/archives");
      for (const name of await fs.readdir(cacheRoot).catch(() => []))
        if (name.startsWith("job-")) {
          const target = path.resolve(cacheRoot, name);
          if (!target.startsWith(path.resolve(cacheRoot) + path.sep)) continue;
          try {
            if (now - (await fs.stat(target)).mtimeMs > 60 * 60 * 1000)
              await fs.rm(target, { recursive: true, force: true });
          } catch (e) {
            failures.push("临时缓存：" + e.code);
          }
        }
      return {
        packets: state.packets.length,
        files: referenced.size,
        bytes,
        removed,
        failures,
      };
    });
  }
}
module.exports = { DesktopStore, validate, retention };
