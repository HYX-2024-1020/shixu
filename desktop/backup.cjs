const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { zipSync, unzipSync, strToU8, strFromU8 } = require("fflate");
const { validate } = require("./storage.cjs");
async function exportBackup(store, target) {
  return store.serial(async () => {
    const state = await store.load(),
      files = { "manifest.json": strToU8(JSON.stringify(state)) };
    let total = 0;
    for (const a of [
      ...state.draft.attachments,
      ...state.packets.flatMap((p) => p.attachments),
    ]) {
      if (files["files/" + a.hash]) continue;
      const data = await fs.readFile(store.file("files/" + a.hash));
      if (crypto.createHash("sha256").update(data).digest("hex") !== a.hash)
        throw new Error("原件校验失败，备份中止：" + a.name);
      total += data.length;
      if (total > 256 * 1024 * 1024)
        throw new Error("备份超过 256MB，请分批整理或备份整个数据目录");
      files["files/" + a.hash] = data;
    }
    await fs.writeFile(target, zipSync(files, { level: 1 }));
    return `已备份 ${state.packets.length} 次投递、${Object.keys(files).length - 1} 个原件和草稿；密钥不包含在备份中`;
  });
}
async function importBackup(store, source) {
  const stat = await fs.stat(source);
  if (stat.size > 280 * 1024 * 1024) throw new Error("备份文件过大");
  let total = 0,
    count = 0;
  const files = unzipSync(await fs.readFile(source), {
    filter: (entry) => {
      total += entry.originalSize;
      count++;
      if (total > 280 * 1024 * 1024 || count > 10000)
        throw new Error("备份解压体积或文件数超限");
      if (
        entry.name !== "manifest.json" &&
        !/^files\/[a-f0-9]{64}$/.test(entry.name)
      )
        throw new Error("备份包含非法路径");
      return true;
    },
  });
  if (!files["manifest.json"]) throw new Error("缺少备份清单");
  const imported = validate(JSON.parse(strFromU8(files["manifest.json"])));
  const attachments = [
    ...imported.draft.attachments,
    ...imported.packets.flatMap((p) => p.attachments),
  ];
  for (const a of attachments) {
    const bytes = files["files/" + a.hash];
    if (
      !bytes ||
      crypto.createHash("sha256").update(bytes).digest("hex") !== a.hash
    )
      throw new Error("原件缺失或校验失败：" + a.name);
  }
  return store.serial(async () => {
    const current = await store.load();
    // Current records win; carry deletion registries across a fresh-directory restore.
    const currentIds = new Set(current.packets.map((p) => p.id));
    const currentAttachmentIds = new Set(
      current.packets.flatMap((p) =>
        p.attachments.map((a) => p.id + "/" + a.id),
      ),
    );
    const tombstones = [
      ...new Set([
        ...(current.tombstones || []),
        ...(imported.tombstones || []).filter((id) => !currentIds.has(id)),
      ]),
    ];
    const attachmentTombstones = [
      ...new Set([
        ...(current.attachmentTombstones || []),
        ...(imported.attachmentTombstones || []).filter(
          (id) => !currentAttachmentIds.has(id),
        ),
      ]),
    ];
    const restorable = imported.packets
      .filter((p) => !tombstones.includes(p.id))
      .map((p) => ({
        ...p,
        attachments: p.attachments.filter(
          (a) => !attachmentTombstones.includes(p.id + "/" + a.id),
        ),
      }));
    const merge = (old, next) => [
      ...new Map([...next, ...old].map((x) => [x.id, x])).values(),
    ];
    const packets = merge(current.packets, restorable);
    const draft =
      current.draft.text || current.draft.attachments.length
        ? current.draft
        : imported.draft;
    const referenced = new Set(
      [...draft.attachments, ...packets.flatMap((p) => p.attachments)].map(
        (a) => a.hash,
      ),
    );
    for (const a of [
      ...new Map(
        attachments
          .filter((a) => referenced.has(a.hash))
          .map((a) => [a.hash, a]),
      ).values(),
    ]) {
      const target = store.file("files/" + a.hash);
      let valid = false;
      try {
        valid =
          crypto
            .createHash("sha256")
            .update(await fs.readFile(target))
            .digest("hex") === a.hash;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (!valid) {
        await fs.writeFile(target + ".restoring", files["files/" + a.hash]);
        await fs.rename(target + ".restoring", target);
      }
    }
    await store.commit({
      ...current,
      packets,
      tombstones,
      attachmentTombstones,
      usage: merge(current.usage, imported.usage),
      draft,
    });
    return `恢复完成：共 ${packets.length} 次投递；本备份原件校验通过。已有记录与草稿优先保留，已永久删除记录不自动恢复`;
  });
}
module.exports = { exportBackup, importBackup };
