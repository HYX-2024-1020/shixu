const { randomUUID, createHash } = require("node:crypto");
const {
  BOARD_ID,
  boardView,
  boardPacket,
  storedBoard,
  applySourceEdits,
} = require("./generated/board.cjs");
class BoardService {
  constructor(cloud) {
    this.cloud = cloud;
  }
  lease() {
    return `${this.cloud.config.active}#${this.cloud.identityGeneration || 0}`;
  }
  async records(lease) {
    if (lease !== this.lease()) throw Error("账号已切换，请重新打开看板");
    return this.cloud.call("packets", undefined, this.cloud.config.active);
  }
  async load(lease) {
    const packets = await this.records(lease),
      record = packets.find((p) => p.id === BOARD_ID);
    if (record?.deletedAt)
      throw Error("看板资料已删除，请先处理同步或恢复，不能自动重建");
    return {
      ...boardView(record, packets),
      pending: this.cloud.space()?.client.pendingCount() || 0,
      error: this.cloud.lastError || "",
    };
  }
  async save(value, lease) {
    const packets = await this.records(lease),
      prior = packets.find((p) => p.id === BOARD_ID);
    if (prior?.deletedAt || prior?.syncConflict)
      throw Error("看板已删除或存在同步冲突，请在主程序中核对");
    if ((prior?.boardStamp || "") !== value.stamp)
      throw Error(
        "另一个窗口或设备已经修改看板；本次输入保留，请重新读取后重试",
      );
    const board = storedBoard(value.snapshot);
    const attachments = (prior?.attachments || []).map(({ bytes, ...a }) => {
      const r = board.resources.find((r) => r.attachmentId === a.id);
      if (!r) throw Error("资料须先移到最近移除，不能直接删除原件引用");
      if (a.deletedAt && !r.deletedAt)
        return {
          ...a,
          deletedAt: undefined,
          restoredAt: new Date().toISOString(),
        };
      return { ...a, ...(r.deletedAt ? { deletedAt: r.deletedAt } : {}) };
    });
    for (const r of board.resources)
      if (!attachments.some((a) => a.id === r.attachmentId))
        throw Error("资料原件缺失，请重新选择文件");
    const sources = applySourceEdits(
      packets,
      value.sourceEdits || [],
      value.sourceTokens || {},
    );
    const record = boardPacket(board, prior, randomUUID());
    record.attachments = attachments;
    // Local commits are atomic; cloud putMany below commits all operations to one
    // durable queue write. The existing server still versions each record.
    await this.cloud.call(
      "savePackets",
      [...sources, record],
      this.cloud.config.active,
    );
    return this.load(lease);
  }
  async addFiles(value, lease) {
    const packets = await this.records(lease),
      prior = packets.find((p) => p.id === BOARD_ID);
    if (
      prior?.deletedAt ||
      prior?.syncConflict ||
      (prior?.boardStamp || "") !== value.stamp
    )
      throw Error("看板已有新修改，请重新读取后添加资料");
    const board = structuredClone(prior?.board || boardView(null, []).snapshot);
    if (!board.plans.some((p) => p.id === value.planningId))
      throw Error("规划已不存在");
    if (
      !Array.isArray(value.files) ||
      !value.files.length ||
      value.files.length > 20
    )
      throw Error("请选择1至20份文件");
    const attachments = [...(prior?.attachments || [])];
    if (attachments.length + value.files.length > 20)
      throw Error("看板资料库最多20份原件，请整理后再添加");
    for (const f of value.files) {
      if (
        typeof f.name !== "string" ||
        !f.name.trim() ||
        f.name.length > 255 ||
        typeof f.type !== "string" ||
        f.type.length > 120 ||
        !(f.bytes instanceof ArrayBuffer)
      )
        throw Error("文件信息无效");
      const bytes = Buffer.from(f.bytes);
      if (!bytes.length || bytes.length > 10 * 1024 * 1024)
        throw Error("每份文件须在1字节至10 MiB之间");
      const id = randomUUID(),
        hash = createHash("sha256").update(bytes).digest("hex");
      // Strictly persist originals first. A library upload never silently falls
      // back to the account adapter's session-only emergency cache.
      await (this.cloud.space()?.cache || this.cloud.local).persistOriginal(
        hash,
        bytes,
      );
      attachments.push({
        id,
        name: f.name,
        type: f.type,
        size: bytes.length,
        hash,
      });
      board.resources.push({
        id: randomUUID(),
        attachmentId: id,
        planningId: value.planningId,
        name: f.name,
        kind: /^image\/(png|jpeg|webp|gif)$/.test(f.type) ? "image" : "file",
        fileType: (f.name.split(".").at(-1) || "FILE")
          .slice(0, 8)
          .toUpperCase(),
        planLabel: "",
        createdAt: new Date().toISOString(),
        sizeLabel: `${Math.max(1, Math.round(bytes.length / 1024))} KB`,
      });
    }
    if (attachments.reduce((n, a) => n + a.size, 0) > 20 * 1024 * 1024)
      throw Error("看板资料原件合计不得超过20 MiB");
    const record = boardPacket(board, prior, randomUUID());
    record.attachments = attachments;
    await this.cloud.call("savePackets", [record], this.cloud.config.active);
    // A volatile cache is never reported as reliably saved for this library.
    const rows = await this.records(lease),
      saved = rows.find((p) => p.id === BOARD_ID);
    if (saved.attachments.some((a) => a.localSaved === false))
      throw Error(
        "部分资料仅临时缓存，请保持窗口打开并检查磁盘和云同步；尚不能保证重启保留",
      );
    return this.load(lease);
  }
  async resource(id, lease, currentPlanOnly = false) {
    const packets = await this.records(lease),
      record = packets.find((p) => p.id === BOARD_ID);
    const resource = record?.board?.resources.find(
        (r) =>
          r.id === id &&
          !r.deletedAt &&
          (!currentPlanOnly || r.planningId === record.board.activePlanId),
      ),
      attachment = record?.attachments.find(
        (a) => a.id === resource?.attachmentId && !a.deletedAt,
      );
    if (!attachment || record.deletedAt || !attachment.bytes)
      throw Error("原件尚未下载、已移除或已清理；请先完成云同步或恢复原件");
    return {
      name: attachment.name,
      type: attachment.type,
      bytes: attachment.bytes,
    };
  }
}
module.exports = { BoardService };
