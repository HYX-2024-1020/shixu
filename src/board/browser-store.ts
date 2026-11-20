import { database } from "../bucket/store";
import {
  BOARD_ID,
  boardView,
  boardPacket,
  storedBoard,
  applySourceEdits,
} from "../../shared/board.mjs";

// One IDB transaction covers the compare-and-swap, source edits and board write.
// This local browser adapter has no server credentials or file path privileges.
export async function browserBoardAction(action: string, value: any = {}) {
  const db = await database();
  return new Promise<any>((resolve, reject) => {
    const tx = db.transaction(
      "packets",
      ["load", "resource"].includes(action) ? "readonly" : "readwrite",
    );
    const store = tx.objectStore("packets"),
      request = store.getAll();
    let result: any, error: unknown;
    request.onsuccess = () => {
      try {
        const packets = request.result,
          prior = packets.find((p) => p.id === BOARD_ID);
        if (prior?.deletedAt) throw Error("看板已删除，请先恢复资料");
        if (action === "load") {
          result = boardView(prior, packets);
          return;
        }
        if (action === "resource") {
          const r = prior?.board.resources.find(
            (r: any) => r.id === value.id && !r.deletedAt,
          );
          const a = prior?.attachments.find(
            (a: any) => a.id === r?.attachmentId && !a.deletedAt,
          );
          if (!a?.bytes) throw Error("原件已移除或缺失");
          result = { name: a.name, type: a.type, bytes: a.bytes };
          return;
        }
        if ((prior?.boardStamp || "") !== value.stamp)
          throw Error("另一窗口已修改看板，本次输入保留，请重新读取后再编辑");
        const board = storedBoard(
          action === "addFiles"
            ? prior?.board || boardView(null, []).snapshot
            : value.snapshot,
        );
        let attachments = structuredClone(prior?.attachments || []);
        if (action === "save") {
          for (const p of applySourceEdits(
            packets,
            value.sourceEdits || [],
            value.sourceTokens || {},
          )) {
            store.put(p);
            packets[packets.findIndex((x) => x.id === p.id)] = p;
          }
          attachments = attachments.map((a: any) => {
            const r = board.resources.find((r: any) => r.attachmentId === a.id);
            if (!r) throw Error("请先移除资料，不能直接删除原件引用");
            return {
              ...a,
              deletedAt: r.deletedAt,
              restoredAt:
                a.deletedAt && !r.deletedAt
                  ? new Date().toISOString()
                  : a.restoredAt,
            };
          });
          if (
            board.resources.some(
              (r: any) =>
                !attachments.some((a: any) => a.id === r.attachmentId),
            )
          )
            throw Error("资料原件缺失");
        } else if (action === "addFiles") {
          if (
            !board.plans.some((p: any) => p.id === value.planningId) ||
            !value.files.length ||
            attachments.length + value.files.length > 20
          )
            throw Error("规划不存在或资料超过20份");
          for (const f of value.files) {
            if (!f.bytes.byteLength || f.bytes.byteLength > 10 * 1024 * 1024)
              throw Error("单文件须在1字节至10 MiB之间");
            const id = crypto.randomUUID();
            attachments.push({
              id,
              name: f.name,
              type: f.type,
              size: f.bytes.byteLength,
              bytes: f.bytes,
            });
            board.resources.push({
              id: crypto.randomUUID(),
              attachmentId: id,
              planningId: value.planningId,
              name: f.name,
              kind: /^image\/(png|jpeg|webp|gif)$/.test(f.type)
                ? "image"
                : "file",
              fileType: (f.name.split(".").pop() || "FILE")
                .slice(0, 8)
                .toUpperCase(),
              planLabel: "",
              createdAt: new Date().toISOString(),
              sizeLabel: `${Math.max(1, Math.round(f.bytes.byteLength / 1024))} KB`,
            });
          }
          if (
            attachments.reduce((n: number, a: any) => n + a.size, 0) >
            20 * 1024 * 1024
          )
            throw Error("资料合计不得超过20 MiB");
        } else throw Error("操作无效");
        const record = boardPacket(board, prior, crypto.randomUUID());
        record.attachments = attachments;
        store.put(record);
        result = boardView(record, [
          ...packets.filter((p) => p.id !== BOARD_ID),
          record,
        ]);
      } catch (e) {
        error = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () =>
      reject(error || Error("保存失败，请检查设备剩余空间"));
  });
}
